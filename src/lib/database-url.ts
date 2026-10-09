/** Runtime pooling only. Prisma CLI keeps the original direct migration URL. */
export function runtimeDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.hostname === "db.prisma.io") {
    url.hostname = "pooled.db.prisma.io";
    url.searchParams.set("pgbouncer", "true");
  }
  // Supabase transaction poolers do not support prepared statements.
  // Session/direct connections on 5432 retain their normal behavior.
  if (url.port === "6543" && (url.hostname.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname))) {
    url.searchParams.set("pgbouncer", "true");
  }
  // Small per-instance pools prevent serverless bursts exhausting free plans.
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

/** Prefer the connected Supabase integration over a legacy Prisma provider.
 * Explicit local/other-provider DATABASE_URL values keep their precedence.
 * Prisma CLI migrations still receive their explicitly configured direct URL.
 */
export function configuredDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const original = env.DATABASE_URL;
  const candidate = env.POSTGRES_PRISMA_URL;
  if (!candidate) return original;
  try {
    const target = new URL(candidate);
    const source = original ? new URL(original) : null;
    const supabase = target.hostname.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9]+\.supabase\.co$/.test(target.hostname);
    const legacyPrisma = source?.hostname === "db.prisma.io" || source?.hostname === "pooled.db.prisma.io";
    if (supabase && ["postgres:", "postgresql:"].includes(target.protocol) && (!original || legacyPrisma)) return candidate;
  } catch { /* Invalid integration values cannot override a configured database. */ }
  return original;
}
