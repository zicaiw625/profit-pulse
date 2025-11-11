/* eslint-env node */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = global;
const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

export default prisma;
