const fs = require('fs');
const path = require('path');
const { dbClient, isSupabase, jsonDbPath } = require('../config/db');

// Helper to read local JSON data
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file:', error);
    return { users: [], patients: [], patient_records: [], duplicate_flags: [], audit_logs: [], temporary_uploads: [] };
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

// Helper to detect if Supabase table is missing or network/DNS is offline
function isFallbackError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const details = (err.details || '').toLowerCase();
  return (
    err.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('fetch failed') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    details.includes('fetch failed') ||
    details.includes('enotfound')
  );
}

const TemporaryUploadModel = {
  // Create a temporary upload record
  async create(tempData) {
    const newTemp = {
      ...tempData,
      created_at: new Date().toISOString()
    };

    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('temporary_uploads')
          .insert([newTemp])
          .select()
          .single();

        if (error) {
          if (isFallbackError(error)) {
            return this.writeLocalTemp(newTemp);
          }
          console.error('Supabase create temporary upload error:', error);
          throw error;
        }
        return data;
      } catch (err) {
        if (isFallbackError(err)) {
          return this.writeLocalTemp(newTemp);
        }
        throw err;
      }
    } else {
      return this.writeLocalTemp(newTemp);
    }
  },

  writeLocalTemp(newTemp) {
    const db = readLocalData();
    if (!db.temporary_uploads) {
      db.temporary_uploads = [];
    }
    newTemp.token = newTemp.token || 'temp-tok-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    db.temporary_uploads.push(newTemp);
    writeLocalData(db);
    return newTemp;
  },

  // Find a temporary upload by token
  async findByToken(token) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('temporary_uploads')
          .select('*')
          .eq('token', token)
          .maybeSingle();

        if (error) {
          if (isFallbackError(error)) {
            return this.readLocalTempByToken(token);
          }
          console.error('Supabase find temporary upload by token error:', error);
          throw error;
        }
        return data;
      } catch (err) {
        if (isFallbackError(err)) {
          return this.readLocalTempByToken(token);
        }
        throw err;
      }
    } else {
      return this.readLocalTempByToken(token);
    }
  },

  readLocalTempByToken(token) {
    const db = readLocalData();
    const list = db.temporary_uploads || [];
    return list.find(t => t.token === token) || null;
  },

  // Update temporary upload by token
  async updateByToken(token, updates) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('temporary_uploads')
          .update(updates)
          .eq('token', token)
          .select();

        if (error) {
          if (isFallbackError(error)) {
            return this.updateLocalTempByToken(token, updates);
          }
          console.error('Supabase update temporary upload by token error:', error);
          throw error;
        }
        return data;
      } catch (err) {
        if (isFallbackError(err)) {
          return this.updateLocalTempByToken(token, updates);
        }
        throw err;
      }
    } else {
      return this.updateLocalTempByToken(token, updates);
    }
  },

  updateLocalTempByToken(token, updates) {
    const db = readLocalData();
    const list = db.temporary_uploads || [];
    const index = list.findIndex(t => t.token === token);
    if (index !== -1) {
      list[index] = { ...list[index], ...updates };
      db.temporary_uploads = list;
      writeLocalData(db);
      return list[index];
    }
    return null;
  },

  // Delete temporary upload by token
  async deleteByToken(token) {
    if (isSupabase) {
      try {
        const { data, error } = await dbClient
          .from('temporary_uploads')
          .delete()
          .eq('token', token)
          .select();

        if (error) {
          if (isFallbackError(error)) {
            return this.deleteLocalTempByToken(token);
          }
          console.error('Supabase delete temporary upload by token error:', error);
          throw error;
        }
        return data;
      } catch (err) {
        if (isFallbackError(err)) {
          return this.deleteLocalTempByToken(token);
        }
        throw err;
      }
    } else {
      return this.deleteLocalTempByToken(token);
    }
  },

  deleteLocalTempByToken(token) {
    const db = readLocalData();
    const list = db.temporary_uploads || [];
    const filtered = list.filter(t => t.token !== token);
    db.temporary_uploads = filtered;
    writeLocalData(db);
    return true;
  },

  // Delete records older than a specific amount of minutes and return deleted lists (to clean disk files)
  async deleteExpired(ageInMinutes = 60) {
    const threshold = new Date(Date.now() - ageInMinutes * 60 * 1000).toISOString();

    if (isSupabase) {
      try {
        // First select expired items to return their file paths
        const { data: expiredList, error: selectError } = await dbClient
          .from('temporary_uploads')
          .select('*')
          .lt('created_at', threshold);

        if (selectError) {
          if (isFallbackError(selectError)) {
            return this.deleteLocalTempExpired(threshold);
          }
          console.error('Supabase select expired temporary uploads error:', selectError);
          throw selectError;
        }

        if (expiredList && expiredList.length > 0) {
          const { error: deleteError } = await dbClient
            .from('temporary_uploads')
            .delete()
            .lt('created_at', threshold);

          if (deleteError) {
            if (isFallbackError(deleteError)) {
              return this.deleteLocalTempExpired(threshold);
            }
            console.error('Supabase delete expired temporary uploads error:', deleteError);
            throw deleteError;
          }
        }

        return expiredList || [];
      } catch (err) {
        if (isFallbackError(err)) {
          return this.deleteLocalTempExpired(threshold);
        }
        throw err;
      }
    } else {
      return this.deleteLocalTempExpired(threshold);
    }
  },

  deleteLocalTempExpired(threshold) {
    const db = readLocalData();
    const list = db.temporary_uploads || [];
    
    const expired = list.filter(t => new Date(t.created_at) < new Date(threshold));
    const active = list.filter(t => new Date(t.created_at) >= new Date(threshold));
    
    db.temporary_uploads = active;
    writeLocalData(db);
    
    return expired;
  }
};

module.exports = TemporaryUploadModel;
