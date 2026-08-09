// Audit log actor snapshot migration (local JSON only; non-destructive)
// Backfills actor_name_snapshot and actor_role_snapshot when reliable user data exists.

const fs = require('fs');
const path = require('path');
const { jsonDbPath } = require('./src/config/db');
const { classifyStaleAuditReference } = require('./src/utils/auditDisplay');

function migrateAuditSnapshots() {
  if (!fs.existsSync(jsonDbPath)) {
    console.log('No local database found. Nothing to migrate.');
    return { updated: 0, skipped: 0 };
  }

  const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf-8'));
  const users = db.users || [];
  const logs = db.audit_logs || [];
  const userMap = new Map(users.map(u => [u.id, u]));
  const knownUserIds = new Set(users.map(u => u.id));

  let updated = 0;
  let skipped = 0;

  logs.forEach(log => {
    const classification = classifyStaleAuditReference(log, knownUserIds);
    const user = log.user_id ? userMap.get(log.user_id) : null;

    if (user) {
      let changed = false;
      if (!log.actor_name_snapshot && user.full_name) {
        log.actor_name_snapshot = user.full_name;
        changed = true;
      }
      if (!log.actor_role_snapshot && user.role) {
        log.actor_role_snapshot = user.role;
        changed = true;
      }
      if (changed) updated += 1;
      else skipped += 1;
      return;
    }

    if (classification === 'historical_valid') {
      skipped += 1;
      return;
    }

    skipped += 1;
  });

  db.audit_logs = logs;
  fs.writeFileSync(jsonDbPath, JSON.stringify(db, null, 2), 'utf-8');

  console.log(`Audit snapshot migration complete. Updated: ${updated}, skipped: ${skipped}`);
  return { updated, skipped };
}

if (require.main === module) {
  migrateAuditSnapshots();
}

module.exports = { migrateAuditSnapshots };
