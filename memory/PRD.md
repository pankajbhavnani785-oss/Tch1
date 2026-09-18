# TCH Kitchenware — Product Requirements

## Problem statement
Build a production-ready mobile-first e-commerce application for TCH Kitchenware & Home Products, focused on crockery and gifts in India. Customers register with mobile/email + password and wait for admin approval before browsing. Admin verifies each customer on WhatsApp and approves them from the Admin Studio.

## Architecture
- Expo SDK 57 React Native mobile frontend with a single protected storefront flow and five bottom navigation areas.
- FastAPI backend on port 8001 with JWT sessions, bcrypt passwords, MongoDB persistence, and `/api` routes.
- Product photos are converted to base64 before being sent to the backend; Indian Rupee pricing and COD are built into checkout.

## User personas
- Customer: signs up/signs in with email or mobile, waits for approval, discovers kitchenware, manages a cart, and places a COD order.
- Store admin: uses a protected email/password account to approve customers, curate categories/products, edit product SKU/category, and manage orders.

## Implemented
- Auth-gated TCH storefront with five-tab bottom navigation and Admin Studio.
- Customer approval flow: pending users blocked from ordering, "Waiting for approval" screen with WhatsApp CTA, admin Users tab with approve/reject/WhatsApp actions.
- Product catalog with base64 images, gallery upload + HTTPS URL upload, stock tracking with purchase history.
- Admin product management: edit category, stock (SKU), price, MRP, name and description from the "Manage" tab; delete products.
- Amazon-style prominent stock indicators for customers: "In stock · N available", "Only N left in stock — order soon", "Out of stock" on cards and detail.
- Product detail: tap-to-zoom fullscreen image viewer with pinch zoom, similar products carousel, customer reviews (5-star input) that update the average rating.
- Advanced filters/sort: category, price range, min rating, min discount, in-stock only, sorted by newest/price/rating/popularity.
- WhatsApp order sharing: opens customer's number with a complete formatted order breakdown (items, totals, delivery address).
- **Reorder shortcut**: Customer taps Reorder on any past order to instantly refill the cart with available items.
- **Admin Sales Snapshot**: Dashboard tab shows today's orders + revenue, processing/delivered counts, pending users, total products, and low-stock alerts.
- **App promo sharing**: Admin can share a branded TCH promo image via WhatsApp (native share sheet) or send a plain WhatsApp promo text.
- Full COD checkout, order history, admin order status/cancel/delete, category CRUD.

## Prioritized backlog
- P1: Saved-address book for repeat customers and product pagination.
- P1: Push-in-app notifications for new pending approvals.
- P2: Hindi translation toggle, real promotional imagery, shipment tracking.

## Next tasks
1. Admin approves the first live customer via WhatsApp verification.
2. Customer completes end-to-end shop → checkout journey and confirms the SKU/stock indicators.
3. Store team validates the WhatsApp order share message with real deliveries.
