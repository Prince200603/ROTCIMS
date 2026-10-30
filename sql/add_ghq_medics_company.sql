-- ============================================================
-- SQL Helper: Update or verify Company column in Supabase
-- Note: 'company' in public.profiles and public.cadets is a standard TEXT column
-- so values like 'GHQ', 'Medics', 'Delta' save directly without constraint errors.
-- ============================================================

-- If you want to update any existing cadets to Medics or GHQ:
-- UPDATE public.profiles SET company = 'Medics' WHERE student_id = 'YOUR_ID';
-- UPDATE public.profiles SET company = 'GHQ' WHERE student_id = 'YOUR_ID';

-- Verify current company distribution:
SELECT company, COUNT(*) FROM public.profiles WHERE role = 'cadet' GROUP BY company;
