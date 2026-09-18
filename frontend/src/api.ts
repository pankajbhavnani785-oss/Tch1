import Constants from "expo-constants";
import { storage } from "@/src/utils/storage";

const baseUrl = `${Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_BACKEND_URL || ""}/api`;

export type User = { id: string; identifier: string; full_name: string; role: "customer" | "admin"; email?: string };
export type Category = { id: string; name: string; icon: string; product_count: number };
export type Product = { id: string; name: string; description: string; category_id: string; mrp: number; price: number; rating: number; stock: number; material: string; dimensions: string; images: string[]; sold_count: number };
export type CartItem = Product & { quantity: number };
export type Order = { id: string; items: { product_id: string; name: string; image: string; price: number; quantity: number }[]; address: Record<string, string>; subtotal: number; discount: number; delivery_charge: number; total: number; status: string; payment_method: string; created_at: string; customer_name?: string };

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

export const api = {
  login: (identifier: string, password: string, admin = false) => request<{ token: string; user: User }>(admin ? "/auth/admin/login" : "/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  register: (identifier: string, password: string, full_name: string) => request<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ identifier, password, full_name, email: identifier.includes("@") ? identifier : undefined }) }),
  categories: () => request<Category[]>("/categories"),
  products: (params = "") => request<Product[]>(`/products${params ? `?${params}` : ""}`),
  createCategory: (name: string) => request<Category>("/categories", { method: "POST", body: JSON.stringify({ name, icon: "grid-outline" }) }),
  updateCategory: (id: string, name: string) => request<Category>(`/categories/${id}`, { method: "PUT", body: JSON.stringify({ name, icon: "grid-outline" }) }),
  createProduct: (product: Omit<Product, "id" | "sold_count">) => request<Product>("/products", { method: "POST", body: JSON.stringify(product) }),
  orders: () => request<Order[]>("/orders"),
  createOrder: (order: object) => request<Order>("/orders", { method: "POST", body: JSON.stringify(order) }),
  updateOrder: (id: string, status: string) => request<Order>(`/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteOrder: (id: string) => request<{ deleted: boolean }>(`/orders/${id}`, { method: "DELETE" }),
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