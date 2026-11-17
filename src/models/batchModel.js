const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dbClient, isSupabase, jsonDbPath } = require('../config/db');

// Helper to read local JSON database
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file in BatchModel:', error);
    return { batch_jobs: [], batch_items: [] };
  }
}

// Helper to write local JSON database
function writeLocalData(data) {
  try {
    fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing to JSON DB file in BatchModel:', error);
  }
}

function generateUuid() {
  return crypto.randomUUID();
}

const BatchModel = {
  // ==========================================
  // BATCH JOBS
  // ==========================================

  async createJob(jobData) {
    const newJob = {
      id: jobData.id || generateUuid(),
      batch_reference: jobData.batch_reference || `BATCH-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      uploaded_by: jobData.uploaded_by || null,
      uploader_name: jobData.uploader_name || 'Records Staff',
      total_files: jobData.total_files || 0,
      processed_files: 0,
      successful_files: 0,
      failed_files: 0,
      status: 'PROCESSING', // PROCESSING, COMPLETED, PARTIALLY_FAILED
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_jobs')
          .insert([newJob])
          .select()
          .single();

        if (error) {
          if (error.code === 'PGRST205' || (error.message && error.message.includes('Could not find the table'))) {
            return this.writeLocalJob(newJob);
          }
          console.warn('Supabase create batch_jobs error, falling back to local:', error.message);
          return this.writeLocalJob(newJob);
        }
        return data;
      } catch (err) {
        return this.writeLocalJob(newJob);
      }
    } else {
      return this.writeLocalJob(newJob);
    }
  },

  writeLocalJob(job) {
    const db = readLocalData();
    if (!db.batch_jobs) db.batch_jobs = [];
    db.batch_jobs.unshift(job);
    writeLocalData(db);
    return job;
  },

  async findJobById(jobId) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_jobs')
          .select('*')
          .eq('id', jobId)
          .maybeSingle();

        if (!error && data) return data;
      } catch (err) {
        // Fallback to local
      }
    }
    const db = readLocalData();
    return (db.batch_jobs || []).find(j => j.id === jobId || j.batch_reference === jobId) || null;
  },

  async listRecentJobs(limit = 20) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error && data && data.length > 0) return data;
      } catch (err) {
        // Fallback to local
      }
    }
    const db = readLocalData();
    return (db.batch_jobs || []).slice(0, limit);
  },

  async updateJob(jobId, updates) {
    const timestamp = new Date().toISOString();
    const cleanUpdates = { ...updates, updated_at: timestamp };

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_jobs')
          .update(cleanUpdates)
          .eq('id', jobId)
          .select()
          .maybeSingle();

        if (!error && data) {
          this.updateLocalJob(jobId, cleanUpdates);
          return data;
        }
      } catch (err) {
        // Fallback
      }
    }
    return this.updateLocalJob(jobId, cleanUpdates);
  },

  updateLocalJob(jobId, updates) {
    const db = readLocalData();
    if (!db.batch_jobs) db.batch_jobs = [];
    const index = db.batch_jobs.findIndex(j => j.id === jobId || j.batch_reference === jobId);
    if (index !== -1) {
      db.batch_jobs[index] = { ...db.batch_jobs[index], ...updates };
      writeLocalData(db);
      return db.batch_jobs[index];
    }
    return null;
  },

  // ==========================================
  // BATCH ITEMS
  // ==========================================

  async createItems(items) {
    const formattedItems = items.map(item => ({
      id: item.id || generateUuid(),
      batch_id: item.batch_id,
      original_filename: item.original_filename,
      file_path: item.file_path,
      file_size_bytes: item.file_size_bytes || 0,
      mime_type: item.mime_type || 'application/octet-stream',
      status: item.status || 'WAITING',
      suggested_category: item.suggested_category || null,
      confidence_score: item.confidence_score || 0.0,
      confidence_level: item.confidence_level || 'LOW',
      target_patient_id: item.target_patient_id || null,
      extracted_data: item.extracted_data || {},
      raw_ocr_text: item.raw_ocr_text || '',
      error_message: item.error_message || null,
      confirmed_record_id: item.confirmed_record_id || null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_items')
          .insert(formattedItems)
          .select();

        if (!error && data) return data;
      } catch (err) {
        // Fallback to local
      }
    }

    const db = readLocalData();
    if (!db.batch_items) db.batch_items = [];
    db.batch_items.push(...formattedItems);
    writeLocalData(db);
    return formattedItems;
  },

  async findItemsByBatchId(batchId) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_items')
          .select('*')
          .eq('batch_id', batchId)
          .order('created_at', { ascending: true });

        if (!error && data) return data;
      } catch (err) {
        // Fallback
      }
    }
    const db = readLocalData();
    return (db.batch_items || []).filter(item => item.batch_id === batchId);
  },

  async findAllItems(limit = 1000) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_items')
          .select('*, batch_jobs(batch_reference, created_at, uploader_name)')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error && data && data.length > 0) {
          return data.map(item => ({
            ...item,
            batch_reference: item.batch_jobs?.batch_reference || 'BATCH',
            batch_uploaded_at: item.batch_jobs?.created_at || item.created_at,
            uploader_name: item.batch_jobs?.uploader_name || 'Records Staff'
          }));
        }
      } catch (err) {
        console.warn('[BatchModel.findAllItems] Supabase query error, falling back to local:', err.message);
      }
    }
    const db = readLocalData();
    const jobMap = {};
    (db.batch_jobs || []).forEach(j => {
      jobMap[j.id] = j;
    });
    return (db.batch_items || [])
      .map(item => ({
        ...item,
        batch_reference: jobMap[item.batch_id]?.batch_reference || 'BATCH',
        batch_uploaded_at: jobMap[item.batch_id]?.created_at || item.created_at,
        uploader_name: jobMap[item.batch_id]?.uploader_name || 'Records Staff'
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  async findItemById(itemId) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_items')
          .select('*')
          .eq('id', itemId)
          .maybeSingle();

        if (!error && data) return data;
      } catch (err) {
        // Fallback
      }
    }
    const db = readLocalData();
    return (db.batch_items || []).find(i => i.id === itemId) || null;
  },

  async updateItem(itemId, updates) {
    const timestamp = new Date().toISOString();
    const cleanUpdates = { ...updates, updated_at: timestamp };

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Sanitize UUID columns to prevent Postgres 'invalid input syntax for type uuid' errors
    if ('target_patient_id' in cleanUpdates) {
      if (!cleanUpdates.target_patient_id || typeof cleanUpdates.target_patient_id !== 'string' || !UUID_REGEX.test(cleanUpdates.target_patient_id.trim())) {
        cleanUpdates.target_patient_id = null;
      } else {
        cleanUpdates.target_patient_id = cleanUpdates.target_patient_id.trim();
      }
    }
    if ('reviewed_by' in cleanUpdates) {
      if (!cleanUpdates.reviewed_by || typeof cleanUpdates.reviewed_by !== 'string' || !UUID_REGEX.test(cleanUpdates.reviewed_by.trim())) {
        cleanUpdates.reviewed_by = null;
      } else {
        cleanUpdates.reviewed_by = cleanUpdates.reviewed_by.trim();
      }
    }
    if ('confirmed_record_id' in cleanUpdates) {
      if (!cleanUpdates.confirmed_record_id || typeof cleanUpdates.confirmed_record_id !== 'string' || !UUID_REGEX.test(cleanUpdates.confirmed_record_id.trim())) {
        cleanUpdates.confirmed_record_id = null;
      } else {
        cleanUpdates.confirmed_record_id = cleanUpdates.confirmed_record_id.trim();
      }
    }

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('batch_items')
          .update(cleanUpdates)
          .eq('id', itemId)
          .select()
          .maybeSingle();

        if (error) {
          console.error('[BatchModel.updateItem] Supabase update error:', error);
        } else if (data) {
          this.updateLocalItem(itemId, cleanUpdates);
          return data;
        }
      } catch (err) {
        console.error('[BatchModel.updateItem] Unexpected error:', err);
      }
    }
    return this.updateLocalItem(itemId, cleanUpdates);
  },

  updateLocalItem(itemId, updates) {
    const db = readLocalData();
    if (!db.batch_items) db.batch_items = [];
    const index = db.batch_items.findIndex(i => i.id === itemId);
    if (index !== -1) {
      db.batch_items[index] = { ...db.batch_items[index], ...updates };
      writeLocalData(db);
      return db.batch_items[index];
    } else {
      const newItem = { id: itemId, ...updates };
      db.batch_items.push(newItem);
      writeLocalData(db);
      return newItem;
    }
  },

  async deleteItem(itemId) {
    if (isSupabase) {
      try {
        await dbClient.from('batch_items').delete().eq('id', itemId);
      } catch (err) {
        // Fallback
      }
    }
    const db = readLocalData();
    if (db.batch_items) {
      db.batch_items = db.batch_items.filter(i => i.id !== itemId);
      writeLocalData(db);
    }
    return true;
  },

  async recountBatchStats(batchId) {
    const items = await this.findItemsByBatchId(batchId);
    const total = items.length;
    const processed = items.filter(i => ['READY_FOR_REVIEW', 'MANUAL_REQUIRED', 'CONFIRMED', 'REJECTED', 'FAILED'].includes(i.status)).length;
    const successful = items.filter(i => ['READY_FOR_REVIEW', 'CONFIRMED'].includes(i.status)).length;
    const failed = items.filter(i => ['FAILED', 'MANUAL_REQUIRED'].includes(i.status)).length;
    
    let status = 'PROCESSING';
    if (processed >= total && total > 0) {
      status = failed === 0 ? 'COMPLETED' : 'PARTIALLY_FAILED';
    }

    return await this.updateJob(batchId, {
      total_files: total,
      processed_files: processed,
      successful_files: successful,
      failed_files: failed,
      status: status
    });
  }
};

module.exports = BatchModel;

