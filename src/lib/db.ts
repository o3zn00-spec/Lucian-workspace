// LUCIAN Vault — Prisma client.
//
// This file provides a singleton Prisma client for the Vault financial
// ledger. It is SERVER-ONLY — never import from a client component.
//
// DATABASE_URL must be set in the environment. If not set, the Vault
// operates in "Real-Money Ready" mode using the in-memory ledger
// (see src/lib/vault/ledger.ts). No fake money is ever shown.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

/** Check if the database is configured. */
export function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}
