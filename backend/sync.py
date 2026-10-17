"""Two-way sync between the office PC's own database and the online one.

The office PC runs with MONGO_URL pointing at a MongoDB on the PC itself, so it
keeps working with no internet, and SYNC_REMOTE_URL pointing at Atlas, which is
what the online site uses. Each run swaps whatever changed on either side since
the last one.

    python sync.py        run once, now (sync-now.bat does this)

The office server also runs it on startup, every few minutes after that, and
from the Sync now button. The online site never runs it - it has no
SYNC_REMOTE_URL - it only has its changes collected.

How a change is found: every write stamps updated_at and every delete leaves a
note in sync_deleted (SyncedDB in server.py does both, for every endpoint).
Each side is read from a little before its last run, measured on that side's
own database clock, so a PC clock a few minutes out cannot hide a change.

How a change is judged: sync_seen holds a fingerprint of each document as it
was when the two sides last agreed. A side whose copy no longer matches that
fingerprint changed it. Without it, a document this run copied across would
come back next time looking like a fresh edit, and every ordinary change would
be reported as a clash.
"""
import asyncio
import hashlib
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo.errors import ConfigurationError, ConnectionFailure, DuplicateKeyError

logger = logging.getLogger("sync")

# Order matters: an order has to arrive before its dispatches and photos, and a
# renamed duplicate order re-points those two in the same run.
SYNC_COLLECTIONS = [
    "customers", "brands", "exhibitions", "salesmen", "seasons", "expense_heads", "lines",
    "sale_orders", "dispatch_orders", "expenses", "users", "order_photos",
]
TOMBSTONES = "sync_deleted"
INFO = "sync_info"            # both sides: when they last synced, for the banner
STATE = "sync_state"          # office PC only: how far each side has been read
SEEN = "sync_seen"            # office PC only: fingerprints from the last agreement
CONFLICTS = "sync_conflicts"  # office PC only: the copies that lost a clash
STUCK = "stuck:"              # in sync_seen: a copy that could not be made

# Re-reading from a little before the last run catches a change written while
# that run was going. Reading one twice is harmless - it already matches.
OVERLAP = timedelta(minutes=10)
# A delete is only passed on while its note survives. A year covers an office
# PC left switched off for a long time.
KEEP_TOMBSTONES = timedelta(days=365)

OFFICE, ONLINE = "the office PC", "online"

WHAT = {
    "customers": "Customer", "brands": "Brand", "exhibitions": "Exhibition", "salesmen": "Salesman",
    "seasons": "Season", "expense_heads": "Expense head", "lines": "Line", "sale_orders": "Order",
    "dispatch_orders": "Dispatch", "expenses": "Expense voucher", "users": "Login",
    "order_photos": "Order photo",
}

_lock = asyncio.Lock()


def sync_running():
    return _lock.locked()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def db_clock(db):
    t = (await db.command("hello"))["localTime"]
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def fingerprint(doc):
    if doc is None:
        return "deleted"
    return hashlib.sha1(json.dumps(doc, sort_keys=True, default=str).encode()).hexdigest()


def version(doc, tombstone):
    """When a side's copy last changed - only used to pick the later of two edits."""
    if doc is not None:
        return doc.get("updated_at") or doc.get("created_at") or ""
    return (tombstone or {}).get("deleted_at") or ""


def describe(coll, doc_id, *docs):
    doc = next((d for d in docs if d), {})
    name = doc.get("name") or doc.get("username")
    return f"{WHAT.get(coll, coll)} {name or doc_id}"


def kept_copy(coll, doc):
    """What a conflict note keeps of the losing copy. A password hash has no
    business sitting in a list people read."""
    if doc is None:
        return None
    return {k: v for k, v in doc.items() if k not in ("password_hash", "data")}


async def read_all(cursor):
    return await cursor.to_list(None)


async def changed_ids(db, coll, since):
    q = {} if since is None else {"updated_at": {"$gt": since}}
    tq = {"coll": coll} if since is None else {"coll": coll, "deleted_at": {"$gt": since}}
    ids = {d["id"] for d in await read_all(db[coll].find(q, {"_id": 0, "id": 1})) if d.get("id")}
    dead = {t["id"]: t for t in await read_all(db[TOMBSTONES].find(tq, {"_id": 0}))}
    return ids | set(dead), dead


async def current(db, coll, ids):
    docs = await read_all(db[coll].find({"id": {"$in": list(ids)}}, {"_id": 0}))
    return {d["id"]: d for d in docs}


async def put(db, coll, doc_id, doc):
    """Make one side hold exactly this copy, or nothing. Written straight to the
    database, not through SyncedDB, so a copied document keeps the updated_at it
    was given where it was really changed."""
    if doc is None:
        await db[coll].delete_one({"id": doc_id})
    else:
        await db[coll].replace_one({"id": doc_id}, doc, upsert=True)


class Run:
    def __init__(self, office, online, state, first):
        self.office, self.online = office, online
        self.office_since = state.get("office_since")
        self.online_since = state.get("online_since")
        self.first = first
        self.pushed = self.pulled = 0
        self.conflicts = []
        self.renamed = []

    async def note(self, coll, doc_id, text, lost):
        self.conflicts.append(text)
        await self.office[CONFLICTS].insert_one({
            "id": uuid.uuid4().hex[:12], "at": now_iso(), "coll": coll, "doc_id": doc_id,
            "note": text, "lost": kept_copy(coll, lost),
        })

    async def unique_order_id(self, base):
        n = 2
        while (await self.office.sale_orders.find_one({"id": f"{base}-{n}"})
               or await self.online.sale_orders.find_one({"id": f"{base}-{n}"})):
            n += 1
        return f"{base}-{n}"

    async def keep_both_orders(self, order_id, office_doc, online_doc):
        """The same order number typed in on both sides since the last sync is two
        different paper orders, not one edited twice - so neither may overwrite
        the other. The online one moves to a new number, and takes its own
        dispatches and photos with it."""
        new_id = await self.unique_order_id(order_id)
        stamp = now_iso()
        moved = {**online_doc, "id": new_id, "updated_at": stamp}
        await self.online.sale_orders.insert_one(dict(moved))
        await self.online.sale_orders.delete_one({"id": order_id})
        await self.online.dispatch_orders.update_many(
            {"sale_order_id": order_id}, {"$set": {"sale_order_id": new_id, "updated_at": stamp}})
        await self.online.order_photos.update_many(
            {"order_id": order_id}, {"$set": {"order_id": new_id, "updated_at": stamp}})
        await put(self.office, "sale_orders", new_id, moved)
        await put(self.online, "sale_orders", order_id, office_doc)
        self.renamed.append((order_id, new_id))
        await self.note("sale_orders", order_id,
                        f"Order {order_id} was added both on the office PC and online. Both are kept: "
                        f"the online one is now Order {new_id}.", None)
        return {order_id: fingerprint(office_doc), new_id: fingerprint(moved)}

    async def merge(self, coll):
        office_ids, office_dead = await changed_ids(self.office, coll, self.office_since)
        online_ids, online_dead = await changed_ids(self.online, coll, self.online_since)
        # copies that failed last time are tried again on every run, so one goes
        # through as soon as whatever blocked it is fixed
        stuck = {d["_id"].split(":", 1)[1] for d in await read_all(self.office[SEEN].find({"stuck": coll}))}
        ids = office_ids | online_ids | stuck
        if not ids:
            return
        here = await current(self.office, coll, ids)
        there = await current(self.online, coll, ids)
        seen = {d["_id"].split(":", 1)[1]: d["h"]
                for d in await read_all(self.office[SEEN].find({"_id": {"$in": [f"{coll}:{i}" for i in ids]}}))}
        agreed = {}
        for i in sorted(ids):
            mine, theirs = here.get(i), there.get(i)
            if mine == theirs:
                agreed[i] = fingerprint(mine)
                continue
            base = seen.get(i)
            quiet = False
            if base and base.startswith(STUCK):
                # already reported; say so again only if it was changed since
                quiet = base[len(STUCK):] in (fingerprint(mine), fingerprint(theirs))
                base = None
            if base is None:
                # never synced: whichever side has it, added it
                mine_moved, theirs_moved = mine is not None, theirs is not None
            else:
                mine_moved, theirs_moved = fingerprint(mine) != base, fingerprint(theirs) != base

            if mine_moved and theirs_moved:
                if coll == "sale_orders" and base is None and mine and theirs and not self.first:
                    agreed.update(await self.keep_both_orders(i, mine, theirs))
                    continue
                office_wins = version(mine, office_dead.get(i)) >= version(theirs, online_dead.get(i))
                win, lose = (mine, theirs) if office_wins else (theirs, mine)
                win_side, lose_side = (OFFICE, ONLINE) if office_wins else (ONLINE, OFFICE)
                what = describe(coll, i, mine, theirs)
                if win is None:
                    text = (f"{what} was changed {lose_side} but deleted {win_side} afterwards, so it stays "
                            f"deleted. The changed copy is saved here.")
                elif lose is None:
                    text = f"{what} was deleted {lose_side} but changed {win_side} afterwards, so it was kept."
                else:
                    text = (f"{what} was changed both on the office PC and online. The later change "
                            f"({win_side}) was kept; the other copy is saved here.")
                await self.note(coll, i, text, lose)
            elif not (mine_moved or theirs_moved):
                # Neither moved off the last agreement yet they differ - only if
                # someone wrote to a database directly. The office copy decides.
                win, office_wins = mine, True
            else:
                office_wins = mine_moved
                win = mine if office_wins else theirs

            target = self.online if office_wins else self.office
            try:
                await put(target, coll, i, win)
            except DuplicateKeyError:
                agreed[i] = STUCK + fingerprint(win)
                if quiet:
                    continue
                # Only logins have a second unique field: the same username
                # added on both sides as two different people.
                await self.note(coll, i,
                                f"{describe(coll, i, win)} could not be copied {ONLINE if office_wins else 'to the office PC'}"
                                f" - a different login with that name already exists there. Rename one of them.",
                                None)
                continue
            if office_wins:
                self.pushed += 1
            else:
                self.pulled += 1
            agreed[i] = fingerprint(win)

        for i, h in agreed.items():
            await self.office[SEEN].replace_one(
                {"_id": f"{coll}:{i}"},
                {"_id": f"{coll}:{i}", "h": h, "stuck": coll if h.startswith(STUCK) else None}, upsert=True)


async def sync_once(office, online, remote_key):
    """One full pass. Nothing is marked as done until every collection has gone
    through, so a run cut off half way is simply repeated next time."""
    if remote_key == "same":
        raise RuntimeError("MONGO_URL and SYNC_REMOTE_URL point at the same database - nothing to sync.")
    office_t0, online_t0 = await db_clock(office), await db_clock(online)
    state = await office[STATE].find_one({"_id": "state"}) or {}
    if state.get("remote") != remote_key:
        # pointed at a different online database - start over against it
        state = {}
        await office[SEEN].delete_many({})
    for side, t0 in (("office_since", office_t0), ("online_since", online_t0)):
        # A clock put back - say a PC that had been running fast - would leave
        # this side's mark in the future and hide every change until it caught
        # up. Read the whole side instead; the fingerprints keep that cheap.
        if state.get(side) and datetime.fromisoformat(state[side]) + OVERLAP > t0:
            logger.info("The %s clock went backwards - checking everything on it.", side.split("_")[0])
            state = {**state, side: None}
    run = Run(office, online, state, first="remote" not in state)
    for coll in SYNC_COLLECTIONS:
        await run.merge(coll)

    stamp = now_iso()
    await office[STATE].replace_one({"_id": "state"}, {
        "_id": "state", "remote": remote_key,
        "office_since": (office_t0 - OVERLAP).isoformat(), "online_since": (online_t0 - OVERLAP).isoformat(),
    }, upsert=True)
    summary = {"last_sync": stamp, "pushed": run.pushed, "pulled": run.pulled, "conflicts": len(run.conflicts)}
    await online[INFO].replace_one({"_id": "sync"}, {"_id": "sync", **summary}, upsert=True)
    await office[INFO].replace_one({"_id": "sync"}, {"_id": "sync", **summary, "last_attempt": stamp,
                                                     "last_error": None}, upsert=True)
    cutoff = (datetime.now(timezone.utc) - KEEP_TOMBSTONES).isoformat()
    for side in (office, online):
        await side[TOMBSTONES].delete_many({"deleted_at": {"$lt": cutoff}})
    return {**summary, "renamed": run.renamed, "notes": run.conflicts}


def remote_key(local_url, remote_url, db_name):
    if local_url.strip() == remote_url.strip():
        return "same"
    return hashlib.sha1(f"{remote_url.strip()}|{db_name}".encode()).hexdigest()[:16]


def friendly(e):
    if isinstance(e, (ConnectionFailure, ConfigurationError)):
        return "Could not reach the online database - no internet, or it is down. Will try again."
    return str(e)


async def run_sync(office_db, remote_url, db_name, local_url, client_factory):
    """Run one sync from the office PC, one at a time. The outcome - success or
    the reason it failed - is recorded where the Sync bar reads it."""
    async with _lock:
        remote = client_factory(remote_url, serverSelectionTimeoutMS=8000)
        try:
            result = await sync_once(office_db, remote[db_name], remote_key(local_url, remote_url, db_name))
            logger.info("Sync done: %s sent online, %s brought in, %s clashes.",
                        result["pushed"], result["pulled"], result["conflicts"])
            return result
        except Exception as e:
            msg = friendly(e)
            logger.warning("Sync failed: %s", msg)
            await office_db[INFO].update_one({"_id": "sync"},
                                             {"$set": {"last_attempt": now_iso(), "last_error": msg}}, upsert=True)
            raise
        finally:
            remote.close()


if __name__ == "__main__":
    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient

    logging.basicConfig(level=logging.INFO, format="  %(message)s")
    load_dotenv(Path(__file__).resolve().parent / ".env")
    local_url = os.environ.get("MONGO_URL", "")
    remote_url = os.environ.get("SYNC_REMOTE_URL", "").strip()
    db_name = os.environ.get("DB_NAME", "")
    if not remote_url:
        print("  [X] This PC is not set up for offline use yet. Double-click setup-offline.bat first.")
        sys.exit(1)

    async def main():
        local = AsyncIOMotorClient(local_url, serverSelectionTimeoutMS=8000)
        try:
            r = await run_sync(local[db_name], remote_url, db_name, local_url, AsyncIOMotorClient)
        finally:
            local.close()
        print(f"\n  [ok] Synced. {r['pushed']} sent online, {r['pulled']} brought to this PC.")
        for n in r["notes"]:
            print(f"       ! {n}")

    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n  [X] {friendly(e)}")
        sys.exit(1)
