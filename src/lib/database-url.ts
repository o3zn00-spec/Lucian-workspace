/** Runtime pooling only. Prisma CLI keeps the original direct migration URL. */
export function runtimeDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.hostname === "db.prisma.io") {
    url.hostname = "pooled.db.prisma.io";
    url.searchParams.set("pgbouncer", "true");
  }
  // Small per-instance pools prevent serverless bursts exhausting free plans.
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  return url.toString();
}
