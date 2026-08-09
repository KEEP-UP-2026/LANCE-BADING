-- Schema Setup for KEEP UP System
-- Database: Supabase / PostgreSQL

-- Drop existing tables in correct order of dependency to ensure clean rebuild and prevent column conflicts
DROP TABLE IF EXISTS duplicate_flags CASCADE;
DROP TABLE IF EXISTS patient_records CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create the users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- bcrypt hash
    role VARCHAR(50) NOT NULL,      -- RHU_ADMINISTRATOR, RECORDS_STAFF, HEALTHCARE_PERSONNEL, ADMINISTRATIVE_STAFF
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security on users table and define security policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable select access for backend queries" ON users FOR SELECT TO anon, service_role USING (true);
CREATE POLICY "Enable insert access for backend queries" ON users FOR INSERT TO anon, service_role WITH CHECK (true);
CREATE POLICY "Enable update access for backend queries" ON users FOR UPDATE TO anon, service_role USING (true) WITH CHECK (true);


-- Seed Data (Default passwords: Admin123!, Records123!, Healthcare123!, Staff123!, Inactive123!)
-- Pre-hashed using bcryptjs (cost factor 10)
INSERT INTO users (full_name, email, password, role, status)
VALUES 
('RHU Administrator', 'admin@keepup.com', '$2a$10$058vSwsf7kqaa5fK4m3aGO35vMYFow18TMGtnL/oE.VfRtqXd/ZIy', 'RHU_ADMINISTRATOR', 'ACTIVE'),
('Records Staff User', 'records@keepup.com', '$2a$10$Ys0zdVjQh19xx8grh8ISnebRc1l7t98YEaGoBLHawLL6/GuVPFPiS', 'RECORDS_STAFF', 'ACTIVE'),
('Healthcare Personnel User', 'healthcare@keepup.com', '$2a$10$7QhenhY3YOnCON7gfn0UKOaumO0wGnTt5NiCCski30fiBSoPfrna6', 'HEALTHCARE_PERSONNEL', 'ACTIVE'),
('Administrative Staff User', 'staff@keepup.com', '$2a$10$GDzbZtAZTzTKPDLGHdKT7eZ8waC75vlFtsdmON4k2Dshf4t/gPBfO', 'ADMINISTRATIVE_STAFF', 'ACTIVE'),
('Inactive Records Staff', 'inactive@keepup.com', '$2a$10$vSoTKwO6HqQIrmzwgxgVFe9YtGgd7JemkjTQIMAOGIrszR1sWB0fq', 'RECORDS_STAFF', 'INACTIVE')
ON CONFLICT (email) DO NOTHING;

-- Create the patients table
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_number VARCHAR(100) UNIQUE NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    middle_name VARCHAR(255),
    last_name VARCHAR(255) NOT NULL,
    birth_date DATE NOT NULL,
    sex VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    contact_number VARCHAR(100),
    philhealth_number VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security on patients table and define security policies
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable select access for authorized readers" ON patients FOR SELECT TO anon, service_role USING (status = 'ACTIVE');
CREATE POLICY "Enable insert access for records staff" ON patients FOR INSERT TO anon, service_role WITH CHECK (true);
CREATE POLICY "Enable update access for records staff" ON patients FOR UPDATE TO anon, service_role USING (true) WITH CHECK (true);


-- Create the patient_records table
CREATE TABLE IF NOT EXISTS patient_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    record_type VARCHAR(100) NOT NULL, -- PATIENT_INFORMATION_SHEET, CONSULTATION_RECORD, IMMUNIZATION_RECORD, ANTI_RABIES_RECORD, MATERNAL_CARE_RECORD
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_path TEXT,
    file_type VARCHAR(100),
    extracted_text TEXT,
    classification_result VARCHAR(100),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security on patient_records table and define security policies
ALTER TABLE patient_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable select access for medical records" ON patient_records FOR SELECT TO anon, service_role USING (status = 'ACTIVE');
CREATE POLICY "Enable insert access for medical records" ON patient_records FOR INSERT TO anon, service_role WITH CHECK (true);
CREATE POLICY "Enable update access for medical records" ON patient_records FOR UPDATE TO anon, service_role USING (true) WITH CHECK (true);


-- Create the duplicate_flags table
CREATE TABLE IF NOT EXISTS duplicate_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    possible_duplicate_patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    similarity_score DECIMAL(5,2),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, REVIEWED, IGNORED
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security on duplicate_flags table and define security policies
ALTER TABLE duplicate_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable select access for duplicate warnings" ON duplicate_flags FOR SELECT TO anon, service_role USING (true);
CREATE POLICY "Enable insert access for duplicate warnings" ON duplicate_flags FOR INSERT TO anon, service_role WITH CHECK (true);
CREATE POLICY "Enable update access for duplicate warnings" ON duplicate_flags FOR UPDATE TO anon, service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete access for duplicate warnings" ON duplicate_flags FOR DELETE TO anon, service_role USING (true);


-- Create the audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255) NOT NULL,
    actor_name_snapshot VARCHAR(255),
    actor_role_snapshot VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    details TEXT,
    ip_address VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS on audit_logs table
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full control on audit_logs" ON audit_logs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Block anon read audit_logs" ON audit_logs FOR SELECT TO anon USING (false);


-- Create the temporary_uploads table
CREATE TABLE IF NOT EXISTS temporary_uploads (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    extracted_text TEXT,
    suggested_category VARCHAR(100),
    alternative_category VARCHAR(100),
    confidence_score DECIMAL(5,2),
    classification_reason TEXT,
    matched_terms TEXT,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security on temporary_uploads table and define security policies
ALTER TABLE temporary_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full control on temporary_uploads" ON temporary_uploads TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Block anon read temporary_uploads" ON temporary_uploads FOR SELECT TO anon USING (false);




