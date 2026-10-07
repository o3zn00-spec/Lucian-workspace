import { NextResponse } from "next/server";
import { rssAggregatorProvider } from "@/lib/markets/news-providers";
import {
  normalizeArticles,
  deriveTrends,
} from "@/lib/news/trending";
import type { NewsFilters } from "@/lib/markets/intelligence-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/trending?max=6
 *
 * Derives trending topics from the REAL article corpus fetched via the
 * same RSS aggregator used by the Discover feed. The algorithm:
 *
 *   score = (articleCount × sourceDiversity × recencyWeight)
 *
 * where sourceDiversity = # of distinct publishers mentioning the trend
 * and recencyWeight is a sum of exponential decays (24h half-life) over
 * each mentioning article.
 *
 * No hardcoded topics. No fake growth percentages. Trends only surface
 * when multiple independent publishers cover the same term within the
 * recency window.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const max = Math.min(parseInt(url.searchParams.get("max") ?? "6", 10) || 6, 12);

  try {
    const filters: NewsFilters = {
      market: "all",
      content: { breaking: true, news: true, analysis: true, economicEvents: false },
      currentInstrumentOnly: false,
      sort: "latest",
    };
    const items = await rssAggregatorProvider.fetch(filters);
    const normalized = normalizeArticles(items);
    const trends = deriveTrends(normalized, { max });
    return NextResponse.json({ trends, generatedAt: Date.now() });
  } catch {
    return NextResponse.json(
      { trends: [], generatedAt: Date.now(), error: "Trending derivation unavailable" },
      { status: 502 },
    );
  }
}
