# Order Ledger — Sales Order Management (Garment Distribution)

## Original Problem Statement
User wanted a full-stack app for sales order management, rebuilt from an uploaded single-file HTML "Order Ledger" garment-distribution tracker (previously localStorage-only). Rebuild faithfully with all features on a real database.

## User Choices
- Rebuild faithfully with all features (Dashboard, Sale Orders, Dispatches, Masters, Excel import/export).
- No login — single shared workspace.
- Indian Rupee ₹ with Indian number format.
- Fresh modern redesign (Swiss high-contrast, Klein Blue #002FA7, Cabinet Grotesk + IBM Plex Sans).

## Architecture
- Frontend: React (CRA + craco, `@/` alias), Tailwind + shadcn/ui, react-router, sonner toasts, exceljs (styled exports) + xlsx (imports).
- Backend: FastAPI, all routes under `/api`. MongoDB via motor.
- Collections: customers, brands, exhibitions, salesmen, sale_orders, dispatch_orders.
- Sale order IDs are user-defined strings; masters/dispatch use generated IDs.

## Core Requirements (static)
- Masters: Customers (name + REQUIRED city), Brands, Exhibitions, Salesmen — add/remove/bulk import.
- Sale Orders: create/edit/delete, line items (brand/rate/qty), event_type exhibition|door_to_door, live totals, filters, Excel import/export.
- Dispatch Orders: dispatch against a sale order per brand; searchable sale-order picker; over-qty blocked (client + server); history + export.
- Dashboard: stat cards, pending by customer, pending by brand, open orders, Excel report.
- Reports: filter by event type/customer/brand/exhibition/salesman + pivot summary (group-by) + detailed lines + Excel export.
- PIN protection (hardcoded `admin123`) gates the Masters menu and all edit/delete actions.

## Implemented (with dates)
- 2026-08-07: Full MVP — Dashboard, Sale Orders (CRUD + import/export), Dispatch (create/delete/export + validation), Masters. Tested 100% (iteration_1).
- 2026-08-07: Reports section (filters + pivot + detail + export); server-side dispatch over-qty validation.
- 2026-08-07: PIN gate (Masters + edit/delete), borders everywhere, styled/bordered Excel exports (exceljs), customer City (required), searchable sale-order combobox in Dispatch. Tested 100% (iteration_2).
- 2026-08-07: Master EDIT (add city to old customers), new Seasons master (in Sale Order form + Reports filter/group-by), Dashboard overdue "needs attention" alert + row badges, Grand Total rows on every table, printable Salesman report (Reports Print button). Tested 100% (iteration_3 backend 31/31, iteration_4 frontend 100%).
- 2026-08-07: Customers tab (searchable list with stats) + per-customer History page (order history + dispatch timeline, printable); Dashboard "Pending by Season" card. Tested 100% (iteration_5 backend 37/37, frontend 100%).
- 2026-08-07: Customer Statement export on the History page — styled multi-sheet Excel (Summary + Orders + Dispatch Timeline) via exceljs; Print/PDF button covers PDF.
- 2026-08-07: Dashboard filter bar — filter all dashboard stats/cards/open-orders by Customer, Brand, Season, Event Type, and an Overdue-only toggle (backend /api/dashboard query params).
- 2026-08-09: Compare & Analyse section — compare two datasets (A vs B) across any dimension (Customer/Brand/Season/Financial Year/Exhibition/Salesman/Event Type), broken down by a second dimension, with metric selection (ordered/dispatched/pending pieces, order value, pending value), summary cards + delta %, a two-series bar chart, detailed table with variance, and Excel export. Added India Financial Year (Apr–Mar) to /api/reports rows. Tested 100% (iteration_6 backend 39/39, frontend 100%).
- 2026-08-09: Compare upgraded — (a) compare 3+ datasets at once via a chip multi-selector; (b) 6 chart types (grouped/stacked bars, line, area, radar, pie) via recharts; (c) new "Top Movers" sub-tab showing biggest gainers/drops between two periods (any entity × any period dimension × metric) with diverging bar chart + Excel export. Tested 100% (iteration_7 frontend).
- 2026-08-09: (a) Brand master default Rate — set a rate per brand that auto-fills the Sale Order line rate when the brand is picked (non-destructive if user already typed a rate); (b) Sale Order import template now includes Event Type/Exhibition/Salesman/Season columns and import maps them; (c) Dispatch sale-order search now shows a per-order summary (brand × qty, event type + exhibition/salesman detail) and is searchable by those fields. Tested 100% (iteration_8 backend 44/44 + Masters/auto-fill/template; iteration_9 Dispatch summary fix).
- 2026-08-09: Customer ledger upgrades — (a) filter bar on Order History (Status/Season/Event) that narrows rows + grand total + statement export; (b) direct Dispatch button per order row opening an in-ledger dispatch dialog (per-brand pending inputs) that saves and auto-refreshes pending/timeline. Backend history now returns per-order brand_rows. Tested 100% (iteration_10 backend 4/4, frontend 8/8).
- 2026-08-09: Multi-select bulk delete — checkbox selection + "Delete Selected" bar on Sale Orders, Dispatch History, and each Masters panel (select-all supported). Backend bulk-delete endpoints (masters/sale-orders/dispatch-orders); sale-order bulk delete cascades to its dispatches. PIN-gated. Tested 100% (iteration_11 backend + frontend).
- 2026-08-10: (a) Sale Order ID now auto-generated (read-only field) for faster entry; (b) Customer City shown in Sale Orders/Dashboard/Reports tables and included in all Excel exports (backend adds city to dashboard.open_orders & reports.rows); (c) Import template rebuilt with in-cell dropdowns (ExcelJS dataValidation from a hidden Lists sheet) for Customer/Event Type/Exhibition/Salesman/Season/Brand. Tested 100% (iteration_12 backend 3/3, frontend 100%).
- 2026-08-10: (a) City filter on Dashboard (backend query param) and Reports; (b) inline "New Customer" (name+city) dialog on the Sale Order form that auto-selects the new customer; (c) Masters per-panel "select all" checkbox + visible customer unique ID; (d) branded loading screen (components/Loader.jsx) across pages. Tested 100% (iteration_13 backend 8/8, frontend 100% after Loader import fix).
- DEFERRED (requested, not yet built): Import Preview dialog (pre-import unmatched-name check) and a fuller Sale Order form redesign.

## Tech Debt (P2)
- server.py ~520 lines; consider splitting into routers before more endpoints.
- customer_history is O(N*M) dispatch queries — fine at current scale, batch later.

## Known Notes / Backlog (P2)
- update_sale_order uses delete+insert (non-atomic) — could switch to replace_one.
- Admin PIN is client-side only (UX gating, not real security) — per user's explicit choice.
- Bulk import of customers requires Name + City columns.

## Next Tasks
- None pending. Awaiting user direction.
