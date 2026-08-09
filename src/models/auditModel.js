const fs = require('fs');
const { dbClient, isSupabase, jsonDbPath } = require('../config/db');

// Helper to read local JSON data
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file:', error);
    return { users: [], patients: [], patient_records: [], duplicate_flags: [], audit_logs: [] };
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

const AuditModel = {
  // Create a new audit log
  async create(logData) {
    const newLog = {
      ...logData,
      created_at: new Date().toISOString()
    };

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('audit_logs')
          .insert([newLog])
          .select()
          .single();

        if (error) {
          // If table does not exist in Supabase schema, fall back to local database
          if (error.code === 'PGRST205' || (error.message && error.message.includes('Could not find the table'))) {
            return this.writeLocalLog(newLog);
          }
          console.error('Supabase create audit log error:', error);
          throw error;
        }
        return data;
      } catch (err) {
        if (err.code === 'PGRST205' || (err.message && err.message.includes('Could not find the table'))) {
          return this.writeLocalLog(newLog);
        }
        throw err;
      }
    } else {
      return this.writeLocalLog(newLog);
    }
  },

  writeLocalLog(newLog) {
    const db = readLocalData();
    if (!db.audit_logs) {
      db.audit_logs = [];
    }
    newLog.id = 'aud-uuid-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    db.audit_logs.push(newLog);
    writeLocalData(db);
    return newLog;
  },

  // Find recent audit logs (default limit to 100)
  async findRecent(limit = 100) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) {
          // If table does not exist in Supabase schema, fall back to local database
          if (error.code === 'PGRST205' || (error.message && error.message.includes('Could not find the table'))) {
            return this.readLocalLogs(limit);
          }
          console.error('Supabase findRecent audit logs error:', error);
          throw error;
        }
        return data || [];
      } catch (err) {
        if (err.code === 'PGRST205' || (err.message && err.message.includes('Could not find the table'))) {
          return this.readLocalLogs(limit);
        }
        throw err;
      }
    } else {
      return this.readLocalLogs(limit);
    }
  },

  readLocalLogs(limit) {
    const db = readLocalData();
    const logs = db.audit_logs || [];
    return logs
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }
};

module.exports = AuditModel;
