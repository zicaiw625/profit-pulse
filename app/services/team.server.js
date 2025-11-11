import pkg from "@prisma/client";
import prisma from "../db.server";

const { TeamRole } = pkg;

export async function listTeamMembers(merchantId) {
  if (!merchantId) return [];
  return prisma.teamMember.findMany({
    where: { merchantId },
    orderBy: { invitedAt: "asc" },
  });
}

export async function inviteTeamMember({ merchantId, email, role = TeamRole.FINANCE, name }) {
  if (!merchantId || !email) {
    throw new Error("merchantId and email are required to invite a member");
  }

  const normalizedEmail = email.trim().toLowerCase();
  return prisma.teamMember.upsert({
    where: {
      merchantId_email: {
        merchantId,
        email: normalizedEmail,
      },
    },
    create: {
      merchantId,
      email: normalizedEmail,
      role,
      name,
      status: "INVITED",
    },
    update: {
      role,
      name,
      status: "INVITED",
    },
  });
}

export async function updateTeamMemberRole({ memberId, role }) {
  if (!memberId || !role) {
    throw new Error("memberId and role are required");
  }
  return prisma.teamMember.update({
    where: { id: memberId },
    data: { role },
  });
}

export async function removeTeamMember(memberId) {
  if (!memberId) {
    throw new Error("memberId is required");
  }
  return prisma.teamMember.delete({ where: { id: memberId } });
}

export async function findTeamMemberByEmail({ merchantId, email }) {
  if (!merchantId || !email) return null;
  return prisma.teamMember.findUnique({
    where: {
      merchantId_email: {
        merchantId,
        email: email.trim().toLowerCase(),
      },
    },
  });
}
