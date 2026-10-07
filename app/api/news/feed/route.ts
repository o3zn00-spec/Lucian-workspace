import { NextResponse } from "next/server";
import { rssAggregatorProvider } from "@/lib/markets/news-providers";
import type { NewsFilters } from "@/lib/markets/intelligence-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/feed?category=technology&search=bitcoin&page=1
 * Fetches real news from the RSS aggregator (same provider as Markets Feed).
 * Category maps to market category + adds general feeds. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || "for-you";
  const search = url.searchParams.get("search") || "";

  // Map News Feed categories to RSS filter categories.
  const categoryMap: Record<string, string> = {
    "for-you": "all",
    "top-stories": "all",
    world: "all",
    nigeria: "all",
    business: "all",
    markets: "all",
    technology: "crypto",
    crypto: "crypto",
    science: "all",
    entertainment: "all",
    sports: "all",
  };

  const filters: NewsFilters = {
    market: (categoryMap[category] ?? "all") as NewsFilters["market"],
    content: { breaking: true, news: true, analysis: true, economicEvents: false },
    currentInstrumentOnly: false,
    sort: "latest",
  };

  try {
    let items = await rssAggregatorProvider.fetch(filters);

    // Apply search filter if provided.
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.headline.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.symbols.some((s) => s.toLowerCase().includes(q)),
      );
    }

    // For category-specific filtering beyond what RSS provides, do keyword matching.
    if (category !== "for-you" && category !== "top-stories" && category !== "all") {
      const keywordMap: Record<string, string[]> = {
        technology: ["tech", "ai", "software", "app", "google", "microsoft", "apple", "startup"],
        crypto: ["bitcoin", "crypto", "btc", "ethereum", "blockchain", "defi"],
        business: ["business", "company", "startup", "revenue", "market"],
        science: ["science", "research", "study", "space", "physics"],
        entertainment: ["movie", "music", "celebrity", "film", "tv"],
        sports: ["sport", "football", "soccer", "basketball", "nba", "mlb"],
        nigeria: ["nigeria", "nigerian", "lagos", "naira"],
      };
      const keywords = keywordMap[category];
      if (keywords) {
        items = items.filter((i) => {
          const text = (i.headline + " " + i.summary).toLowerCase();
          return keywords.some((k) => text.includes(k));
        });
      }
    }

    // Paginate: first 20 items.
    return NextResponse.json({
      items: items.slice(0, 20),
      hasMore: items.length > 20,
      total: items.length,
    });
  } catch {
    return NextResponse.json({ items: [], hasMore: false, total: 0, error: "Feed unavailable" }, { status: 502 });
  }
}
