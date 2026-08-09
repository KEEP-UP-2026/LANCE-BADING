// Safe audit log actor display helpers

function resolveAuditActor(log, knownUserIds = null) {
  const email = log.user_email || log.actor_email_snapshot || '';
  const name = log.actor_name_snapshot || '';
  const role = log.actor_role_snapshot || '';

  const userMissing = log.user_id && knownUserIds && !knownUserIds.has(log.user_id);

  if (userMissing || (!log.user_id && !email && !name)) {
    if (name) return { label: name, sublabel: email || 'Deleted or unavailable user', role };
    if (email) return { label: email, sublabel: 'Deleted or unavailable user', role };
    return { label: 'Deleted or unavailable user', sublabel: '', role };
  }

  if (name) return { label: name, sublabel: email, role };
  if (email) return { label: email, sublabel: '', role };
  return { label: 'System', sublabel: '', role: role || 'SYSTEM' };
}

function classifyStaleAuditReference(log, knownUserIds) {
  if (!log.user_id) {
    if (log.user_email || log.actor_name_snapshot) return 'historical_valid';
    return 'missing_snapshot';
  }
  if (!knownUserIds.has(log.user_id)) {
    if (log.user_email || log.actor_name_snapshot) return 'historical_valid';
    return 'missing_snapshot';
  }
  return 'valid';
}

module.exports = { resolveAuditActor, classifyStaleAuditReference };
