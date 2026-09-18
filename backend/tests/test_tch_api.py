import os
import uuid

import requests


BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")


def test_public_catalog_and_admin_auth():
    assert BASE_URL
    root = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert root.status_code == 200
    assert root.json()["message"] == "TCH Kitchenware API"
    categories = requests.get(f"{BASE_URL}/api/categories", timeout=15)
    assert categories.status_code == 200
    assert len(categories.json()) >= 14
    products = requests.get(f"{BASE_URL}/api/products", timeout=15)
    assert products.status_code == 200
    assert products.json() == []
    login = requests.post(
        f"{BASE_URL}/api/auth/admin/login",
        json={"identifier": "admin@tch.in", "password": "TCHAdmin@123"},
        timeout=15,
    )
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "admin"


def test_customer_registration_and_protected_orders():
    identifier = f"TEST_{uuid.uuid4().hex[:10]}@example.com"
    register = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"identifier": identifier, "password": "TestPass123!", "full_name": "TEST Customer"},
        timeout=15,
    )
    assert register.status_code == 200
    data = register.json()
    assert data["user"]["identifier"] == identifier
    assert data["user"]["role"] == "customer"
    orders = requests.get(
        f"{BASE_URL}/api/orders",
        headers={"Authorization": f"Bearer {data['token']}"},
        timeout=15,
    )
    assert orders.status_code == 200
    assert orders.json() == []


def test_orders_require_authentication():
    response = requests.get(f"{BASE_URL}/api/orders", timeout=15)
    assert response.status_code == 401
    assert "Authentication" in response.json()["detail"]