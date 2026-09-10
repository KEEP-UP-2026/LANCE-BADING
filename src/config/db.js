const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let dbClient = null;
let isSupabase = false;

// Path to local JSON database
const jsonDbPath = path.join(process.cwd(), 'database.json');

// Default seed accounts
const seedAccounts = [
  {
    id: "admin-uuid-1111-2222-333333333333",
    full_name: "RHU Administrator",
    email: "admin@keepup.com",
    password: "Admin123!", // Will be hashed below
    role: "RHU_ADMINISTRATOR",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "records-uuid-1111-2222-333333333333",
    full_name: "Records Staff User",
    email: "records@keepup.com",
    password: "Records123!", // Will be hashed below
    role: "RECORDS_STAFF",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "healthcare-uuid-1111-2222-333333333333",
    full_name: "Healthcare Personnel User",
    email: "healthcare@keepup.com",
    password: "Healthcare123!", // Will be hashed below
    role: "HEALTHCARE_PERSONNEL",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "staff-uuid-1111-2222-333333333333",
    full_name: "Administrative Staff User",
    email: "staff@keepup.com",
    password: "Staff123!", // Will be hashed below
    role: "ADMINISTRATIVE_STAFF",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "inactive-uuid-1111-2222-333333333333",
    full_name: "Inactive Records Staff",
    email: "inactive@keepup.com",
    password: "Inactive123!", // Will be hashed below
    role: "RECORDS_STAFF",
    status: "INACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

// Initialize local JSON DB
function initLocalDb() {
  if (!fs.existsSync(jsonDbPath)) {
    console.log('Initializing local JSON database...');
    const hashedAccounts = seedAccounts.map(account => {
      const salt = bcrypt.genSaltSync(10);
      return {
        ...account,
        password: bcrypt.hashSync(account.password, salt)
      };
    });
    fs.writeFileSync(jsonDbPath, JSON.stringify({ users: hashedAccounts, patients: [], patient_records: [], duplicate_flags: [], audit_logs: [], temporary_uploads: [] }, null, 2), 'utf-8');
    console.log('Local database seeded with 5 test accounts successfully.');
  } else {
    // If the database exists, make sure it has users, patients, patient_records, duplicate_flags, and audit_logs initialized
    try {
      const fileContent = fs.readFileSync(jsonDbPath, 'utf-8');
      const data = JSON.parse(fileContent);
      let modified = false;

      if (!data.users || data.users.length === 0) {
        const hashedAccounts = seedAccounts.map(account => {
          const salt = bcrypt.genSaltSync(10);
          return {
            ...account,
            password: bcrypt.hashSync(account.password, salt)
          };
        });
        data.users = hashedAccounts;
        modified = true;
      }

      if (!data.patients) {
        data.patients = [];
        modified = true;
      }

      if (!data.patient_records) {
        data.patient_records = [];
        modified = true;
      }

      if (!data.duplicate_flags) {
        data.duplicate_flags = [];
        modified = true;
      }

      if (!data.audit_logs) {
        data.audit_logs = [];
        modified = true;
      }

      if (!data.temporary_uploads) {
        data.temporary_uploads = [];
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2), 'utf-8');
      }
    } catch (e) {
      console.error('Error reading local JSON database, recreating...', e);
      const hashedAccounts = seedAccounts.map(account => {
        const salt = bcrypt.genSaltSync(10);
        return {
          ...account,
          password: bcrypt.hashSync(account.password, salt)
        };
      });
      fs.writeFileSync(jsonDbPath, JSON.stringify({ users: hashedAccounts, patients: [], patient_records: [], duplicate_flags: [], audit_logs: [], temporary_uploads: [] }, null, 2), 'utf-8');
    }
  }
}

const forceLocal = process.env.FORCE_LOCAL_DB === 'true';

// Always ensure local DB file exists as fallback
initLocalDb();

if (supabaseUrl && supabaseKey && !forceLocal) {
  try {
    console.log('Connecting to Supabase at:', supabaseUrl);
    dbClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false
      }
    });
    isSupabase = true;
    console.log('Supabase connection initialized.');
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error.message);
    console.log('Falling back to local JSON database...');
  }
} else {
  if (forceLocal) {
    console.log('FORCE_LOCAL_DB is active. Running in local JSON database mode.');
  } else {
    console.log('Supabase URL/Key not provided in .env. Running in local JSON database mode.');
  }
}

module.exports = {
  dbClient,
  isSupabase,
  jsonDbPath
};
