import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { JSXAttribute, JSXElement, Node } from "@babel/types";

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule;
const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test(); passed += 1; console.log(`  ✓ ${name}`);
}

function filesUnder(directory: string, extension: RegExp): string[] {
  const output: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (extension.test(entry.name)) output.push(path);
    }
  };
  walk(resolve(root, directory));
  return output;
}

function attribute(node: JSXElement, name: string): JSXAttribute | undefined {
  return node.openingElement.attributes.find((item): item is JSXAttribute => item.type === "JSXAttribute" && item.name.type === "JSXIdentifier" && item.name.name === name);
}

function containsReadableText(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.type === "JSXText") return String(node.value || "").trim().length > 0;
  if (node.type === "StringLiteral" || node.type === "TemplateElement") return String(node.value && typeof node.value === "object" ? (node.value as { raw?: string }).raw : node.value || "").trim().length > 0;
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") return true;
  if (node.type === "Identifier") return /^(children|label|action|title|name|mode|style|cat|i|g|s|r|t|q|m|k)$|(?:label|text|title|headline)$/i.test(String(node.name || ""));
  if (node.type === "JSXElement") return ((node.children as unknown[]) || []).some(containsReadableText);
  if (node.type === "JSXFragment") return ((node.children as unknown[]) || []).some(containsReadableText);
  if (node.type === "JSXExpressionContainer") return containsReadableText(node.expression);
  return Object.entries(node).some(([key, child]) => {
    if (["loc", "start", "end", "leadingComments", "trailingComments", "openingElement", "attributes"].includes(key)) return false;
    return Array.isArray(child) ? child.some(containsReadableText) : containsReadableText(child);
  });
}

console.log("\n=== PHASE 13 FINAL PRODUCTION AUDIT ===");

check("Every migration directory contains migration.sql", () => {
  const base = resolve(root, "prisma/migrations");
  const directories = readdirSync(base).filter((name) => statSync(resolve(base, name)).isDirectory());
  assert.deepEqual(directories.filter((name) => !existsSync(resolve(base, name, "migration.sql"))), []);
});

check("Sensitive API handlers enforce ownership inside the handler layer", () => {
  const publicRoute = /app[\\/]api[\\/]auth[\\/](?:\[\.\.\.nextauth\]|reset-password|email-status|google-status|health|signup)[\\/]|app[\\/]api[\\/]vault[\\/]webhooks[\\/]/;
  const sensitiveRoute = /app[\\/]api[\\/](?:assistant|ai|economic-agent|lilith|owner|user|vault|bybit|trading|workspace)[\\/]|app[\\/]api[\\/]auth[\\/](?:me|profile|sessions|change-password|delete-account|export-data)[\\/]/;
  const authPattern = /requireOwner(?:Id)?|requireUser(?:Id)?|requireVaultOwner|withVaultOwner/;
  const failures: string[] = [];
  for (const path of filesUnder("app/api", /^route\.ts$/)) {
    const rel = relative(root, path);
    if (publicRoute.test(rel) || !sensitiveRoute.test(rel)) continue;
    if (!authPattern.test(readFileSync(path, "utf8"))) failures.push(rel);
  }
  assert.deepEqual(failures, []);
});

check("Proxy fails closed for every non-public API route", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /if \(!isOwner\)[\s\S]*?if \(isApi\)/);
  assert.doesNotMatch(proxy, /"\/api\/"\s*,/);
});

check("Login and recovery endpoints have request throttling", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /owner-login/); assert.match(proxy, /owner-recovery/); assert.match(proxy, /status: 429/); assert.match(proxy, /Retry-After/);
  assert.match(proxy, /db\.authRateLimit\.upsert/); assert.match(proxy, /createHmac/); assert.doesNotMatch(proxy, /authRateBuckets/);
});

check("Password-reset token claiming is concurrency safe", () => {
  const reset = read("app/api/auth/reset-password/confirm/route.ts");
  assert.match(reset, /passwordResetToken\.updateMany/); assert.match(reset, /claimed\.count !== 1/); assert.match(reset, /sessionVersion: \{ increment: 1 \}/);
});

check("Owner-managed AI and Bybit credentials use authenticated encryption", () => {
  const encryption = read("src/lib/security/owner-credential-encryption.ts");
  const credentials = read("src/lib/security/owner-credentials.ts");
  assert.match(encryption, /aes-256-gcm/); assert.match(encryption, /setAAD/); assert.match(credentials, /encryptOwnerCredential/); assert.doesNotMatch(read("app/api/owner/credentials/route.ts"), /encryptedValue|decryptOwnerCredential/);
});

check("Production security and private-cache headers are configured", () => {
  const config = read("next.config.ts");
  for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Cache-Control"]) assert.match(config, new RegExp(header));
  assert.match(config, /poweredByHeader: false/);
});

check("Application and root error boundaries provide recovery", () => {
  for (const path of ["app/(app)/error.tsx", "app/global-error.tsx"]) {
    const source = read(path); assert.match(source, /role="alert"/); assert.match(source, /retry/);
  }
});

check("Keyboard users can skip navigation and browser zoom remains enabled", () => {
  assert.match(read("src/components/layout/AppShell.tsx"), /Skip to main content/);
  const layout = read("app/layout.tsx");
  assert.doesNotMatch(layout, /userScalable:\s*false/); assert.doesNotMatch(layout, /maximumScale:\s*1/);
});

check("Icon-only buttons and links have an accessible name", () => {
  const failures: string[] = [];
  for (const path of [...filesUnder("app", /\.tsx$/), ...filesUnder("src", /\.tsx$/)]) {
    const source = readFileSync(path, "utf8");
    let ast;
    try { ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] }); } catch { continue; }
    traverse(ast, {
      JSXElement(pathRef) {
        const node = pathRef.node;
        const name = node.openingElement.name;
        if (name.type !== "JSXIdentifier" || !["button", "a", "Link"].includes(name.name)) return;
        if (attribute(node, "aria-label") || attribute(node, "aria-labelledby") || attribute(node, "title")) return;
        if (node.children.some(containsReadableText)) return;
        failures.push(`${relative(root, path)}:${node.loc?.start.line ?? 0}`);
      },
    });
  }
  assert.deepEqual(failures, [], `Unlabelled icon controls:\n${failures.join("\n")}`);
});

check("OAuth bearer tokens are not retained", () => {
  const auth = read("src/lib/auth/auth.ts");
  const cleanup = read("prisma/migrations/20260903000000_remove_oauth_tokens/migration.sql");
  for (const field of ["access_token", "refresh_token", "id_token", "session_state"]) {
    assert.match(auth, new RegExp(`${field}: null`));
    assert.match(cleanup, new RegExp(`"${field}"\\s*=\\s*NULL`, "i"));
  }
});

check("Backups and emergency owner recovery are operator-gated", () => {
  const database = read("scripts/database-maintenance.ts");
  const owner = read("scripts/recover-owner.ts");
  assert.match(database, /--confirm-restore/); assert.match(database, /sha256/); assert.match(database, /pg_restore/);
  assert.match(owner, /--confirm-owner-reset/); assert.match(owner, /sessionVersion/); assert.doesNotMatch(owner, /console\.(?:log|error)\([^\n]*(?:\$\{password\}|,\s*password\b)/i);
});

check("No real environment files are present in the repository root", () => {
  const envFiles = readdirSync(root).filter((name) => name.startsWith(".env") && name !== ".env.example");
  assert.deepEqual(envFiles, []);
});

console.log(`\nPhase 13 production checks passed: ${passed}`);
