import "server-only";

export type BybitPage<T extends Record<string, unknown> = Record<string, string>> = { list?: T[]; nextPageCursor?: string };

// Only return complete lists. A failed later page must never become usable risk data.
export async function readCompleteBybitList<T extends Record<string, unknown>>(readPage: (cursor?: string) => Promise<BybitPage<T>>, label: string): Promise<BybitPage<T>> {
  const rows: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await readPage(cursor);
    if (!Array.isArray(result.list) || (result.nextPageCursor !== undefined && typeof result.nextPageCursor !== "string")) {
      throw new Error(`${label}: Malformed exchange list; complete records are unavailable.`);
    }
    rows.push(...result.list);
    if (rows.length > 4000) throw new Error(`${label}: Complete records exceed the bounded read limit.`);
    const next = result.nextPageCursor;
    if (!next) return { list: rows, nextPageCursor: "" };
    if (cursors.has(next)) throw new Error(`${label}: Exchange repeated a page cursor; complete records are unavailable.`);
    cursors.add(next);
    cursor = next;
  }
  throw new Error(`${label}: Complete records exceed the bounded page limit.`);
}
