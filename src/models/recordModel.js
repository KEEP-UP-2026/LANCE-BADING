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

const RecordModel = {
  // Create a new patient record
  async create(recordData) {
    const newRecord = {
      ...recordData,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patient_records')
        .insert([newRecord])
        .select()
        .single();

      if (error) {
        console.error('Supabase create record error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      if (!db.patient_records) {
        db.patient_records = [];
      }
      // Generate standard random ID for local fallback if not already provided
      newRecord.id = recordData.id || 'rec-uuid-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
      db.patient_records.push(newRecord);
      writeLocalData(db);
      return newRecord;
    }
  },

  // Find all ACTIVE records for a specific patient
  async findByPatientId(patientId) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patient_records')
        .select('*')
        .eq('patient_id', patientId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase findByPatientId records error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      const records = db.patient_records || [];
      return records
        .filter(r => r.patient_id === patientId && r.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Find a specific record by ID
  async findById(id) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patient_records')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('Supabase findById record error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const records = db.patient_records || [];
      return records.find(r => r.id === id) || null;
    }
  },

  // Find all ACTIVE records
  async findAllActive() {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patient_records')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase findAllActive records error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      const records = db.patient_records || [];
      return records
        .filter(r => r.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Find all records (optionally including archived)
  async findAll(includeArchived = false) {
    if (isSupabase) {
      let query = dbClient.from('patient_records').select('*');
      if (!includeArchived) {
        query = query.eq('status', 'ACTIVE');
      }
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase findAll records error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      const records = db.patient_records || [];
      return records
        .filter(r => includeArchived || r.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Update record details
  async update(id, updates) {
    const cleanUpdates = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patient_records')
        .update(cleanUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Supabase update record error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const records = db.patient_records || [];
      const index = records.findIndex(r => r.id === id);
      if (index === -1) {
        return null;
      }

      records[index] = {
        ...records[index],
        ...cleanUpdates
      };

      db.patient_records = records;
      writeLocalData(db);
      return records[index];
    }
  },

  // Archive a record
  async archive(id) {
    return this.update(id, { status: 'ARCHIVED' });
  },

  // Reassign all records of a patient to another patient (used in profile merging)
  async reassignPatientRecords(oldPatientId, newPatientId) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patient_records')
        .update({ patient_id: newPatientId, updated_at: new Date().toISOString() })
        .eq('patient_id', oldPatientId)
        .select();

      if (error) {
        console.error('Supabase reassignPatientRecords error:', error);
        throw error;
      }
      return data;
    } else {
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
      return true;
    }
  }
};

module.exports = RecordModel;
