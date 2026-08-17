"""Backend tests for Iteration 13: city filter on dashboard, inline new customer master."""
import os
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# --- Dashboard city filter ---
class TestDashboardCityFilter:
    def test_no_city_returns_all(self, s):
        r = s.get(f"{BASE}/dashboard")
        assert r.status_code == 200
        assert r.json()["total_orders"] >= 1

    def test_city_ahmedabad(self, s):
        r = s.get(f"{BASE}/dashboard", params={"city": "Ahmedabad"})
        assert r.status_code == 200
        data = r.json()
        ids = [o["id"] for o in data["open_orders"]]
        for o in data["open_orders"]:
            assert o["city"] == "Ahmedabad"
        # Expect SO-A100 if present
        # Only asserts that all returned rows are Ahmedabad
        assert data["total_orders"] == len(ids) or data["total_orders"] >= len(ids)

    def test_city_testcity(self, s):
        r = s.get(f"{BASE}/dashboard", params={"city": "TestCity"})
        assert r.status_code == 200
        data = r.json()
        for o in data["open_orders"]:
            assert o["city"] == "TestCity"

    def test_city_unknown_returns_zero(self, s):
        r = s.get(f"{BASE}/dashboard", params={"city": "___NoSuchCity___"})
        assert r.status_code == 200
        assert r.json()["total_orders"] == 0
        assert r.json()["open_orders"] == []


# --- Inline new customer create ---
class TestInlineCustomerCreate:
    def test_create_customer_with_city(self, s):
        payload = {"name": "TEST_InlineCust_QA", "city": "TestVille"}
        r = s.post(f"{BASE}/masters/customers", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["city"] == payload["city"]
        assert data["id"].startswith("CUST-")
        cid = data["id"]
        # Persistence check
        r2 = s.get(f"{BASE}/masters/customers")
        assert any(c["id"] == cid and c.get("city") == "TestVille" for c in r2.json())
        # Cleanup
        s.delete(f"{BASE}/masters/customers/{cid}")

    def test_create_customer_missing_city_fails(self, s):
        r = s.post(f"{BASE}/masters/customers", json={"name": "TEST_NoCity_QA", "city": ""})
        assert r.status_code == 400

    def test_create_customer_missing_name_fails(self, s):
        r = s.post(f"{BASE}/masters/customers", json={"name": "  ", "city": "X"})
        assert r.status_code == 400


# --- Reports city presence ---
class TestReportsCity:
    def test_reports_rows_have_city(self, s):
        r = s.get(f"{BASE}/reports")
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert isinstance(rows, list)
        if rows:
            assert "city" in rows[0]
