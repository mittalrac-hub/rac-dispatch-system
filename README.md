# RAC Dispatch System

Production, ageing, packing, and dispatch management system for **RAC Extrusions Limited** — a custom aluminium extrusion manufacturer (6063 alloy, 5 presses, ~₹300 Cr revenue).

## Architecture

| Component | Technology | Purpose |
|---|---|---|
| **Frontend** | Google Apps Script Web App (`webapp/Index.html`) | Single-page app with tabbed UI (Production, Scan/OCR, Ageing, Packing, Stock, Dispatch, Reports, Order List) |
| **Backend** | Supabase (PostgreSQL + Edge Functions) | Database, auth (PIN-based), RPC functions, views |
| **OCR** | Supabase Edge Function → Claude Opus 4.8 Vision | Handwritten production report → structured data |
| **WhatsApp** | Supabase Edge Function → HelloAll BSP (Meta Cloud API) | Automated production notifications with PDF attachment |
| **Order Sync** | Google Apps Script (`gas/OrderSync.gs`) | 30-min sync from Google Sheet order book → Supabase |
| **Supervisor Portal** | `webapp/Supervisor.html` | Mobile-first photo upload for shop-floor supervisors |

## Key Files

```
webapp/
  Index.html          — Main app (all tabs, ~3500 lines)
  Supervisor.html     — Mobile supervisor portal
  Code.gs             — Apps Script server-side (doGet, WhatsApp via GAS)
  FurnaceHeatSync.gs  — Furnace data sync
  appsscript.json     — Apps Script manifest

gas/
  OrderSync.gs        — Order book sync (Google Sheet → Supabase)

supabase/
  functions/
    ocr-production/index.ts   — Vision OCR Edge Function
    notify-production/index.ts — WhatsApp notification Edge Function
  migrations/
    add_notify_scan.sql       — DB migration

scripts/
  setup-die-entry-sheet.gs    — Die entry sheet setup

Docs/
  die-library-spec.md         — Die library specification

templates/
  production_backfill_template.xlsx
  ageing_backfill_template.xlsx
  customer_codes.csv
```

## Database (Supabase)

Key tables: `lots`, `bundles`, `ageing`, `customers`, `order_book`, `users`, `presses`, `ocr_corrections`

Key views: `v_lot_balance` (pipeline: produced → aged → packed), `v_bundle_full` (bundles with lot/ageing/dispatch joins)

Key RPCs: `verify_login`, `age_edit_line`, `reallocate_bundles`, `gen_bundle_no`

## Secrets (Environment Variables)

All secrets are read at runtime — none are committed:

| Secret | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Supabase Edge Function | Claude Vision API for OCR |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function | DB access from edge functions |
| `WA_PHONE_NUMBER_ID` | Supabase Edge Function | HelloAll WhatsApp sender |
| `WA_ACCESS_TOKEN` | Supabase Edge Function | HelloAll API auth |

The Supabase **anon key** in `Index.html` is intentionally public (client-side, row-level security enforced).

## Roles

| Role | Tabs | Capabilities |
|---|---|---|
| `prod` | Production, Scan | Enter/scan production data |
| `age` | Ageing | Enter ageing batches |
| `pack` | Packing, Dispatch, Stock | Pack bundles, dispatch, stock view |
| `incharge` | Ageing, Report | Edit ageing batches (2-day lock), view reports |
| `all` | All tabs | Full access |

## Dev Notes

- **No build step** — the frontend is a single HTML file served by Google Apps Script
- **Tabulator 5.6.1** — data grid library (loaded from CDN in the HTML)
- **PIN auth** — users authenticate with a numeric PIN via `verify_login` RPC
- **Recovery band** — 70-85% (`REC_LO`/`REC_HI`), enforced in DB trigger
- **Billet constants** — P1/P2/P4/P6: 126.00mm dia, P5: 176.36mm dia
