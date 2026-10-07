import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Operation = "backup" | "verify" | "restore";

function fail(message: string): never {
  console.error(`[database] ${message}`);
  process.exit(1);
}

function postgresEnvironment(rawUrl: string): NodeJS.ProcessEnv {
  let url: URL;
  try { url = new URL(rawUrl); } catch { fail("DATABASE_URL is not a valid URL."); }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") fail("Only PostgreSQL backups are supported.");
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !dbName) fail("DATABASE_URL must include a host and database name.");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: dbName,
    PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer",
  };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { env, stdio: "inherit", windowsHide: true });
  if (result.error) fail(`${command} could not start. Install PostgreSQL client tools and ensure ${command} is on PATH.`);
  if (result.status !== 0) fail(`${command} exited with status ${result.status ?? "unknown"}.`);
}

function checksum(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const operation = (process.argv[2] || "backup") as Operation;
const rawUrl = operation === "restore" ? (process.env.RESTORE_DATABASE_URL || process.env.DATABASE_URL) : process.env.DATABASE_URL;
if (operation !== "verify" && !rawUrl) fail(operation === "restore" ? "RESTORE_DATABASE_URL or DATABASE_URL is required." : "DATABASE_URL is required.");
const env = rawUrl ? postgresEnvironment(rawUrl) : process.env;

if (operation === "backup") {
  const directory = resolve(process.env.BACKUP_DIR || "backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = resolve(directory, `lucian-${stamp}.dump`);
  run("pg_dump", ["--format=custom", "--compress=9", "--no-owner", "--no-acl", "--file", output], env);
  if (process.platform !== "win32") chmodSync(output, 0o600);
  run("pg_restore", ["--list", output], env);
  const digest = checksum(output);
  writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`[database] Backup created and verified: ${output}`);
  console.log(`[database] SHA-256: ${digest}`);
} else {
  const inputArg = process.argv[3];
  if (!inputArg) fail(`Usage: npm run ${operation === "verify" ? "verify:backup" : "restore:database"} -- <backup.dump>${operation === "restore" ? " --confirm-restore" : ""}`);
  const input = resolve(inputArg);
  if (!existsSync(input)) fail(`Backup file not found: ${input}`);
  const digestPath = `${input}.sha256`;
  if (existsSync(digestPath)) {
    const expected = readFileSync(digestPath, "utf8").trim().split(/\s+/)[0];
    const actual = checksum(input);
    if (expected !== actual) fail("Backup checksum verification failed; restore was not attempted.");
  }
  run("pg_restore", ["--list", input], env);
  if (operation === "verify") {
    console.log(`[database] Backup structure${existsSync(digestPath) ? " and checksum" : ""} verified: ${input}`);
  } else {
    if (!process.argv.includes("--confirm-restore")) fail("Restore refused. Re-run with --confirm-restore after verifying the destination and taking a fresh backup.");
    run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--dbname", env.PGDATABASE || "", input], env);
    console.log(`[database] Restore completed from: ${input}`);
  }
}
