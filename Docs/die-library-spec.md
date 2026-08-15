# Die Library — Spec & Handoff

**Project:** Die catalogue extension to the RAC Dispatch app  
**Target repo:** `C:\Users\DELL\Documents\Claude\Projects\rac-dispatch-system`  
**Suggested location for this file:** `docs/die-library-spec.md`  
**Status:** Design locked — ready to build tables. Frontend integration deferred until die catalogue is complete.

---

## 1. Context

The RAC Dispatch app (Apps Script + Supabase, live at `dispatch.racextrusions.in`) already has a `sections` table with section drawings and images, and every `lots` row references a `section_no`. This spec extends the same Supabase project (`qhvtrlktxfnvuijokkds`) to catalogue individual physical dies — 10,000+ steel blocks — with full history, location tracking, corrections, and nitriding.

**Why not Snipe-IT / ERPNext / custom app:** The Dispatch app already owns `sections`, `lots`, `customers`. A separate system means dual data entry and impossible reporting joins. Extend, don't replace.

---

## 2. Locked Decisions

| Decision | Value |
|---|---|
| Die definition | Physical block of steel. No bolster/backer/container tracking in v1. |
| Multi-cavity | One die row, `num_cavities` column. |
| Ownership | Every die owned by RAC. No customer-owned dies. Only `made_for_customer_id` retained. |
| Serial format (catalogued) | `{section_no}-{seq}` — e.g. `8087-01`, `8087-02` |
| Serial format (uncatalogued) | `UNK-{seq}` — e.g. `UNK-00001` |
| Press ↔ die diameter | 5-inch press: 170-220mm OD. 7-inch press (P5): 240-350mm OD. Enforced via CHECK constraint. |
| Die size | Captured as **OD (mm) × thickness (mm)** — e.g. 190×110, 220×140. Thickness is a separate column, no range constraint. |
| Running weight | `current_running_wt` (kg/m) tracked per die to flag worn dies producing overweight sections. |
| Bearing | **Not tracked** in the entry sheet / `dies` table (dropped 2026-07-29 per Gaurav). `Bearing_Wear` remains only as a correction *reason*. |
| Die photo | `photo_link` = optional photo of the **physical die**. The profile/section **drawing already exists** in `sections` and auto-links by section_no — supervisors never upload it. |
| Nitriding | Batch system — matches existing ageing-batch pattern. Trigger auto-writes to `die_events` and updates die status when a die joins a batch. |
| Labels | No physical label printing in v1. Serial engraved/stamped by die room. |
| Location vocabulary | Controlled table `die_locations` — rack codes + press codes + vendor + scrap + missing. |
| Sequencing | Physical inventory first (complete `dies` records), THEN Production tab captures `die_serial`. |
| Data migration | Excel bulk import → PDF reconciliation → mobile physical walk-through. |

**Explicitly rejected:**

- Global sequential serials like `DIE-00001` — chosen `{section}-{seq}` because supervisors read the section context instantly.
- Separate tables per event type (corrections, nitriding, moves) — chosen one flat `die_events` timeline with 1:1 extension for correction details.
- QR-code labels v1 — deferred.
- Bolster/backer/container tracking — deferred to v2.

---

## 3. Schema DDL

Run against the existing Dispatch Supabase project.

### 3.1 `die_locations` — controlled vocabulary

```sql
CREATE TABLE die_locations (
  location_code text PRIMARY KEY,
  location_type text NOT NULL CHECK (location_type IN ('Rack','Press','Vendor','Other')),
  description   text,
  active        boolean DEFAULT true
);

INSERT INTO die_locations VALUES
  ('ON_P1','Press','Mounted on Press 1 (5-inch)',true),
  ('ON_P2','Press','Mounted on Press 2 (5-inch)',true),
  ('ON_P4','Press','Mounted on Press 4 (5-inch)',true),
  ('ON_P5','Press','Mounted on Press 5 (7-inch)',true),
  ('ON_P6','Press','Mounted on Press 6 (5-inch)',true),
  ('NITRIDING_VENDOR','Vendor','At nitriding vendor',true),
  ('CORRECTION_SHOP','Vendor','At correction shop',true),
  ('SCRAP','Other','Scrap yard',true),
  ('MISSING','Other','Unaccounted for',true);
-- Rack codes (DR-A-01 etc.) to be added when rack numbering is finalized (TODO §7).
```

### 3.2 `dies` — physical inventory master

```sql
CREATE TABLE dies (
  die_serial            text PRIMARY KEY,
  section_no            text REFERENCES sections(section_no),     -- NULL for uncatalogued
  container_size_in     smallint NOT NULL CHECK (container_size_in IN (5,7)),
  die_od_mm             numeric(6,2) NOT NULL,
  die_thickness_mm      numeric(6,2),                              -- die size = OD × thickness (e.g. 190×110, 220×140)
  current_running_wt    numeric(7,3),                             -- kg/m the die currently produces (flags worn/overweight dies)
  die_type              text CHECK (die_type IN ('Solid','Hollow','Semi-hollow','Porthole')),
  num_cavities          smallint DEFAULT 1 CHECK (num_cavities >= 1),
  made_for_customer_id  int NOT NULL REFERENCES customers(customer_id),
  die_maker             text,
  made_date             date,
  make_cost_inr         numeric(10,2),
  current_status        text NOT NULL DEFAULT 'Idle'
                        CHECK (current_status IN (
                          'Active','In_Production','In_Correction','Nitriding',
                          'Idle','Retired','Scrapped','Missing')),
  current_location      text REFERENCES die_locations(location_code),
  die_photo_url         text,                                      -- OPTIONAL photo of the physical steel die
  drawing_pdf_url       text,                                      -- profile drawing — auto-linked from sections.pdf_url by section_no (already available)
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT die_diameter_matches_press CHECK (
    (container_size_in = 5 AND die_od_mm BETWEEN 170 AND 220) OR
    (container_size_in = 7 AND die_od_mm BETWEEN 240 AND 350)
  )
);

CREATE INDEX ON dies(section_no);
CREATE INDEX ON dies(made_for_customer_id);
CREATE INDEX ON dies(current_status);
CREATE INDEX ON dies(current_location);
```

### 3.3 `die_events` — timeline

```sql
CREATE TABLE die_events (
  event_id      bigserial PRIMARY KEY,
  die_serial    text NOT NULL REFERENCES dies(die_serial),
  event_type    text NOT NULL CHECK (event_type IN (
                  'Correction','Nitriding','Location_Move','Status_Change',
                  'Setup','Removed','Inspection','Photo_Update','Note')),
  event_date    date NOT NULL DEFAULT CURRENT_DATE,
  prev_value    text,
  new_value     text,
  vendor        text,
  cost_inr      numeric(10,2),
  batch_id      bigint,                       -- FK to nitriding_batches, nullable
  notes         text,
  recorded_by   text,
  recorded_at   timestamptz DEFAULT now()
);

CREATE INDEX ON die_events(die_serial, event_date DESC);
CREATE INDEX ON die_events(event_type);
CREATE INDEX ON die_events(batch_id);
```

### 3.4 `die_corrections_detail` — 1:1 extension for correction events

```sql
CREATE TABLE die_corrections_detail (
  event_id              bigint PRIMARY KEY REFERENCES die_events(event_id) ON DELETE CASCADE,
  reason_code           text CHECK (reason_code IN (
                          'Flow_Defect','Rough','Angle_Out','Line','Corner_Fill',
                          'Weight_Variance','Bearing_Wear','Dimension_Out','Other')),
  outcome               text CHECK (outcome IN (
                          'Successful','Partial','Failed','Pending_Verification')),
  dimensions_changed    text
);
```

### 3.5 `nitriding_batches` + join + trigger

```sql
CREATE TABLE nitriding_batches (
  batch_id           bigserial PRIMARY KEY,
  batch_date         date NOT NULL,
  vendor             text NOT NULL,
  total_cost_inr     numeric(10,2),
  duration_hours     numeric(5,2),
  temperature_c      numeric(5,1),
  notes              text,
  created_by         text,
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE nitriding_batch_dies (
  batch_id           bigint NOT NULL REFERENCES nitriding_batches(batch_id) ON DELETE CASCADE,
  die_serial         text NOT NULL REFERENCES dies(die_serial),
  cost_allocated_inr numeric(10,2),
  PRIMARY KEY (batch_id, die_serial)
);

CREATE OR REPLACE FUNCTION log_nitriding_join() RETURNS trigger AS $$
DECLARE b nitriding_batches%ROWTYPE;
BEGIN
  SELECT * INTO b FROM nitriding_batches WHERE batch_id = NEW.batch_id;
  INSERT INTO die_events (
    die_serial, event_type, event_date, vendor, cost_inr, batch_id, notes, recorded_by
  ) VALUES (
    NEW.die_serial, 'Nitriding', b.batch_date, b.vendor,
    NEW.cost_allocated_inr, b.batch_id,
    'Nitriding batch #' || b.batch_id, b.created_by
  );
  UPDATE dies
    SET current_status = 'Nitriding',
        current_location = 'NITRIDING_VENDOR',
        updated_at = now()
    WHERE die_serial = NEW.die_serial;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_nitriding_join
AFTER INSERT ON nitriding_batch_dies
FOR EACH ROW EXECUTE FUNCTION log_nitriding_join();
```

**Batch close workflow (application-level):** When batch returns from vendor, app sets `current_status = 'Idle'` and `current_location` back to the assigned rack for each die in the batch. Consider a companion `close_nitriding_batch(batch_id, return_locations jsonb)` RPC for atomicity.

### 3.6 `v_die_stats` — derived metrics view

```sql
CREATE VIEW v_die_stats AS
SELECT 
  d.die_serial,
  d.section_no,
  d.container_size_in,
  d.made_for_customer_id,
  c.name AS customer_name,
  d.current_status,
  d.current_location,
  COUNT(DISTINCT l.lot_id) AS total_lots_run,
  COALESCE(SUM(l.output_kg), 0) AS cumulative_kg,
  COALESCE(SUM(l.produced_pcs), 0) AS cumulative_pcs,
  AVG(l.output_kg / NULLIF(l.input_kg, 0)) AS avg_yield,
  MAX(l.produced_date) AS last_used_date,
  CASE WHEN MAX(l.produced_date) IS NULL THEN NULL
       ELSE CURRENT_DATE - MAX(l.produced_date) END AS days_idle,
  (SELECT COUNT(*) FROM die_events e
    WHERE e.die_serial = d.die_serial AND e.event_type='Correction') AS correction_count,
  (SELECT COALESCE(SUM(cost_inr),0) FROM die_events e
    WHERE e.die_serial = d.die_serial AND e.event_type='Correction') AS correction_cost_total,
  (SELECT MAX(event_date) FROM die_events e
    WHERE e.die_serial = d.die_serial AND e.event_type='Nitriding') AS last_nitriding_date,
  (SELECT COUNT(*) FROM die_events e
    WHERE e.die_serial = d.die_serial AND e.event_type='Nitriding') AS nitriding_count
FROM dies d
LEFT JOIN customers c ON c.customer_id = d.made_for_customer_id
LEFT JOIN lots l ON l.section_no = d.section_no      -- v1: aggregates all dies of same section
GROUP BY d.die_serial, d.section_no, d.container_size_in,
         d.made_for_customer_id, c.name,
         d.current_status, d.current_location;
```

**Important:** the `LEFT JOIN lots l ON l.section_no = d.section_no` currently aggregates production across ALL dies sharing a section. This is intentional for v1 — until Production captures `die_serial`, per-die metrics are impossible. Once §5 is done, change the JOIN to `l.die_serial = d.die_serial` and per-die numbers become real.

### 3.7 `v_dies_ready` — scheduling helper

```sql
CREATE VIEW v_dies_ready AS
SELECT d.*, c.name AS customer_name
FROM dies d
LEFT JOIN customers c ON c.customer_id = d.made_for_customer_id
WHERE d.current_status IN ('Active','Idle')
  AND d.current_location LIKE 'DR-%';         -- rack-resident dies only
```

Feeds the Production tab dropdown after Production integration (§5).

---

## 4. RLS (Row-Level Security) — mandatory

Given the audit finding on the Dispatch app (RLS status unverified, direct anon DML everywhere), **all new tables must ship with RLS enabled** and explicit policies. Do NOT default to `USING (true)`.

```sql
ALTER TABLE dies ENABLE ROW LEVEL SECURITY;
ALTER TABLE die_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE die_corrections_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE nitriding_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE nitriding_batch_dies ENABLE ROW LEVEL SECURITY;
ALTER TABLE die_locations ENABLE ROW LEVEL SECURITY;

-- Reads open to anon (app is on internal domain, no external threat model yet):
CREATE POLICY die_read ON dies FOR SELECT TO anon USING (true);
CREATE POLICY die_event_read ON die_events FOR SELECT TO anon USING (true);
CREATE POLICY die_corr_read ON die_corrections_detail FOR SELECT TO anon USING (true);
CREATE POLICY nb_read ON nitriding_batches FOR SELECT TO anon USING (true);
CREATE POLICY nbd_read ON nitriding_batch_dies FOR SELECT TO anon USING (true);
CREATE POLICY dl_read ON die_locations FOR SELECT TO anon USING (true);

-- All writes go through SECURITY DEFINER RPCs — no direct anon DML.
-- Do NOT create INSERT/UPDATE/DELETE policies for anon on these tables.
```

Companion RPCs to create (specifics deferred to build phase):

- `create_die(payload jsonb, pin text) → die_serial` — with PIN verification (same pattern as `verify_login`)
- `update_die(die_serial text, patch jsonb, pin text)`
- `log_die_event(die_serial, event_type, payload jsonb, pin text)`
- `create_nitriding_batch(payload jsonb, die_serials text[], pin text) → batch_id`
- `close_nitriding_batch(batch_id, return_locations jsonb, pin text)`

**This closes the audit gap for the die library from day 1** — unlike the existing Dispatch tables which will need retrofitting.

---

## 5. Dispatch app integration — DEFERRED until §6 is complete

Two changes when die catalogue is complete:

### 5.1 Schema change to `lots`

```sql
ALTER TABLE lots ADD COLUMN die_serial text REFERENCES dies(die_serial);
CREATE INDEX idx_lots_die_serial ON lots(die_serial);
-- Historical lots: die_serial = NULL (do NOT backfill).
```

### 5.2 Update `v_die_stats`

Change the LEFT JOIN to `l.die_serial = d.die_serial` — per-die metrics become live.

### 5.3 Frontend (Index.html)

1. **Production tab** (grid mode + form mode):
   - After `section_no` is entered/selected, a new `die_serial` dropdown appears
   - Populated via `SELECT die_serial FROM v_dies_ready WHERE section_no = ?`
   - Auto-selected if only one die available
   - Multi-cavity dies show cavity count in the label
2. **New "Dies" tab** (visible to roles: `pack`, `all`, and new `die_room` role):
   - Tabulator grid: list all dies with search/filter (status, location, customer, section)
   - Click row → detail panel showing metadata + `v_die_stats` + `die_events` timeline
   - Log-event button + Verify button (for physical walk-through)
3. **New "Nitriding" sub-tab** under Dies (or a new top-level tab):
   - Create batch, add dies, close batch — same shape as ageing UX
4. **Role addition:** add `die_room` to `TABS_FOR` map in `enter()` function.

**Do not touch Production entry UX until §6 is >80% complete.** Prematurely adding a die_serial dropdown when the catalogue is incomplete forces supervisors to skip the field, permanently polluting the data.

---

## 6. Data migration — three phases

### Phase 1: Excel bulk import (day 1-2)

- Excel file location: **TODO (§7)** — user to upload
- Column mapping to be finalized once file is inspected
- For each section_no with multiple physical dies in Excel, auto-generate suffixes `-01`, `-02`, `-03`…
- Uncatalogued dies (no section_no in Excel): start `UNK-00001`, increment
- Initial values: `current_status = 'Idle'`, `current_location = NULL` (unverified), `die_type` / `die_od_mm` / `die_thickness_mm` / `current_running_wt` = NULL if not in Excel
- Migration script: to be written as `scripts/migrate-dies-from-excel.py` or similar (Supabase SQL insert via psycopg or REST)

### Phase 2: PDF reconciliation (day 3-5)

- PDF file location: **TODO (§7)** — user to share sample page
- Decide: is the PDF net-new information (drawings/dimensions/customer names not in Excel) or a printed version of the Excel?
- If net-new → OCR + cross-match by `section_no` + enrich existing rows
- If duplicate → skip

### Phase 3: Physical walk-through (60-90 days)

**This is the actual project timeline.** The schema is a weekend. Cataloguing 10,000 physical dies is months.

**Approach:**

- Mobile-friendly "Die Verify" flow in the Dispatch app (new sub-view of Dies tab)
- Supervisor picks die → types serial (or scans if QR labels added later)
- Form pre-fills from existing `dies` row
- Captures missing fields: `die_od_mm`, `die_thickness_mm`, `current_running_wt`, `die_type`, actual `current_location`, optional `die_photo_url` (camera capture)
- On save: `current_location` set → row becomes "verified"
- Uncatalogued dies discovered mid-walk: "Add new die" button generates next `UNK-{seq}`

**Progress metric:**

```sql
SELECT
  COUNT(*) FILTER (WHERE current_location IS NOT NULL) AS verified,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE current_location IS NOT NULL) / COUNT(*), 1) AS pct
FROM dies;
```

**Team + pace:** 2 people, after-hours, ~100-200 dies/day at 30-60 seconds each. 10,000 dies = 50-100 workdays = 2-4 months elapsed.

---

## 7. TODO — pending items from user

Not blockers for schema creation, but blockers for full migration.

- [ ] **Rack numbering format** — physical labelling scheme for die room. Suggested `DR-{row}-{shelf}` (e.g. `DR-A-01`, `DR-A-02`). Waiting for user to confirm actual room layout.
- [ ] **Excel file** — die list currently maintained. Upload to project repo. Needed to write migration script.
- [ ] **PDF sample page** — one page from the PDF catalogue. Determines whether it's worth OCR'ing.
- [ ] **Die type completeness** — is `Solid / Hollow / Semi-hollow / Porthole` enough, or add `Spread` / `Bridge`? RAC to confirm based on actual inventory.

---

## 8. Build sequence

| Phase | Effort | Deliverable |
|---|---|---|
| 1. Create tables + views + trigger + RLS + RPCs | 2 days | Schema live on Supabase, empty tables |
| 2. Load rack locations (once TODO §7 resolved) | 1 hour | `die_locations` seeded |
| 3. Excel bulk import | 2-3 days | Migration script + all Excel dies loaded as `UNVERIFIED` |
| 4. PDF reconciliation | 1-3 days | Depends on PDF content |
| 5. Dies tab UI in Dispatch app | 5 days | List, detail, event logging, verify flow |
| 6. Nitriding batch UI | 2 days | Create batch, add dies, close batch |
| 7. Physical walkthrough (parallel to #8+) | 2-4 months | 100% dies verified in place |
| 8. `lots.die_serial` column + Production dropdown | 2 days | Per-die metrics become real (only after #7 >80% done) |

**Software = 2-3 weeks. Physical inventory = the actual timeline.**

---

## 9. Reference — existing project files

Files the die library integrates with (existing in `rac-dispatch-system` project):

- `Code.gs` — Apps Script backend (serves Index.html, WhatsApp gateway, OCR)
- `Index.html` — single-page frontend, Supabase client + Tabulator + Chart.js
- `FurnaceHeatSync.gs` — separate Apps Script project, hourly heat sync to `heats` table
- `appsscript.json` — Apps Script manifest

Supabase schema touched:

- `sections` (existing) — dies FK to this
- `customers` (existing) — dies FK to this
- `lots` (existing) — gains `die_serial` FK in phase §5
- All new: `dies`, `die_locations`, `die_events`, `die_corrections_detail`, `nitriding_batches`, `nitriding_batch_dies`
- New views: `v_die_stats`, `v_dies_ready`
- New RPCs: `create_die`, `update_die`, `log_die_event`, `create_nitriding_batch`, `close_nitriding_batch`

---

## 10. Open questions for the build session

Answer these before writing migration code:

1. Rack numbering format?
2. Excel file — share it.
3. PDF sample page?
4. Die type list — add Spread/Bridge?
5. What's the PIN format for `verify_login`? (Determines brute-force risk on new RPCs — flagged in the Dispatch app audit.)
6. Is `sections.section_no` unique? (If not, the FK from `dies.section_no` will fail.)
7. Preferred RPC pattern — SECURITY DEFINER Postgres functions (matches existing `admin_delete`), or Supabase Edge Functions (matches `ocr-production`)? Recommend the former for CRUD; latter for anything that needs external calls.

---

## Handoff notes

- This spec is complete for phase §1 (schema creation). Phase §2 needs the Excel file. Phases §5-8 need §1-4 done first.
- **Do NOT modify the Production entry UX in Index.html until §7 (physical walkthrough) is >80% complete** — pollution risk to production data if the die dropdown is empty most of the time.
- RLS discipline from day 1 is non-negotiable — the existing Dispatch tables have unverified RLS and the die library should not inherit that debt.
- All decisions in §2 came from live discussion with the user (Gaurav Mittal, CFO/2nd-gen owner-operator, RAC Extrusions). Reconfirm any deviation before implementing.
