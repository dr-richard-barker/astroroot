-- AstroRoot — Supabase schema for metadata-only measurement sync.
-- Run this in your Supabase project: SQL Editor -> New query -> paste -> Run.
-- NOTE: this stores MEASUREMENTS ONLY. No images or thumbnails are ever uploaded.

create table if not exists public.measurements (
  id              text primary key,          -- AstroRoot record id (stable across devices)
  ts              bigint,                     -- client timestamp (ms since epoch)
  name            text,
  engine          text,                       -- 'classical' | 'RootNav2 (webgpu|wasm)'
  marker          text,                       -- marker/scale type used
  px_per_cm       double precision,
  length_val      double precision,
  length_unit     text,                       -- 'cm' | 'px'
  color_corrected boolean default false,
  tips            integer,
  branches        integer,
  angle           double precision,
  created_at      timestamptz default now()
);

-- Row Level Security. Without this, the anon key would expose the table. REQUIRED.
alter table public.measurements enable row level security;

-- ---------------------------------------------------------------------------
-- Policy choice — pick ONE. The tool uses the anon (publishable) key from the browser.
-- ---------------------------------------------------------------------------

-- OPTION A (simplest, for a trusted classroom): allow anonymous insert + read.
-- Anyone with the anon key + URL can add and read rows. Fine for non-sensitive,
-- metadata-only class data; not for anything private.
create policy "anon can read"   on public.measurements for select to anon using (true);
create policy "anon can insert" on public.measurements for insert to anon with check (true);
-- upsert (merge-duplicates) also needs update:
create policy "anon can update" on public.measurements for update to anon using (true) with check (true);

-- OPTION B (recommended when you add sign-in): require an authenticated user and
-- scope rows to them. Add a `user_id uuid default auth.uid()` column, then:
--   create policy "owner rw" on public.measurements
--     for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- and drop the OPTION A anon policies above.

-- Helpful index for the dashboard's newest-first ordering:
create index if not exists measurements_ts_idx on public.measurements (ts desc);
