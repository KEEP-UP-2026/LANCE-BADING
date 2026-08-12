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

const DuplicateModel = {
  // Create a new duplicate flag
  async create(flagData) {
    const newFlag = {
      ...flagData,
      status: 'PENDING',
      detected_at: new Date().toISOString()
    };

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('duplicate_flags')
        .insert([newFlag])
        .select()
        .single();

      if (error) {
        console.error('Supabase create duplicate flag error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      if (!db.duplicate_flags) {
        db.duplicate_flags = [];
      }
      newFlag.id = 'dup-uuid-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
      db.duplicate_flags.push(newFlag);
      writeLocalData(db);
      return newFlag;
    }
  },

  // Find all PENDING duplicate flags (with patient details populated)
  async findAllPending() {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('duplicate_flags')
        .select(`
          *,
          patient:patients!patient_id(*),
          possible_duplicate_patient:patients!possible_duplicate_patient_id(*)
        `)
        .eq('status', 'PENDING')
        .order('detected_at', { ascending: false });

      if (error) {
        console.error('Supabase findAllPending duplicate flags error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      const flags = db.duplicate_flags || [];
      const patients = db.patients || [];

      return flags
        .filter(f => f.status === 'PENDING')
        .map(f => {
          const patient = patients.find(p => p.id === f.patient_id) || null;
          const possibleDuplicatePatient = patients.find(p => p.id === f.possible_duplicate_patient_id) || null;
          return {
            ...f,
            patient,
            possible_duplicate_patient: possibleDuplicatePatient
          };
        })
        .sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at));
    }
  },

  // Update duplicate flag status (e.g. REVIEWED, IGNORED)
  async update(id, updates) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('duplicate_flags')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Supabase update duplicate flag error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const flags = db.duplicate_flags || [];
      const index = flags.findIndex(f => f.id === id);
      if (index === -1) {
        return null;
      }

      flags[index] = {
        ...flags[index],
        ...updates
      };

      db.duplicate_flags = flags;
      writeLocalData(db);
      return flags[index];
    }
  },

  // Check if a duplicate flag already exists between two patients in either direction
  async checkPairExists(patientId, otherId) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('duplicate_flags')
        .select('id')
        .or(`and(patient_id.eq.${patientId},possible_duplicate_patient_id.eq.${otherId}),and(patient_id.eq.${otherId},possible_duplicate_patient_id.eq.${patientId})`)
        .limit(1);

      if (error) {
        console.error('Supabase checkPairExists duplicate flag error:', error);
        throw error;
      }
      return data && data.length > 0;
    } else {
      const db = readLocalData();
      const flags = db.duplicate_flags || [];
      return flags.some(f => 
        (f.patient_id === patientId && f.possible_duplicate_patient_id === otherId) ||
        (f.patient_id === otherId && f.possible_duplicate_patient_id === patientId)
      );
    }
  },

  // Find duplicate flag by ID with populated patient fields
  async findById(id) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('duplicate_flags')
        .select(`
          *,
          patient:patients!patient_id(*),
          possible_duplicate_patient:patients!possible_duplicate_patient_id(*)
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('Supabase find duplicate flag by ID error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const flags = db.duplicate_flags || [];
      const patients = db.patients || [];
      const flag = flags.find(f => f.id === id);
      if (!flag) return null;
      const patient = patients.find(p => p.id === flag.patient_id) || null;
      const possibleDuplicatePatient = patients.find(p => p.id === flag.possible_duplicate_patient_id) || null;
      return {
        ...flag,
        patient,
        possible_duplicate_patient: possibleDuplicatePatient
      };
    }
  },

  // Delete all PENDING flags for a patient (when they are updated, so we can re-evaluate)
  async deleteFlagsForPatient(patientId) {
    const db = readLocalData();
    let flags = db.duplicate_flags || [];
    flags = flags.filter(f => 
      !(f.status === 'PENDING' && (f.patient_id === patientId || f.possible_duplicate_patient_id === patientId))
    );
    db.duplicate_flags = flags;
    writeLocalData(db);

    if (isSupabase) {
      try {
        const { error } = await dbClient
          .from('duplicate_flags')
          .delete()
          .eq('status', 'PENDING')
          .or(`patient_id.eq.${patientId},possible_duplicate_patient_id.eq.${patientId}`);

        if (error) {
          console.error('Supabase delete duplicate flags error (handled locally):', error.message || error);
        }
      } catch (err) {
        console.error('Supabase delete duplicate flags catch error (handled locally):', err.message || err);
      }
    }
    return true;
  },

  // Update status for all duplicate flags involving a specific patient ID (e.g. set to MERGED)
  async updateFlagsStatusForPatient(patientId, status) {
    const db = readLocalData();
    const flags = db.duplicate_flags || [];
    const updated = flags.map(f => {
      if (f.patient_id === patientId || f.possible_duplicate_patient_id === patientId) {
        return {
          ...f,
          status
        };
      }
      return f;
    });
    db.duplicate_flags = updated;
    writeLocalData(db);

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('duplicate_flags')
          .update({ status })
          .or(`patient_id.eq.${patientId},possible_duplicate_patient_id.eq.${patientId}`)
          .select();

        if (error) {
          console.error('Supabase updateFlagsStatusForPatient error (handled locally):', error.message || error);
          return null;
        }
        return data;
      } catch (err) {
        console.error('Supabase updateFlagsStatusForPatient catch error (handled locally):', err.message || err);
        return null;
      }
    }
    return true;
  }
};

module.exports = DuplicateModel;
