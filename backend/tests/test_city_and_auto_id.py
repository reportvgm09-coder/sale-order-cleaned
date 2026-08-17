"""Tests for iteration 12: city field in dashboard/reports & auto-ID SO creation."""
import os
import time
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _first_id(api, mtype):
    r = api.get(f"{BASE_URL}/api/masters/{mtype}")
    r.raise_for_status()
    items = r.json()
    return items[0]["id"] if items else None


def test_dashboard_open_orders_has_city(api):
    r = api.get(f"{BASE_URL}/api/dashboard")
    assert r.status_code == 200
    data = r.json()
    assert "open_orders" in data
    # Every open order dict must expose city (may be empty string)
    for row in data["open_orders"]:
        assert "city" in row, f"row missing city: {row}"
    # At least one seeded order should have Ahmedabad or TestCity
    cities = {row.get("city") for row in data["open_orders"]}
    print("Open-order cities:", cities)
    assert any(c for c in cities if c), "Expected at least one non-empty city in open_orders"


def test_reports_rows_have_city(api):
    r = api.get(f"{BASE_URL}/api/reports")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    for row in data["rows"]:
        assert "city" in row
    cities = {row.get("city") for row in data["rows"]}
    print("Report cities:", cities)


def test_create_sale_order_with_auto_id(api):
    customer_id = _first_id(api, "customers")
    brand_id = _first_id(api, "brands")
    assert customer_id and brand_id
    auto_id = f"SO-{format(int(time.time()*1000) % 0xFFFFFF, 'X')}"
    payload = {
        "id": auto_id,
        "order_date": "2026-01-15",
        "customer_id": customer_id,
        "event_type": "exhibition",
        "items": [{"brand_id": brand_id, "rate": 100, "qty": 5}],
    }
    r = api.post(f"{BASE_URL}/api/sale-orders", json=payload)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body["id"] == auto_id

    # GET verify
    g = api.get(f"{BASE_URL}/api/sale-orders")
    assert g.status_code == 200
    ids = [o["id"] for o in g.json()]
    assert auto_id in ids

    # Duplicate should fail
    dup = api.post(f"{BASE_URL}/api/sale-orders", json=payload)
    assert dup.status_code >= 400

    # cleanup
    d = api.delete(f"{BASE_URL}/api/sale-orders/{auto_id}")
    assert d.status_code in (200, 204)
