-- SQL Migration script to add structured_json and layout_blocks columns to patient_records table in Supabase PostgreSQL database
-- Run this query in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql):

ALTER TABLE patient_records ADD COLUMN IF NOT EXISTS layout_blocks TEXT;
ALTER TABLE patient_records ADD COLUMN IF NOT EXISTS structured_json JSONB;

-- Refresh Supabase Schema Cache after adding columns
NOTIFY pgrst, 'reload schema';
