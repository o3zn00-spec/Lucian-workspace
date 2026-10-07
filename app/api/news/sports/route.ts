import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/sports
 * Fetches real sports scores from TheSportsDB (free API, key "3" for testing). */
export async function GET() {
  try {
    // Fetch recent events from multiple leagues in parallel.
    const [mlb, nba, epl] = await Promise.all([
      fetch("https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "&l=American_League").catch(() => null),
      fetch("https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "&l=NBA").catch(() => null),
      fetch("https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "&l=English_Premier_League").catch(() => null),
    ]);

    const events: {
      league: string;
      homeTeam: string;
      awayTeam: string;
      homeScore: string;
      awayScore: string;
      status: string;
      time: string;
    }[] = [];

    for (const [res, league] of [[mlb, "MLB"], [nba, "NBA"], [epl, "EPL"]] as const) {
      if (!res || !res.ok) continue;
      const data = await res.json().catch(() => null);
      if (!data?.events) continue;
      for (const e of data.events.slice(0, 4)) {
        events.push({
          league,
          homeTeam: e.strHomeTeam || "—",
          awayTeam: e.strAwayTeam || "—",
          homeScore: e.intHomeScore ?? "—",
          awayScore: e.intAwayScore ?? "—",
          status: e.strStatus?.toLowerCase().includes("ft") || e.strStatus?.toLowerCase().includes("final")
            ? "final"
            : e.strStatus?.toLowerCase().includes("live") || e.strStatus?.toLowerCase().includes("in play")
            ? "live"
            : "scheduled",
          time: e.strTimestamp ? new Date(e.strTimestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "",
        });
      }
    }

    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [], error: "Sports service unavailable" }, { status: 502 });
  }
}
