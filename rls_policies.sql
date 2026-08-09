-- KEEP-UP 2026 System
-- Database Security Review & Row Level Security (RLS) Policies Recommendation

/*
================================================================================
DATABASE SECURITY AUDIT SUMMARY & RECOMMENDATIONS
================================================================================

1. Secret Key Exposure:
   - Analysis: The frontend JavaScript code is confirmed safe. Only the Express backend
     communicates with Supabase, which means the SUPABASE_KEY (anon key) and any other 
     database credentials are NOT exposed in client-side code.
   - Finding: SECURE.

2. Database Client Key Usage:
   - Current State: The Express backend uses the `SUPABASE_KEY` (anon key) to connect.
     In Supabase, requests using the anon key run with the `anon` PostgreSQL role.
   - Risk: If RLS is enabled with permissive policies (like `TO anon USING (true)`), 
     anyone who obtains the public anon key can query or write directly to the tables
     bypassing the Express server's auth checks and authorization logic.
   - Recommendation: The Express backend should connect to Supabase using a server-only
     `SUPABASE_SERVICE_ROLE_KEY`. This key bypasses Row Level Security (RLS) entirely.
     This is the industry standard for trusted backend service connections because it 
     ensures all database queries succeed securely without complex or broken RLS rules,
     while allowing you to lock down the tables from public/anon access.

3. RLS Recommendations:
   - Disable all public `anon` policies that allow broad access.
   - Restrict all tables to only permit access via `service_role` or authenticated roles.
*/

-- ================================================================================
-- MIGRATION SQL FOR SECURING TABLES AND CREATING POLICIES
-- ================================================================================

-- 1. Enable RLS on all tables (if not already enabled)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_flags ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing permissive policies to prevent anonymous bypasses
DROP POLICY IF EXISTS "Enable select access for backend queries" ON users;
DROP POLICY IF EXISTS "Enable insert access for backend queries" ON users;
DROP POLICY IF EXISTS "Enable update access for backend queries" ON users;

DROP POLICY IF EXISTS "Enable select access for authorized readers" ON patients;
DROP POLICY IF EXISTS "Enable insert access for records staff" ON patients;
DROP POLICY IF EXISTS "Enable update access for records staff" ON patients;

DROP POLICY IF EXISTS "Enable select access for medical records" ON patient_records;
DROP POLICY IF EXISTS "Enable insert access for medical records" ON patient_records;
DROP POLICY IF EXISTS "Enable update access for medical records" ON patient_records;

DROP POLICY IF EXISTS "Enable select access for duplicate warnings" ON duplicate_flags;
DROP POLICY IF EXISTS "Enable insert access for duplicate warnings" ON duplicate_flags;
DROP POLICY IF EXISTS "Enable update access for duplicate warnings" ON duplicate_flags;
DROP POLICY IF EXISTS "Enable delete access for duplicate warnings" ON duplicate_flags;

-- 3. Create strict policies that permit ONLY the trusted backend ('service_role')
-- Note: 'service_role' automatically bypasses RLS in Supabase, so by restricting 'anon'
-- and other roles, we protect the data from unauthorized direct network access.

CREATE POLICY "Allow service_role full control on users" 
ON users TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role full control on patients" 
ON patients TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role full control on patient_records" 
ON patient_records TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role full control on duplicate_flags" 
ON duplicate_flags TO service_role USING (true) WITH CHECK (true);

-- 4. Explicitly block anonymous (public REST API) queries from returning any records
CREATE POLICY "Block anon read users" ON users FOR SELECT TO anon USING (false);
CREATE POLICY "Block anon read patients" ON patients FOR SELECT TO anon USING (false);
CREATE POLICY "Block anon read records" ON patient_records FOR SELECT TO anon USING (false);
CREATE POLICY "Block anon read duplicates" ON duplicate_flags FOR SELECT TO anon USING (false);
