-- ====================================================================
-- SUPABASE MIGRATION: Missing Tables for TALA / KEEP UP
-- Run this in the Supabase Dashboard -> SQL Editor -> Click "Run"
-- ====================================================================

-- 1. Create temporary_uploads table
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

ALTER TABLE temporary_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full control on temporary_uploads" ON temporary_uploads TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable anon/backend access for temporary_uploads" ON temporary_uploads FOR ALL TO anon, service_role USING (true) WITH CHECK (true);


-- 2. Create audit_logs table
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

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full control on audit_logs" ON audit_logs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable anon/backend access for audit_logs" ON audit_logs FOR ALL TO anon, service_role USING (true) WITH CHECK (true);


-- 3. Create batch_jobs table
CREATE TABLE IF NOT EXISTS batch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_reference VARCHAR(50) NOT NULL UNIQUE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploader_name VARCHAR(255) DEFAULT 'Records Staff',
    total_files INT NOT NULL DEFAULT 0,
    processed_files INT NOT NULL DEFAULT 0,
    successful_files INT NOT NULL DEFAULT 0,
    failed_files INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'PROCESSING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full control on batch_jobs" ON batch_jobs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable anon/backend access for batch_jobs" ON batch_jobs FOR ALL TO anon, service_role USING (true) WITH CHECK (true);


-- 4. Create batch_items table
CREATE TABLE IF NOT EXISTS batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes INT NOT NULL DEFAULT 0,
    mime_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'WAITING',
    suggested_category VARCHAR(60),
    confidence_score NUMERIC(5,2) DEFAULT 0.0,
    confidence_level VARCHAR(20) DEFAULT 'LOW',
    target_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    extracted_data JSONB DEFAULT '{}'::jsonb,
    raw_ocr_text TEXT,
    error_message TEXT,
    confirmed_record_id UUID REFERENCES patient_records(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full control on batch_items" ON batch_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable anon/backend access for batch_items" ON batch_items FOR ALL TO anon, service_role USING (true) WITH CHECK (true);

-- Index optimizations
CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_items(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_temporary_uploads_created_at ON temporary_uploads(created_at);

