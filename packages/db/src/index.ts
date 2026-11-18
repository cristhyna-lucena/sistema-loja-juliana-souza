import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
export { PrismaClient, Prisma } from "./generated/prisma/client";
export { Perfil } from "./generated/prisma/enums";
export function createDatabase(connectionString: string) {
  if (!connectionString) throw new Error("DATABASE_URL é obrigatória");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000, max: 5 }) });
}

