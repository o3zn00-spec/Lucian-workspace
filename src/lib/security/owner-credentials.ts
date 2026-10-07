import "server-only";

import { db } from "@/lib/db";
import { decryptOwnerCredential, encryptOwnerCredential } from "@/lib/security/owner-credential-encryption";

export const OWNER_CREDENTIAL_DEFINITIONS = [
  { service: "gemini", key: "api_key", label: "Gemini API key" },
  { service: "openai", key: "api_key", label: "Openai API key" },
  { service: "anthropic", key: "api_key", label: "Anthropic API key" },
  { service: "openrouter", key: "api_key", label: "Openrouter API key" },
  { service: "deepseek", key: "api_key", label: "Deepseek API key" },
  { service: "custom", key: "api_key", label: "Custom API key" },

  { service: "bybit", key: "api_key", label: "Bybit API key" },
  { service: "bybit", key: "api_secret", label: "Bybit API secret" },
  { service: "bybit", key: "environment", label: "Bybit environment (testnet or mainnet)" },
] as const;

export type OwnerCredentialService = (typeof OWNER_CREDENTIAL_DEFINITIONS)[number]["service"];
export type OwnerCredentialKey = (typeof OWNER_CREDENTIAL_DEFINITIONS)[number]["key"];

export function isAllowedOwnerCredential(service: string, keyName: string): boolean {
  return OWNER_CREDENTIAL_DEFINITIONS.some((item) => item.service === service && item.key === keyName);
}

function binding(ownerUserId: string, service: string, keyName: string): string {
  return `${ownerUserId}:${service}:${keyName}`;
}

export async function readOwnerCredential(ownerUserId: string, service: string, keyName: string): Promise<string | null> {
  if (!process.env.DATABASE_URL || !isAllowedOwnerCredential(service, keyName)) return null;
  const row = await db.ownerCredential.findUnique({
    where: { ownerUserId_service_keyName: { ownerUserId, service, keyName } },
    select: { encryptedValue: true },
  });
  if (!row) return null;
  return decryptOwnerCredential(row.encryptedValue, binding(ownerUserId, service, keyName));
}

export async function writeOwnerCredential(ownerUserId: string, service: string, keyName: string, value: string): Promise<void> {
  if (!isAllowedOwnerCredential(service, keyName)) throw new Error("Unsupported owner credential.");
  if (!value.trim()) throw new Error("Credential value cannot be empty.");
  const encryptedValue = encryptOwnerCredential(value.trim(), binding(ownerUserId, service, keyName));
  await db.ownerCredential.upsert({
    where: { ownerUserId_service_keyName: { ownerUserId, service, keyName } },
    create: { ownerUserId, service, keyName, encryptedValue, keyVersion: 1 },
    update: { encryptedValue, keyVersion: 1 },
  });
}

export async function deleteOwnerCredential(ownerUserId: string, service: string, keyName: string): Promise<void> {
  if (!isAllowedOwnerCredential(service, keyName)) throw new Error("Unsupported owner credential.");
  await db.ownerCredential.deleteMany({ where: { ownerUserId, service, keyName } });
}

export async function listOwnerCredentialStatus(ownerUserId: string) {
  const rows = process.env.DATABASE_URL
    ? await db.ownerCredential.findMany({
        where: { ownerUserId },
        select: { service: true, keyName: true, updatedAt: true },
      })
    : [];
  const configured = new Map(rows.map((row) => [`${row.service}:${row.keyName}`, row.updatedAt]));
  return OWNER_CREDENTIAL_DEFINITIONS.map((definition) => ({
    ...definition,
    configured: configured.has(`${definition.service}:${definition.key}`),
    updatedAt: configured.get(`${definition.service}:${definition.key}`)?.toISOString() ?? null,
  }));
}
