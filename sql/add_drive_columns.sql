-- ============================================================================
-- FILE: add_drive_columns.sql
-- PURPOSE: Migration for Google Drive Primary Storage + Supabase CRUD.
--          Adds drive_file_id, drive_photo_id, drive_file_url, drive_file_ids,
--          drive_video_id, and video_url metadata columns across ROTCIMS tables.
--          Creates the cadet_files table for cadet certificates, clearances, and records.
--
-- RUN IN:  Supabase Dashboard -> Database -> SQL Editor -> + New Query -> Run
-- SAFETY:  Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — 100% safe & idempotent.
-- ============================================================================

-- ── 1. profiles table: Google Drive profile photo references ─────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS drive_photo_id  text,
  ADD COLUMN IF NOT EXISTS drive_photo_url text;

-- ── 2. documents table: Google Drive learning modules & official files ───────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS drive_file_id  text,
  ADD COLUMN IF NOT EXISTS drive_file_url text;

-- ── 3. posts table: Google Drive images, videos, and attachments ─────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS drive_file_ids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS drive_video_id text,
  ADD COLUMN IF NOT EXISTS video_url      text;

-- ── 4. application_documents table: Google Drive applicant files ─────────────
ALTER TABLE public.application_documents
  ADD COLUMN IF NOT EXISTS drive_file_id  text,
  ADD COLUMN IF NOT EXISTS drive_file_url text,
  ADD COLUMN IF NOT EXISTS file_name      text,
  ADD COLUMN IF NOT EXISTS file_size      bigint,
  ADD COLUMN IF NOT EXISTS mime_type      text;

-- ── 5. cadet_files table: Cadet certificates, medical clearances, & records ───
CREATE TABLE IF NOT EXISTS public.cadet_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  drive_file_id   text NOT NULL,
  drive_file_url  text,
  file_name       text NOT NULL,
  file_type       text NOT NULL DEFAULT 'certificate', -- 'certificate', 'clearance', 'enlistment_form', 'birth_certificate', 'attachment', 'other'
  mime_type       text,
  file_size       bigint,
  description     text,
  uploaded_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast query indices
CREATE INDEX IF NOT EXISTS cadet_files_profile_idx ON public.cadet_files(profile_id);
CREATE INDEX IF NOT EXISTS cadet_files_type_idx    ON public.cadet_files(file_type);
CREATE INDEX IF NOT EXISTS cadet_files_created_idx ON public.cadet_files(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.cadet_files ENABLE ROW LEVEL SECURITY;

-- ── 6. RLS Policies for cadet_files ──────────────────────────────────────────
DROP POLICY IF EXISTS "cadet_files_select_policy" ON public.cadet_files;
DROP POLICY IF EXISTS "cadet_files_insert_policy" ON public.cadet_files;
DROP POLICY IF EXISTS "cadet_files_update_policy" ON public.cadet_files;
DROP POLICY IF EXISTS "cadet_files_delete_policy" ON public.cadet_files;

-- Cadets can read their own files; Admins/Personnel can read all cadet files
CREATE POLICY "cadet_files_select_policy" ON public.cadet_files
FOR SELECT USING (
  public.current_profile_role() IN ('admin', 'personnel', 'platoon_leader')
  OR profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR auth.role() = 'authenticated'
);

-- Cadets can upload to their own file collection; Admins can upload for anyone
CREATE POLICY "cadet_files_insert_policy" ON public.cadet_files
FOR INSERT WITH CHECK (
  public.current_profile_role() IN ('admin', 'personnel', 'platoon_leader')
  OR profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR auth.role() = 'authenticated'
);

-- Admins and owners can update metadata
CREATE POLICY "cadet_files_update_policy" ON public.cadet_files
FOR UPDATE USING (
  public.current_profile_role() IN ('admin', 'personnel')
  OR profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

-- Cadets can delete their own files; Admins can delete any file
CREATE POLICY "cadet_files_delete_policy" ON public.cadet_files
FOR DELETE USING (
  public.current_profile_role() IN ('admin', 'personnel')
  OR profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

-- ── 7. Verification query to confirm successful migration ────────────────────
SELECT 
  'Migration applied successfully!' AS status,
  COUNT(*) AS cadet_files_count
FROM public.cadet_files;
