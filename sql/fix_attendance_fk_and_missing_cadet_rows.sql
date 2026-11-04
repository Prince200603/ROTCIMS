-- ============================================================
-- FIX: attendance_records FK violation + missing cadets rows
-- 
-- Run this in Supabase SQL Editor if you get:
--   "null value in column "cadet_id" of relation "attendance_records" violates not-null constraint"
--   OR "violates foreign key constraint attendance_records_cadet_id_fkey"
--
-- ROOT CAUSE:
--   attendance_records.cadet_id references cadets.id (NOT profiles.id).
--   When cadets register or are seeded, if a cadet has a profile row
--   but no row in the public.cadets table, the scanner could not resolve
--   cadet_id and failed with the not-null violation.
--
-- This script safely inserts matching public.cadets rows for all cadets,
-- fixes default values, and ensures required columns exist.
-- ============================================================

-- STEP 1: Ensure columns exist in public.cadets and public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company text DEFAULT 'Alpha';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platoon text DEFAULT '1st Platoon';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rank text DEFAULT 'Cadet Private';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_name text DEFAULT 'Emergency Contact';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_relationship text DEFAULT 'Parent/Guardian';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone text DEFAULT '09000000000';

ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS company text DEFAULT 'Alpha';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS platoon text DEFAULT '1st Platoon';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS rank text DEFAULT 'Cadet Private';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS emergency_contact_name text DEFAULT 'Emergency Contact';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS emergency_contact_relationship text DEFAULT 'Parent/Guardian';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS emergency_contact_phone text DEFAULT '09000000000';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS rotc_unit text DEFAULT 'San Enrique ROTC Unit';
ALTER TABLE public.cadets ADD COLUMN IF NOT EXISTS enlistment_date date DEFAULT CURRENT_DATE;

-- STEP 2: Create public.cadets rows for all cadet profiles that don't already have one
INSERT INTO public.cadets (
  profile_id,
  rotc_unit,
  enlistment_date,
  company,
  platoon,
  rank,
  emergency_contact_name,
  emergency_contact_relationship,
  emergency_contact_phone
)
SELECT
  p.id            AS profile_id,
  COALESCE(p.company || ' Company', 'San Enrique ROTC Unit') AS rotc_unit,
  CURRENT_DATE    AS enlistment_date,
  COALESCE(p.company, 'Alpha') AS company,
  COALESCE(p.platoon, '1st Platoon') AS platoon,
  COALESCE(p.rank, 'Cadet Private') AS rank,
  COALESCE(p.emergency_contact_name, 'Emergency Contact') AS emergency_contact_name,
  COALESCE(p.emergency_contact_relationship, 'Parent/Guardian') AS emergency_contact_relationship,
  COALESCE(p.emergency_contact_phone, '09000000000') AS emergency_contact_phone
FROM public.profiles p
WHERE p.role = 'cadet'
  AND NOT EXISTS (
    SELECT 1 FROM public.cadets c WHERE c.profile_id = p.id
  );

-- STEP 3: Sync company, platoon, and rank between profiles and cadets where missing
UPDATE public.cadets c
SET 
  company = COALESCE(c.company, p.company, 'Alpha'),
  platoon = COALESCE(c.platoon, p.platoon, '1st Platoon'),
  rank    = COALESCE(c.rank, p.rank, 'Cadet Private')
FROM public.profiles p
WHERE c.profile_id = p.id;

-- STEP 4: Ensure attendance_records has created_at, updated_at, scanned_at
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS scanned_at timestamptz DEFAULT now();
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS remarks text;

-- STEP 5: Verification Counts
SELECT
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'cadet') AS total_cadet_profiles,
  (SELECT COUNT(*) FROM public.cadets) AS total_cadets_rows,
  (SELECT COUNT(*) FROM public.attendance_records) AS total_attendance_records;

NOTIFY pgrst, 'reload schema';
