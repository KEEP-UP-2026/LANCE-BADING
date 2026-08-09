// Short-lived deduplication for high-frequency read audit events

const buckets = new Map();

function shouldLogOnce(key, ttlMs) {
  const now = Date.now();
  const last = buckets.get(key);
  if (last && now - last < ttlMs) return false;
  buckets.set(key, now);
  return true;
}

function buildReportAccessKey(userId, reportType, filters) {
  const filterKey = JSON.stringify(filters || {});
  return `report:${userId}:${reportType}:${filterKey}`;
}

function buildAuditLogsAccessKey(userId) {
  return `audit-logs:${userId}`;
}

module.exports = {
  shouldLogOnce,
  buildReportAccessKey,
  buildAuditLogsAccessKey
};
