import prisma from "../db.server.js";

export async function logAuditEvent({ merchantId, userEmail, action, details }) {
  if (!merchantId || !action) {
    return null;
  }
  return prisma.auditLog.create({
    data: {
      merchantId,
      userEmail,
      action,
      details,
    },
  });
}

export async function listAuditLogs({ merchantId, limit = 10 }) {
  if (!merchantId) {
    return [];
  }
  return prisma.auditLog.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
