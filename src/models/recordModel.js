const fs = require('fs');
const { dbClient, isSupabase, jsonDbPath } = require('../config/db');

// Helper to read local JSON data
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file:', error);
    return { users: [], patients: [], patient_records: [], duplicate_flags: [] };
  }
}

// Helper to write local JSON data
function writeLocalData(data) {
  try {
    fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing to JSON DB file:', error);
  }
}

// Helper to deduplicate and merge records from remote & local DB
function mergeRecords(remoteList, localList, activeOnly = true) {
  const map = new Map();
  if (Array.isArray(remoteList)) {
    remoteList.forEach(r => { if (r && r.id) map.set(r.id, r); });
  }
  if (Array.isArray(localList)) {
    localList.forEach(l => {
      if (l && l.id) {
        if (map.has(l.id)) {
          const r = map.get(l.id);
          map.set(l.id, {
            ...l,
            ...r,
            structured_json: l.structured_json || r.structured_json,
            layout_blocks: l.layout_blocks || r.layout_blocks
          });
        } else {
          map.set(l.id, l);
        }
      }
    });
  }
  let result = Array.from(map.values());
  if (activeOnly) {
    result = result.filter(r => r.status === 'ACTIVE');
  }
  return result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

const isUuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const RecordModel = {
  // Create a new patient record
  async create(recordData) {
    const newRecord = {
      ...recordData,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Always persist to local DB for reliability
    this.writeLocalRecord(newRecord);

    if (isSupabase) {
      try {
        let supabasePayload = { ...newRecord };

        let { data, error } = await dbClient
          .from('patient_records')
          .insert([supabasePayload])
          .select()
          .single();

        if (error && error.code === 'PGRST204') {
          delete supabasePayload.layout_blocks;
          delete supabasePayload.structured_json;
          const retry = await dbClient
            .from('patient_records')
            .insert([supabasePayload])
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          console.error('Supabase create record error (saved in local DB):', error);
        } else if (data) {
          return { ...data, structured_json: newRecord.structured_json, layout_blocks: newRecord.layout_blocks };
        }
      } catch (err) {
        console.error('Supabase create record catch error (saved in local DB):', err);
      }
    }
    return newRecord;
  },

  writeLocalRecord(newRecord) {
    const db = readLocalData();
    if (!db.patient_records) {
      db.patient_records = [];
    }
    newRecord.id = newRecord.id || 'rec-uuid-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);

    const existingIdx = db.patient_records.findIndex(r => r.id === newRecord.id);
    if (existingIdx !== -1) {
      db.patient_records[existingIdx] = newRecord;
    } else {
      db.patient_records.push(newRecord);
    }
    writeLocalData(db);
    return newRecord;
  },

  getLocalByPatientId(patientId) {
    const db = readLocalData();
    const records = db.patient_records || [];
    return records
      .filter(r => r.patient_id === patientId && r.status === 'ACTIVE')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Find all ACTIVE records for a specific patient
  async findByPatientId(patientId) {
    const localRecords = this.getLocalByPatientId(patientId);

    if (isSupabase && isUuid(patientId)) {
      try {
        const { data, error } = await dbClient
          .from('patient_records')
          .select('*')
          .eq('patient_id', patientId)
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false });

        if (error) {
          return localRecords;
        }
        return mergeRecords(data, localRecords);
      } catch (err) {
        return localRecords;
      }
    } else {
      return localRecords;
    }
  },

  // Find a specific record by ID
  async findById(id) {
    const db = readLocalData();
    const records = db.patient_records || [];
    const localRec = records.find(r => r.id === id) || null;

    if (isSupabase && isUuid(id)) {
      try {
        const { data, error } = await dbClient
          .from('patient_records')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error || !data) {
          return localRec;
        }
        return {
          ...localRec,
          ...data,
          structured_json: (localRec && localRec.structured_json) ? localRec.structured_json : data.structured_json
        };
      } catch (err) {
        return localRec;
      }
    } else {
      return localRec;
    }
  },

  getLocalAllActive() {
    const db = readLocalData();
    const records = db.patient_records || [];
    return records
      .filter(r => r.status === 'ACTIVE')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Find all ACTIVE records
  async findAllActive() {
    const localRecords = this.getLocalAllActive();

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patient_records')
          .select('*')
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Supabase findAllActive records error (returning local):', error);
          return localRecords;
        }
        return mergeRecords(data, localRecords);
      } catch (err) {
        console.error('Supabase findAllActive catch error (returning local):', err);
        return localRecords;
      }
    } else {
      return localRecords;
    }
  },

  getLocalAll(includeArchived = false) {
    const db = readLocalData();
    const records = db.patient_records || [];
    return records
      .filter(r => includeArchived || r.status === 'ACTIVE')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Find all records (optionally including archived)
  async findAll(includeArchived = false) {
    const localRecords = this.getLocalAll(includeArchived);

    if (isSupabase) {
      try {
        let query = dbClient.from('patient_records').select('*');
        if (!includeArchived) {
          query = query.eq('status', 'ACTIVE');
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
          console.error('Supabase findAll records error (returning local):', error);
          return localRecords;
        }
        return mergeRecords(data, localRecords, !includeArchived);
      } catch (err) {
        console.error('Supabase findAll catch error (returning local):', err);
        return localRecords;
      }
    } else {
      return localRecords;
    }
  },

  // Update record details
  async update(id, updates) {
    const cleanUpdates = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Update local DB
    const db = readLocalData();
    const records = db.patient_records || [];
    const index = records.findIndex(r => r.id === id);
    let updatedLocal = null;
    if (index !== -1) {
      records[index] = { ...records[index], ...cleanUpdates };
      db.patient_records = records;
      writeLocalData(db);
      updatedLocal = records[index];
    }

    if (isSupabase) {
      try {
        let supabaseUpdates = { ...cleanUpdates };

        let { data, error } = await dbClient
          .from('patient_records')
          .update(supabaseUpdates)
          .eq('id', id)
          .select()
          .single();

        if (error && error.code === 'PGRST204') {
          delete supabaseUpdates.layout_blocks;
          delete supabaseUpdates.structured_json;
          const retry = await dbClient
            .from('patient_records')
            .update(supabaseUpdates)
            .eq('id', id)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          console.error('Supabase update record error:', error);
          return updatedLocal;
        }
        return {
          ...data,
          structured_json: updatedLocal ? updatedLocal.structured_json : cleanUpdates.structured_json,
          layout_blocks: updatedLocal ? updatedLocal.layout_blocks : cleanUpdates.layout_blocks
        };
      } catch (err) {
        return updatedLocal;
      }
    } else {
      return updatedLocal;
    }
  },

  // Archive a record
  async archive(id) {
    return this.update(id, { status: 'ARCHIVED' });
  },

  // Permanently delete a record
  async delete(id) {
    const db = readLocalData();
    const records = db.patient_records || [];
    const filtered = records.filter(r => r.id !== id);
    db.patient_records = filtered;
    writeLocalData(db);

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patient_records')
          .delete()
          .eq('id', id)
          .select();

        if (error) {
          console.error('Supabase delete record error:', error);
        }
        return data;
      } catch (err) {
        console.error('Supabase delete record catch error:', err);
        return true;
      }
    } else {
      return true;
    }
  },

  // Reassign all records of a patient to another patient (used in profile merging)
  async reassignPatientRecords(oldPatientId, newPatientId) {
    const db = readLocalData();
    const records = db.patient_records || [];
    const updated = records.map(r => {
      if (r.patient_id === oldPatientId) {
        return {
          ...r,
          patient_id: newPatientId,
          updated_at: new Date().toISOString()
        };
      }
      return r;
    });
    db.patient_records = updated;
    writeLocalData(db);

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patient_records')
          .update({ patient_id: newPatientId, updated_at: new Date().toISOString() })
          .eq('patient_id', oldPatientId)
          .select();

        if (error) {
          console.error('Supabase reassignPatientRecords error:', error);
        }
        return data;
      } catch (err) {
        return true;
      }
    } else {
      return true;
    }
  }
};

module.exports = RecordModel;
