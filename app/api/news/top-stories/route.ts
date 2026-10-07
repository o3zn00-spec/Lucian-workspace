import { NextResponse } from "next/server";
import { rssAggregatorProvider } from "@/lib/markets/news-providers";
import {
  normalizeArticles,
  deriveTopStories,
} from "@/lib/news/trending";
import type { NewsFilters } from "@/lib/markets/intelligence-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/top-stories?max=5
 *
 * Derives Top Stories from the REAL article corpus. The ranking uses:
 *
 *   score = recencyWeight × sourceDiversity × (isBreaking ? 1.5 : 1.0)
 *
 * Stories are deduplicated by canonical URL + normalized title slug before
 * ranking so a wire story published by 5 different outlets only surfaces
 * once. The original article (highest-ranked deduplicated instance) is
 * the one we return.
 *
 * No fake views, no fake read counts, no fake "prominence" numbers.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const max = Math.min(parseInt(url.searchParams.get("max") ?? "5", 10) || 5, 10);

  try {
    const filters: NewsFilters = {
      market: "all",
      content: { breaking: true, news: true, analysis: true, economicEvents: false },
      currentInstrumentOnly: false,
      sort: "latest",
    };
    const items = await rssAggregatorProvider.fetch(filters);
    const normalized = normalizeArticles(items);
    const top = deriveTopStories(normalized, { max });
    return NextResponse.json({ items: top, generatedAt: Date.now() });
  } catch {
    return NextResponse.json(
      { items: [], generatedAt: Date.now(), error: "Top stories derivation unavailable" },
      { status: 502 },
    );
  }
}
