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

const PatientModel = {
  // Find all ACTIVE patients
  async findAllActive() {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patients')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase findAllActive patients error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      const patients = db.patients || [];
      return patients
        .filter(p => p.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Find all patients (optionally including archived)
  async findAll(includeArchived = false) {
    if (isSupabase) {
      let query = dbClient.from('patients').select('*');
      if (!includeArchived) {
        query = query.eq('status', 'ACTIVE');
      }
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase findAll patients error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      const patients = db.patients || [];
      return patients
        .filter(p => includeArchived || p.status === 'ACTIVE')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Find a patient by ID
  async findById(id) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patients')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('Supabase findById patient error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const patients = db.patients || [];
      return patients.find(p => p.id === id) || null;
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
      ...patientData,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patients')
        .insert([newPatient])
        .select()
        .single();

      if (error) {
        console.error('Supabase create patient error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      if (!db.patients) {
        db.patients = [];
      }
      // Generate standard random ID for local fallback
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

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('patients')
        .update(cleanUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Supabase update patient error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const patients = db.patients || [];
      const index = patients.findIndex(p => p.id === id);
      if (index === -1) {
        return null;
      }

      patients[index] = {
        ...patients[index],
        ...cleanUpdates
      };

      db.patients = patients;
      writeLocalData(db);
      return patients[index];
    }
  },

  // Archive a patient (soft delete)
  async archive(id) {
    return this.update(id, { status: 'ARCHIVED' });
  }
};

module.exports = PatientModel;
