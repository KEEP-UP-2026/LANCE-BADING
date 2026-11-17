const fs = require('fs');
const { dbClient, isSupabase, jsonDbPath } = require('../config/db');

// Helper to read local JSON data
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file:', error);
    return { users: [], patients: [] };
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

// Helper to deduplicate and merge patients from remote & local DB
function mergePatients(remoteList, localList, activeOnly = true) {
  const map = new Map();
  if (Array.isArray(localList)) {
    localList.forEach(p => { if (p && p.id) map.set(p.id, p); });
  }
  if (Array.isArray(remoteList)) {
    remoteList.forEach(sp => {
      if (sp && sp.id) {
        const existing = map.get(sp.id) || {};
        map.set(sp.id, { ...existing, ...sp });
      }
    });
  }
  let result = Array.from(map.values());
  if (activeOnly) {
    result = result.filter(p => p.status === 'ACTIVE');
  }
  return result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

const PatientModel = {
  // Helper to merge Supabase patient data with local JSON extended fields
  _mergePatient(supabasePatient, localPatients) {
    if (!supabasePatient) return null;
    const match = localPatients.find(p => p.id === supabasePatient.id || p.patient_number === supabasePatient.patient_number);
    if (!match) return supabasePatient;
    return {
      ...match,
      ...supabasePatient
    };
  },

  // Find all ACTIVE patients
  async findAllActive() {
    const db = readLocalData();
    const localPatients = db.patients || [];

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patients')
          .select('*')
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Supabase findAllActive patients error (returning local):', error);
          return localPatients.filter(p => p.status === 'ACTIVE');
        }
        return mergePatients(data, localPatients, true);
      } catch (err) {
        console.error('Supabase findAllActive patients catch error (returning local):', err);
        return localPatients.filter(p => p.status === 'ACTIVE');
      }
    } else {
      return localPatients
        .filter(p => p.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Find all patients (optionally including archived)
  async findAll(includeArchived = false) {
    const db = readLocalData();
    const localPatients = db.patients || [];

    if (isSupabase) {
      try {
        let query = dbClient.from('patients').select('*');
        if (!includeArchived) {
          query = query.eq('status', 'ACTIVE');
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
          console.error('Supabase findAll patients error (returning local):', error);
          return localPatients.filter(p => includeArchived || p.status === 'ACTIVE');
        }
        return mergePatients(data, localPatients, !includeArchived);
      } catch (err) {
        console.error('Supabase findAll patients catch error (returning local):', err);
        return localPatients.filter(p => includeArchived || p.status === 'ACTIVE');
      }
    } else {
      return localPatients
        .filter(p => includeArchived || p.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Find a patient by ID
  async findById(id) {
    const db = readLocalData();
    const localPatients = db.patients || [];
    const localMatch = localPatients.find(p => p.id === id) || null;

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patients')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error || !data) {
          return localMatch;
        }
        return this._mergePatient(data, localPatients);
      } catch (err) {
        return localMatch;
      }
    } else {
      return localMatch;
    }
  },

  // Check if a patient number already exists
  async checkPatientNumberExists(patientNumber) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patients')
        .select('id')
        .eq('patient_number', patientNumber)
        .maybeSingle();

      if (error) {
        console.error('Supabase checkPatientNumberExists error:', error);
        throw error;
      }
      return !!data;
    } else {
      const db = readLocalData();
      const patients = db.patients || [];
      return patients.some(p => p.patient_number === patientNumber);
    }
  },

  // Create a new patient
  async create(patientData) {
    const newPatient = {
      id: patientData.id || crypto.randomUUID(),
      ...patientData,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Save to local JSON store first so extended fields are always cached
    const db = readLocalData();
    if (!db.patients) db.patients = [];

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patients')
          .insert([newPatient])
          .select()
          .single();

        if (error) throw error;
        const merged = { ...newPatient, ...data };
        db.patients.push(merged);
        writeLocalData(db);
        return merged;
      } catch (error) {
        if (error && error.code === 'PGRST204') {
          console.warn('Supabase missing extended columns, inserting core columns fallback...');
          const corePayload = {
            id: newPatient.id,
            patient_number: newPatient.patient_number,
            first_name: newPatient.first_name,
            middle_name: newPatient.middle_name,
            last_name: newPatient.last_name,
            birth_date: newPatient.birth_date,
            sex: newPatient.sex,
            address: newPatient.address,
            contact_number: newPatient.contact_number,
            philhealth_number: newPatient.philhealth_number,
            status: newPatient.status,
            created_by: newPatient.created_by,
            created_at: newPatient.created_at,
            updated_at: newPatient.updated_at
          };
          const { data, error: err2 } = await dbClient
            .from('patients')
            .insert([corePayload])
            .select()
            .single();

          if (err2) {
            console.error('Supabase fallback create error:', err2);
            throw err2;
          }
          const merged = { ...newPatient, ...data };
          db.patients.push(merged);
          writeLocalData(db);
          return merged;
        }
        console.error('Supabase create patient error:', error);
        throw error;
      }
    } else {
      newPatient.id = 'pat-uuid-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
      db.patients.push(newPatient);
      writeLocalData(db);
      return newPatient;
    }
  },

  // Update an existing patient's details
  async update(id, updates) {
    const cleanUpdates = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    const db = readLocalData();
    const localPatients = db.patients || [];
    const localIdx = localPatients.findIndex(p => p.id === id);
    if (localIdx !== -1) {
      localPatients[localIdx] = { ...localPatients[localIdx], ...cleanUpdates };
      db.patients = localPatients;
      writeLocalData(db);
    }

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patients')
          .update(cleanUpdates)
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        return { ...cleanUpdates, ...data };
      } catch (error) {
        if (error && error.code === 'PGRST204') {
          console.warn('Supabase missing extended columns on update, updating core columns fallback...');
          const coreUpdates = {};
          const allowedCore = ['patient_number', 'first_name', 'middle_name', 'last_name', 'birth_date', 'sex', 'address', 'contact_number', 'philhealth_number', 'status', 'updated_at'];
          allowedCore.forEach(k => {
            if (cleanUpdates[k] !== undefined) coreUpdates[k] = cleanUpdates[k];
          });

          const { data, error: err2 } = await dbClient
            .from('patients')
            .update(coreUpdates)
            .eq('id', id)
            .select()
            .single();

          if (err2) {
            console.error('Supabase fallback update error:', err2);
            throw err2;
          }
          return { ...cleanUpdates, ...data };
        }
        console.error('Supabase update patient error:', error);
        throw error;
      }
    } else {
      return localPatients[localIdx] || null;
    }
  },

  // Archive a patient (soft delete)
  async archive(id) {
    return this.update(id, { status: 'ARCHIVED' });
  },

  // Permanently delete a patient record (cascade-deletes their records too)
  async delete(id) {
    const db = readLocalData();
    const patients = db.patients || [];
    const target = patients.find(p => p.id === id);

    // Remove patient
    db.patients = patients.filter(p => p.id !== id);

    // Cascade-delete all records belonging to this patient from local DB
    if (db.patient_records) {
      db.patient_records = db.patient_records.filter(r => r.patient_id !== id);
    }

    writeLocalData(db);

    if (isSupabase) {
      try {
        // Cascade-delete records on Supabase too (best-effort)
        const { error: recErr } = await dbClient
          .from('patient_records')
          .delete()
          .eq('patient_id', id);
        if (recErr) console.error('Supabase cascade-delete records error (handled):', recErr.message);

        const { error } = await dbClient
          .from('patients')
          .delete()
          .eq('id', id);
        if (error) console.error('Supabase delete patient error (handled):', error.message);
      } catch (err) {
        console.error('Supabase delete patient catch error (handled):', err.message);
      }
    }
    return target || null;
  },

  // Find all ARCHIVED patients
  async findAllArchived() {
    const db = readLocalData();
    const localPatients = (db.patients || []).filter(p => p.status === 'ARCHIVED');

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('patients')
          .select('*')
          .eq('status', 'ARCHIVED')
          .order('updated_at', { ascending: false });

        if (error) {
          console.error('Supabase findAllArchived error (returning local):', error);
          return localPatients;
        }
        return mergePatients(data, localPatients, false).filter(p => p.status === 'ARCHIVED');
      } catch (err) {
        console.error('Supabase findAllArchived catch error:', err);
        return localPatients;
      }
    } else {
      return localPatients.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }
  }
};

module.exports = PatientModel;
