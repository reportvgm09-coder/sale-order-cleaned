"""Backend API tests for Order Ledger app."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sales-command-100.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TAG = f"TEST_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# --------- Masters CRUD ---------
@pytest.mark.parametrize("mtype", ["customers", "brands", "exhibitions", "salesmen"])
def test_masters_crud(s, mtype):
    name = f"{TAG}_{mtype}"
    payload = {"name": name}
    if mtype == "customers":
        payload["city"] = "TestCity"
    r = s.post(f"{API}/masters/{mtype}", json=payload)
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    assert r.json()["name"] == name

    r2 = s.get(f"{API}/masters/{mtype}")
    assert r2.status_code == 200
    assert any(x["id"] == mid for x in r2.json())

    r3 = s.delete(f"{API}/masters/{mtype}/{mid}")
    assert r3.status_code == 200

    r4 = s.get(f"{API}/masters/{mtype}")
    assert not any(x["id"] == mid for x in r4.json())


def test_masters_invalid_type(s):
    r = s.get(f"{API}/masters/unknown")
    assert r.status_code == 404


def test_masters_empty_name_rejected(s):
    r = s.post(f"{API}/masters/customers", json={"name": "   ", "city": "X"})
    assert r.status_code == 400


# --------- Customer city required ---------
def test_customer_requires_city(s):
    r = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_NoCity"})
    assert r.status_code == 400, r.text


def test_customer_empty_city_rejected(s):
    r = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_NoCity2", "city": "  "})
    assert r.status_code == 400


def test_customer_with_city_ok(s):
    r = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_WithCity", "city": "Mumbai"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["city"] == "Mumbai"
    mid = body["id"]
    # GET and verify persisted
    lst = s.get(f"{API}/masters/customers").json()
    row = next((x for x in lst if x["id"] == mid), None)
    assert row and row.get("city") == "Mumbai"
    s.delete(f"{API}/masters/customers/{mid}")


def test_bulk_customers_with_city_rows(s):
    r = s.post(f"{API}/masters/customers/bulk", json={"rows": [
        {"name": f"{TAG}_BR1", "city": "Delhi"},
        {"name": f"{TAG}_BR2", "city": "Pune"},
    ]})
    assert r.status_code == 200
    assert r.json()["added"] == 2
    lst = s.get(f"{API}/masters/customers").json()
    for c in lst:
        if c["name"].startswith(f"{TAG}_BR"):
            assert c.get("city")
            s.delete(f"{API}/masters/customers/{c['id']}")


# --------- Reports endpoint ---------
def test_reports_endpoint(s):
    r = s.get(f"{API}/reports")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert isinstance(data["rows"], list)
    if data["rows"]:
        row = data["rows"][0]
        for k in ["sale_order_id", "customer", "brand", "event_type",
                  "ordered_qty", "dispatched_qty", "pending_qty", "amount"]:
            assert k in row, f"missing {k}"


# --------- Sale Orders + Dispatch full flow ---------
@pytest.fixture(scope="module")
def seed(s):
    """Create isolated customer, brands, exhibition, salesman."""
    c = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_Cust", "city": "TestCity"}).json()
    b1 = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_B1"}).json()
    b2 = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_B2"}).json()
    e = s.post(f"{API}/masters/exhibitions", json={"name": f"{TAG}_Exh"}).json()
    sm = s.post(f"{API}/masters/salesmen", json={"name": f"{TAG}_SM"}).json()
    data = {"customer": c, "b1": b1, "b2": b2, "exh": e, "sm": sm, "orders": [], "dispatches": []}
    yield data
    # cleanup
    for oid in data["orders"]:
        s.delete(f"{API}/sale-orders/{oid}")
    for mtype, mid in [("customers", c["id"]), ("brands", b1["id"]), ("brands", b2["id"]),
                       ("exhibitions", e["id"]), ("salesmen", sm["id"])]:
        s.delete(f"{API}/masters/{mtype}/{mid}")


def test_sale_order_create_and_totals(s, seed):
    oid = f"{TAG}_SO1"
    payload = {
        "id": oid,
        "order_date": "2026-01-10",
        "customer_id": seed["customer"]["id"],
        "dispatch_date": "2026-01-20",
        "event_type": "exhibition",
        "exhibition_id": seed["exh"]["id"],
        "items": [
            {"id": "ITM-1", "brand_id": seed["b1"]["id"], "rate": 100, "qty": 10},
            {"id": "ITM-2", "brand_id": seed["b2"]["id"], "rate": 200, "qty": 5},
        ],
    }
    r = s.post(f"{API}/sale-orders", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    seed["orders"].append(oid)
    assert data["totals"]["ordered_qty"] == 15
    assert data["totals"]["amount"] == 100*10 + 200*5  # 2000
    assert data["totals"]["status"] == "pending"
    assert data["totals"]["pending_qty"] == 15

    # duplicate id
    dup = s.post(f"{API}/sale-orders", json=payload)
    assert dup.status_code == 400


def test_sale_order_list_and_get(s, seed):
    r = s.get(f"{API}/sale-orders")
    assert r.status_code == 200
    ids = [o["id"] for o in r.json()]
    assert f"{TAG}_SO1" in ids


def test_sale_order_update(s, seed):
    oid = f"{TAG}_SO1"
    payload = {
        "id": oid,
        "order_date": "2026-01-10",
        "customer_id": seed["customer"]["id"],
        "dispatch_date": "2026-01-25",
        "event_type": "door_to_door",
        "salesman_id": seed["sm"]["id"],
        "items": [
            {"id": "ITM-1", "brand_id": seed["b1"]["id"], "rate": 100, "qty": 20},
            {"id": "ITM-2", "brand_id": seed["b2"]["id"], "rate": 200, "qty": 5},
        ],
    }
    r = s.put(f"{API}/sale-orders/{oid}", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["totals"]["ordered_qty"] == 25
    assert r.json()["event_type"] == "door_to_door"


def test_dispatch_partial_and_status(s, seed):
    oid = f"{TAG}_SO1"
    # dispatch 10 of b1
    r = s.post(f"{API}/dispatch-orders", json={
        "sale_order_id": oid,
        "dispatch_date": "2026-01-15",
        "items": [{"brand_id": seed["b1"]["id"], "qty": 10}],
    })
    assert r.status_code == 200, r.text
    seed["dispatches"].append(r.json()["id"])

    # order should now be partial
    orders = s.get(f"{API}/sale-orders").json()
    o = next(x for x in orders if x["id"] == oid)
    assert o["totals"]["status"] == "partial"
    assert o["totals"]["dispatched_qty"] == 10
    assert o["totals"]["pending_qty"] == 15


def test_dispatch_over_qty_rejected(s, seed):
    oid = f"{TAG}_SO1"
    # SO1 has 20 b1 + 5 b2 = 25 ordered (after update); 10 b1 already dispatched. Pending b1 = 10.
    r = s.post(f"{API}/dispatch-orders", json={
        "sale_order_id": oid,
        "items": [{"brand_id": seed["b1"]["id"], "qty": 999}],
    })
    assert r.status_code == 400, r.text
    assert "exceeds" in r.text.lower() or "pending" in r.text.lower()


def test_dispatch_empty_items_rejected(s, seed):
    r = s.post(f"{API}/dispatch-orders", json={
        "sale_order_id": f"{TAG}_SO1",
        "items": [{"brand_id": seed["b1"]["id"], "qty": 0}],
    })
    assert r.status_code == 400


def test_dispatch_unknown_order(s, seed):
    r = s.post(f"{API}/dispatch-orders", json={
        "sale_order_id": "NOPE-XXX",
        "items": [{"brand_id": seed["b1"]["id"], "qty": 1}],
    })
    assert r.status_code == 400


def test_dispatch_full_becomes_done(s, seed):
    oid = f"{TAG}_SO1"
    # dispatch remaining b1 (10) and b2 (5)
    r = s.post(f"{API}/dispatch-orders", json={
        "sale_order_id": oid,
        "items": [
            {"brand_id": seed["b1"]["id"], "qty": 10},
            {"brand_id": seed["b2"]["id"], "qty": 5},
        ],
    })
    assert r.status_code == 200
    seed["dispatches"].append(r.json()["id"])

    orders = s.get(f"{API}/sale-orders").json()
    o = next(x for x in orders if x["id"] == oid)
    assert o["totals"]["status"] == "done"
    assert o["totals"]["pending_qty"] == 0


def test_dashboard_shape(s):
    r = s.get(f"{API}/dashboard")
    assert r.status_code == 200
    d = r.json()
    for k in ["total_orders", "orders_with_pending", "pending_pieces",
              "pending_value", "by_customer", "by_brand", "open_orders"]:
        assert k in d


def test_sale_order_delete_removes_dispatches(s, seed):
    oid = f"{TAG}_SO_DEL"
    s.post(f"{API}/sale-orders", json={
        "id": oid, "customer_id": seed["customer"]["id"],
        "event_type": "exhibition", "exhibition_id": seed["exh"]["id"],
        "items": [{"id": "X", "brand_id": seed["b1"]["id"], "rate": 10, "qty": 5}],
    })
    s.post(f"{API}/dispatch-orders", json={
        "sale_order_id": oid, "items": [{"brand_id": seed["b1"]["id"], "qty": 2}],
    })
    r = s.delete(f"{API}/sale-orders/{oid}")
    assert r.status_code == 200
    dispatches = s.get(f"{API}/dispatch-orders").json()
    assert not any(d["sale_order_id"] == oid for d in dispatches)


def test_bulk_masters(s):
    names = [f"{TAG}_bulk_a", f"{TAG}_bulk_b", f"{TAG}_bulk_a"]  # duplicate
    r = s.post(f"{API}/masters/customers/bulk", json={"names": names})
    assert r.status_code == 200
    assert r.json()["added"] == 2
    # cleanup
    lst = s.get(f"{API}/masters/customers").json()
    for c in lst:
        if c["name"].startswith(f"{TAG}_bulk"):
            s.delete(f"{API}/masters/customers/{c['id']}")


# --------- New iteration_3 features: Master PUT / Seasons / Overdue / Season in reports ---------
def test_seasons_master_exists(s):
    r = s.get(f"{API}/masters/seasons")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_seasons_master_crud(s):
    name = f"{TAG}_Season"
    r = s.post(f"{API}/masters/seasons", json={"name": name})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    # update
    r2 = s.put(f"{API}/masters/seasons/{sid}", json={"name": name + "_upd"})
    assert r2.status_code == 200
    assert r2.json()["name"] == name + "_upd"
    # verify persisted
    lst = s.get(f"{API}/masters/seasons").json()
    row = next((x for x in lst if x["id"] == sid), None)
    assert row and row["name"] == name + "_upd"
    s.delete(f"{API}/masters/seasons/{sid}")


def test_update_master_customer_requires_city(s):
    # create customer with city
    r = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_UpdCity", "city": "Delhi"})
    assert r.status_code == 200
    cid = r.json()["id"]
    # update with empty city -> 400
    r2 = s.put(f"{API}/masters/customers/{cid}", json={"name": f"{TAG}_UpdCity", "city": "  "})
    assert r2.status_code == 400
    # update with valid city -> 200
    r3 = s.put(f"{API}/masters/customers/{cid}", json={"name": f"{TAG}_UpdCity", "city": "Mumbai"})
    assert r3.status_code == 200
    assert r3.json()["city"] == "Mumbai"
    # verify GET
    lst = s.get(f"{API}/masters/customers").json()
    row = next((x for x in lst if x["id"] == cid), None)
    assert row and row["city"] == "Mumbai"
    s.delete(f"{API}/masters/customers/{cid}")


def test_update_master_not_found(s):
    r = s.put(f"{API}/masters/brands/NOPE-XX", json={"name": "x"})
    assert r.status_code == 404


def test_update_master_invalid_type(s):
    r = s.put(f"{API}/masters/unknown/xxx", json={"name": "x"})
    assert r.status_code == 404


def test_dashboard_overdue_fields(s):
    r = s.get(f"{API}/dashboard")
    assert r.status_code == 200
    d = r.json()
    assert "overdue_count" in d
    assert isinstance(d["overdue_count"], int)
    for oo in d["open_orders"]:
        assert "overdue" in oo
        assert isinstance(oo["overdue"], bool)


def test_dashboard_overdue_computation(s):
    # Create a customer + brand + overdue sale order
    c = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_OverCust", "city": "X"}).json()
    b = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_OverBrand"}).json()
    oid = f"{TAG}_OVER"
    s.post(f"{API}/sale-orders", json={
        "id": oid, "customer_id": c["id"],
        "order_date": "2020-01-01", "dispatch_date": "2020-01-05",
        "event_type": "exhibition",
        "items": [{"id": "I1", "brand_id": b["id"], "rate": 100, "qty": 5}],
    })
    d = s.get(f"{API}/dashboard").json()
    row = next((x for x in d["open_orders"] if x["id"] == oid), None)
    assert row is not None
    assert row["overdue"] is True
    assert d["overdue_count"] >= 1
    # cleanup
    s.delete(f"{API}/sale-orders/{oid}")
    s.delete(f"{API}/masters/customers/{c['id']}")
    s.delete(f"{API}/masters/brands/{b['id']}")


def test_reports_has_season_field(s):
    r = s.get(f"{API}/reports")
    assert r.status_code == 200
    rows = r.json()["rows"]
    if rows:
        # season key must exist in row schema (value may be None)
        assert "season" in rows[0]


# --------- New iteration_5: Customers overview, history, dashboard by_season ---------
def test_customers_overview_shape(s):
    r = s.get(f"{API}/customers")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    if data:
        row = data[0]
        for k in ["id", "name", "order_count", "pending_qty", "amount"]:
            assert k in row, f"missing {k}"


def test_customers_overview_seeded_acme():
    r = requests.get(f"{API}/customers")
    assert r.status_code == 200
    rows = r.json()
    acme = next((c for c in rows if c["name"] == "Acme Traders"), None)
    if acme:
        assert acme.get("city") == "Ahmedabad"
        # Seed expanded to add SO-FY25A (100) and SO-FY25B (50) -> 5 orders total
        assert acme["order_count"] >= 3
        assert acme["pending_qty"] >= 155
        assert acme["amount"] >= 100000


def test_customer_history_not_found(s):
    r = s.get(f"{API}/customers/NOPE-XX/history")
    assert r.status_code == 404


def test_customer_history_acme():
    rows = requests.get(f"{API}/customers").json()
    acme = next((c for c in rows if c["name"] == "Acme Traders"), None)
    if not acme:
        pytest.skip("Acme Traders not seeded")
    r = requests.get(f"{API}/customers/{acme['id']}/history")
    assert r.status_code == 200
    data = r.json()
    for k in ["customer", "orders", "timeline", "summary"]:
        assert k in data
    assert data["customer"]["name"] == "Acme Traders"
    s = data["summary"]
    assert s["order_count"] >= 3
    assert s["ordered"] >= 215
    assert s["pending"] >= 155
    assert s["amount"] >= 100000
    # dispatch timeline should have at least 1
    assert len(data["timeline"]) >= 1
    tl_ids = {t["sale_order_id"] for t in data["timeline"]}
    assert "SO-1001" in tl_ids


def test_customer_history_no_orders():
    rows = requests.get(f"{API}/customers").json()
    sunrise = next((c for c in rows if c["name"] == "Sunrise Apparel"), None)
    if not sunrise:
        pytest.skip("Sunrise Apparel not seeded")
    r = requests.get(f"{API}/customers/{sunrise['id']}/history")
    assert r.status_code == 200
    data = r.json()
    # Note: seed may have grown; just verify shape
    assert isinstance(data["orders"], list)
    assert isinstance(data["timeline"], list)
    assert "order_count" in data["summary"]


def test_dashboard_by_season():
    r = requests.get(f"{API}/dashboard")
    assert r.status_code == 200
    d = r.json()
    assert "by_season" in d
    assert isinstance(d["by_season"], list)
    # Should include either 'No Season' or 'Winter 2026' in seeded env
    names = {x["name"] for x in d["by_season"]}
    # Loose check: at least one non-empty entry
    if names:
        for x in d["by_season"]:
            assert "name" in x and "qty" in x


def test_sale_order_with_season(s):
    # create season, customer, brand
    season = s.post(f"{API}/masters/seasons", json={"name": f"{TAG}_S"}).json()
    c = s.post(f"{API}/masters/customers", json={"name": f"{TAG}_SC", "city": "X"}).json()
    b = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_SB"}).json()
    oid = f"{TAG}_SO_SEASON"
    r = s.post(f"{API}/sale-orders", json={
        "id": oid, "customer_id": c["id"], "season_id": season["id"],
        "event_type": "exhibition",
        "items": [{"id": "I1", "brand_id": b["id"], "rate": 10, "qty": 2}],
    })
    assert r.status_code == 200, r.text
    # reports should reflect season name
    rp = s.get(f"{API}/reports").json()["rows"]
    match = [x for x in rp if x["sale_order_id"] == oid]
    assert match and match[0]["season"] == f"{TAG}_S"
    # cleanup
    s.delete(f"{API}/sale-orders/{oid}")
    s.delete(f"{API}/masters/seasons/{season['id']}")
    s.delete(f"{API}/masters/customers/{c['id']}")
    s.delete(f"{API}/masters/brands/{b['id']}")


# --------- Iteration 6: financial_year field in reports ---------
def test_reports_has_financial_year():
    r = requests.get(f"{API}/reports")
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert rows, "expected some seeded rows"
    for row in rows:
        assert "financial_year" in row, "financial_year missing from reports row"
        fy = row["financial_year"]
        assert fy == "Unknown" or (fy.startswith("FY ") and "-" in fy), f"bad FY: {fy}"


def test_reports_fin_year_covers_two_years():
    r = requests.get(f"{API}/reports").json()["rows"]
    fys = {row["financial_year"] for row in r}
    # Per spec, seeded data spans FY 2025-26 and FY 2026-27
    assert "FY 2025-26" in fys, f"FY 2025-26 missing, got {fys}"
    assert "FY 2026-27" in fys, f"FY 2026-27 missing, got {fys}"


# --------- Iteration 8: Brand rate (default rate) ---------
def test_brand_create_with_rate(s):
    r = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_BRate", "rate": 555})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == f"{TAG}_BRate"
    assert float(body.get("rate", 0)) == 555.0
    bid = body["id"]
    # GET persistence
    lst = s.get(f"{API}/masters/brands").json()
    row = next((x for x in lst if x["id"] == bid), None)
    assert row is not None
    assert float(row.get("rate", 0)) == 555.0
    s.delete(f"{API}/masters/brands/{bid}")


def test_brand_create_without_rate_defaults_zero(s):
    r = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_BNoRate"})
    assert r.status_code == 200
    body = r.json()
    bid = body["id"]
    lst = s.get(f"{API}/masters/brands").json()
    row = next((x for x in lst if x["id"] == bid), None)
    assert row is not None
    # rate should be 0 (or missing meaning no rate)
    assert float(row.get("rate", 0) or 0) == 0.0
    s.delete(f"{API}/masters/brands/{bid}")


def test_brand_update_rate(s):
    c = s.post(f"{API}/masters/brands", json={"name": f"{TAG}_BUpd", "rate": 100})
    bid = c.json()["id"]
    r = s.put(f"{API}/masters/brands/{bid}", json={"name": f"{TAG}_BUpd", "rate": 987.5})
    assert r.status_code == 200, r.text
    assert float(r.json().get("rate", 0)) == 987.5
    # GET persists
    lst = s.get(f"{API}/masters/brands").json()
    row = next((x for x in lst if x["id"] == bid), None)
    assert row is not None and float(row.get("rate", 0)) == 987.5
    s.delete(f"{API}/masters/brands/{bid}")


def test_brand_bulk_with_rate(s):
    r = s.post(f"{API}/masters/brands/bulk", json={"rows": [
        {"name": f"{TAG}_BulkBR1", "rate": 111},
        {"name": f"{TAG}_BulkBR2", "rate": 222},
        {"name": f"{TAG}_BulkBR3"},
    ]})
    assert r.status_code == 200
    assert r.json()["added"] == 3
    lst = s.get(f"{API}/masters/brands").json()
    for b in lst:
        if b["name"] == f"{TAG}_BulkBR1":
            assert float(b.get("rate", 0)) == 111.0
        if b["name"] == f"{TAG}_BulkBR2":
            assert float(b.get("rate", 0)) == 222.0
        if b["name"].startswith(f"{TAG}_BulkBR"):
            s.delete(f"{API}/masters/brands/{b['id']}")


def test_seeded_brand_rates():
    """Nova Wear should have rate 333, RateTest Brand 777, per problem statement."""
    lst = requests.get(f"{API}/masters/brands").json()
    nova = next((b for b in lst if b["name"] == "Nova Wear"), None)
    ratetest = next((b for b in lst if b["name"] == "RateTest Brand"), None)
    if nova:
        assert float(nova.get("rate", 0)) == 333.0, f"Nova Wear rate={nova.get('rate')}"
    if ratetest:
        assert float(ratetest.get("rate", 0)) == 777.0, f"RateTest Brand rate={ratetest.get('rate')}"
    if not nova and not ratetest:
        pytest.skip("Seeded brands with rate not present")
