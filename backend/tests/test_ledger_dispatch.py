"""Backend tests for Customer History (ledger) + direct dispatch feature."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sales-command-100.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def acme(s):
    r = s.get(f"{BASE_URL}/api/customers")
    assert r.status_code == 200
    for c in r.json():
        if c["name"] == "Acme Traders":
            return c
    pytest.fail("Acme Traders not seeded")


def test_customer_history_has_brand_rows(s, acme):
    r = s.get(f"{BASE_URL}/api/customers/{acme['id']}/history")
    assert r.status_code == 200
    d = r.json()
    assert "orders" in d and "timeline" in d and "summary" in d
    assert len(d["orders"]) > 0
    for o in d["orders"]:
        assert "brand_rows" in o and isinstance(o["brand_rows"], list)
        for br in o["brand_rows"]:
            for k in ("brand_id", "brand", "ordered", "dispatched", "pending"):
                assert k in br
            assert br["pending"] == max(0, br["ordered"] - br["dispatched"])
        assert "totals" in o and "status" in o["totals"]


def test_direct_dispatch_flow_and_persistence(s, acme):
    r = s.get(f"{BASE_URL}/api/customers/{acme['id']}/history")
    d = r.json()
    target = None
    for o in d["orders"]:
        if o["id"] == "SO-1001":
            target = o
            break
    if not target:
        for o in d["orders"]:
            if o["totals"]["pending_qty"] > 0 and o["brand_rows"]:
                target = o
                break
    assert target, "No dispatchable order"
    br = next((b for b in target["brand_rows"] if b["pending"] > 0), None)
    assert br, "No pending brand"

    payload = {
        "sale_order_id": target["id"],
        "dispatch_date": "2026-01-15",
        "items": [{"brand_id": br["brand_id"], "qty": 1}],
    }
    r2 = s.post(f"{BASE_URL}/api/dispatch-orders", json=payload)
    assert r2.status_code == 200, r2.text
    dsp = r2.json()
    assert dsp["sale_order_id"] == target["id"]

    # verify persistence: pending decreased by 1
    r3 = s.get(f"{BASE_URL}/api/customers/{acme['id']}/history")
    d3 = r3.json()
    new_target = next(o for o in d3["orders"] if o["id"] == target["id"])
    new_br = next(b for b in new_target["brand_rows"] if b["brand_id"] == br["brand_id"])
    assert new_br["pending"] == br["pending"] - 1
    assert new_br["dispatched"] == br["dispatched"] + 1
    # timeline gained an entry with this dispatch id
    assert any(t["id"] == dsp["id"] for t in d3["timeline"])


def test_dispatch_rejects_over_pending(s, acme):
    r = s.get(f"{BASE_URL}/api/customers/{acme['id']}/history")
    d = r.json()
    target = None
    for o in d["orders"]:
        for b in o.get("brand_rows", []):
            if b["pending"] > 0:
                target = (o, b)
                break
        if target:
            break
    assert target
    o, b = target
    payload = {
        "sale_order_id": o["id"],
        "dispatch_date": "2026-01-15",
        "items": [{"brand_id": b["brand_id"], "qty": b["pending"] + 999}],
    }
    r2 = s.post(f"{BASE_URL}/api/dispatch-orders", json=payload)
    assert r2.status_code == 400
    assert "exceeds pending" in r2.text.lower() or "pending" in r2.text.lower()


def test_dispatch_rejects_empty(s, acme):
    r = s.get(f"{BASE_URL}/api/customers/{acme['id']}/history")
    d = r.json()
    oid = d["orders"][0]["id"]
    r2 = s.post(f"{BASE_URL}/api/dispatch-orders", json={"sale_order_id": oid, "dispatch_date": "2026-01-15", "items": []})
    assert r2.status_code == 400
