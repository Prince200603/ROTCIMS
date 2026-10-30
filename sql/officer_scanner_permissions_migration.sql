-- ============================================================================
-- FILE: officer_scanner_permissions_migration.sql
-- PROJECT: ROTCIMS — San Enrique ROTC
-- PURPOSE: Adds Officer Classification table and QR Scanner session permissions.
--
-- WHAT THIS ADDS:
--   1. public.officer_classifications  — maps existing cadet profiles to one
--      of five officer classes (advance, 1st–4th class). Reuses existing
--      profiles/auth accounts; no duplicate users are created.
--   2. attendance_sessions.allowed_scanner_type  — 'all' | 'officers_only' |
--      'cadets_only'. Default 'all' so existing sessions are unaffected.
--   3. RLS policies for the new table.
--   4. Helper function public.is_active_officer() for runtime checks.
--
-- HOW TO RUN:
--   1. Open https://supabase.com/dashboard → your ROTCIMS project
--   2. Database → SQL Editor → + New Query
--   3. Paste entire file → Run
--   Safe to run multiple times (idempotent — uses IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ── 1. OFFICER CLASSIFICATIONS TABLE ────────────────────────────────────────
-- Maps an existing cadet profile to an officer class.
-- Does NOT create new auth accounts — uses the profile that already exists.
create table if not exists public.officer_classifications (
  id            uuid        primary key default gen_random_uuid(),

  -- Link to the cadet's existing profile (CASCADE: if profile deleted, so is classification)
  profile_id    uuid        not null references public.profiles(id) on delete cascade,

  -- Direct auth reference for fast per-user lookups (avoids join in scanner checks)
  user_id       uuid        references auth.users(id) on delete cascade,

  -- Which officer tier this cadet holds
  -- 'advance_officer'   — Advance Course Officer
  -- '1st_class_officer' — 1st Class Officer
  -- '2nd_class_officer' — 2nd Class Officer
  -- '3rd_class_officer' — 3rd Class Officer
  -- '4th_class_officer' — 4th Class Officer
  officer_class text        not null check (officer_class in (
                              'advance_officer',
                              '1st_class_officer',
                              '2nd_class_officer',
                              '3rd_class_officer',
                              '4th_class_officer'
                            )),

  -- Active flag — admin can deactivate without deleting history
  is_active     boolean     not null default true,

  -- Optional admin notes (e.g., reason for assignment or deactivation)
  notes         text,

  -- Which admin profile assigned this classification
  assigned_by   uuid        references public.profiles(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One active classification per officer class per profile
  -- (A cadet can hold multiple classes simultaneously but not the same class twice)
  unique (profile_id, officer_class)
);

-- Make user_id nullable so cadets without a linked auth account can still be classified
alter table public.officer_classifications
  alter column user_id drop not null;
-- ── 2. INDEXES ───────────────────────────────────────────────────────────────
-- Speed up the most common query: "is this user_id an active officer?"
create index if not exists officer_classifications_user_active_idx
  on public.officer_classifications (user_id, is_active);

-- Speed up admin listings: all officers, filtered by class
create index if not exists officer_classifications_class_active_idx
  on public.officer_classifications (officer_class, is_active);

-- Speed up profile-level lookups
create index if not exists officer_classifications_profile_idx
  on public.officer_classifications (profile_id);

-- ── 3. ATTENDANCE_SESSIONS: ADD allowed_scanner_type ────────────────────────
-- 'all'           — Officers AND regular cadets can scan (DEFAULT — no regression)
-- 'officers_only' — Only cadets with an active officer_classification can scan
-- 'cadets_only'   — Only cadets WITHOUT an active officer_classification can scan
alter table public.attendance_sessions
  add column if not exists allowed_scanner_type text
    not null default 'all'
    check (allowed_scanner_type in ('all', 'officers_only', 'cadets_only'));

-- ── 4. ROW LEVEL SECURITY ────────────────────────────────────────────────────
alter table public.officer_classifications enable row level security;

-- Admins have full CRUD on all classifications
drop policy if exists "officer_class_admin_all" on public.officer_classifications;
create policy "officer_class_admin_all"
  on public.officer_classifications
  for all
  using  (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

-- Officers and cadets can read their own classification (for cadet portal display)
drop policy if exists "officer_class_read_own" on public.officer_classifications;
create policy "officer_class_read_own"
  on public.officer_classifications
  for select
  using (user_id = auth.uid());

-- ── 5. HELPER FUNCTION: is_active_officer() ─────────────────────────────────
-- Returns TRUE if the currently authenticated user has at least one active
-- officer classification. Used in scanner permission checks.
create or replace function public.is_active_officer()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from   public.officer_classifications oc
    join   public.profiles p on p.id = oc.profile_id
    where  p.user_id = auth.uid()
      and  oc.is_active = true
  );
$$;

-- ── 6. HELPER FUNCTION: is_officer_by_profile_id(profile_id uuid) ────────────
-- Returns TRUE if the given profile_id belongs to an active officer.
-- Used by the admin scanner to check a scanned cadet's officer status
-- without requiring the scanned cadet to be logged in.
create or replace function public.is_officer_by_profile_id(p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from   public.officer_classifications
    where  profile_id = p_profile_id
      and  is_active  = true
  );
$$;


-- ── 7. SERVER-SIDE ENFORCEMENT TRIGGER ON attendance_records ─────────────────
-- Guarantees that neither frontend bypassing, PostgREST API requests, nor
-- direct client calls can write unauthorized attendance records.
create or replace function public.check_attendance_scanner_permission()
returns trigger
language plpgsql
security definer
as $func$
declare
  v_scanner_type text;
  v_profile_id   uuid;
  v_is_officer   boolean;
begin
  -- 1. Fetch allowed_scanner_type for this session
  select allowed_scanner_type into v_scanner_type
  from public.attendance_sessions
  where id = NEW.session_id;

  -- Default to 'all' if column unset or null
  if v_scanner_type is null or v_scanner_type = 'all' then
    return NEW;
  end if;

  -- 2. Resolve the cadet's profile_id (cadets.profile_id or direct profile)
  select profile_id into v_profile_id
  from public.cadets
  where id = NEW.cadet_id;

  if v_profile_id is null then
    v_profile_id := NEW.cadet_id;
  end if;

  -- 3. Check if this cadet is an active officer
  select exists (
    select 1
    from public.officer_classifications
    where profile_id = v_profile_id
      and is_active  = true
  ) into v_is_officer;

  -- 4. Enforce strict permissions
  if v_scanner_type = 'officers_only' and not v_is_officer then
    raise exception 'You are not authorized to scan attendance for this session. (Officers Only session)';
  elsif v_scanner_type = 'cadets_only' and v_is_officer then
    raise exception 'You are not authorized to scan attendance for this session. (Cadets Only session)';
  end if;

  return NEW;
end;
$func$;

-- Ensure unique constraint exists for (session_id, cadet_id) to prevent duplicate scans
do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attendance_records_session_cadet_key'
  ) then
    begin
      alter table public.attendance_records
        add constraint attendance_records_session_cadet_key unique (session_id, cadet_id);
    exception when others then
      -- If constraint exists under another name, continue safely
      null;
    end;
  end if;
end;
$block$;

drop trigger if exists trg_check_attendance_scanner_permission on public.attendance_records;
create trigger trg_check_attendance_scanner_permission
  before insert or update on public.attendance_records
  for each row
  execute function public.check_attendance_scanner_permission();

-- ── 8. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE ──────────────────────────────
notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION QUERIES (run these to confirm the migration succeeded):
-- ============================================================================
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_name = 'attendance_sessions'
--    and column_name = 'allowed_scanner_type';
--
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name   = 'officer_classifications';
-- ============================================================================

