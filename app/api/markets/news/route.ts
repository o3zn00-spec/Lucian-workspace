import { NextResponse } from "next/server";
import type { NewsFilters } from "@/lib/markets/intelligence-types";
import { rssAggregatorProvider } from "@/lib/markets/news-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/markets/news
 *
 * Fetches real market news from the configured RSS aggregator.
 * Query params mirror NewsFilters:
 *   - market: "all" | "forex" | "crypto" | "stocks" | "indices" | "metals" | "energy"
 *   - content.breaking: "true" | "false"
 *   - content.news: "true" | "false"
 *   - content.analysis: "true" | "false"
 *   - content.economicEvents: "true" | "false"
 *   - currentInstrumentOnly: "true" | "false"
 *   - sort: "latest"
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;

  const filters: NewsFilters = {
    market: (params.get("market") as NewsFilters["market"]) ?? "all",
    content: {
      breaking: params.get("breaking") !== "false",
      news: params.get("news") !== "false",
      analysis: params.get("analysis") !== "false",
      economicEvents: params.get("economicEvents") !== "false",
    },
    currentInstrumentOnly: params.get("currentInstrumentOnly") === "true",
    sort: "latest",
  };

  try {
    const items = await rssAggregatorProvider.fetch(filters);
    return NextResponse.json({
      provider: {
        id: rssAggregatorProvider.id,
        label: rssAggregatorProvider.label,
        configured: rssAggregatorProvider.configured,
      },
      items,
      count: items.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "feed_unavailable",
        message:
          err instanceof Error ? err.message : "Failed to fetch market news.",
        provider: {
          id: rssAggregatorProvider.id,
          label: rssAggregatorProvider.label,
          configured: rssAggregatorProvider.configured,
        },
        items: [],
        count: 0,
      },
      { status: 502 },
    );
  }
}
