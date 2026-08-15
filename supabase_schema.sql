-- RAC DISPATCH SYSTEM — Supabase schema (dedicated project, not Tally Mirror)
-- Standard `public` tables so Supabase's auto REST API works out of the box.
-- Columns mirror the Google Sheet tabs 1:1 — migration is a data copy + repoint.
-- Apply once the new project is created and the connector points at it.

-- ---- customers (= Customer Master) ----------------------------------------
create table if not exists customers (
  customer_id   text primary key,
  name          text not null,
  whatsapp      text,
  legacy_code   text,
  shop_floor_no text,
  notes         text
);

-- ---- orders ----------------------------------------------------------------
create table if not exists orders (
  order_line_id text primary key,
  customer_id   text references customers(customer_id),
  customer_name text,
  section_no    text,
  section_name  text,
  cut_length    text,
  ordered_qty   numeric,
  unit          text,
  po_number     text,
  order_date    text,
  alloy         text,
  price         text,
  status        text default 'Open',
  notes         text
);

-- ---- production (dispatch fields only) -------------------------------------
create table if not exists production (
  prod_id      text primary key,
  entry_date   date default current_date,
  shift        text,
  press        text,
  die_no       text,
  section_name text,
  alloy        text,
  cut_length   text,
  wt_pc        numeric,
  good_pcs     integer,
  kg           numeric,
  customer_id  text references customers(customer_id),
  notes        text,
  created_at   timestamptz default now()
);

-- ---- ageing (= Material Clearance Report) ----------------------------------
create table if not exists ageing (
  clear_id     text primary key,
  entry_date   date default current_date,
  shift        text,
  aging_no     text,
  section_no   text,
  customer_id  text references customers(customer_id),
  cut_length   text,
  wt_pc        numeric,
  total_weight numeric,
  finish       text,
  webster      text,
  result       text,                       -- 'Pass' if every reading >= 7, else 'Re-age'
  out_time     time,
  cleared_by   text,
  remarks      text,
  created_at   timestamptz default now()
);

-- ---- ready (= packed bundles, the dispatch-ready truth) --------------------
create table if not exists ready (
  bundle_no    text primary key,
  section_no   text,
  section_name text,
  cut_length   text,
  bundle_wt    numeric,
  pcs          integer,
  customer_id  text references customers(customer_id),
  packed_date  date default current_date,
  packed_by    text,
  status       text default 'In Stock',    -- 'In Stock' | 'Dispatched'
  remarks      text,
  created_at   timestamptz default now()
);

-- ---- dispatch --------------------------------------------------------------
create table if not exists dispatch (
  dispatch_id text primary key,
  entry_date  date default current_date,
  vehicle_no  text,
  customer_id text references customers(customer_id),
  bundle_nos  text,
  gross_wt    numeric,
  tare_wt     numeric,
  net_wt      numeric,
  invoice_no  text,
  notes       text,
  created_at  timestamptz default now()
);

create index if not exists idx_ageing_cust on ageing(customer_id);
create index if not exists idx_ready_cust  on ready(customer_id) where status = 'In Stock';
create index if not exists idx_prod_cust   on production(customer_id);
create index if not exists idx_orders_cust on orders(customer_id);
