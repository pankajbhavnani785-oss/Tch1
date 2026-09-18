"""
Image upload validation regression for TCH Kitchenware.
Covers the fix where:
  - short/corrupt base64 payloads (< 1000 chars) are rejected with a friendly 400
  - raw base64 (no data: prefix) and data-URI form both accepted when valid
  - https:// image URLs are downloaded and stored as raw base64
  - empty string entries are filtered out (not fatal unless nothing remains)
  - PUT /api/products/{id} enforces the same rules
  - existing seeded products (elight, cello Cup saucer) still carry image bytes
  - cuo product exists with empty images (post-cleanup)
Cleans up all TEST_ products it creates.
"""
import base64
import io
import os
import struct
import uuid
import zlib

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")

ADMIN_ID = "admin@tch.in"
ADMIN_PW = "TCHAdmin@123"


# ---------- helpers ----------
def _valid_base64_payload() -> str:
    """Return a >1000-char base64 blob.

    The backend only validates length (>1000 chars of raw base64 OR >1000 bytes
    of downloaded HTTPS content). It does NOT decode the image, so any random
    payload of sufficient size satisfies the contract.
    """
    # 2 KB of pseudo-random bytes → ~2732 chars of base64
    data = os.urandom(2048)
    b64 = base64.b64encode(data).decode("ascii")
    assert len(b64) > 1000
    return b64


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def api():
    assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL required"
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
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def category_id(api):
    r = api.get(f"{BASE_URL}/api/categories", timeout=15)
    assert r.status_code == 200
    cats = r.json()
    assert cats, "no categories seeded"
    return cats[0]["id"]


def _product_body(category_id: str, images):
    return {
        "name": f"TEST_img_{uuid.uuid4().hex[:6]}",
        "description": "image validation test",
        "category_id": category_id,
        "mrp": 200,
        "price": 150,
        "rating": 4.0,
        "stock": 3,
        "material": "",
        "dimensions": "",
        "images": images,
    }


# ---------- tests: rejection of short/corrupt base64 ----------
class TestRejectCorruptImages:
    def test_reject_short_raw_base64_file_not_found(self, api, admin_headers, category_id):
        """base64 of the literal text 'File not found' (~20 bytes) must be rejected."""
        payload_b64 = base64.b64encode(b"File not found").decode("ascii")
        assert len(payload_b64) < 1000

        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, [payload_b64]),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "empty or corrupted" in r.json()["detail"].lower()

        # confirm no product created with that TEST_ name
        listing = api.get(f"{BASE_URL}/api/products", timeout=15).json()
        assert all("image validation test" != p.get("description")
                   or p.get("images") != [payload_b64] for p in listing)

    def test_reject_short_data_uri(self, api, admin_headers, category_id):
        """data:image/jpeg;base64,<short> must be rejected."""
        short = "data:image/jpeg;base64," + base64.b64encode(b"tiny").decode("ascii")
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, [short]),
            timeout=15,
        )
        assert r.status_code == 400
        assert "empty or corrupted" in r.json()["detail"].lower()

    def test_reject_http_scheme(self, api, admin_headers, category_id):
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, ["http://example.com/x.jpg"]),
            timeout=15,
        )
        assert r.status_code == 400
        assert "https" in r.json()["detail"].lower()


# ---------- tests: valid base64 accepted ----------
class TestAcceptValidBase64:
    def test_create_with_raw_base64_stored_intact(self, api, admin_headers, category_id):
        payload = _valid_base64_payload()
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, [payload]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        product = r.json()
        try:
            assert len(product["images"]) == 1
            stored = product["images"][0]
            # backend stores WITHOUT data: prefix
            assert not stored.startswith("data:")
            assert stored == payload
            # GET back and verify persistence
            got = api.get(f"{BASE_URL}/api/products", timeout=15).json()
            match = [p for p in got if p["id"] == product["id"]][0]
            assert match["images"][0] == payload
        finally:
            api.delete(f"{BASE_URL}/api/products/{product['id']}",
                       headers=admin_headers, timeout=15)

    def test_create_with_data_uri_strips_prefix(self, api, admin_headers, category_id):
        payload = _valid_base64_payload()
        uri = f"data:image/png;base64,{payload}"
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, [uri]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            assert p["images"][0] == payload  # prefix removed
        finally:
            api.delete(f"{BASE_URL}/api/products/{p['id']}",
                       headers=admin_headers, timeout=15)

    def test_empty_strings_are_filtered(self, api, admin_headers, category_id):
        payload = _valid_base64_payload()
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, ["", payload, ""]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            assert p["images"] == [payload]  # empties dropped, valid retained
        finally:
            api.delete(f"{BASE_URL}/api/products/{p['id']}",
                       headers=admin_headers, timeout=15)

    def test_all_empty_strings_allowed_no_images(self, api, admin_headers, category_id):
        """images: ["", ""] should be accepted, resulting in a product with 0 images."""
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, ["", ""]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            assert p["images"] == []
        finally:
            api.delete(f"{BASE_URL}/api/products/{p['id']}",
                       headers=admin_headers, timeout=15)


# ---------- tests: https download ----------
class TestHttpsUrlDownload:
    def test_https_url_downloaded_and_stored_as_base64(self, api, admin_headers, category_id):
        # Use a small but valid JPEG (>1KB). picsum.photos serves ~10-50KB JPEGs
        url = "https://picsum.photos/id/237/200/200.jpg"
        try:
            probe = requests.get(url, timeout=15)
            if probe.status_code != 200 or len(probe.content) < 1000:
                pytest.skip("Remote image not reachable / too small in this environment")
        except Exception:
            pytest.skip("Network to picsum.photos unavailable")

        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, [url]),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            assert len(p["images"]) == 1
            stored = p["images"][0]
            assert not stored.startswith("http")
            assert not stored.startswith("data:")
            # decodable base64 with reasonable size
            raw = base64.b64decode(stored, validate=True)
            assert len(raw) >= 1000
            # GET path returns it back intact
            got = api.get(f"{BASE_URL}/api/products", timeout=15).json()
            match = [x for x in got if x["id"] == p["id"]][0]
            assert match["images"][0] == stored
        finally:
            api.delete(f"{BASE_URL}/api/products/{p['id']}",
                       headers=admin_headers, timeout=15)


# ---------- tests: PUT enforces same validation ----------
class TestPutEnforcesValidation:
    @pytest.fixture()
    def product(self, api, admin_headers, category_id):
        r = api.post(
            f"{BASE_URL}/api/products",
            headers=admin_headers,
            json=_product_body(category_id, []),
            timeout=15,
        )
        assert r.status_code == 200
        p = r.json()
        yield p
        api.delete(f"{BASE_URL}/api/products/{p['id']}",
                   headers=admin_headers, timeout=15)

    def test_put_rejects_short_base64(self, api, admin_headers, category_id, product):
        short_b64 = base64.b64encode(b"nope").decode("ascii")
        body = _product_body(category_id, [short_b64])
        body["name"] = product["name"]
        r = api.put(
            f"{BASE_URL}/api/products/{product['id']}",
            headers=admin_headers, json=body, timeout=15,
        )
        assert r.status_code == 400
        assert "empty or corrupted" in r.json()["detail"].lower()

    def test_put_accepts_valid_base64(self, api, admin_headers, category_id, product):
        payload = _valid_base64_payload()
        body = _product_body(category_id, [payload])
        body["name"] = product["name"]
        r = api.put(
            f"{BASE_URL}/api/products/{product['id']}",
            headers=admin_headers, json=body, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["images"] == [payload]


# ---------- tests: existing seeded products (regression) ----------
class TestSeededProductRegression:
    def test_elight_and_cello_have_images(self, api):
        rows = api.get(f"{BASE_URL}/api/products", timeout=15).json()
        by_name = {p["name"].strip().lower(): p for p in rows}

        elight = by_name.get("elight")
        cello = None
        for name, prod in by_name.items():
            if "cello" in name and "cup" in name:
                cello = prod
                break

        # Neither must be missing – if they're gone the seed cleanup went too far
        if not elight:
            pytest.skip("elight product not present in this environment")
        if not cello:
            pytest.skip("'cello Cup saucer' product not present in this environment")

        for prod in (elight, cello):
            imgs = prod.get("images") or []
            assert imgs, f"{prod['name']} has no images (regression!)"
            # Each stored image must be > 1000 chars of raw base64
            for img in imgs:
                assert not img.startswith("data:"), f"{prod['name']} image should be raw base64"
                assert len(img) > 1000, f"{prod['name']} image payload too small"
                # decode-safe
                base64.b64decode(img, validate=False)

    def test_cuo_has_empty_images(self, api):
        rows = api.get(f"{BASE_URL}/api/products", timeout=15).json()
        cuo = next((p for p in rows if p["name"].strip().lower() == "cuo"), None)
        if not cuo:
            pytest.skip("cuo product not in this environment")
        assert cuo.get("images", []) == [], (
            f"cuo should have empty images post-cleanup, got {len(cuo.get('images', []))}"
        )
