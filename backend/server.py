from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Optional
import logging
import os
import uuid

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get("DB_NAME", "tch_kitchenware")]
JWT_SECRET = os.environ.get("JWT_SECRET", "tch-local-secret-change-me")

app = FastAPI(title="TCH Kitchenware API")
api = APIRouter(prefix="/api")
logger = logging.getLogger("tch")

DEFAULT_CATEGORIES = [
    "New Arrivals", "Gift Items", "Return Gifts", "Jar or Candy Jar", "Cup and Saucers",
    "Home & Kitchen", "Bulk Item", "Bulk Glasses", "Glass Jar Bulk", "Cylinder and Fish Bowl",
    "Bottles", "Dinner Sets", "Ceramic Jar and Handi", "Other",
]


class AuthInput(BaseModel):
    identifier: str = Field(min_length=3)
    password: str = Field(min_length=6)


class RegisterInput(AuthInput):
    full_name: str = Field(min_length=2)
    email: Optional[EmailStr] = None


class CategoryInput(BaseModel):
    name: str = Field(min_length=2)
    icon: str = "grid-outline"


class ProductInput(BaseModel):
    name: str = Field(min_length=2)
    description: str = ""
    category_id: str
    mrp: float = Field(gt=0)
    price: float = Field(gt=0)
    rating: float = Field(default=4.5, ge=0, le=5)
    stock: int = Field(default=0, ge=0)
    material: str = ""
    dimensions: str = ""
    images: List[str] = Field(default_factory=list, max_length=4)


class OrderItem(BaseModel):
    product_id: str
    name: str
    image: str = ""
    price: float
    quantity: int = Field(gt=0)


class Address(BaseModel):
    full_name: str
    mobile: str
    email: str = ""
    address: str
    landmark: str = ""
    city: str
    state: str
    pincode: str


class OrderInput(BaseModel):
    items: List[OrderItem] = Field(min_length=1)
    address: Address
    subtotal: float
    discount: float = 0
    delivery_charge: float = 0
    total: float


class StatusInput(BaseModel):
    status: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


def token_for(user: dict) -> str:
    return jwt.encode({"sub": user["id"], "role": user["role"], "exp": datetime.now(timezone.utc) + timedelta(days=14)}, JWT_SECRET, algorithm="HS256")


async def current_user(token: str = Query(default="")) -> dict:
    # Query is intentionally supported for simple mobile fetch helpers; the frontend sends Authorization too.
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def make_user(identifier: str, full_name: str, role: str) -> dict:
    email = identifier.lower() if "@" in identifier else ""
    return {"id": str(uuid.uuid4()), "identifier": identifier, "email": email, "full_name": full_name, "role": role, "created_at": now_iso()}


async def auth_user(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1], JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def admin_user(authorization: Optional[str]) -> dict:
    user = await auth_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@app.on_event("startup")
async def seed_defaults() -> None:
    admin = await db.users.find_one({"identifier": "admin@tch.in"}, {"_id": 0})
    if not admin:
        await db.users.insert_one({**make_user("admin@tch.in", "TCH Admin", "admin"), "password_hash": bcrypt.hashpw(b"TCHAdmin@123", bcrypt.gensalt()).decode()})
    for name in DEFAULT_CATEGORIES:
        if not await db.categories.find_one({"name": name}, {"_id": 0}):
            await db.categories.insert_one({"id": str(uuid.uuid4()), "name": name, "icon": "grid-outline", "created_at": now_iso()})


@api.get("/")
async def root() -> dict:
    return {"message": "TCH Kitchenware API"}


@api.post("/auth/register")
async def register(payload: RegisterInput) -> dict:
    existing = await db.users.find_one({"identifier": payload.identifier}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="An account already exists")
    user = make_user(payload.identifier, payload.full_name, "customer")
    if payload.email:
        user["email"] = str(payload.email)
    user["password_hash"] = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    await db.users.insert_one(user.copy())
    user.pop("password_hash", None)
    return {"token": token_for(user), "user": user}


@api.post("/auth/login")
async def login(payload: AuthInput) -> dict:
    user = await db.users.find_one({"identifier": payload.identifier}, {"_id": 0})
    if not user or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Incorrect email/mobile or password")
    safe = {k: v for k, v in user.items() if k != "password_hash"}
    return {"token": token_for(safe), "user": safe}


@api.post("/auth/admin/login")
async def admin_login(payload: AuthInput) -> dict:
    user = await db.users.find_one({"identifier": payload.identifier, "role": "admin"}, {"_id": 0})
    if not user or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    safe = {k: v for k, v in user.items() if k != "password_hash"}
    return {"token": token_for(safe), "user": safe}


@api.get("/categories")
async def categories() -> List[dict]:
    rows = await db.categories.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    counts = {row["id"]: await db.products.count_documents({"category_id": row["id"]}) for row in rows}
    return [{**row, "product_count": counts.get(row["id"], 0)} for row in rows]


@api.post("/categories")
async def create_category(payload: CategoryInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    if await db.categories.find_one({"name": payload.name}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="Category already exists")
    row = {"id": str(uuid.uuid4()), **payload.model_dump(), "created_at": now_iso()}
    await db.categories.insert_one(row.copy())
    return row


@api.put("/categories/{category_id}")
async def update_category(category_id: str, payload: CategoryInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    await db.categories.update_one({"id": category_id}, {"$set": payload.model_dump()})
    row = await db.categories.find_one({"id": category_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return row


@api.get("/products")
async def products(search: str = "", category_id: str = "", sort: str = "newest", available: bool = False) -> List[dict]:
    query: dict[str, Any] = {}
    if search:
        query["$or"] = [{"name": {"$regex": search, "$options": "i"}}, {"description": {"$regex": search, "$options": "i"}}]
    if category_id:
        query["category_id"] = category_id
    if available:
        query["stock"] = {"$gt": 0}
    sort_field = {"price_low": "price", "price_high": "price", "rating": "rating", "popular": "sold_count"}.get(sort, "created_at")
    direction = 1 if sort == "price_low" else -1
    rows = await db.products.find(query, {"_id": 0}).sort(sort_field, direction).to_list(500)
    return rows


@api.post("/products")
async def create_product(payload: ProductInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    if not await db.categories.find_one({"id": payload.category_id}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="Choose a valid category")
    if payload.price > payload.mrp:
        raise HTTPException(status_code=400, detail="Selling price cannot exceed MRP")
    row = {"id": str(uuid.uuid4()), **payload.model_dump(), "sold_count": 0, "created_at": now_iso()}
    await db.products.insert_one(row.copy())
    return row


@api.put("/products/{product_id}")
async def update_product(product_id: str, payload: ProductInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    await db.products.update_one({"id": product_id}, {"$set": payload.model_dump()})
    row = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return row


@api.post("/orders")
async def create_order(payload: OrderInput, authorization: Optional[str] = Header(default=None)) -> dict:
    user = await auth_user(authorization)
    order = {"id": f"TCH-{datetime.now(timezone.utc).strftime('%y%m%d')}-{uuid.uuid4().hex[:6].upper()}", "user_id": user["id"], "customer_name": payload.address.full_name, "items": [item.model_dump() for item in payload.items], "address": payload.address.model_dump(), "subtotal": payload.subtotal, "discount": payload.discount, "delivery_charge": payload.delivery_charge, "total": payload.total, "status": "processing", "payment_method": "Cash on Delivery", "created_at": now_iso()}
    await db.orders.insert_one(order.copy())
    for item in payload.items:
        await db.products.update_one({"id": item.product_id}, {"$inc": {"stock": -item.quantity, "sold_count": item.quantity}})
    return order


@api.get("/orders")
async def get_orders(authorization: Optional[str] = Header(default=None)) -> List[dict]:
    user = await auth_user(authorization)
    query = {} if user.get("role") == "admin" else {"user_id": user["id"]}
    return await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.patch("/orders/{order_id}/status")
async def update_order_status(order_id: str, payload: StatusInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    allowed = {"processing", "dispatched", "delivered", "cancelled"}
    if payload.status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid order status")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": payload.status}})
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@api.delete("/orders/{order_id}")
async def delete_order(order_id: str, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order or order.get("status") not in {"dispatched", "cancelled"}:
        raise HTTPException(status_code=400, detail="Only dispatched or cancelled orders can be deleted")
    await db.orders.delete_one({"id": order_id})
    return {"deleted": True}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    client.close()