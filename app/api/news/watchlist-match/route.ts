import { NextResponse } from "next/server";
import { rssAggregatorProvider } from "@/lib/markets/news-providers";
import {
  normalizeArticles,
  matchWatchlistTopic,
} from "@/lib/news/trending";
import type { NewsFilters } from "@/lib/markets/intelligence-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/watchlist-match?topic=Federal+Reserve
 *
 * Returns REAL articles matching a single watchlist topic.
 *
 * Matching rule: case-insensitive phrase match against title + summary.
 * Whitespace/hyphen variants are accepted (so "Federal Reserve" matches
 * "Federal-Reserve"). Word boundaries are enforced (no substring matches
 * inside other words).
 *
 * If no articles match: returns an empty array. The client should show
 * an honest empty state — never fabricate articles to fill a Watchlist.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic")?.trim();
  if (!topic) {
    return NextResponse.json({ error: "topic parameter required" }, { status: 400 });
  }
  try {
    const filters: NewsFilters = {
      market: "all",
      content: { breaking: true, news: true, analysis: true, economicEvents: false },
      currentInstrumentOnly: false,
      sort: "latest",
    };
    const items = await rssAggregatorProvider.fetch(filters);
    const normalized = normalizeArticles(items);
    const matched = matchWatchlistTopic(topic, normalized);
    return NextResponse.json({ items: matched, topic, generatedAt: Date.now() });
  } catch {
    return NextResponse.json(
      { items: [], topic, generatedAt: Date.now(), error: "Watchlist match unavailable" },
      { status: 502 },
    );
  }
}
