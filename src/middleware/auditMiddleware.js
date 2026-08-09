const AuditModel = require('../models/auditModel');

const AuditMiddleware = {
  async logActivity(userId, email, action, details, req = null, actorMeta = null) {
    try {
      let ipAddress = 'INTERNAL';
      if (req) {
        ipAddress = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'UNKNOWN';
      }

      const actor = actorMeta || (req && req.user ? {
        actor_name_snapshot: req.user.full_name || null,
        actor_role_snapshot: req.user.role || null
      } : {});

      await AuditModel.create({
        user_id: userId || null,
        user_email: email || 'system@keepup.com',
        actor_name_snapshot: actor.actor_name_snapshot || null,
        actor_role_snapshot: actor.actor_role_snapshot || null,
        action,
        details,
        ip_address: ipAddress
      });
      console.log(`[AUDIT LOG] ${email || 'system'} - Action: ${action} - Details: ${details}`);
    } catch (err) {
      console.error('Failed to write audit log entry:', err);
    }
  },

  async logFromRequest(req, action, details) {
    if (!req || !req.user) {
      return this.logActivity(null, 'system@keepup.com', action, details, req);
    }
    return this.logActivity(req.user.id, req.user.email, action, details, req);
  }
};

module.exports = AuditMiddleware;
