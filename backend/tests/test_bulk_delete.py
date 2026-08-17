"""Bulk delete endpoint tests for masters, sale-orders, dispatch-orders."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://sales-command-100.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- Masters bulk-delete ----
class TestMastersBulkDelete:
    def test_bulk_delete_empty_ids(self, session):
        r = session.post(f"{API}/masters/seasons/bulk-delete", json={"ids": []})
        assert r.status_code == 200
        assert r.json() == {"deleted": 0}

    def test_bulk_delete_nonexistent(self, session):
        r = session.post(f"{API}/masters/seasons/bulk-delete", json={"ids": ["NON-EXIST-1", "NON-EXIST-2"]})
        assert r.status_code == 200
        assert r.json()["deleted"] == 0

    def test_bulk_delete_invalid_type(self, session):
        r = session.post(f"{API}/masters/unknown/bulk-delete", json={"ids": ["x"]})
        assert r.status_code == 404

    def test_bulk_delete_seasons_flow(self, session):
        # create 2 throwaway seasons
        s1 = session.post(f"{API}/masters/seasons", json={"name": "TEST_BULK_S1"}).json()
        s2 = session.post(f"{API}/masters/seasons", json={"name": "TEST_BULK_S2"}).json()
        ids = [s1["id"], s2["id"]]
        # bulk delete
        r = session.post(f"{API}/masters/seasons/bulk-delete", json={"ids": ids})
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        # verify gone
        listing = session.get(f"{API}/masters/seasons").json()
        remaining_ids = [x["id"] for x in listing]
        for i in ids:
            assert i not in remaining_ids


# ---- Sale Orders bulk-delete with cascade to dispatch ----
class TestSaleOrdersBulkDelete:
    def test_empty_ids(self, session):
        r = session.post(f"{API}/sale-orders/bulk-delete", json={"ids": []})
        assert r.status_code == 200
        assert r.json() == {"deleted": 0}

    def test_bulk_delete_cascades_dispatches(self, session):
        # Need a brand + customer for line items
        brands = session.get(f"{API}/masters/brands").json()
        customers = session.get(f"{API}/masters/customers").json()
        assert brands and customers, "need seed brands + customers"
        brand_id = brands[0]["id"]
        cust_id = customers[0]["id"]

        so1_id = "TEST_SO_BULK1"
        so2_id = "TEST_SO_BULK2"
        # cleanup pre
        session.post(f"{API}/sale-orders/bulk-delete", json={"ids": [so1_id, so2_id]})

        payload_common = {
            "order_date": "2026-01-10",
            "customer_id": cust_id,
            "dispatch_date": "2026-02-10",
            "event_type": "exhibition",
            "items": [{"id": "ITM-TEST1", "brand_id": brand_id, "rate": 100, "qty": 5}],
        }
        r1 = session.post(f"{API}/sale-orders", json={"id": so1_id, **payload_common})
        assert r1.status_code == 200, r1.text
        r2 = session.post(f"{API}/sale-orders", json={"id": so2_id, **payload_common})
        assert r2.status_code == 200

        # create a dispatch for so1
        d = session.post(f"{API}/dispatch-orders", json={
            "sale_order_id": so1_id,
            "dispatch_date": "2026-02-05",
            "items": [{"brand_id": brand_id, "qty": 2}],
        })
        assert d.status_code == 200, d.text
        disp_id = d.json()["id"]

        # bulk delete
        r = session.post(f"{API}/sale-orders/bulk-delete", json={"ids": [so1_id, so2_id]})
        assert r.status_code == 200
        assert r.json()["deleted"] == 2

        # verify orders gone
        orders = session.get(f"{API}/sale-orders").json()
        ids_left = [o["id"] for o in orders]
        assert so1_id not in ids_left
        assert so2_id not in ids_left

        # verify dispatch cascade-deleted
        disps = session.get(f"{API}/dispatch-orders").json()
        assert disp_id not in [x["id"] for x in disps]


# ---- Dispatch bulk-delete ----
class TestDispatchBulkDelete:
    def test_empty(self, session):
        r = session.post(f"{API}/dispatch-orders/bulk-delete", json={"ids": []})
        assert r.status_code == 200
        assert r.json() == {"deleted": 0}

    def test_nonexistent(self, session):
        r = session.post(f"{API}/dispatch-orders/bulk-delete", json={"ids": ["DSP-NOPE"]})
        assert r.status_code == 200
        assert r.json()["deleted"] == 0

    def test_bulk_delete_flow(self, session):
        brands = session.get(f"{API}/masters/brands").json()
        customers = session.get(f"{API}/masters/customers").json()
        brand_id = brands[0]["id"]
        cust_id = customers[0]["id"]
        so_id = "TEST_SO_DSP_BULK"
        session.post(f"{API}/sale-orders/bulk-delete", json={"ids": [so_id]})
        r = session.post(f"{API}/sale-orders", json={
            "id": so_id,
            "order_date": "2026-01-10",
            "customer_id": cust_id,
            "dispatch_date": "2026-02-10",
            "event_type": "exhibition",
            "items": [{"id": "ITM-X", "brand_id": brand_id, "rate": 100, "qty": 10}],
        })
        assert r.status_code == 200
        d1 = session.post(f"{API}/dispatch-orders", json={
            "sale_order_id": so_id, "dispatch_date": "2026-02-01",
            "items": [{"brand_id": brand_id, "qty": 2}],
        }).json()
        d2 = session.post(f"{API}/dispatch-orders", json={
            "sale_order_id": so_id, "dispatch_date": "2026-02-02",
            "items": [{"brand_id": brand_id, "qty": 3}],
        }).json()
        ids = [d1["id"], d2["id"]]
        r = session.post(f"{API}/dispatch-orders/bulk-delete", json={"ids": ids})
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        disps = session.get(f"{API}/dispatch-orders").json()
        for i in ids:
            assert i not in [x["id"] for x in disps]
        # cleanup order
        session.post(f"{API}/sale-orders/bulk-delete", json={"ids": [so_id]})
