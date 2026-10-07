from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
import os
import logging
import re
import secrets
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()

# ---------- Authentication ----------
# The old admin PIN lived in the frontend source and the API had no checks at
# all, which was survivable on one PC and is not once this is on the internet.
# Credentials live in the environment; the password is only ever stored hashed.
AUTH_USERNAME = os.environ.get("APP_USERNAME", "admin").strip()
AUTH_PASSWORD_HASH = os.environ.get("APP_PASSWORD_HASH", "").strip()
JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
TOKEN_DAYS = int(os.environ.get("TOKEN_DAYS", "30"))

_missing = [
    name
    for name, value in (("APP_PASSWORD_HASH", AUTH_PASSWORD_HASH), ("JWT_SECRET", JWT_SECRET))
    if not value
]
if _missing:
    # Refusing to start is deliberate. A "no password configured" fallback is
    # exactly how an app ends up publicly readable without anyone noticing.
    # Name only what is actually missing - listing both when one is already
    # set sends people hunting for a problem that isn't there.
    _names = " and ".join(_missing)
    _present = [n for n in ("APP_PASSWORD_HASH", "JWT_SECRET") if n not in _missing]
    raise RuntimeError(
        "\n"
        "  ==========================================================\n"
        f"    {_names} {'is' if len(_missing) == 1 else 'are'} not set, so the server\n"
        "    will not start - it will not run without a login.\n"
        + (f"\n    {_present[0]} is already set. Leave it as it is.\n" if _present else "")
        + "\n"
        f"    Set {'it' if len(_missing) == 1 else 'them'} in ONE of these places:\n"
        "\n"
        "      On your PC   double-click set-password.bat\n"
        "      On Render    open this service, click Environment,\n"
        f"                   then Add Environment Variable for {_names}.\n"
        "                   Get the value from show-hosting-values.bat\n"
        "  ==========================================================\n"
    )

bearer_scheme = HTTPBearer(auto_error=False)


async def require_auth(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    """Applied to the whole API router, so a new endpoint is protected by default
    rather than by remembering to protect it."""
    if cred is None:
        raise HTTPException(401, "Sign in to continue")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Your session has expired - please sign in again")
    except jwt.PyJWTError:
        raise HTTPException(401, "Sign in to continue")
    return payload.get("sub")


# public: login and the health check Render pings
auth_router = APIRouter(prefix="/api")
# everything else - guarded at the router, not per endpoint
api_router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

MASTER_TYPES = {
    "customers": "customers",
    "brands": "brands",
    "exhibitions": "exhibitions",
    "salesmen": "salesmen",
    "seasons": "seasons",
    "expense_heads": "expense_heads",
    "lines": "lines",
}

# A "line" is one door-to-door trip: a salesman, an area, and the days he was
# there. Gopal's twelve days in Amravati and his following week in Katni are two
# lines, so their orders and their costs can be told apart - which they cannot be
# when everything hangs off the salesman alone.
LINE_OWNER = "salesman_id"

# Created on first run so the Expenses page isn't empty on day one.
# They are an ordinary master list - rename, delete or add to them freely.
DEFAULT_EXPENSE_HEADS = ["Hotel", "Vehicle", "Food", "Commission", "Misc"]

# Reads used to pass to_list(5000), which silently dropped everything past the
# 5000th document - wrong totals with no error anywhere. These bounds are a
# memory backstop only: crossing WARN_AT logs a warning, and hitting HARD_CAP
# logs an error, so truncation can never happen quietly again.
WARN_AT = 20_000
HARD_CAP = 250_000


async def fetch_all(cursor, what):
    """Drain a cursor completely, and complain loudly if the ceiling is reached."""
    docs = await cursor.to_list(HARD_CAP)
    if len(docs) >= HARD_CAP:
        logger.error(
            "TRUNCATED: '%s' hit the %s-document ceiling. Totals shown in the app are INCOMPLETE - "
            "the queries need pagination.", what, HARD_CAP,
        )
    elif len(docs) >= WARN_AT:
        logger.warning("'%s' returned %s documents - worth adding pagination before this grows further.", what, len(docs))
    return docs


# Created on startup. Without these, every dispatch lookup scans the whole
# collection, which is what made the app slow as the data grew.
INDEXES = [
    ("sale_orders", "id", True),
    ("sale_orders", "customer_id", False),
    # the brand ledger looks orders up by the brands on their lines
    ("sale_orders", "items.brand_id", False),
    ("sale_orders", "order_date", False),
    ("sale_orders", "created_at", False),
    ("dispatch_orders", "id", True),
    ("dispatch_orders", "sale_order_id", False),
    ("dispatch_orders", "created_at", False),
    ("expenses", "id", True),
    ("expenses", "exhibition_id", False),
    ("expenses", "salesman_id", False),
    ("expenses", "expense_date", False),
    ("expenses", "created_at", False),
    ("lines", LINE_OWNER, False),
] + [(coll, field, field == "id") for coll in MASTER_TYPES.values() for field in ("id", "name")]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def gen_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def fin_year(date_str):
    if not date_str:
        return "Unknown"
    try:
        y = int(str(date_str)[0:4])
        m = int(str(date_str)[5:7])
    except Exception:
        return "Unknown"
    start = y if m >= 4 else y - 1
    return f"FY {start}-{str(start + 1)[2:]}"


# ---------- Near-duplicate detection ----------
def norm_name(s):
    """Collapse case, punctuation and spacing, so 'R.K. Textiles ' and 'rk textiles' match."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (s or "").lower())).strip()


def edit_distance(a, b, cap=2):
    """Levenshtein distance, bailing out as soon as it exceeds `cap`."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def looks_like_same(a, b):
    """a and b are already normalised. Deliberately a warning, not a rule -
    the caller can always override, so leaning slightly noisy is the safe side."""
    if not a or not b:
        return False
    if a == b:
        return True
    # 'r k textiles' vs 'rk textiles' - initials written with and without dots
    if a.replace(" ", "") == b.replace(" ", ""):
        return True
    # 'raj textiles' vs 'raj textiles mumbai'
    if len(a) >= 5 and len(b) >= 5 and (a in b or b in a):
        return True
    # 'raj textiles' vs 'raj textile' - a typo or a plural
    if len(a) >= 5 and len(b) >= 5 and edit_distance(a, b) <= 2:
        return True
    return False


async def find_similar(mtype, name, exclude_id=None, within=None):
    """`within` narrows what counts as a duplicate. Two salesmen may each work an
    Amravati line, and warning about the other man's is just noise."""
    target = norm_name(name)
    if not target:
        return []
    docs = await fetch_all(db[MASTER_TYPES[mtype]].find(within or {}, {"_id": 0}), mtype)
    hits = [
        {"id": d["id"], "name": d["name"], "city": d.get("city")}
        for d in docs
        if d.get("id") != exclude_id and looks_like_same(target, norm_name(d.get("name")))
    ]
    return hits[:6]


# ---------- Models ----------
class MasterCreate(BaseModel):
    name: str
    city: Optional[str] = None
    rate: Optional[float] = None
    # lines only - which salesman works it, and when he was there
    salesman_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    force: bool = False  # set once the user has seen the near-duplicate warning and wants it anyway


class MasterBulkRow(BaseModel):
    name: str
    city: Optional[str] = None
    rate: Optional[float] = None
    salesman: Optional[str] = None  # by name - a spreadsheet has no ids in it
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class MasterBulk(BaseModel):
    names: Optional[List[str]] = None
    rows: Optional[List[MasterBulkRow]] = None


class MasterUpdate(BaseModel):
    name: str
    city: Optional[str] = None
    rate: Optional[float] = None
    salesman_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class BulkIds(BaseModel):
    ids: List[str] = []


class LoginIn(BaseModel):
    username: str
    password: str


class LineItem(BaseModel):
    id: str = Field(default_factory=lambda: gen_id("ITM"))
    brand_id: str
    rate: float = 0
    qty: float = 0


# What has been decided about an order, by hand. Deliberately separate from the
# derived status (pending / partial / done), which is only ever about quantity -
# an order can be half dispatched and on hold at the same time.
#   open       nothing special
#   hold       paused, but still owed - it stays in every outstanding total
#   half       the "50%" mark. A label only: no quantity or money changes
#   cancelled  nothing more will ship, so it stops counting as outstanding
class SaleOrderIn(BaseModel):
    id: str
    state: Literal["open", "hold", "half", "cancelled"] = "open"
    order_date: Optional[str] = None
    customer_id: Optional[str] = None
    dispatch_date: Optional[str] = None
    event_type: Literal["exhibition", "door_to_door"] = "exhibition"
    exhibition_id: Optional[str] = None
    salesman_id: Optional[str] = None
    line_id: Optional[str] = None  # which door-to-door trip it was taken on
    season_id: Optional[str] = None
    items: List[LineItem] = []


class DispatchItem(BaseModel):
    brand_id: str
    qty: float = 0
    # What this quantity is really worth. Order rates are only indicative, so
    # leaving this out falls back to them; filling it in overrides them
    # everywhere value is reported.
    amount: Optional[float] = None


class DispatchIn(BaseModel):
    sale_order_id: str
    dispatch_date: Optional[str] = None
    items: List[DispatchItem] = []


class SaleOrderBulk(BaseModel):
    orders: List[SaleOrderIn]


class ExpenseItem(BaseModel):
    id: str = Field(default_factory=lambda: gen_id("EXI"))
    head_id: str
    amount: float = 0
    note: Optional[str] = None


class ExpenseIn(BaseModel):
    """One voucher - a day or a trip - carrying several heads."""
    expense_date: Optional[str] = None
    event_type: Literal["exhibition", "door_to_door"] = "exhibition"
    exhibition_id: Optional[str] = None
    salesman_id: Optional[str] = None
    line_id: Optional[str] = None
    season_id: Optional[str] = None
    note: Optional[str] = None
    items: List[ExpenseItem] = []


# ---------- Helpers ----------
async def get_name_map(coll):
    docs = await fetch_all(db[coll].find({}, {"_id": 0, "id": 1, "name": 1}), coll)
    return {d["id"]: d["name"] for d in docs}


async def get_city_map():
    docs = await fetch_all(db.customers.find({}, {"_id": 0, "id": 1, "city": 1}), "customers")
    return {c["id"]: c.get("city", "") for c in docs}


async def dispatched_by_brand(sale_order_id):
    result = {}
    async for d in db.dispatch_orders.find({"sale_order_id": sale_order_id}, {"_id": 0}):
        for it in d.get("items", []):
            result[it["brand_id"]] = result.get(it["brand_id"], 0) + (it.get("qty") or 0)
    return result


async def dispatched_detail_bulk(sale_order_ids):
    """{sale_order_id: {brand_id: {qty, amount, qty_priced}}} in one round trip.

    qty_priced is how much of qty came from dispatch lines that recorded a real
    amount. Older dispatches have none, and a brand can be part priced and part
    not, so the two are tracked separately rather than assumed to move together.
    """
    result = {oid: {} for oid in sale_order_ids or ()}
    # None means every dispatch, so an endpoint reading every order can fetch
    # both at once instead of waiting for the order ids first.
    query = {} if sale_order_ids is None else {"sale_order_id": {"$in": list(sale_order_ids)}}
    async for d in db.dispatch_orders.find(query, {"_id": 0}):
        bucket = result.setdefault(d["sale_order_id"], {})
        for it in d.get("items", []):
            b = bucket.setdefault(it["brand_id"], {"qty": 0.0, "amount": 0.0, "qty_priced": 0.0})
            qty = it.get("qty") or 0
            b["qty"] += qty
            if it.get("amount") is not None:
                b["amount"] += it.get("amount") or 0
                b["qty_priced"] += qty
    return result


async def dispatched_by_brand_bulk(sale_order_ids):
    """Quantities only - {sale_order_id: {brand_id: qty}}."""
    detail = await dispatched_detail_bulk(sale_order_ids)
    return {oid: {bid: d["qty"] for bid, d in brands.items()} for oid, brands in detail.items()}


def brand_dispatched_value(detail, fallback_rate):
    """Actual amounts where they were entered, order rates for the rest."""
    d = detail or {}
    unpriced = max(0.0, (d.get("qty") or 0) - (d.get("qty_priced") or 0))
    return (d.get("amount") or 0.0) + unpriced * fallback_rate


def brand_rates(order):
    """Per-brand blended rate from the order - the fallback when no actual amount
    was recorded. Blended because one brand can appear on several lines."""
    agg = {}
    for it in order.get("items", []):
        b = it["brand_id"]
        q = it.get("qty") or 0
        agg.setdefault(b, {"qty": 0.0, "amount": 0.0})
        agg[b]["qty"] += q
        agg[b]["amount"] += q * (it.get("rate") or 0)
    return {b: (a["amount"] / a["qty"] if a["qty"] > 0 else 0) for b, a in agg.items()}


def compute_order_totals(order, dispatched):
    ordered_by_brand = {}
    amount = 0.0
    for it in order.get("items", []):
        q = it.get("qty") or 0
        ordered_by_brand[it["brand_id"]] = ordered_by_brand.get(it["brand_id"], 0) + q
        amount += q * (it.get("rate") or 0)

    ordered_qty = sum(ordered_by_brand.values())
    pending_by_brand = {}
    for bid, oq in ordered_by_brand.items():
        pending_by_brand[bid] = max(0, oq - dispatched.get(bid, 0))
    pending_qty = sum(pending_by_brand.values())
    dispatched_qty = ordered_qty - pending_qty

    if ordered_qty == 0:
        status = "pending"
    elif dispatched_qty <= 0:
        status = "pending"
    elif pending_qty <= 0:
        status = "done"
    else:
        status = "partial"

    # Zeroed after the status is worked out, not before: what is outstanding
    # changes, what already happened does not. A cancelled order that was half
    # dispatched still reads as partial, and still owns that dispatch.
    if (order.get("state") or "open") == "cancelled":
        pending_by_brand = {bid: 0 for bid in pending_by_brand}
        pending_qty = 0

    per_unit = (amount / ordered_qty) if ordered_qty > 0 else 0
    pending_value = per_unit * pending_qty

    return {
        "ordered_qty": ordered_qty,
        "dispatched_qty": dispatched_qty,
        "pending_qty": pending_qty,
        "amount": amount,
        "status": status,
        "pending_value": pending_value,
        "pending_by_brand": pending_by_brand,
    }


async def enrich_order(order):
    dispatched = await dispatched_by_brand(order["id"])
    totals = compute_order_totals(order, dispatched)
    return {**order, "state": order.get("state") or "open",
            "totals": {k: v for k, v in totals.items() if k != "pending_by_brand"}}


async def enrich_orders(orders):
    """Bulk version of enrich_order for lists - one dispatch query total instead of one per order."""
    dispatched_map = await dispatched_by_brand_bulk([o["id"] for o in orders])
    result = []
    for o in orders:
        totals = compute_order_totals(o, dispatched_map.get(o["id"], {}))
        result.append({**o, "state": o.get("state") or "open",
                       "totals": {k: v for k, v in totals.items() if k != "pending_by_brand"}})
    return result


def build_items(order, brands):
    """Line items with both the brand name (to display) and the brand id (to edit)."""
    return [
        {
            "id": it.get("id"),
            "brand_id": it.get("brand_id"),
            "brand": brands.get(it["brand_id"], "Unknown"),
            "rate": it.get("rate", 0),
            "qty": it.get("qty", 0),
        }
        for it in order.get("items", [])
    ]


def build_brand_rows(order, dispatched, brands, detail=None):
    """Per-brand ordered / dispatched / pending totals - what the dispatch dialog runs on."""
    ordered_bb = {}
    for it in order.get("items", []):
        ordered_bb[it["brand_id"]] = ordered_bb.get(it["brand_id"], 0) + (it.get("qty") or 0)
    rates = brand_rates(order)
    cancelled = (order.get("state") or "open") == "cancelled"
    rows = []
    for bid, oq in ordered_bb.items():
        disp = min(dispatched.get(bid, 0), oq)
        row = {
            "brand_id": bid,
            "brand": brands.get(bid, "Unknown"),
            "ordered": oq,
            "dispatched": disp,
            "pending": 0 if cancelled else max(0, oq - disp),
            # so the dispatch form can suggest an amount to start from
            "rate": rates.get(bid, 0),
            "ordered_value": oq * rates.get(bid, 0),
        }
        if detail is not None:
            row["dispatched_value"] = brand_dispatched_value(detail.get(bid), rates.get(bid, 0))
        rows.append(row)
    return rows


# ---------- Masters ----------
@api_router.get("/masters/{mtype}")
async def list_masters(mtype: str):
    if mtype not in MASTER_TYPES:
        raise HTTPException(404, "Unknown master type")
    docs = await fetch_all(db[MASTER_TYPES[mtype]].find({}, {"_id": 0}).sort("name", 1), mtype)
    return docs


@api_router.post("/masters/{mtype}")
async def create_master(mtype: str, body: MasterCreate):
    if mtype not in MASTER_TYPES:
        raise HTTPException(404, "Unknown master type")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    city = (body.city or "").strip()
    if mtype == "customers" and not city:
        raise HTTPException(400, "City is required for customers")
    owner = (body.salesman_id or "").strip()
    if mtype == "lines":
        if not owner:
            raise HTTPException(400, "Choose which salesman works this line")
        if not await db.salesmen.find_one({"id": owner}):
            raise HTTPException(400, "That salesman no longer exists - pick another")
    if not body.force:
        # Only the same salesman's own lines can be duplicates of each other.
        similar = await find_similar(mtype, name, within={LINE_OWNER: owner} if mtype == "lines" else None)
        if similar:
            # 409 rather than 400 so the UI can tell "needs confirming" apart from
            # "invalid", and offer to use the existing record instead.
            raise HTTPException(409, {
                "message": f"“{name}” looks like {'an existing record' if len(similar) == 1 else 'existing records'} you already have.",
                "similar": similar,
            })
    doc = {"id": gen_id(mtype[:4].upper()), "name": name, "created_at": now_iso()}
    if mtype == "customers":
        doc["city"] = city
    if mtype == "brands":
        doc["rate"] = float(body.rate) if body.rate is not None else 0
    if mtype == "lines":
        doc[LINE_OWNER] = owner
        doc["start_date"] = body.start_date or None
        doc["end_date"] = body.end_date or None
    await db[MASTER_TYPES[mtype]].insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "created_at"}


@api_router.post("/masters/{mtype}/bulk")
async def bulk_master(mtype: str, body: MasterBulk):
    if mtype not in MASTER_TYPES:
        raise HTTPException(404, "Unknown master type")
    docs = await fetch_all(db[MASTER_TYPES[mtype]].find({}, {"_id": 0}), mtype)
    # A line's name is only taken within its own salesman - two men can both
    # work Amravati - so what counts as "already there" depends on the type.
    existing = {(d.get(LINE_OWNER, ""), d["name"].lower()) if mtype == "lines" else ("", d["name"].lower()) for d in docs}
    by_salesman = {}
    if mtype == "lines":
        by_salesman = {norm_name(s["name"]): s["id"] for s in await fetch_all(db.salesmen.find({}, {"_id": 0}), "salesmen")}
    incoming = body.rows if body.rows else [MasterBulkRow(name=n) for n in (body.names or [])]
    added, skipped = 0, 0
    for row in incoming:
        name = (row.name or "").strip()
        if not name:
            continue
        owner = ""
        if mtype == "lines":
            owner = by_salesman.get(norm_name(row.salesman or ""), "")
            if not owner:
                # No salesman, no line - it would be untrackable, which is the
                # whole reason lines exist.
                skipped += 1
                continue
        if (owner, name.lower()) in existing:
            continue
        existing.add((owner, name.lower()))
        doc = {"id": gen_id(mtype[:4].upper()), "name": name, "created_at": now_iso()}
        if mtype == "customers":
            doc["city"] = (row.city or "").strip()
        if mtype == "brands":
            doc["rate"] = float(row.rate) if row.rate is not None else 0
        if mtype == "lines":
            doc[LINE_OWNER] = owner
            doc["start_date"] = row.start_date or None
            doc["end_date"] = row.end_date or None
        await db[MASTER_TYPES[mtype]].insert_one(doc)
        added += 1
    return {"added": added, "skipped": skipped} if skipped else {"added": added}


@api_router.put("/masters/{mtype}/{mid}")
async def update_master(mtype: str, mid: str, body: MasterUpdate):
    if mtype not in MASTER_TYPES:
        raise HTTPException(404, "Unknown master type")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    update = {"name": name}
    if mtype == "customers":
        city = (body.city or "").strip()
        if not city:
            raise HTTPException(400, "City is required for customers")
        update["city"] = city
    if mtype == "brands":
        update["rate"] = float(body.rate) if body.rate is not None else 0
    if mtype == "lines":
        owner = (body.salesman_id or "").strip()
        if not owner:
            raise HTTPException(400, "Choose which salesman works this line")
        if not await db.salesmen.find_one({"id": owner}):
            raise HTTPException(400, "That salesman no longer exists - pick another")
        update[LINE_OWNER] = owner
        update["start_date"] = body.start_date or None
        update["end_date"] = body.end_date or None
    res = await db[MASTER_TYPES[mtype]].update_one({"id": mid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"id": mid, **update}


@api_router.post("/masters/{mtype}/bulk-delete")
async def bulk_delete_masters(mtype: str, body: BulkIds):
    if mtype not in MASTER_TYPES:
        raise HTTPException(404, "Unknown master type")
    res = await db[MASTER_TYPES[mtype]].delete_many({"id": {"$in": body.ids}})
    return {"deleted": res.deleted_count}


@api_router.delete("/masters/{mtype}/{mid}")
async def delete_master(mtype: str, mid: str):
    if mtype not in MASTER_TYPES:
        raise HTTPException(404, "Unknown master type")
    await db[MASTER_TYPES[mtype]].delete_one({"id": mid})
    return {"ok": True}


# ---------- Sale Orders ----------
@api_router.get("/sale-orders")
async def list_sale_orders():
    orders = await fetch_all(db.sale_orders.find({}, {"_id": 0}).sort("created_at", -1), "sale_orders")
    return await enrich_orders(orders)


@api_router.post("/sale-orders")
async def create_sale_order(body: SaleOrderIn):
    oid = body.id.strip()
    if not oid:
        raise HTTPException(400, "Sale Order ID required")
    if await db.sale_orders.find_one({"id": oid}):
        raise HTTPException(400, f"Sale Order '{oid}' already exists")
    doc = body.model_dump()
    doc["id"] = oid
    doc["created_at"] = now_iso()
    await db.sale_orders.insert_one(dict(doc))
    return await enrich_order({k: v for k, v in doc.items() if k != "_id"})


@api_router.put("/sale-orders/{order_id}")
async def update_sale_order(order_id: str, body: SaleOrderIn):
    existing = await db.sale_orders.find_one({"id": order_id})
    if not existing:
        raise HTTPException(404, "Sale order not found")
    new_id = body.id.strip()
    if new_id != order_id and await db.sale_orders.find_one({"id": new_id}):
        raise HTTPException(400, f"Sale Order '{new_id}' already exists")
    doc = body.model_dump()
    doc["id"] = new_id
    doc["created_at"] = existing.get("created_at", now_iso())
    await db.sale_orders.delete_one({"id": order_id})
    await db.sale_orders.insert_one(dict(doc))
    if new_id != order_id:
        await db.dispatch_orders.update_many({"sale_order_id": order_id}, {"$set": {"sale_order_id": new_id}})
    return await enrich_order({k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/sale-orders/{order_id}")
async def get_sale_order(order_id: str):
    """One fully-loaded order plus its customer - enough to drive the edit and
    dispatch dialogs from any page, not just the customer ledger."""
    o = await db.sale_orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Sale order not found")
    brands, exhibitions, salesmen, seasons, lines, detail_map, customer = await asyncio.gather(
        get_name_map("brands"), get_name_map("exhibitions"), get_name_map("salesmen"),
        get_name_map("seasons"), get_name_map("lines"), dispatched_detail_bulk([order_id]),
        db.customers.find_one({"id": o.get("customer_id")}, {"_id": 0}),
    )
    detail = detail_map.get(order_id, {})
    dispatched = {bid: d["qty"] for bid, d in detail.items()}
    t = compute_order_totals(o, dispatched)
    t["dispatched_value"] = order_dispatched_value(o, detail)
    return {
        "order": {
            **o,
            "state": o.get("state") or "open",
            "exhibition": exhibitions.get(o.get("exhibition_id")),
            "salesman": salesmen.get(o.get("salesman_id")),
            "line": lines.get(o.get("line_id")),
            "season": seasons.get(o.get("season_id")),
            "items": build_items(o, brands),
            "brand_rows": build_brand_rows(o, dispatched, brands, detail),
            "totals": {k: v for k, v in t.items() if k != "pending_by_brand"},
        },
        "customer": customer,
    }


@api_router.post("/sale-orders/bulk-delete")
async def bulk_delete_sale_orders(body: BulkIds):
    res = await db.sale_orders.delete_many({"id": {"$in": body.ids}})
    await db.dispatch_orders.delete_many({"sale_order_id": {"$in": body.ids}})
    return {"deleted": res.deleted_count}


@api_router.delete("/sale-orders/{order_id}")
async def delete_sale_order(order_id: str):
    await db.sale_orders.delete_one({"id": order_id})
    await db.dispatch_orders.delete_many({"sale_order_id": order_id})
    return {"ok": True}


@api_router.post("/sale-orders/bulk")
async def bulk_sale_orders(body: SaleOrderBulk):
    added, skipped = 0, 0
    for o in body.orders:
        oid = o.id.strip()
        if not oid or await db.sale_orders.find_one({"id": oid}):
            skipped += 1
            continue
        doc = o.model_dump()
        doc["id"] = oid
        doc["created_at"] = now_iso()
        await db.sale_orders.insert_one(dict(doc))
        added += 1
    return {"added": added, "skipped": skipped}


# ---------- Dispatch Orders ----------
@api_router.get("/dispatch-orders")
async def list_dispatch_orders():
    docs = await fetch_all(db.dispatch_orders.find({}, {"_id": 0}).sort("created_at", -1), "dispatch_orders")
    for d in docs:
        priced = [it for it in d.get("items", []) if it.get("amount") is not None]
        # None rather than 0 - "nobody entered an amount" is not "it was free"
        d["total_amount"] = sum(it.get("amount") or 0 for it in priced) if priced else None
        d["fully_priced"] = len(priced) == len(d.get("items", [])) and bool(priced)
    return docs


@api_router.post("/dispatch-orders")
async def create_dispatch(body: DispatchIn):
    order = await db.sale_orders.find_one({"id": body.sale_order_id}, {"_id": 0})
    if not order:
        raise HTTPException(400, "Sale order not found")
    if (order.get("state") or "open") == "cancelled":
        raise HTTPException(400, "This order is cancelled. Set it back to open before dispatching against it.")
    items = [it.model_dump() for it in body.items if (it.qty or 0) > 0]
    if not items:
        raise HTTPException(400, "Enter at least one dispatch quantity")

    ordered = {}
    for it in order.get("items", []):
        ordered[it["brand_id"]] = ordered.get(it["brand_id"], 0) + (it.get("qty") or 0)
    already = await dispatched_by_brand(body.sale_order_id)
    for it in items:
        pending = ordered.get(it["brand_id"], 0) - already.get(it["brand_id"], 0)
        if it["qty"] > pending:
            raise HTTPException(400, f"Dispatch qty {it['qty']} exceeds pending {pending} for a brand")
    doc = {
        "id": gen_id("DSP"),
        "sale_order_id": body.sale_order_id,
        "dispatch_date": body.dispatch_date,
        "items": items,
        "created_at": now_iso(),
    }
    await db.dispatch_orders.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.post("/dispatch-orders/bulk-delete")
async def bulk_delete_dispatches(body: BulkIds):
    res = await db.dispatch_orders.delete_many({"id": {"$in": body.ids}})
    return {"deleted": res.deleted_count}


@api_router.delete("/dispatch-orders/{dispatch_id}")
async def delete_dispatch(dispatch_id: str):
    await db.dispatch_orders.delete_one({"id": dispatch_id})
    return {"ok": True}


# ---------- Expenses ----------
def build_expense_items(exp, heads):
    return [
        {
            "id": it.get("id"),
            "head_id": it.get("head_id"),
            "head": heads.get(it.get("head_id"), "Unknown"),
            "amount": it.get("amount") or 0,
            "note": it.get("note") or "",
        }
        for it in exp.get("items", [])
    ]


def expense_total(exp):
    return sum((it.get("amount") or 0) for it in exp.get("items", []))


def doc_context(doc):
    """Where a voucher or an order belongs: an exhibition, or a salesman and the
    particular line he was working at the time.

    Kept separate from the row it ends up in, because the two are not the same
    question - the rows can be split by line while a filter still narrows by the
    salesman who worked them."""
    d2d = (doc.get("event_type") or "exhibition") == "door_to_door"
    return {
        "door_to_door": d2d,
        "exhibition_id": None if d2d else doc.get("exhibition_id"),
        "salesman_id": doc.get("salesman_id") if d2d else None,
        "line_id": doc.get("line_id") if d2d else None,
    }


def expense_target(exp):
    """Which exhibition or salesman this voucher is charged to.
    Returns (kind, id) - id is None when it wasn't assigned to one."""
    ctx = doc_context(exp)
    return ("salesman", ctx["salesman_id"]) if ctx["door_to_door"] else ("exhibition", ctx["exhibition_id"])


def order_gross_value(order):
    """Everything that was ordered, at the rates on the order."""
    return sum((it.get("qty") or 0) * (it.get("rate") or 0) for it in order.get("items", []))


def order_dispatched_value(order, detail):
    """What has actually gone out is worth. Uses the real amount entered against
    each dispatch line, and the order's rate only where none was entered."""
    rates = brand_rates(order)
    return sum(
        brand_dispatched_value(d, rates.get(bid, 0))
        for bid, d in (detail or {}).items()
    )


def in_range(date_str, start, end):
    if start and (not date_str or date_str < start):
        return False
    if end and (not date_str or date_str > end):
        return False
    return True


@api_router.get("/expenses")
async def list_expenses():
    heads, exhibitions, salesmen, seasons, lines, docs = await asyncio.gather(
        get_name_map("expense_heads"), get_name_map("exhibitions"), get_name_map("salesmen"),
        get_name_map("seasons"), get_name_map("lines"),
        fetch_all(db.expenses.find({}, {"_id": 0}).sort("expense_date", -1), "expenses"),
    )
    return [
        {
            **e,
            "exhibition": exhibitions.get(e.get("exhibition_id")),
            "salesman": salesmen.get(e.get("salesman_id")),
            "line": lines.get(e.get("line_id")),
            "season": seasons.get(e.get("season_id")),
            "items": build_expense_items(e, heads),
            "total": expense_total(e),
        }
        for e in docs
    ]


def expense_doc(body: "ExpenseIn"):
    items = [it.model_dump() for it in body.items if (it.amount or 0) != 0 and it.head_id]
    if not items:
        raise HTTPException(400, "Add at least one head with an amount")
    return {
        "expense_date": body.expense_date,
        "event_type": body.event_type,
        "exhibition_id": body.exhibition_id if body.event_type == "exhibition" else None,
        "salesman_id": body.salesman_id if body.event_type == "door_to_door" else None,
        "line_id": body.line_id if body.event_type == "door_to_door" else None,
        "season_id": body.season_id,
        "note": (body.note or "").strip() or None,
        "items": items,
    }


@api_router.post("/expenses")
async def create_expense(body: ExpenseIn):
    doc = expense_doc(body)
    doc["id"] = gen_id("EXP")
    doc["created_at"] = now_iso()
    await db.expenses.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseIn):
    existing = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Expense not found")
    doc = expense_doc(body)
    doc["id"] = expense_id
    doc["created_at"] = existing.get("created_at", now_iso())
    await db.expenses.delete_one({"id": expense_id})
    await db.expenses.insert_one(dict(doc))
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.post("/expenses/bulk-delete")
async def bulk_delete_expenses(body: BulkIds):
    res = await db.expenses.delete_many({"id": {"$in": body.ids}})
    return {"deleted": res.deleted_count}


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str):
    await db.expenses.delete_one({"id": expense_id})
    return {"ok": True}


@api_router.get("/expenses/summary")
async def expenses_summary(
    start: Optional[str] = None,
    end: Optional[str] = None,
    basis: Literal["order", "dispatch"] = "order",
    season: Optional[str] = None,
    exhibition: Optional[str] = None,
    salesman: Optional[str] = None,
    line: Optional[str] = None,
    group: Literal["target", "line"] = "target",
):
    """Spend per exhibition and per salesman, broken down by head, next to what
    each one brought in.

    basis picks what "brought in" means:
      order    - everything ordered, whether it has shipped or not
      dispatch - only what has actually gone out

    Both figures are always returned, so the page can show one against the other.
    start/end filter on expense_date and order_date - an order is credited to the
    event where it was taken, no matter when the goods later left the building.

    season / exhibition / salesman / line narrow both sides the same way, so the
    spend and the sales on any row always describe the same slice of the business.

    group picks what a row is:
      target - one row per exhibition and per salesman (how it has always read)
      line   - door-to-door splits into one row per trip, so twelve days in
               Amravati and the following week in Katni can be told apart.
               Exhibitions are unaffected; they have no lines.
    """
    heads, exhibitions, salesmen, line_docs, expenses, orders, dispatched_map = await asyncio.gather(
        get_name_map("expense_heads"), get_name_map("exhibitions"), get_name_map("salesmen"),
        fetch_all(db.lines.find({}, {"_id": 0}), "lines"),
        fetch_all(db.expenses.find({}, {"_id": 0}), "expenses"),
        fetch_all(db.sale_orders.find({}, {"_id": 0}), "sale_orders"),
        dispatched_detail_bulk(None),
    )
    line_map = {ln["id"]: ln for ln in line_docs}

    def keep(ctx, season_id, date_str):
        """One gate for expenses and orders alike - if the two sides were filtered
        differently, a row's cost and its sales would describe different things."""
        if not in_range(date_str, start, end):
            return False
        if season and season_id != season:
            return False
        if exhibition and ctx["exhibition_id"] != exhibition:
            return False
        if salesman and ctx["salesman_id"] != salesman:
            return False
        if line and ctx["line_id"] != line:
            return False
        return True

    def bucket_for(ctx):
        """Which row this belongs in - a different question from `keep`."""
        if not ctx["door_to_door"]:
            return "exhibition", ctx["exhibition_id"]
        if group == "line":
            return "line", ctx["line_id"]
        return "salesman", ctx["salesman_id"]

    rows = {}

    def bucket(kind, ref_id):
        key = f"{kind}:{ref_id or 'unassigned'}"
        if key not in rows:
            owner = None
            if kind == "line":
                ln = line_map.get(ref_id)
                owner = salesmen.get(ln.get(LINE_OWNER)) if ln else None
                # Whose trip it was rides along with the name. "Amravati" alone
                # says nothing when two salesmen both work it.
                name = f"{ln['name']} · {owner or 'Unknown'}" if ln else (
                    "No line set" if not ref_id else "Deleted record"
                )
            else:
                names = exhibitions if kind == "exhibition" else salesmen
                owner = salesmen.get(ref_id) if kind == "salesman" else None
                name = names.get(ref_id) or ("Not assigned" if not ref_id else "Deleted record")
            rows[key] = {
                "key": key,
                "type": kind,
                "id": ref_id,
                "name": name,
                "salesman": owner,
                "expense": 0.0,
                "by_head": {},
                "order_value": 0.0,
                "dispatched_value": 0.0,
                "order_count": 0,
                "voucher_count": 0,
            }
        return rows[key]

    for e in expenses:
        ctx = doc_context(e)
        if not keep(ctx, e.get("season_id"), e.get("expense_date")):
            continue
        r = bucket(*bucket_for(ctx))
        r["voucher_count"] += 1
        for it in e.get("items", []):
            amt = it.get("amount") or 0
            r["expense"] += amt
            name = heads.get(it.get("head_id"), "Unknown")
            r["by_head"][name] = r["by_head"].get(name, 0) + amt

    for o in orders:
        ctx = doc_context(o)
        if not keep(ctx, o.get("season_id"), o.get("order_date")):
            continue
        r = bucket(*bucket_for(ctx))
        disp = order_dispatched_value(o, dispatched_map.get(o["id"], {}))
        # Nothing more is coming from a cancelled order, so only what actually
        # shipped counts as ordered. Counting the whole order would leave the
        # difference sitting in pending value for good.
        gross = disp if (o.get("state") or "open") == "cancelled" else order_gross_value(o)
        r["order_count"] += 1
        r["order_value"] += gross
        r["dispatched_value"] += disp

    pick = "order_value" if basis == "order" else "dispatched_value"

    out = []
    for r in rows.values():
        # Nothing happened either side - don't clutter the table with it.
        if r["expense"] == 0 and r["order_count"] == 0:
            continue
        r["by_head"] = [{"name": k, "amount": v} for k, v in sorted(r["by_head"].items(), key=lambda x: -x[1])]
        r["value"] = r[pick]
        r["pending_value"] = r["order_value"] - r["dispatched_value"]
        r["net"] = r["value"] - r["expense"]
        r["expense_pct"] = (r["expense"] / r["value"] * 100) if r["value"] > 0 else None
        out.append(r)
    out.sort(key=lambda x: -x["expense"])

    by_head_all = {}
    for r in out:
        for h in r["by_head"]:
            by_head_all[h["name"]] = by_head_all.get(h["name"], 0) + h["amount"]

    totals = {
        "expense": sum(r["expense"] for r in out),
        "order_value": sum(r["order_value"] for r in out),
        "dispatched_value": sum(r["dispatched_value"] for r in out),
        "voucher_count": sum(r["voucher_count"] for r in out),
    }
    totals["value"] = totals["order_value"] if basis == "order" else totals["dispatched_value"]
    totals["pending_value"] = totals["order_value"] - totals["dispatched_value"]
    totals["net"] = totals["value"] - totals["expense"]
    totals["expense_pct"] = (totals["expense"] / totals["value"] * 100) if totals["value"] > 0 else None

    return {
        "basis": basis,
        "group": group,
        "rows": out,
        "totals": totals,
        "by_head": [{"name": k, "amount": v} for k, v in sorted(by_head_all.items(), key=lambda x: -x[1])],
    }


# ---------- Dashboard ----------
@api_router.get("/dashboard")
async def dashboard(customer_id: Optional[str] = None, brand_id: Optional[str] = None,
                    season_id: Optional[str] = None, event_type: Optional[str] = None,
                    city: Optional[str] = None, line_id: Optional[str] = None,
                    overdue_only: bool = False):
    all_orders, customers, brands, seasons, city_map, dispatched_map = await asyncio.gather(
        fetch_all(db.sale_orders.find({}, {"_id": 0}), "sale_orders"),
        get_name_map("customers"), get_name_map("brands"), get_name_map("seasons"),
        get_city_map(), dispatched_by_brand_bulk(None),
    )
    today_str = datetime.now(timezone.utc).date().isoformat()

    def keep(o):
        if customer_id and o.get("customer_id") != customer_id:
            return False
        if season_id and o.get("season_id") != season_id:
            return False
        if event_type and (o.get("event_type") or "exhibition") != event_type:
            return False
        if brand_id and not any(it.get("brand_id") == brand_id for it in o.get("items", [])):
            return False
        if city and city_map.get(o.get("customer_id"), "") != city:
            return False
        if line_id and o.get("line_id") != line_id:
            return False
        # A cancelled order is not work waiting to be done, so it is not on a
        # dashboard about what is still owed - not even in the order count.
        if (o.get("state") or "open") == "cancelled":
            return False
        return True

    orders = [o for o in all_orders if keep(o)]

    total_orders = 0
    orders_with_pending = 0
    pending_pieces = 0.0
    pending_value = 0.0
    by_customer = {}
    by_brand = {}
    by_season = {}
    open_orders = []

    for o in orders:
        dispatched = dispatched_map.get(o["id"], {})
        t = compute_order_totals(o, dispatched)
        is_overdue = bool(o.get("dispatch_date") and o.get("dispatch_date") < today_str and t["pending_qty"] > 0)
        if overdue_only and not is_overdue:
            continue
        total_orders += 1
        if t["pending_qty"] > 0:
            orders_with_pending += 1
            pending_pieces += t["pending_qty"]
            pending_value += t["pending_value"]
            cname = customers.get(o.get("customer_id"), "Unassigned")
            by_customer[cname] = by_customer.get(cname, 0) + t["pending_qty"]
            sname = seasons.get(o.get("season_id")) or "No Season"
            by_season[sname] = by_season.get(sname, 0) + t["pending_qty"]
            for bid, pq in t["pending_by_brand"].items():
                if pq > 0:
                    bname = brands.get(bid, "Unknown")
                    by_brand[bname] = by_brand.get(bname, 0) + pq
            open_orders.append({
                "id": o["id"],
                "state": o.get("state") or "open",
                "customer": cname,
                "city": city_map.get(o.get("customer_id"), ""),
                "order_date": o.get("order_date"),
                "dispatch_date": o.get("dispatch_date"),
                "ordered_qty": t["ordered_qty"],
                "dispatched_qty": t["dispatched_qty"],
                "pending_qty": t["pending_qty"],
                "amount": t["amount"],
                "status": t["status"],
                "overdue": is_overdue,
            })

    open_orders.sort(key=lambda x: (x.get("dispatch_date") or "9999"))
    overdue_count = sum(1 for x in open_orders if x["overdue"])
    return {
        "total_orders": total_orders,
        "orders_with_pending": orders_with_pending,
        "pending_pieces": pending_pieces,
        "pending_value": pending_value,
        "overdue_count": overdue_count,
        "by_customer": [{"name": k, "qty": v} for k, v in sorted(by_customer.items(), key=lambda x: -x[1])],
        "by_brand": [{"name": k, "qty": v} for k, v in sorted(by_brand.items(), key=lambda x: -x[1])],
        "by_season": [{"name": k, "qty": v} for k, v in sorted(by_season.items(), key=lambda x: -x[1])],
        "open_orders": open_orders,
    }


@api_router.get("/reports")
async def reports():
    orders, customers, brands, exhibitions, salesmen, seasons, lines, city_map, detail_map = await asyncio.gather(
        fetch_all(db.sale_orders.find({}, {"_id": 0}), "sale_orders"),
        get_name_map("customers"), get_name_map("brands"), get_name_map("exhibitions"),
        get_name_map("salesmen"), get_name_map("seasons"), get_name_map("lines"),
        get_city_map(), dispatched_detail_bulk(None),
    )
    rows = []
    for o in orders:
        detail = detail_map.get(o["id"], {})
        dispatched = {bid: d["qty"] for bid, d in detail.items()}
        state = o.get("state") or "open"
        agg = {}
        for it in o.get("items", []):
            b = it["brand_id"]
            q = it.get("qty") or 0
            r = it.get("rate") or 0
            a = agg.setdefault(b, {"qty": 0, "amount": 0})
            a["qty"] += q
            a["amount"] += q * r
        for bid, a in agg.items():
            disp = min(dispatched.get(bid, 0), a["qty"])
            pending = 0 if state == "cancelled" else max(0, a["qty"] - disp)
            per_unit = (a["amount"] / a["qty"]) if a["qty"] > 0 else 0
            rows.append({
                "sale_order_id": o["id"],
                "state": state,
                "order_date": o.get("order_date"),
                "financial_year": fin_year(o.get("order_date")),
                "dispatch_date": o.get("dispatch_date"),
                "customer": customers.get(o.get("customer_id"), "Unassigned"),
                "city": city_map.get(o.get("customer_id"), ""),
                "event_type": o.get("event_type") or "exhibition",
                "exhibition": exhibitions.get(o.get("exhibition_id")) if o.get("event_type") == "exhibition" else None,
                "salesman": salesmen.get(o.get("salesman_id")) if o.get("event_type") == "door_to_door" else None,
                "line": lines.get(o.get("line_id")) if o.get("event_type") == "door_to_door" else None,
                "season": seasons.get(o.get("season_id")),
                "brand": brands.get(bid, "Unknown"),
                "ordered_qty": a["qty"],
                "dispatched_qty": disp,
                "pending_qty": pending,
                "amount": a["amount"],
                "pending_value": per_unit * pending,
                # actual amounts where they were entered against the dispatch,
                # order rates only for the rest
                "dispatched_value": brand_dispatched_value(detail.get(bid), per_unit),
            })
    return {"rows": rows}


# ---------- Customers overview & history ----------
@api_router.get("/customers")
async def customers_overview():
    customers, orders, dispatched_map = await asyncio.gather(
        fetch_all(db.customers.find({}, {"_id": 0}).sort("name", 1), "customers"),
        fetch_all(db.sale_orders.find({}, {"_id": 0}), "sale_orders"),
        dispatched_by_brand_bulk(None),
    )
    stats = {}
    for o in orders:
        dispatched = dispatched_map.get(o["id"], {})
        t = compute_order_totals(o, dispatched)
        s = stats.setdefault(o.get("customer_id"), {"order_count": 0, "pending_qty": 0, "amount": 0})
        s["order_count"] += 1
        s["pending_qty"] += t["pending_qty"]
        s["amount"] += t["amount"]
    return [{**c, **stats.get(c["id"], {"order_count": 0, "pending_qty": 0, "amount": 0})} for c in customers]


@api_router.get("/customers/{customer_id}/history")
async def customer_history(customer_id: str):
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(404, "Customer not found")
    brands, seasons, exhibitions, salesmen, lines, raw_orders = await asyncio.gather(
        get_name_map("brands"), get_name_map("seasons"), get_name_map("exhibitions"),
        get_name_map("salesmen"), get_name_map("lines"),
        fetch_all(db.sale_orders.find({"customer_id": customer_id}, {"_id": 0}).sort("order_date", -1), "sale_orders"),
    )
    detail_map = await dispatched_detail_bulk([o["id"] for o in raw_orders])
    orders = []
    order_ids = []
    agg = {"ordered": 0, "dispatched": 0, "pending": 0, "amount": 0, "dispatched_value": 0}
    for o in raw_orders:
        order_ids.append(o["id"])
        detail = detail_map.get(o["id"], {})
        dispatched = {bid: d["qty"] for bid, d in detail.items()}
        t = compute_order_totals(o, dispatched)
        # What has actually gone out is worth - actual dispatch amounts where
        # they were entered, order rates for the rest.
        t["dispatched_value"] = order_dispatched_value(o, detail)
        agg["ordered"] += t["ordered_qty"]
        agg["dispatched"] += t["dispatched_qty"]
        agg["pending"] += t["pending_qty"]
        agg["amount"] += t["amount"]
        agg["dispatched_value"] += t["dispatched_value"]
        items = build_items(o, brands)
        brand_rows = build_brand_rows(o, dispatched, brands, detail)
        orders.append({
            "id": o["id"],
            "state": o.get("state") or "open",
            "order_date": o.get("order_date"),
            "dispatch_date": o.get("dispatch_date"),
            "event_type": o.get("event_type"),
            # Display names (used by the table and the Excel statement export)
            "exhibition": exhibitions.get(o.get("exhibition_id")),
            "salesman": salesmen.get(o.get("salesman_id")),
            "line": lines.get(o.get("line_id")),
            "season": seasons.get(o.get("season_id")),
            # Raw IDs, so the ledger's Edit dialog can pre-fill the form
            "customer_id": o.get("customer_id"),
            "exhibition_id": o.get("exhibition_id"),
            "salesman_id": o.get("salesman_id"),
            "line_id": o.get("line_id"),
            "season_id": o.get("season_id"),
            "items": items,
            "brand_rows": brand_rows,
            "totals": {k: v for k, v in t.items() if k != "pending_by_brand"},
        })
    timeline = []
    if order_ids:
        async for d in db.dispatch_orders.find({"sale_order_id": {"$in": order_ids}}, {"_id": 0}):
            items = [
                {"brand": brands.get(it["brand_id"], "Unknown"), "qty": it.get("qty", 0), "amount": it.get("amount")}
                for it in d.get("items", [])
            ]
            priced = [it["amount"] for it in items if it["amount"] is not None]
            timeline.append({
                "id": d["id"],
                "sale_order_id": d["sale_order_id"],
                "dispatch_date": d.get("dispatch_date"),
                "created_at": d.get("created_at"),
                "items": items,
                "total": sum(it["qty"] for it in items),
                "value": sum(priced) if priced else None,
            })
    timeline.sort(key=lambda x: (x.get("dispatch_date") or x.get("created_at") or ""), reverse=True)
    return {"customer": customer, "orders": orders, "timeline": timeline, "summary": {**agg, "order_count": len(orders)}}


# ---------- Brands overview & history ----------
# The customer ledger read down the other axis. A customer's page answers "what
# does this shop still have coming"; a brand's answers "how is this brand
# moving, and who is holding it". Both are built from build_brand_rows, so
# neither invents its own arithmetic - the dispatched-value rule in CLAUDE.md
# only allows one implementation of that sum.
def blank_brand_stats():
    return {
        "order_count": 0,
        "customer_count": 0,
        "ordered_qty": 0,
        "dispatched_qty": 0,
        "pending_qty": 0,
        "amount": 0,
        "dispatched_value": 0,
    }


@api_router.get("/brands")
async def brands_overview():
    brand_docs, orders, detail_map = await asyncio.gather(
        fetch_all(db.brands.find({}, {"_id": 0}).sort("name", 1), "brands"),
        fetch_all(db.sale_orders.find({}, {"_id": 0}), "sale_orders"),
        dispatched_detail_bulk(None),
    )
    names = {b["id"]: b["name"] for b in brand_docs}
    stats = {}
    # Counted per brand, so the same order adds to every brand it carries - a
    # brand's "orders" is how many orders it appears on, not the whole book.
    buyers = {}
    for o in orders:
        detail = detail_map.get(o["id"], {})
        dispatched = {bid: d["qty"] for bid, d in detail.items()}
        for row in build_brand_rows(o, dispatched, names, detail):
            s = stats.setdefault(row["brand_id"], blank_brand_stats())
            s["order_count"] += 1
            s["ordered_qty"] += row["ordered"]
            s["dispatched_qty"] += row["dispatched"]
            s["pending_qty"] += row["pending"]
            s["amount"] += row["ordered_value"]
            s["dispatched_value"] += row["dispatched_value"]
            if o.get("customer_id"):
                buyers.setdefault(row["brand_id"], set()).add(o["customer_id"])
    for bid, s in stats.items():
        s["customer_count"] = len(buyers.get(bid, ()))
    return [{**b, **stats.get(b["id"], blank_brand_stats())} for b in brand_docs]


@api_router.get("/brands/{brand_id}/history")
async def brand_history(brand_id: str):
    brand = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    if not brand:
        raise HTTPException(404, "Brand not found")
    names, customers, seasons, exhibitions, salesmen, lines, city_map, raw_orders = await asyncio.gather(
        get_name_map("brands"), get_name_map("customers"), get_name_map("seasons"),
        get_name_map("exhibitions"), get_name_map("salesmen"), get_name_map("lines"), get_city_map(),
        fetch_all(db.sale_orders.find({"items.brand_id": brand_id}, {"_id": 0}).sort("order_date", -1), "sale_orders"),
    )
    detail_map = await dispatched_detail_bulk([o["id"] for o in raw_orders])
    orders = []
    order_ids = []
    order_customer = {}
    order_rate = {}
    agg = {"ordered": 0, "dispatched": 0, "pending": 0, "amount": 0, "dispatched_value": 0}
    for o in raw_orders:
        detail = detail_map.get(o["id"], {})
        dispatched = {bid: d["qty"] for bid, d in detail.items()}
        row = next((r for r in build_brand_rows(o, dispatched, names, detail) if r["brand_id"] == brand_id), None)
        if row is None:
            continue
        order_ids.append(o["id"])
        order_customer[o["id"]] = o.get("customer_id")
        order_rate[o["id"]] = row["rate"]
        # Status is the whole order's, not this brand's: an order is what gets
        # dispatched, and calling a line "done" while the rest of its order is
        # still outstanding would read as a shipment that never happened.
        t = compute_order_totals(o, dispatched)
        agg["ordered"] += row["ordered"]
        agg["dispatched"] += row["dispatched"]
        agg["pending"] += row["pending"]
        agg["amount"] += row["ordered_value"]
        agg["dispatched_value"] += row["dispatched_value"]
        orders.append({
            "id": o["id"],
            "state": o.get("state") or "open",
            "status": t["status"],
            "order_date": o.get("order_date"),
            "dispatch_date": o.get("dispatch_date"),
            "event_type": o.get("event_type"),
            "customer": customers.get(o.get("customer_id")),
            "customer_id": o.get("customer_id"),
            "city": city_map.get(o.get("customer_id"), ""),
            "exhibition": exhibitions.get(o.get("exhibition_id")),
            "salesman": salesmen.get(o.get("salesman_id")),
            "line": lines.get(o.get("line_id")),
            "season": seasons.get(o.get("season_id")),
            # This brand's share of the order, and the order's size behind it
            "rate": row["rate"],
            "ordered": row["ordered"],
            "dispatched": row["dispatched"],
            "pending": row["pending"],
            "amount": row["ordered_value"],
            "dispatched_value": row["dispatched_value"],
            "order_qty": t["ordered_qty"],
        })
    timeline = []
    if order_ids:
        async for d in db.dispatch_orders.find({"sale_order_id": {"$in": order_ids}}, {"_id": 0}):
            mine = [it for it in d.get("items", []) if it.get("brand_id") == brand_id]
            if not mine:
                continue
            priced = [it["amount"] for it in mine if it.get("amount") is not None]
            rate = order_rate.get(d["sale_order_id"], 0)
            timeline.append({
                "id": d["id"],
                "sale_order_id": d["sale_order_id"],
                "customer": customers.get(order_customer.get(d["sale_order_id"])),
                "dispatch_date": d.get("dispatch_date"),
                "created_at": d.get("created_at"),
                "qty": sum(it.get("qty") or 0 for it in mine),
                # What was actually typed against this dispatch. None, not 0:
                # nothing priced means "value it at the order rate", and a zero
                # would read as goods that went out free.
                "value": sum(priced) if priced else None,
                # What it is worth, on the one rule used everywhere - the amount
                # entered where there is one, the order's rate where there is
                # not. Summed over a brand these come back to exactly
                # brand_dispatched_value, which is what keeps the week and month
                # rollups from drifting from the totals printed above them.
                "dispatched_value": sum(
                    it["amount"] if it.get("amount") is not None else (it.get("qty") or 0) * rate
                    for it in mine
                ),
            })
    timeline.sort(key=lambda x: (x.get("dispatch_date") or x.get("created_at") or ""), reverse=True)
    return {
        "brand": brand,
        "orders": orders,
        "timeline": timeline,
        "summary": {
            **agg,
            "order_count": len(orders),
            "customer_count": len({c for c in order_customer.values() if c}),
        },
    }


# ---------- Backup ----------
BACKUP_COLLECTIONS = [
    "customers", "brands", "exhibitions", "salesmen", "seasons", "expense_heads", "lines",
    "sale_orders", "dispatch_orders", "expenses",
]


@api_router.get("/backup")
async def backup():
    """The whole database as plain JSON, with nothing stripped out.

    Restore it into any MongoDB with:  python restore_backup.py <file.json>
    (or double-click restore-backup.bat in the project root)."""
    collections = {}
    for coll in BACKUP_COLLECTIONS:
        collections[coll] = await fetch_all(db[coll].find({}, {"_id": 0}), coll)
    counts = {k: len(v) for k, v in collections.items()}
    logger.info("Backup taken: %s", counts)
    return {
        "app": "order-ledger",
        "format_version": 1,
        "database": os.environ.get("DB_NAME"),
        "taken_at": now_iso(),
        "counts": counts,
        "collections": collections,
    }


# ---------- Auth endpoints ----------
@auth_router.post("/auth/login")
async def login(body: LoginIn):
    name_ok = secrets.compare_digest((body.username or "").strip().lower(), AUTH_USERNAME.lower())
    # Always run the hash check, even when the username is wrong, so response
    # time doesn't reveal whether a username exists.
    try:
        pass_ok = bcrypt.checkpw((body.password or "").encode("utf-8"), AUTH_PASSWORD_HASH.encode("utf-8"))
    except Exception:
        pass_ok = False
    if not (name_ok and pass_ok):
        logger.warning("Failed sign-in attempt for username %r", (body.username or "")[:40])
        raise HTTPException(401, "Wrong username or password")
    expires = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    token = jwt.encode({"sub": AUTH_USERNAME, "exp": expires}, JWT_SECRET, algorithm="HS256")
    logger.info("Signed in as %s", AUTH_USERNAME)
    return {"token": token, "username": AUTH_USERNAME, "expires_at": expires.isoformat()}


@api_router.get("/auth/me")
async def whoami(user: str = Depends(require_auth)):
    """Used by the browser on load to check a stored token is still good."""
    return {"username": user}


@auth_router.get("/")
async def root():
    """Public health check - Render pings this to see the service is alive."""
    return {"message": "Order Ledger API", "status": "ok"}


@app.get("/")
async def service_root():
    """The bare service address, e.g. https://sale-order-api.onrender.com

    Anyone checking whether the API is alive will click that before anything
    else, so it answers instead of returning a bare 404. Carries no data and
    needs no login - it says nothing a stranger could not already guess.
    """
    return {
        "message": "Order Ledger API",
        "status": "ok",
        "hint": "This is the API, not the app. Open your website address instead.",
    }


app.include_router(auth_router)
app.include_router(api_router)

# allow_credentials is off because auth travels in the Authorization header,
# not cookies - which also means CORS_ORIGINS="*" stays valid for browsers.
_origins = [o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Order lists run to hundreds of kilobytes of JSON; compressed they are a
# fraction of that, which is most of the wait on a slow connection.
app.add_middleware(GZipMiddleware, minimum_size=1000)
if _origins == ["*"]:
    logger.warning("CORS_ORIGINS is '*' - set it to your site's address once deployed.")

@app.on_event("startup")
async def ensure_indexes():
    """Without these every dispatch lookup scans the whole collection.
    Failures are logged, never fatal - the app must still start if Mongo is unreachable."""
    ok = 0
    for coll, field, uniq in INDEXES:
        try:
            await db[coll].create_index(field, unique=uniq)
            ok += 1
        except Exception as e:
            logger.warning("Index %s.%s skipped: %s", coll, field, e)
    logger.info("Database indexes ready (%s of %s).", ok, len(INDEXES))


@app.on_event("startup")
async def seed_expense_heads():
    """Only ever runs when the list is completely empty, so a head you delete
    on purpose does not reappear on the next restart."""
    try:
        if await db.expense_heads.find_one({}):
            return
        for name in DEFAULT_EXPENSE_HEADS:
            await db.expense_heads.insert_one({"id": gen_id("EXPE"), "name": name, "created_at": now_iso()})
        logger.info("Created starter expense heads: %s", ", ".join(DEFAULT_EXPENSE_HEADS))
    except Exception as e:
        logger.warning("Could not create starter expense heads: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
