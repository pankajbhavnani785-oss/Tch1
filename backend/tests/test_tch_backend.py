"""
TCH Kitchenware backend regression + new feature tests.
Covers: approval flow, WhatsApp-share gating, admin users mgmt, PATCH products,
reviews, advanced product filters, and existing regression endpoints.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")

ADMIN_ID = "admin@tch.in"
ADMIN_PW = "TCHAdmin@123"


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def api():
    assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL required"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/admin/login",
        json={"identifier": ADMIN_ID, "password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def categories(api):
    r = api.get(f"{BASE_URL}/api/categories", timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def pending_customer(api):
    ident = f"TEST_pending_{uuid.uuid4().hex[:8]}@tch.test"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"identifier": ident, "password": "TestPass123!", "full_name": "TEST Pending"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    yield {"identifier": ident, "token": data["token"], "user": data["user"]}
    # cleanup (best-effort)
    try:
        admin = requests.post(
            f"{BASE_URL}/api/auth/admin/login",
            json={"identifier": ADMIN_ID, "password": ADMIN_PW}, timeout=10,
        ).json()
        requests.post(
            f"{BASE_URL}/api/users/{data['user']['id']}/reject",
            headers={"Authorization": f"Bearer {admin['token']}"}, timeout=10,
        )
    except Exception:
        pass


# ---------- basic health / regression ----------
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        assert r.json()["message"] == "TCH Kitchenware API"

    def test_categories_seeded(self, api):
        r = api.get(f"{BASE_URL}/api/categories", timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 14

    def test_admin_login_works(self, admin_token):
        assert admin_token


# ---------- approval flow ----------
class TestApprovalFlow:
    def test_registration_creates_pending_customer(self, pending_customer):
        u = pending_customer["user"]
        assert u["role"] == "customer"
        assert u["is_approved"] is False

    def test_pending_customer_orders_get_forbidden_message(self, api, pending_customer, categories):
        # GET /orders currently returns [] for pending (per implementation) OR 403?
        # Spec says 403 friendly message. Verify actual behavior.
        r = api.get(
            f"{BASE_URL}/api/orders",
            headers={"Authorization": f"Bearer {pending_customer['token']}"},
            timeout=15,
        )
        # implementation returns [] for pending customer on GET orders.
        # POST orders is what gates with 403. We assert on POST.
        cat_id = categories[0]["id"]
        payload = {
            "items": [{"product_id": "x", "name": "n", "price": 1, "quantity": 1}],
            "address": {
                "full_name": "TEST", "mobile": "9999999999", "address": "a",
                "city": "c", "state": "s", "pincode": "560001",
            },
            "subtotal": 1, "discount": 0, "delivery_charge": 0, "total": 1,
        }
        rp = api.post(
            f"{BASE_URL}/api/orders",
            headers={"Authorization": f"Bearer {pending_customer['token']}"},
            json=payload, timeout=15,
        )
        assert rp.status_code == 403, rp.text
        detail = rp.json().get("detail", "")
        assert "WhatsApp" in detail or "approval" in detail.lower()
        # extra: also record whether GET orders returned [] or 403
        assert r.status_code in (200, 403)

    def test_admin_lists_pending_users(self, api, admin_headers, pending_customer):
        r = api.get(f"{BASE_URL}/api/users?status=pending", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [u["id"] for u in r.json()]
        assert pending_customer["user"]["id"] in ids

    def test_non_admin_cannot_list_users(self, api, pending_customer):
        r = api.get(
            f"{BASE_URL}/api/users?status=pending",
            headers={"Authorization": f"Bearer {pending_customer['token']}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_approve_then_order_success(self, api, admin_headers, categories):
        # Create a fresh customer to approve+order
        ident = f"TEST_ok_{uuid.uuid4().hex[:8]}@tch.test"
        reg = api.post(
            f"{BASE_URL}/api/auth/register",
            json={"identifier": ident, "password": "TestPass123!", "full_name": "TEST Approve"},
            timeout=15,
        )
        assert reg.status_code == 200
        user = reg.json()["user"]
        token = reg.json()["token"]

        appr = api.post(
            f"{BASE_URL}/api/users/{user['id']}/approve",
            headers=admin_headers, timeout=15,
        )
        assert appr.status_code == 200
        assert appr.json()["is_approved"] is True

        # place order (with a valid category product created just for this)
        cat_id = categories[0]["id"]
        prod = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json={
                "name": f"TEST_prod_{uuid.uuid4().hex[:6]}",
                "description": "test", "category_id": cat_id,
                "mrp": 200, "price": 150, "rating": 4.2, "stock": 5,
                "material": "glass", "dimensions": "10x10", "images": [],
            }, timeout=15,
        )
        assert prod.status_code == 200
        p = prod.json()

        order_payload = {
            "items": [{"product_id": p["id"], "name": p["name"], "price": p["price"], "quantity": 1}],
            "address": {
                "full_name": "TEST", "mobile": "9999999999", "address": "a",
                "city": "c", "state": "s", "pincode": "560001",
            },
            "subtotal": p["price"], "discount": 0, "delivery_charge": 0, "total": p["price"],
        }
        ro = api.post(
            f"{BASE_URL}/api/orders",
            headers={"Authorization": f"Bearer {token}"},
            json=order_payload, timeout=15,
        )
        assert ro.status_code == 200, ro.text
        order_id = ro.json()["id"]

        # cleanup: cancel + delete order, delete product, reject user
        api.patch(f"{BASE_URL}/api/orders/{order_id}/status",
                  headers=admin_headers, json={"status": "cancelled"}, timeout=15)
        api.delete(f"{BASE_URL}/api/orders/{order_id}", headers=admin_headers, timeout=15)
        api.delete(f"{BASE_URL}/api/products/{p['id']}", headers=admin_headers, timeout=15)
        api.post(f"{BASE_URL}/api/users/{user['id']}/reject", headers=admin_headers, timeout=15)

    def test_reject_deletes_customer(self, api, admin_headers):
        ident = f"TEST_rej_{uuid.uuid4().hex[:8]}@tch.test"
        reg = api.post(
            f"{BASE_URL}/api/auth/register",
            json={"identifier": ident, "password": "TestPass123!", "full_name": "TEST Reject"},
            timeout=15,
        )
        user_id = reg.json()["user"]["id"]
        r = api.post(f"{BASE_URL}/api/users/{user_id}/reject",
                     headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        # confirm user gone from pending list
        listing = api.get(f"{BASE_URL}/api/users?status=pending",
                          headers=admin_headers, timeout=15)
        assert user_id not in [u["id"] for u in listing.json()]


# ---------- PATCH products ----------
class TestPatchProducts:
    @pytest.fixture(scope="class")
    def sample_product(self, api, admin_headers, categories):
        cat_id = categories[0]["id"]
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json={
                "name": f"TEST_patch_{uuid.uuid4().hex[:6]}",
                "description": "for patch", "category_id": cat_id,
                "mrp": 300, "price": 200, "rating": 4.0, "stock": 10,
                "material": "", "dimensions": "", "images": [],
            }, timeout=15,
        )
        assert r.status_code == 200
        p = r.json()
        yield p
        api.delete(f"{BASE_URL}/api/products/{p['id']}", headers=admin_headers, timeout=15)

    def test_patch_stock_partial(self, api, admin_headers, sample_product):
        r = api.patch(
            f"{BASE_URL}/api/products/{sample_product['id']}",
            headers=admin_headers, json={"stock": 42}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["stock"] == 42
        # verify persisted
        got = api.get(f"{BASE_URL}/api/products", timeout=15).json()
        match = [x for x in got if x["id"] == sample_product["id"]][0]
        assert match["stock"] == 42

    def test_patch_category_id_valid(self, api, admin_headers, sample_product, categories):
        new_cat = categories[1]["id"]
        r = api.patch(
            f"{BASE_URL}/api/products/{sample_product['id']}",
            headers=admin_headers, json={"category_id": new_cat}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["category_id"] == new_cat

    def test_patch_invalid_category_rejected(self, api, admin_headers, sample_product):
        r = api.patch(
            f"{BASE_URL}/api/products/{sample_product['id']}",
            headers=admin_headers, json={"category_id": "not-a-real-id"}, timeout=15,
        )
        assert r.status_code == 400

    def test_patch_price_gt_mrp_rejected(self, api, admin_headers, sample_product):
        r = api.patch(
            f"{BASE_URL}/api/products/{sample_product['id']}",
            headers=admin_headers, json={"price": 999999}, timeout=15,
        )
        assert r.status_code == 400

    def test_patch_requires_admin(self, api, sample_product):
        r = requests.patch(
            f"{BASE_URL}/api/products/{sample_product['id']}",
            json={"stock": 1}, timeout=15,
        )
        assert r.status_code == 401


# ---------- reviews ----------
class TestReviews:
    @pytest.fixture(scope="class")
    def review_ctx(self, api, admin_headers, categories):
        cat_id = categories[0]["id"]
        prod = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json={
                "name": f"TEST_rev_{uuid.uuid4().hex[:6]}",
                "description": "rev", "category_id": cat_id,
                "mrp": 100, "price": 80, "rating": 3.0, "stock": 5,
                "material": "", "dimensions": "", "images": [],
            }, timeout=15,
        ).json()

        # approved customer
        ident = f"TEST_rev_{uuid.uuid4().hex[:8]}@tch.test"
        reg = api.post(
            f"{BASE_URL}/api/auth/register",
            json={"identifier": ident, "password": "TestPass123!", "full_name": "TEST Rev"},
            timeout=15,
        ).json()
        api.post(
            f"{BASE_URL}/api/users/{reg['user']['id']}/approve",
            headers=admin_headers, timeout=15,
        )
        yield {"product": prod, "customer": reg}
        api.delete(f"{BASE_URL}/api/products/{prod['id']}", headers=admin_headers, timeout=15)
        api.post(f"{BASE_URL}/api/users/{reg['user']['id']}/reject",
                 headers=admin_headers, timeout=15)

    def test_pending_user_cannot_review(self, api, pending_customer, review_ctx):
        r = api.post(
            f"{BASE_URL}/api/products/{review_ctx['product']['id']}/reviews",
            headers={"Authorization": f"Bearer {pending_customer['token']}"},
            json={"rating": 5, "comment": "nice"}, timeout=15,
        )
        assert r.status_code == 403

    def test_review_created_and_average_updated(self, api, review_ctx):
        token = review_ctx["customer"]["token"]
        pid = review_ctx["product"]["id"]
        r = api.post(
            f"{BASE_URL}/api/products/{pid}/reviews",
            headers={"Authorization": f"Bearer {token}"},
            json={"rating": 4, "comment": "solid"}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["rating"] == 4
        # list
        lst = api.get(f"{BASE_URL}/api/products/{pid}/reviews", timeout=15)
        assert lst.status_code == 200
        assert len(lst.json()) >= 1
        # avg rating updated on product
        prods = api.get(f"{BASE_URL}/api/products", timeout=15).json()
        prod = [p for p in prods if p["id"] == pid][0]
        assert prod["rating"] == 4.0  # only one review -> avg == 4

    def test_review_rating_bounds(self, api, review_ctx):
        token = review_ctx["customer"]["token"]
        pid = review_ctx["product"]["id"]
        bad = api.post(
            f"{BASE_URL}/api/products/{pid}/reviews",
            headers={"Authorization": f"Bearer {token}"},
            json={"rating": 6, "comment": "x"}, timeout=15,
        )
        assert bad.status_code == 422


# ---------- advanced filters ----------
class TestProductFilters:
    @pytest.fixture(scope="class")
    def seeded_products(self, api, admin_headers, categories):
        cat_a = categories[0]["id"]
        cat_b = categories[1]["id"]
        created = []
        specs = [
            {"name": "TEST_f_cheap", "mrp": 200, "price": 100, "rating": 3.5, "stock": 5, "category_id": cat_a},
            {"name": "TEST_f_mid",   "mrp": 500, "price": 400, "rating": 4.8, "stock": 0, "category_id": cat_a},
            {"name": "TEST_f_high",  "mrp": 2000, "price": 1500, "rating": 4.2, "stock": 3, "category_id": cat_b},
            {"name": "TEST_f_disc",  "mrp": 1000, "price": 500, "rating": 4.6, "stock": 8, "category_id": cat_b},
        ]
        for s in specs:
            r = api.post(
                f"{BASE_URL}/api/products",
                headers=admin_headers,
                json={**s, "description": "", "material": "", "dimensions": "", "images": []},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            created.append(r.json())
        yield created
        for p in created:
            api.delete(f"{BASE_URL}/api/products/{p['id']}", headers=admin_headers, timeout=15)

    def _names(self, rows):
        return {r["name"] for r in rows if r["name"].startswith("TEST_f_")}

    def test_min_max_price(self, api, seeded_products):
        r = api.get(f"{BASE_URL}/api/products?min_price=200&max_price=600", timeout=15)
        assert r.status_code == 200
        names = self._names(r.json())
        assert "TEST_f_mid" in names and "TEST_f_disc" in names
        assert "TEST_f_cheap" not in names and "TEST_f_high" not in names

    def test_min_rating(self, api, seeded_products):
        r = api.get(f"{BASE_URL}/api/products?min_rating=4.5", timeout=15)
        names = self._names(r.json())
        assert "TEST_f_mid" in names and "TEST_f_disc" in names
        assert "TEST_f_cheap" not in names

    def test_available_only(self, api, seeded_products):
        r = api.get(f"{BASE_URL}/api/products?available=true", timeout=15)
        names = self._names(r.json())
        assert "TEST_f_mid" not in names  # stock 0
        assert "TEST_f_cheap" in names

    def test_min_discount(self, api, seeded_products):
        # only TEST_f_disc has 50% off; TEST_f_cheap has 50% off too (200->100)
        r = api.get(f"{BASE_URL}/api/products?min_discount=40", timeout=15)
        names = self._names(r.json())
        assert "TEST_f_disc" in names and "TEST_f_cheap" in names
        assert "TEST_f_mid" not in names  # 20% only
        assert "TEST_f_high" not in names  # 25% only

    def test_sort_price_low(self, api, seeded_products):
        r = api.get(f"{BASE_URL}/api/products?sort=price_low", timeout=15)
        prices = [p["price"] for p in r.json()]
        assert prices == sorted(prices)

    def test_sort_price_high(self, api, seeded_products):
        r = api.get(f"{BASE_URL}/api/products?sort=price_high", timeout=15)
        prices = [p["price"] for p in r.json()]
        assert prices == sorted(prices, reverse=True)

    def test_sort_rating(self, api, seeded_products):
        r = api.get(f"{BASE_URL}/api/products?sort=rating", timeout=15)
        ratings = [p["rating"] for p in r.json()]
        assert ratings == sorted(ratings, reverse=True)


# ---------- existing regression (auth + stock update + order lifecycle) ----------
class TestExistingRegression:
    def test_unauthenticated_orders_401(self, api):
        r = api.get(f"{BASE_URL}/api/orders", timeout=15)
        assert r.status_code == 401

    def test_admin_product_and_stock_update(self, api, admin_headers, categories):
        cat_id = categories[0]["id"]
        prod = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json={
                "name": f"TEST_reg_{uuid.uuid4().hex[:6]}",
                "description": "", "category_id": cat_id,
                "mrp": 100, "price": 80, "rating": 4.0, "stock": 2,
                "material": "", "dimensions": "", "images": [],
            }, timeout=15,
        ).json()
        try:
            r = api.post(
                f"{BASE_URL}/api/products/{prod['id']}/stock",
                headers=admin_headers,
                json={"quantity": 5, "operation": "add", "note": "restock"},
                timeout=15,
            )
            assert r.status_code == 200
            assert r.json()["product"]["stock"] == 7
            # set operation
            r2 = api.post(
                f"{BASE_URL}/api/products/{prod['id']}/stock",
                headers=admin_headers,
                json={"quantity": 3, "operation": "set", "note": "reset"},
                timeout=15,
            )
            assert r2.status_code == 200
            assert r2.json()["product"]["stock"] == 3
        finally:
            api.delete(f"{BASE_URL}/api/products/{prod['id']}",
                       headers=admin_headers, timeout=15)
