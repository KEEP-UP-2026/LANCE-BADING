const fs = require('fs');
const { dbClient, isSupabase, jsonDbPath } = require('../config/db');

// Helper to read local JSON data
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file:', error);
    return { users: [] };
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

const UserModel = {
  // Find a user by email address
  async findByEmail(email) {
    const normalizedEmail = email.toLowerCase().trim();
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .eq('email', normalizedEmail)
        .maybeSingle();
      
      if (error) {
        console.error('Supabase findByEmail error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      return db.users.find(u => u.email.toLowerCase() === normalizedEmail) || null;
    }
  },

  // Find a user by ID
  async findById(id) {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('Supabase findById error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      return db.users.find(u => u.id === id) || null;
    }
  },

  // Create a new user account
  async create(userData) {
    const newUser = {
      ...userData,
      email: userData.email.toLowerCase().trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('users')
        .insert([newUser])
        .select()
        .single();

      if (error) {
        console.error('Supabase create user error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      // Generate a UUID-like random id for local mode
      newUser.id = 'uuid-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
      db.users.push(newUser);
      writeLocalData(db);
      return newUser;
    }
  },

  // Update an existing user account
  async update(id, updates) {
    const cleanUpdates = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    if (isSupabase) {
      const { data, error } = await dbClient
        .from('users')
        .update(cleanUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Supabase update user error:', error);
        throw error;
      }
      return data;
    } else {
      const db = readLocalData();
      const userIndex = db.users.findIndex(u => u.id === id);
      if (userIndex === -1) {
        return null;
      }
      
      // Update fields
      db.users[userIndex] = {
        ...db.users[userIndex],
        ...cleanUpdates
      };
      
      writeLocalData(db);
      return db.users[userIndex];
    }
  },

  // Retrieve all users
  async findAll() {
    if (isSupabase) {
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase findAll users error:', error);
        throw error;
      }
      return data || [];
    } else {
      const db = readLocalData();
      // Return sorted by created_at descending (latest first)
      return [...db.users].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }
};

module.exports = UserModel;
