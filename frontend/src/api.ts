import Constants from "expo-constants";
import { storage } from "@/src/utils/storage";

const baseUrl = `${Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_BACKEND_URL || ""}/api`;

export type User = { id: string; identifier: string; full_name: string; role: "customer" | "admin"; email?: string; is_approved: boolean; created_at?: string };
export type Category = { id: string; name: string; icon: string; product_count: number };
export type Product = { id: string; name: string; description: string; category_id: string; mrp: number; price: number; rating: number; stock: number; material: string; dimensions: string; images: string[]; sold_count: number };
export type CartItem = Product & { quantity: number };
export type Order = { id: string; items: { product_id: string; name: string; image: string; price: number; quantity: number }[]; address: { full_name: string; mobile: string; email?: string; address: string; landmark?: string; city: string; state: string; pincode: string }; subtotal: number; discount: number; delivery_charge: number; total: number; status: string; payment_method: string; created_at: string; customer_name?: string };
export type StockEvent = { id: string; product_id: string; quantity: number; operation: "add" | "set"; note: string; created_at: string };
export type Review = { id: string; product_id: string; user_id: string; user_name: string; rating: number; comment: string; created_at: string };
export type DashboardStats = { today_orders: number; today_revenue: number; active_orders: number; total_delivered: number; total_revenue: number; low_stock: Product[]; pending_users: number; total_products: number };
export type ProductFilters = { search?: string; category_id?: string; sort?: string; available?: boolean; min_price?: number; max_price?: number; min_rating?: number; min_discount?: number };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet("tch_token", "");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Something went wrong");
  return data as T;
}

function buildQuery(filters: ProductFilters = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === 0 || value === false) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  login: (identifier: string, password: string, admin = false) => request<{ token: string; user: User }>(admin ? "/auth/admin/login" : "/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  register: (identifier: string, password: string, full_name: string) => request<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ identifier, password, full_name, email: identifier.includes("@") ? identifier : undefined }) }),
  me: () => request<User>("/auth/me"),
  categories: () => request<Category[]>("/categories"),
  products: (filters: ProductFilters = {}) => request<Product[]>(`/products${buildQuery(filters)}`),
  createCategory: (name: string) => request<Category>("/categories", { method: "POST", body: JSON.stringify({ name, icon: "grid-outline" }) }),
  updateCategory: (id: string, name: string) => request<Category>(`/categories/${id}`, { method: "PUT", body: JSON.stringify({ name, icon: "grid-outline" }) }),
  createProduct: (product: Omit<Product, "id" | "sold_count">) => request<Product>("/products", { method: "POST", body: JSON.stringify(product) }),
  patchProduct: (id: string, updates: Partial<Omit<Product, "id" | "images" | "sold_count">>) => request<Product>(`/products/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  deleteProduct: (id: string) => request<{ deleted: boolean }>(`/products/${id}`, { method: "DELETE" }),
  updateStock: (id: string, quantity: number, operation: "add" | "set", note: string) => request<{ product: Product; event: StockEvent }>(`/products/${id}/stock`, { method: "POST", body: JSON.stringify({ quantity, operation, note }) }),
  stockHistory: (id: string) => request<StockEvent[]>(`/products/${id}/stock-history`),
  reviews: (id: string) => request<Review[]>(`/products/${id}/reviews`),
  addReview: (id: string, rating: number, comment: string) => request<Review>(`/products/${id}/reviews`, { method: "POST", body: JSON.stringify({ rating, comment }) }),
  orders: () => request<Order[]>("/orders"),
  createOrder: (order: object) => request<Order>("/orders", { method: "POST", body: JSON.stringify(order) }),
  updateOrder: (id: string, status: string) => request<Order>(`/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteOrder: (id: string) => request<{ deleted: boolean }>(`/orders/${id}`, { method: "DELETE" }),
  listUsers: (status: "pending" | "approved") => request<User[]>(`/users?status=${status}`),
  approveUser: (id: string) => request<User>(`/users/${id}/approve`, { method: "POST" }),
  rejectUser: (id: string) => request<{ deleted: boolean }>(`/users/${id}/reject`, { method: "POST" }),
  dashboardStats: () => request<DashboardStats>("/dashboard/stats"),
};

export async function saveSession(token: string, user: User) {
  await storage.secureSet("tch_token", token);
  await storage.setItem("tch_user", JSON.stringify(user));
}

export async function loadSession(): Promise<{ token: string; user: User } | null> {
  const token = await storage.secureGet("tch_token", "");
  const rawUser = await storage.getItem("tch_user", "");
  return token && rawUser ? { token, user: JSON.parse(rawUser) as User } : null;
}

export async function clearSession() {
  await storage.secureRemove("tch_token");
  await storage.removeItem("tch_user");
}
