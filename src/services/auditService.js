import AuditLog from '../models/AuditLog.js';

export async function writeAudit({ req, action, entityType, entityId, oldValues, newValues, session }) {
  const payload = {
    userId: req?.user?._id ?? null,
    action,
    entityType,
    entityId: entityId ?? null,
    oldValues: oldValues ?? null,
    newValues: newValues ?? null,
    ipAddress: req?.ip ?? '',
    userAgent: req?.get?.('user-agent') ?? ''
  };

  if (session) {
    const [log] = await AuditLog.create([payload], { session });
    return log;
  }

  return AuditLog.create(payload);
}
