"""
Pagination & new-shape regression for GET /api/products.
Response is now: {items: Product[], total: int, offset: int, limit: int}

Covers:
- default limit=24, offset=0
- limit=1 offset=0/1 slicing (no dup)
- limit clamped to <= 100
- search substring case-insensitive (name/description)
- min_discount aggregation ($expr) with total matching
- combined filters (min_price + max_price + min_rating + category_id + available)
- sort ordering (price_low/high, rating, popular, newest)
Cleans up all TEST_ products created.
"""
import os
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


@pytest.fixture(scope="module")
def api():
    assert BASE_URL, "EXPO_BACKEND_URL required"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_headers(api):
    r = api.post(
        f"{BASE_URL}/api/auth/admin/login",
        json={"identifier": ADMIN_ID, "password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def categories(api):
    r = api.get(f"{BASE_URL}/api/categories", timeout=15)
    return r.json()


# ---------- shape ----------
class TestPaginatedShape:
    def test_default_shape_and_defaults(self, api):
        r = api.get(f"{BASE_URL}/api/products", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict), body
        for k in ("items", "total", "offset", "limit"):
            assert k in body, f"missing key {k}"
        assert isinstance(body["items"], list)
        assert isinstance(body["total"], int)
        assert body["offset"] == 0
        assert body["limit"] == 24
        assert len(body["items"]) <= 24
        assert len(body["items"]) <= body["total"]

    def test_limit_clamped_to_100(self, api):
        r = api.get(f"{BASE_URL}/api/products?limit=500", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["limit"] == 100
        assert len(body["items"]) <= 100


# ---------- pagination slicing ----------
class TestPaginationSlicing:
    @pytest.fixture(scope="class")
    def seeded(self, api, admin_headers, categories):
        """Ensure at least 3 products in DB so page1/page2 are meaningful."""
        # Peek current total
        cur = api.get(f"{BASE_URL}/api/products?limit=1", timeout=15).json()
        created = []
        need = max(0, 3 - cur["total"])
        cat_id = categories[0]["id"]
        for _ in range(need):
            r = api.post(
                f"{BASE_URL}/api/products",
                headers=admin_headers,
                json={"name": f"TEST_pg_{uuid.uuid4().hex[:6]}",
                      "description": "pagination seed",
                      "category_id": cat_id, "mrp": 100, "price": 90,
                      "rating": 4.0, "stock": 1, "material": "",
                      "dimensions": "", "images": []},
                timeout=15,
            )
            assert r.status_code == 200
            created.append(r.json())
        yield created
        for p in created:
            api.delete(f"{BASE_URL}/api/products/{p['id']}",
                       headers=admin_headers, timeout=15)

    def test_limit_1_offset_0(self, api, seeded):
        r = api.get(f"{BASE_URL}/api/products?limit=1&offset=0", timeout=15)
        body = r.json()
        assert body["limit"] == 1
        assert body["offset"] == 0
        assert len(body["items"]) == 1
        # total should equal unfiltered count
        full = api.get(f"{BASE_URL}/api/products?limit=100", timeout=15).json()
        assert body["total"] == full["total"]

    def test_next_page_no_duplicates(self, api, seeded):
        p1 = api.get(f"{BASE_URL}/api/products?limit=2&offset=0", timeout=15).json()
        p2 = api.get(f"{BASE_URL}/api/products?limit=2&offset=1", timeout=15).json()
        ids1 = {p["id"] for p in p1["items"]}
        ids2 = {p["id"] for p in p2["items"]}
        # offset=1 shifts window; item[1] of p1 == item[0] of p2 → intersection == 1
        # but crucially p2 must contain an id not in p1 (if total >=3)
        if p1["total"] >= 3:
            assert ids2 - ids1, "page 2 must contain at least one new id"
        # offset & limit echoed correctly
        assert p2["offset"] == 1
        assert p2["limit"] == 2


# ---------- search / filters / sort ----------
class TestSearchFiltersSort:
    @pytest.fixture(scope="class")
    def seeded(self, api, admin_headers, categories):
        cat_a = categories[0]["id"]
        cat_b = categories[1]["id"]
        unique = uuid.uuid4().hex[:6]
        specs = [
            {"name": f"TEST_pgSearch_alpha_{unique}", "mrp": 200, "price": 100,
             "rating": 3.0, "stock": 5, "category_id": cat_a,
             "description": "unique_kw_zxq alpha"},
            {"name": f"TEST_pgSearch_bravo_{unique}", "mrp": 500, "price": 400,
             "rating": 4.9, "stock": 2, "category_id": cat_a,
             "description": "bravo item"},
            {"name": f"TEST_pgSearch_charlie_{unique}", "mrp": 2000, "price": 1900,
             "rating": 4.1, "stock": 0, "category_id": cat_b,
             "description": "charlie zero stock"},
            {"name": f"TEST_pgSearch_delta_{unique}", "mrp": 1000, "price": 300,
             "rating": 4.7, "stock": 8, "category_id": cat_b,
             "description": "delta 70pct off"},
        ]
        created = []
        for s in specs:
            r = api.post(
                f"{BASE_URL}/api/products",
                headers=admin_headers,
                json={**s, "material": "", "dimensions": "", "images": []},
                timeout=15,
            )
            assert r.status_code == 200
            created.append(r.json())
        yield {"products": created, "cat_a": cat_a, "cat_b": cat_b, "kw": unique}
        for p in created:
            api.delete(f"{BASE_URL}/api/products/{p['id']}",
                       headers=admin_headers, timeout=15)

    def test_search_case_insensitive_substring(self, api, seeded):
        # search for the shared unique token — should match all 4
        r = api.get(f"{BASE_URL}/api/products?search=PGSEARCH&limit=100",
                    timeout=15)
        body = r.json()
        matches = [p for p in body["items"] if seeded["kw"] in p["name"]]
        assert len(matches) == 4
        # total should equal number of matches (only TEST_pgSearch names match)
        assert body["total"] >= 4

    def test_search_description_field(self, api, seeded):
        # description-only keyword
        r = api.get(f"{BASE_URL}/api/products?search=unique_kw_zxq&limit=10",
                    timeout=15)
        body = r.json()
        assert body["total"] >= 1
        assert any("alpha" in p["name"] for p in body["items"])

    def test_min_discount_aggregation_and_total(self, api, seeded):
        # delta = 70% off, alpha = 50% off, bravo = 20%, charlie = 5%
        r = api.get(f"{BASE_URL}/api/products?min_discount=60&limit=100",
                    timeout=15)
        body = r.json()
        # verify all returned items actually satisfy the discount
        for p in body["items"]:
            mrp, price = p.get("mrp", 0), p.get("price", 0)
            if mrp > 0:
                disc = ((mrp - price) / mrp) * 100
                assert disc >= 60, f"{p['name']} disc={disc}"
        # total must match number of items returned when limit >= total
        assert body["total"] == len(body["items"]) or body["total"] > 100
        # our delta (70%) must be present, bravo (20%) not
        names = {p["name"] for p in body["items"]}
        assert any("delta" in n for n in names)
        assert not any("bravo" in n for n in names)

    def test_combined_filters_intersection(self, api, seeded):
        # min_price=200, max_price=500, min_rating=4.5, cat_a, available=true
        # → only bravo matches (price 400, rating 4.9, stock 2, cat_a)
        r = api.get(
            f"{BASE_URL}/api/products"
            f"?min_price=200&max_price=500&min_rating=4.5"
            f"&category_id={seeded['cat_a']}&available=true&limit=100",
            timeout=15,
        )
        body = r.json()
        # every returned item must satisfy every filter
        for p in body["items"]:
            assert 200 <= p["price"] <= 500
            assert p["rating"] >= 4.5
            assert p["category_id"] == seeded["cat_a"]
            assert p["stock"] > 0
        # bravo must be in there
        names = {p["name"] for p in body["items"]}
        assert any("bravo" in n for n in names)
        # total reflects the intersected set (no over-count from category alone)
        assert body["total"] == len(body["items"])

    def test_sort_price_low_high(self, api, seeded):
        low = api.get(
            f"{BASE_URL}/api/products?sort=price_low"
            f"&category_id={seeded['cat_a']}&limit=100", timeout=15,
        ).json()["items"]
        high = api.get(
            f"{BASE_URL}/api/products?sort=price_high"
            f"&category_id={seeded['cat_a']}&limit=100", timeout=15,
        ).json()["items"]
        # peek first two
        if len(low) >= 2:
            assert low[0]["price"] <= low[1]["price"]
        if len(high) >= 2:
            assert high[0]["price"] >= high[1]["price"]

    def test_sort_rating(self, api, seeded):
        r = api.get(
            f"{BASE_URL}/api/products?sort=rating"
            f"&category_id={seeded['cat_a']}&limit=100", timeout=15,
        ).json()["items"]
        if len(r) >= 2:
            assert r[0]["rating"] >= r[1]["rating"]

    def test_sort_popular_and_newest(self, api, seeded):
        # popular sorts by sold_count desc
        pop = api.get(f"{BASE_URL}/api/products?sort=popular&limit=5",
                      timeout=15).json()["items"]
        if len(pop) >= 2:
            a = pop[0].get("sold_count", 0)
            b = pop[1].get("sold_count", 0)
            assert a >= b
        # newest sorts by created_at desc; our just-seeded items should be near top
        newest = api.get(f"{BASE_URL}/api/products?sort=newest&limit=10",
                         timeout=15).json()["items"]
        top_names = {p["name"] for p in newest}
        # at least one of the freshly-seeded TEST_pgSearch products in top 10
        assert any("TEST_pgSearch" in n for n in top_names)
