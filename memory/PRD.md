# TCH Kitchenware — Product Requirements

## Problem statement
Build a production-ready mobile-first e-commerce application for TCH Kitchenware & Home Products, focused on crockery and gifts in India. Customers must authenticate before browsing, shop products, place Cash on Delivery orders, and view order history. Approved admins manage categories, products with up to four gallery images, and order history.

## Architecture
- Expo SDK 57 React Native mobile frontend with a single protected storefront flow and five bottom navigation areas.
- FastAPI backend on port 8001 with JWT sessions, bcrypt passwords, MongoDB persistence, and `/api` routes.
- Product photos are converted to base64 before being sent to the backend; Indian Rupee pricing and COD are built into checkout.

## User personas
- Customer: signs up/signs in with email or mobile, discovers kitchenware, manages a cart, and places a COD order.
- Store admin: uses a protected email/password account to curate categories/products and manage orders.

## Core requirements (static)
- Deep-red premium TCH brand, dark charcoal surfaces, rounded cards, readable prices, modern icons.
- Customer login gate, Home, Categories, Products, Orders, Profile, cart, product details, checkout, confirmation via Orders.
- Admin-only category/product/order tools, four-photo gallery upload, order status updates, deletion backend for dispatched/cancelled history, WhatsApp sharing.

## Implemented
- 2026-09-18: Replaced the starter screen with TCH auth-gated mobile storefront and five navigation areas.
- 2026-09-18: Added FastAPI JWT customer/admin auth, seeded admin, 14 starter categories, MongoDB product/category/order APIs.
- 2026-09-18: Added cart quantity controls, product detail view, COD checkout address form, order history, status badges, and admin studio.
- 2026-09-18: Added mobile gallery picker with up to four base64 photos, category creation, order sharing, and status management.
- 2026-09-18: Verified preview rendering, admin login, customer registration, protected order retrieval, backend compilation, and frontend TypeScript/lint checks.

## Prioritized backlog
- P0: Add real product catalog through Admin Studio and validate gallery uploads on a physical device.
- P1: Add editable category controls and delete buttons directly to the admin mobile list; add saved-address persistence and product pagination.
- P1: Add order confirmation detail screen and customer cancellation support.
- P2: Add Hindi translation strings/toggle, real promotional imagery, reviews, and notifications.

## Next tasks
1. Admin adds the first product set with photos, prices, stock, material, and dimensions.
2. Customer validates browse → cart → COD order on a device.
3. Store team reviews order status and WhatsApp message formatting.