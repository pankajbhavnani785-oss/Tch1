from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Optional
import base64
import logging
import os
import urllib.request
import uuid

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get("DB_NAME", "tch_kitchenware")]
JWT_SECRET = os.environ["JWT_SECRET"]

app = FastAPI(title="TCH Kitchenware API")
api = APIRouter(prefix="/api")
logger = logging.getLogger("tch")
security = HTTPBearer(auto_error=False)

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


class StockInput(BaseModel):
    quantity: int = Field(gt=0, le=100000)
    operation: str = "add"
    note: str = ""


class ReviewInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=1000)


class ProductPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[str] = None
    mrp: Optional[float] = None
    price: Optional[float] = None
    stock: Optional[int] = None
    material: Optional[str] = None
    dimensions: Optional[str] = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


def token_for(user: dict) -> str:
    return jwt.encode({"sub": user["id"], "role": user["role"], "exp": datetime.now(timezone.utc) + timedelta(days=14)}, JWT_SECRET, algorithm="HS256")


def make_user(identifier: str, full_name: str, role: str) -> dict:
    email = identifier.lower() if "@" in identifier else ""
    return {"id": str(uuid.uuid4()), "identifier": identifier, "email": email, "full_name": full_name, "role": role, "is_approved": role == "admin", "created_at": now_iso()}


def safe_user(user: dict) -> dict:
    approved = user.get("is_approved", True) if user.get("role") == "admin" else user.get("is_approved", False)
    return {k: v for k, v in {**user, "is_approved": approved}.items() if k != "password_hash"}


def normalize_images(images: List[str]) -> List[str]:
    normalized: List[str] = []
    for image in images[:4]:
        if not image:
            continue
        if image.startswith("https://"):
            try:
                request = urllib.request.Request(image, headers={"User-Agent": "TCH-Kitchenware/1.0"})
                with urllib.request.urlopen(request, timeout=10) as response:
                    content = response.read(5 * 1024 * 1024 + 1)
                if len(content) > 5 * 1024 * 1024:
                    raise ValueError("Image is larger than 5 MB")
                if len(content) < 1000:
                    raise ValueError("Downloaded content is too small to be an image")
                normalized.append(base64.b64encode(content).decode("ascii"))
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Could not download image URL: {image}") from exc
        elif image.startswith("http://"):
            raise HTTPException(status_code=400, detail="Product image links must use HTTPS")
        elif image.startswith("data:") and "," in image:
            payload = image.split(",", 1)[1]
            if len(payload) < 1000:
                raise HTTPException(status_code=400, detail="Uploaded image is empty or corrupted. Please re-select the photo.")
            normalized.append(payload)
        else:
            if len(image) < 1000:
                raise HTTPException(status_code=400, detail="Uploaded image is empty or corrupted. Please re-select the photo.")
            normalized.append(image)
    return normalized


async def auth_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:

    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Authentication required"
        )

    if credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Authentication required"
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=["HS256"]
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid session"
        ) from exc

    user = await db.users.find_one(
        {"id": payload.get("sub")},
        {"_id": 0}
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found"
        )

    return user


async def approved_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:

    user = await auth_user(credentials)

    if user.get("role") == "admin":
        return user

    if not user.get("is_approved", False):
        raise HTTPException(
            status_code=403,
            detail="Your account is waiting for admin approval. Contact TCH support on WhatsApp."
        )

    return user


async def admin_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:

    user = await auth_user(credentials)

    if user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )

    return user


@app.on_event("startup")
async def seed_defaults() -> None:
    admin = await db.users.find_one({"identifier": "admin@tch.in"}, {"_id": 0})
    if not admin:
        await db.users.insert_one({**make_user("admin@tch.in", "TCH Admin", "admin"), "password_hash": bcrypt.hashpw(b"TCHAdmin@123", bcrypt.gensalt()).decode()})
    else:
        await db.users.update_one({"identifier": "admin@tch.in"}, {"$set": {"is_approved": True}})
    # Backfill existing customers as approved so old accounts keep working
    await db.users.update_many({"role": "customer", "is_approved": {"$exists": False}}, {"$set": {"is_approved": True}})
    for name in DEFAULT_CATEGORIES:
        if not await db.categories.find_one({"name": name}, {"_id": 0}):
            await db.categories.insert_one({"id": str(uuid.uuid4()), "name": name, "icon": "grid-outline", "created_at": now_iso()})
    # Text index for fast product search at scale (5000+ products)
    try:
        await db.products.create_index([("name", "text"), ("description", "text")])
        await db.products.create_index([("category_id", 1)])
        await db.products.create_index([("price", 1)])
        await db.products.create_index([("created_at", -1)])
    except Exception as exc:
        logger.warning("Could not create product indexes: %s", exc)


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
    return {"token": token_for(user), "user": safe_user(user)}


@api.post("/auth/login")
async def login(payload: AuthInput) -> dict:
    user = await db.users.find_one({"identifier": payload.identifier}, {"_id": 0})
    if not user or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Incorrect email/mobile or password")
    safe = safe_user(user)
    return {"token": token_for(safe), "user": safe}


@api.post("/auth/admin/login")
async def admin_login(payload: AuthInput) -> dict:
    user = await db.users.find_one({"identifier": payload.identifier, "role": "admin"}, {"_id": 0})
    if not user or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    safe = safe_user(user)
    return {"token": token_for(safe), "user": safe}

    
@api.get("/auth/me")
async def me(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:
    user = await auth_user(credentials)
    return safe_user(user)

@api.get("/users")
async def list_users(
    status: str = "pending",
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> List[dict]:
    await admin_user(credentials)
    query: dict = {"role": "customer"}
    if status == "pending":
        query["is_approved"] = False
    elif status == "approved":
        query["is_approved"] = True
    rows = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return rows


@api.post("/users/{user_id}/approve")
async def approve_customer(
    user_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:
    await admin_user(credentials)
    result = await db.users.update_one({"id": user_id, "role": "customer"}, {"$set": {"is_approved": True, "approved_at": now_iso()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Customer not found")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return safe_user(user)


@api.post("/users/{user_id}/reject")
async def reject_customer(
    user_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:
    await admin_user(credentials)
    result = await db.users.delete_one({"id": user_id, "role": "customer"})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"deleted": True}


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
async def products(search: str = "", category_id: str = "", sort: str = "newest", available: bool = False, min_price: float = 0, max_price: float = 0, min_rating: float = 0, min_discount: float = 0, limit: int = 24, offset: int = 0) -> dict:
    query: dict[str, Any] = {}
    if search:
        query["$or"] = [{"name": {"$regex": search, "$options": "i"}}, {"description": {"$regex": search, "$options": "i"}}]
    if category_id:
        query["category_id"] = category_id
    if available:
        query["stock"] = {"$gt": 0}
    if min_price > 0:
        query.setdefault("price", {})["$gte"] = min_price
    if max_price > 0:
        query.setdefault("price", {})["$lte"] = max_price
    if min_rating > 0:
        query["rating"] = {"$gte": min_rating}
    if min_discount > 0:
        query["$expr"] = {"$and": [
            {"$gt": ["$mrp", 0]},
            {"$gte": [{"$multiply": [{"$divide": [{"$subtract": ["$mrp", "$price"]}, "$mrp"]}, 100]}, min_discount]},
        ]}
    sort_field = {"price_low": "price", "price_high": "price", "rating": "rating", "popular": "sold_count"}.get(sort, "created_at")
    direction = 1 if sort == "price_low" else -1
    safe_limit = max(1, min(int(limit or 24), 100))
    safe_offset = max(0, int(offset or 0))
    total = await db.products.count_documents(query)
    rows = await db.products.find(query, {"_id": 0}).sort(sort_field, direction).skip(safe_offset).limit(safe_limit).to_list(safe_limit)
    return {"items": rows, "total": total, "offset": safe_offset, "limit": safe_limit}


@api.post("/products")
async def create_product(payload: ProductInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    if not await db.categories.find_one({"id": payload.category_id}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="Choose a valid category")
    if payload.price > payload.mrp:
        raise HTTPException(status_code=400, detail="Selling price cannot exceed MRP")
    values = payload.model_dump()
    values["images"] = normalize_images(values.get("images", []))
    row = {"id": str(uuid.uuid4()), **values, "sold_count": 0, "created_at": now_iso()}
    await db.products.insert_one(row.copy())
    return row


@api.put("/products/{product_id}")
async def update_product(product_id: str, payload: ProductInput, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    values = payload.model_dump()
    values["images"] = normalize_images(values.get("images", []))
    await db.products.update_one({"id": product_id}, {"$set": values})
    row = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return row


@api.patch("/products/{product_id}")
async def patch_product(product_id: str, payload: ProductPatch, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "category_id" in updates and not await db.categories.find_one({"id": updates["category_id"]}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="Choose a valid category")
    price = updates.get("price", existing.get("price"))
    mrp = updates.get("mrp", existing.get("mrp"))
    if price and mrp and price > mrp:
        raise HTTPException(status_code=400, detail="Selling price cannot exceed MRP")
    if updates:
        await db.products.update_one({"id": product_id}, {"$set": updates})
    return await db.products.find_one({"id": product_id}, {"_id": 0})


@api.delete("/products/{product_id}")
async def delete_product(product_id: str, authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    result = await db.products.delete_one({"id": product_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.stock_events.delete_many({"product_id": product_id})
    await db.reviews.delete_many({"product_id": product_id})
    return {"deleted": True}


@api.post("/products/{product_id}/stock")
async def update_stock(product_id: str, payload: StockInput, authorization: Optional[str] = Header(default=None)) -> dict:
    admin = await admin_user(authorization)
    if payload.operation not in {"add", "set"}:
        raise HTTPException(status_code=400, detail="Stock operation must be add or set")
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    next_stock = product.get("stock", 0) + payload.quantity if payload.operation == "add" else payload.quantity
    event = {"id": str(uuid.uuid4()), "product_id": product_id, "quantity": payload.quantity, "operation": payload.operation, "note": payload.note, "admin_id": admin["id"], "created_at": now_iso()}
    await db.products.update_one({"id": product_id}, {"$set": {"stock": next_stock}})
    await db.stock_events.insert_one(event.copy())
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    return {"product": updated, "event": event}


@api.get("/products/{product_id}/stock-history")
async def stock_history(product_id: str, authorization: Optional[str] = Header(default=None)) -> List[dict]:
    await admin_user(authorization)
    return await db.stock_events.find({"product_id": product_id}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.get("/products/{product_id}/reviews")
async def list_reviews(product_id: str) -> List[dict]:
    return await db.reviews.find({"product_id": product_id}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/products/{product_id}/reviews")
async def create_review(product_id: str, payload: ReviewInput, authorization: Optional[str] = Header(default=None)) -> dict:
    user = await approved_user(authorization)
    if not await db.products.find_one({"id": product_id}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Product not found")
    review = {"id": str(uuid.uuid4()), "product_id": product_id, "user_id": user["id"], "user_name": user.get("full_name", "Customer"), "rating": payload.rating, "comment": payload.comment, "created_at": now_iso()}
    await db.reviews.insert_one(review.copy())
    # Recompute product rating
    all_reviews = await db.reviews.find({"product_id": product_id}, {"_id": 0, "rating": 1}).to_list(1000)
    if all_reviews:
        avg = sum(r["rating"] for r in all_reviews) / len(all_reviews)
        await db.products.update_one({"id": product_id}, {"$set": {"rating": round(avg, 2)}})
    return review


@api.get("/dashboard/stats")
async def dashboard_stats(authorization: Optional[str] = Header(default=None)) -> dict:
    await admin_user(authorization)
    today = datetime.now(timezone.utc).date().isoformat()
    all_orders = await db.orders.find({}, {"_id": 0}).to_list(1000)
    today_orders = [o for o in all_orders if o.get("created_at", "").startswith(today) and o.get("status") != "cancelled"]
    active_orders = [o for o in all_orders if o.get("status") == "processing"]
    delivered_orders = [o for o in all_orders if o.get("status") == "delivered"]
    low_stock = await db.products.find({"stock": {"$lte": 5}}, {"_id": 0}).sort("stock", 1).to_list(20)
    pending_users = await db.users.count_documents({"role": "customer", "is_approved": False})
    total_products = await db.products.count_documents({})
    return {
        "today_orders": len(today_orders),
        "today_revenue": sum(o.get("total", 0) for o in today_orders),
        "active_orders": len(active_orders),
        "total_delivered": len(delivered_orders),
        "total_revenue": sum(o.get("total", 0) for o in all_orders if o.get("status") != "cancelled"),
        "low_stock": low_stock,
        "pending_users": pending_users,
        "total_products": total_products,
    }


@api.post("/orders")
async def create_order(payload: OrderInput, authorization: Optional[str] = Header(default=None)) -> dict:
    user = await approved_user(authorization)
    order = {"id": f"TCH-{datetime.now(timezone.utc).strftime('%y%m%d')}-{uuid.uuid4().hex[:6].upper()}", "user_id": user["id"], "customer_name": payload.address.full_name, "items": [item.model_dump() for item in payload.items], "address": payload.address.model_dump(), "subtotal": payload.subtotal, "discount": payload.discount, "delivery_charge": payload.delivery_charge, "total": payload.total, "status": "processing", "payment_method": "Cash on Delivery", "created_at": now_iso()}
    await db.orders.insert_one(order.copy())
    for item in payload.items:
        await db.products.update_one({"id": item.product_id}, {"$inc": {"stock": -item.quantity, "sold_count": item.quantity}})
    return order


@api.get("/orders")
async def get_orders(authorization: Optional[str] = Header(default=None)) -> List[dict]:
    user = await auth_user(authorization)
    if user.get("role") != "admin" and not user.get("is_approved", False):
        return []
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
