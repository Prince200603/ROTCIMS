-- ============================================================================
-- FILE: officer_rbac_management_migration.sql
-- PROJECT: ROTCIMS — San Enrique ROTC
-- PURPOSE: Full Officer Management, Dynamic Positions, Centralized RBAC,
--          Platoon-based QR Attendance Rules, and Security Policies.
--
-- TECH STACK: Pure Supabase PostgreSQL / PostgREST (NO PHP).
--
-- HOW TO RUN:
--   1. Open https://supabase.com/dashboard/project/cntisxkugmvwsommzjom/sql/new
--   2. Paste this entire file into the SQL Editor and click "Run".
--   Safe to run multiple times (idempotent — uses IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ── 1. ENHANCE officer_classifications TABLE ────────────────────────────────
-- Ensure table exists
create table if not exists public.officer_classifications (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles(id) on delete cascade,
  user_id       uuid        references auth.users(id) on delete cascade,
  officer_class text        not null,
  is_active     boolean     not null default true,
  notes         text,
  assigned_by   uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (profile_id, officer_class)
);

-- Ensure user_id is nullable (so seeded/offline cadets can be assigned ranks)
alter table public.officer_classifications
  alter column user_id drop not null;

-- Add officer_position, company, and platoon columns if not already present
alter table public.officer_classifications
  add column if not exists officer_position text,
  add column if not exists company          text,
  add column if not exists platoon          text;

-- Update officer_class constraint to support all 5 recognized categories
alter table public.officer_classifications
  drop constraint if exists officer_classifications_officer_class_check;

alter table public.officer_classifications
  add constraint officer_classifications_officer_class_check
  check (officer_class in (
    '1st_class_officer',
    '2nd_class_officer',
    '3rd_class_officer',
    '4th_class_officer',
    'advance_officer'
  ));

-- ── 2. CLASS-POSITION VALIDATION TRIGGER ─────────────────────────────────────
-- Strictly enforces the approved class-position combinations defined in Section 3:
-- 1st Class:
--   1. Alpha Company Commander
--   2. Bravo Company Commander
--   3. Charlie Company Commander
--   4. Executive Officer
--   5. S1 Adjutant
--   6. S2 Intelligence
--   7. S3 Operations
--   8. S4 Supply
--   9. S7 CMO
--
-- 2nd, 3rd, 4th & Advance Officers:
--   1. Deputy S1
--   2. Deputy S2
--   3. Deputy S3
--   4. Deputy S4
--   5. Deputy S7
--   6. Platoon Leader
create or replace function public.validate_officer_class_and_position()
returns trigger
language plpgsql
security definer
as $$
declare
  v_first_class_positions text[] := array[
    'Alpha Company Commander',
    'Bravo Company Commander',
    'Charlie Company Commander',
    'Executive Officer',
    'S1 Adjutant',
    'S2 Intelligence',
    'S3 Operations',
    'S4 Supply',
    'S7 CMO'
  ];
  v_junior_class_positions text[] := array[
    'Deputy S1',
    'Deputy S2',
    'Deputy S3',
    'Deputy S4',
    'Deputy S7',
    'Platoon Leader'
  ];
begin
  -- If officer_position is provided, validate it matches the class
  if NEW.officer_position is not null and NEW.officer_position <> '' then
    if NEW.officer_class = '1st_class_officer' then
      if not (NEW.officer_position = any(v_first_class_positions)) then
        raise exception 'Invalid position "%" for First Class Officer. Allowed: Alpha/Bravo/Charlie Company Commander, Executive Officer, S1-S4, S7 CMO.', NEW.officer_position;
      end if;
    elsif NEW.officer_class in ('2nd_class_officer', '3rd_class_officer', '4th_class_officer', 'advance_officer') then
      if not (NEW.officer_position = any(v_junior_class_positions)) then
        raise exception 'Invalid position "%" for % Class Officer. Allowed: Deputy S1, S2, S3, S4, S7, or Platoon Leader.', NEW.officer_position, NEW.officer_class;
      end if;
    else
      raise exception 'Unrecognized officer class "%".', NEW.officer_class;
    end if;
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_validate_officer_class_and_position on public.officer_classifications;
create trigger trg_validate_officer_class_and_position
  before insert or update on public.officer_classifications
  for each row
  execute function public.validate_officer_class_and_position();

-- ── 3. ENHANCE attendance_sessions TABLE ────────────────────────────────────
-- Add allowed_scanner_type ('all', 'officers_only', 'cadets_only')
alter table public.attendance_sessions
  add column if not exists allowed_scanner_type text not null default 'all'
    check (allowed_scanner_type in ('all', 'officers_only', 'cadets_only'));

-- Add target_company and target_platoon for platoon-specific drill sessions
alter table public.attendance_sessions
  add column if not exists target_company text not null default 'all',
  add column if not exists target_platoon text not null default 'all';

-- ── 4. SERVER-SIDE ATTENDANCE & SCANNER ENFORCEMENT TRIGGER ──────────────────
create or replace function public.check_attendance_scanner_permission()
returns trigger
language plpgsql
security definer
as $$
declare
  v_session_is_open    boolean;
  v_scanner_type       text;
  v_target_platoon     text;
  v_target_company     text;
  v_profile_id         uuid;
  v_cadet_company      text;
  v_cadet_platoon      text;
  v_is_officer         boolean;
  v_operator_profile_id uuid;
  v_operator_position  text;
  v_operator_platoon   text;
begin
  -- 1. Verify session exists and is OPEN
  select is_open, allowed_scanner_type, target_company, target_platoon
    into v_session_is_open, v_scanner_type, v_target_company, v_target_platoon
  from public.attendance_sessions
  where id = NEW.session_id;

  if v_session_is_open is false then
    raise exception 'This attendance session is closed.';
  end if;

  -- 2. Resolve the scanned cadet's profile and assignments
  select p.id, p.company, p.platoon
    into v_profile_id, v_cadet_company, v_cadet_platoon
  from public.cadets c
  join public.profiles p on p.id = c.profile_id
  where c.id = NEW.cadet_id;

  -- Fallback if cadet_id references profiles directly
  if v_profile_id is null then
    select id, company, platoon
      into v_profile_id, v_cadet_company, v_cadet_platoon
    from public.profiles
    where id = NEW.cadet_id;
  end if;

  -- 3. Check if the scanned cadet is an active officer
  select exists (
    select 1
    from public.officer_classifications
    where profile_id = v_profile_id
      and is_active  = true
  ) into v_is_officer;

  -- 4. Enforce Session Permission ('all' | 'officers_only' | 'cadets_only')
  if v_scanner_type = 'officers_only' and not v_is_officer then
    raise exception 'You are not authorized to scan attendance for this session. (Officers Only session)';
  elsif v_scanner_type = 'cadets_only' and v_is_officer then
    raise exception 'You are not authorized to scan attendance for this session. (Cadets Only session)';
  end if;

  -- 5. Platoon-Based Rules for Platoon Leaders
  -- If recorded_by is provided, check if the scanner operator is a Platoon Leader
  if NEW.recorded_by is not null then
    select oc.officer_position, coalesce(oc.platoon, p.platoon)
      into v_operator_position, v_operator_platoon
    from public.profiles p
    left join public.officer_classifications oc
      on oc.profile_id = p.id and oc.is_active = true
    where p.id = NEW.recorded_by;

    -- If operator is a Platoon Leader, strictly enforce their assigned platoon
    if v_operator_position = 'Platoon Leader' and v_operator_platoon is not null and v_operator_platoon <> '' then
      -- Cadet must belong to Platoon Leader's assigned platoon
      if v_cadet_platoon is distinct from v_operator_platoon then
        raise exception 'You are authorized to record attendance only for your assigned platoon (%). Scanned cadet is in %.', v_operator_platoon, coalesce(v_cadet_platoon, 'Unassigned');
      end if;

      -- If session is platoon-specific, Platoon Leader must match session platoon
      if v_target_platoon <> 'all' and v_target_platoon is distinct from v_operator_platoon then
        raise exception 'You are not assigned to the platoon for this session. (Required: %, Your Platoon: %)', v_target_platoon, v_operator_platoon;
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_check_attendance_scanner_permission on public.attendance_records;
create trigger trg_check_attendance_scanner_permission
  before insert or update on public.attendance_records
  for each row
  execute function public.check_attendance_scanner_permission();

-- ── 5. ROW LEVEL SECURITY (RLS) FOR OFFICER & ATTENDANCE MANAGEMENT ─────────
-- ── 5.1 PROFILES TABLE RLS FOR ADMIN OFFICER PROVISIONING ────────────────────
-- Allow Admin to insert profiles when creating officer accounts
drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles
  for insert
  with check (
    auth.uid() = user_id
    or public.current_profile_role() = 'admin'
  );

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles
  for update
  using (
    auth.uid() = user_id
    or public.current_profile_role() in ('admin', 'personnel')
  )
  with check (
    auth.uid() = user_id
    or public.current_profile_role() in ('admin', 'personnel')
  );

alter table public.officer_classifications enable row level security;
alter table public.attendance_sessions enable row level security;

-- Admin full control on officer_classifications
drop policy if exists "officer_class_admin_all" on public.officer_classifications;
create policy "officer_class_admin_all"
  on public.officer_classifications
  for all
  using  (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

-- Authenticated users can read officer classifications (for UI badges, permissions & scanner)
drop policy if exists "officer_class_read_all" on public.officer_classifications;
create policy "officer_class_read_all"
  on public.officer_classifications
  for select
  using (auth.role() = 'authenticated');

-- Attendance Sessions RLS: Only Admin can create, update, or delete sessions
drop policy if exists "attendance_sessions_admin_write" on public.attendance_sessions;
create policy "attendance_sessions_admin_write"
  on public.attendance_sessions
  for all
  using  (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

-- Authenticated users (officers and cadets) can read attendance sessions
drop policy if exists "attendance_sessions_read_all" on public.attendance_sessions;
create policy "attendance_sessions_read_all"
  on public.attendance_sessions
  for select
  using (auth.role() = 'authenticated');

-- ── 6. AUDIT LOGGING HELPER FUNCTION ─────────────────────────────────────────
create or replace function public.log_rotc_audit_event(
  p_action      text,
  p_target_id   text default null,
  p_details     jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_actor_id uuid;
  v_log_id   uuid;
begin
  -- Resolve actor from auth.uid()
  select id into v_actor_id from public.profiles where user_id = auth.uid() limit 1;

  insert into public.audit_logs (actor_id, action, target_id, details, created_at)
  values (v_actor_id, p_action, p_target_id, p_details, now())
  returning id into v_log_id;

  return v_log_id;
exception when others then
  -- Do not fail calling transaction if audit logging encounters a minor issue
  return null;
end;
$$;

-- ── 7. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE ───────────────────────────────

-- =============================================================================
-- 5.2 SECURITY DEFINER RPC FOR ADMIN OFFICER PROFILE PROVISIONING
-- =============================================================================
-- This function bypasses RLS so an Admin can INSERT a profile row for a newly
-- created officer (whose user_id != admin's auth.uid()). It validates that the
-- calling authenticated user is an admin before inserting.
-- =============================================================================
create or replace function public.admin_provision_officer_profile(
  p_user_id                uuid,
  p_first_name             text,
  p_middle_name            text,
  p_last_name              text,
  p_student_id             text,
  p_course                 text,
  p_year_level             text,
  p_section                text,
  p_role                   text,
  p_status                 text,
  p_company                text,
  p_platoon                text,
  p_phone                  text,
  p_date_of_birth          date,
  p_address                text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_email                  text,
  p_profile_picture        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_profile_id  uuid;
begin
  -- Verify calling user is an admin
  select role into v_caller_role
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'Unauthorized: only administrators can provision officer accounts.';
  end if;

  -- Upsert the profile (conflict on email)
  insert into public.profiles (
    user_id, first_name, middle_name, last_name,
    student_id, course, year_level, section,
    role, status, company, platoon, phone,
    date_of_birth, address,
    emergency_contact_name, emergency_contact_phone,
    email, profile_picture, updated_at
  ) values (
    p_user_id, p_first_name, p_middle_name, p_last_name,
    p_student_id, p_course, p_year_level, p_section,
    p_role, p_status, p_company, p_platoon, p_phone,
    p_date_of_birth, p_address,
    p_emergency_contact_name, p_emergency_contact_phone,
    p_email, p_profile_picture, now()
  )
  on conflict (email) do update set
    user_id                 = excluded.user_id,
    first_name              = excluded.first_name,
    middle_name             = excluded.middle_name,
    last_name               = excluded.last_name,
    student_id              = excluded.student_id,
    course                  = excluded.course,
    year_level              = excluded.year_level,
    section                 = excluded.section,
    role                    = excluded.role,
    status                  = excluded.status,
    company                 = excluded.company,
    platoon                 = excluded.platoon,
    phone                   = excluded.phone,
    date_of_birth           = excluded.date_of_birth,
    address                 = excluded.address,
    emergency_contact_name  = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    profile_picture         = coalesce(excluded.profile_picture, profiles.profile_picture),
    updated_at              = now()
  returning id into v_profile_id;

  return v_profile_id;
end;
$$;

-- Grant execute to authenticated users (auth.uid() check inside ensures only admin can call)
grant execute on function public.admin_provision_officer_profile to authenticated;
notify pgrst, 'reload schema';


