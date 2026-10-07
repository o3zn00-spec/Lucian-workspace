import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createDecipheriv, createHmac } from "node:crypto";
import { createTransport } from "nodemailer";
import { db } from "../src/lib/db";
import { isValidEmail, normalizeEmail } from "../src/lib/auth/validation";

let failures = 0;
function check(ok: boolean, label: string, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

function required(name: string): string {
  const value = process.env[name]?.trim() || "";
  check(Boolean(value), name, value ? "configured" : "missing");
  return value;
}

function decryptCredential(envelope: string, binding: string): string {
  const key = Buffer.from(process.env.OWNER_CREDENTIALS_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) throw new Error("Credential encryption key is invalid.");
  const [version, iv, tag, encrypted] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored credential envelope is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(binding, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

async function verifyBybit(ownerUserId: string) {
  const rows = await db.ownerCredential.findMany({ where: { ownerUserId, service: "bybit" }, select: { keyName: true, encryptedValue: true } });
  const stored = new Map(rows.map((row) => [row.keyName, decryptCredential(row.encryptedValue, `${ownerUserId}:bybit:${row.keyName}`)]));
  const apiKey = stored.get("api_key") || process.env.BYBIT_API_KEY || "";
  const apiSecret = stored.get("api_secret") || process.env.BYBIT_API_SECRET || "";
  const environment = (stored.get("environment") || process.env.BYBIT_ENVIRONMENT || "testnet").toLowerCase();
  check(environment === "mainnet", "Stored Bybit mode", `credential set targets ${environment}`);
  if (!apiKey || !apiSecret || environment !== "mainnet") return;
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = "accountType=UNIFIED";
  const signature = createHmac("sha256", apiSecret).update(`${timestamp}${apiKey}${recvWindow}${query}`).digest("hex");
  const response = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${query}`, {
    headers: { Accept: "application/json", "X-BAPI-API-KEY": apiKey, "X-BAPI-SIGN": signature, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-RECV-WINDOW": recvWindow },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { retCode?: number; retMsg?: string } | null;
  check(response.ok && payload?.retCode === 0, "Bybit authenticated read", response.ok && payload?.retCode === 0 ? "mainnet wallet endpoint authenticated" : payload?.retMsg || `HTTP ${response.status}`);
}

async function main() {
  console.log("\n=== LUCIAN LIVE READINESS (READ-ONLY) ===");
  required("DATABASE_URL");
  required("AUTH_SECRET");
  required("OWNER_CREDENTIALS_ENCRYPTION_KEY");
  const appUrl = required("AUTH_APP_URL");
  check(appUrl.startsWith("https://"), "Public origin", "AUTH_APP_URL must use HTTPS");
  check(process.env.BYBIT_ENVIRONMENT === "mainnet", "Bybit environment", "must be mainnet for live verification");
  check(process.env.BYBIT_LIVE_MODE_ENABLED === "true", "Bybit live lock", "BYBIT_LIVE_MODE_ENABLED=true");
  check(process.env.LIVE_TRADING_ENABLED === "true", "Execution lock", "LIVE_TRADING_ENABLED=true");
  check(process.env.BYBIT_WITHDRAWALS_ENABLED !== "true", "Withdrawal lock", "withdrawals remain disabled during release verification");

  const ownerEmail = normalizeEmail(process.env.LUCIAN_OWNER_EMAIL || "");
  check(isValidEmail(ownerEmail), "Owner identity", "configured owner email is syntactically valid");
  if (!isValidEmail(ownerEmail) || failures) throw new Error("Environment prerequisites failed.");

  await db.$queryRaw`SELECT 1`;
  check(true, "Database connection", "PostgreSQL accepted a query");
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true, status: true, passwordHash: true, accounts: { select: { id: true } } } });
  check(Boolean(owner), "Owner record", "configured owner exists");
  check(owner?.status === "active", "Owner status", "configured owner is active");
  check(Boolean(owner?.passwordHash || owner?.accounts.length), "Owner recovery path", "owner has a password or linked identity");
  const extraActive = owner ? await db.user.count({ where: { id: { not: owner.id }, status: { not: "disabled" } } }) : -1;
  check(extraActive === 0, "Single-owner invariant", `${Math.max(0, extraActive)} non-owner active identities`);

  type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };
  const applied = await db.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  const appliedNames = new Set(applied.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
  const local = readdirSync(resolve(import.meta.dirname, "../prisma/migrations"))
    .filter((name) => statSync(resolve(import.meta.dirname, "../prisma/migrations", name)).isDirectory());
  const pending = local.filter((name) => !appliedNames.has(name));
  check(pending.length === 0, "Database migrations", pending.length ? `pending: ${pending.join(", ")}` : `${local.length} local migrations applied`);

  const smtpHost = required("SMTP_HOST");
  const smtpUser = required("SMTP_USER");
  const smtpPass = required("SMTP_PASS");
  if (smtpHost && smtpUser && smtpPass) {
    const transport = createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transport.verify();
    check(true, "SMTP authentication", "provider accepted the configured transport (no email sent)");
  }

  if (owner) await verifyBybit(owner.id);
}

main()
  .catch((error) => {
    if (failures === 0) failures = 1;
    console.error("FAIL  Live readiness stopped —", error instanceof Error ? error.message : "Unknown error");
  })
  .finally(async () => {
    await db.$disconnect();
    console.log(`\nLive readiness result: ${failures} failure(s). No orders, withdrawals, emails, or writes were performed.`);
    if (failures) process.exitCode = 1;
  });
