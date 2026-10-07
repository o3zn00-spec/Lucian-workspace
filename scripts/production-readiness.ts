import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const strict = process.argv.includes("--environment");
let failures = 0;
let warnings = 0;

function result(kind: "PASS" | "WARN" | "FAIL", label: string, detail: string) {
  console.log(`${kind.padEnd(4)}  ${label} — ${detail}`);
  if (kind === "FAIL") failures += 1;
  if (kind === "WARN") warnings += 1;
}

function envCheck(ok: boolean, label: string, detail: string) {
  result(ok ? "PASS" : strict ? "FAIL" : "WARN", label, detail);
}

console.log("\n=== LUCIAN PRODUCTION READINESS ===");
const databaseUrl = process.env.DATABASE_URL || "";
envCheck(/^postgres(ql)?:\/\//.test(databaseUrl) && !/user:pass|YOUR_|host\/db/i.test(databaseUrl), "PostgreSQL", "DATABASE_URL must be a non-placeholder PostgreSQL URL");
envCheck((process.env.AUTH_SECRET || "").length >= 32, "Auth secret", "AUTH_SECRET must contain at least 32 characters");
const ownerEmail = process.env.LUCIAN_OWNER_EMAIL || "";
envCheck(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail) && !/(example|your-domain|lucian\.local)/i.test(ownerEmail), "Owner identity", "LUCIAN_OWNER_EMAIL must be a real deployment email");
const key = process.env.OWNER_CREDENTIALS_ENCRYPTION_KEY || process.env.VAULT_ENCRYPTION_KEY || "";
let validKey = false;
try { validKey = Buffer.from(key, "base64").length === 32; } catch { validKey = false; }
envCheck(validKey, "Credential encryption", "provide one base64-encoded 32-byte encryption key");

const smtpValues = [process.env.SMTP_HOST, process.env.SMTP_USER, process.env.SMTP_PASS];
const smtpAll = smtpValues.every(Boolean);
envCheck(smtpAll, "Recovery email", "SMTP_HOST, SMTP_USER and SMTP_PASS are required for owner recovery");
let validOrigin = false;
try { const origin = new URL(process.env.AUTH_APP_URL || ""); validOrigin = origin.protocol === "https:" && origin.origin === origin.href.replace(/\/$/, ""); } catch { validOrigin = false; }
envCheck(validOrigin, "Recovery origin", "AUTH_APP_URL must be an absolute HTTPS origin without a path");
envCheck(Boolean(process.env.SMTP_FROM) && !/(example\.com|lucian\.local)/i.test(process.env.SMTP_FROM || ""), "Recovery sender", "SMTP_FROM must use a verified non-placeholder sender");

const bybitKey = !!process.env.BYBIT_API_KEY;
const bybitSecret = !!process.env.BYBIT_API_SECRET;
envCheck(bybitKey === bybitSecret, "Bybit credential pair", "BYBIT_API_KEY and BYBIT_API_SECRET must be supplied together");
const liveEnabled = process.env.BYBIT_LIVE_MODE_ENABLED === "true" || process.env.LIVE_TRADING_ENABLED === "true";
envCheck(!liveEnabled || (process.env.BYBIT_LIVE_MODE_ENABLED === "true" && process.env.LIVE_TRADING_ENABLED === "true" && process.env.BYBIT_ENVIRONMENT === "mainnet"), "Live trading locks", "live execution requires both locks and mainnet; verify encrypted database credentials with npm run verify:live");

const migrationsDir = resolve(root, "prisma/migrations");
const migrationDirs = readdirSync(migrationsDir).filter((name) => statSync(resolve(migrationsDir, name)).isDirectory());
const missingMigrationSql = migrationDirs.filter((name) => !existsSync(resolve(migrationsDir, name, "migration.sql")));
result(missingMigrationSql.length === 0 ? "PASS" : "FAIL", "Migration chain", missingMigrationSql.length ? `missing migration.sql: ${missingMigrationSql.join(", ")}` : `${migrationDirs.length} migration directories are complete`);

const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
result(gitignore.includes(".env") && gitignore.includes("/backups") ? "PASS" : "FAIL", "Secret/backup ignores", ".env files and database backups must remain outside source control");
const forbiddenPublic = Object.keys(process.env).filter((name) => name.startsWith("NEXT_PUBLIC_") && /(SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL)/i.test(name));
result(forbiddenPublic.length === 0 ? "PASS" : "FAIL", "Public environment", forbiddenPublic.length ? `secret-like public variables: ${forbiddenPublic.join(", ")}` : "no secret-like NEXT_PUBLIC variables detected");

for (const path of ["app/global-error.tsx", "app/(app)/error.tsx", "scripts/database-maintenance.ts", "scripts/recover-owner.ts"]) {
  result(existsSync(resolve(root, path)) ? "PASS" : "FAIL", path, "required production recovery artifact");
}

console.log(`\nReadiness result: ${failures} failure(s), ${warnings} warning(s).${strict ? " Environment enforcement enabled." : " Use --environment to enforce deployment variables."}`);
if (failures) process.exit(1);
