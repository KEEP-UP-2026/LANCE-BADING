-- Migration: Batch Processing Pipeline Tables
-- Database: Supabase / PostgreSQL

CREATE TABLE IF NOT EXISTS batch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_reference VARCHAR(50) NOT NULL UNIQUE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    total_files INT NOT NULL DEFAULT 0,
    processed_files INT NOT NULL DEFAULT 0,
    successful_files INT NOT NULL DEFAULT 0,
    failed_files INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'PROCESSING', -- 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes INT NOT NULL DEFAULT 0,
    mime_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'WAITING',
    -- Status values: 'WAITING', 'PROCESSING', 'READY_FOR_REVIEW', 'MANUAL_REQUIRED', 'CONFIRMED', 'REJECTED', 'FAILED'
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

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_items(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created_at ON batch_jobs(created_at DESC);

-- Enable RLS
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full control on batch_jobs" ON batch_jobs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role full control on batch_items" ON batch_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable select access for authenticated backend queries on batch_jobs" ON batch_jobs FOR SELECT TO anon, service_role USING (true);
CREATE POLICY "Enable select access for authenticated backend queries on batch_items" ON batch_items FOR SELECT TO anon, service_role USING (true);

