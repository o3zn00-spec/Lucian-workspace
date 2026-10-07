import { NextResponse } from "next/server";
import { geocodeLocation } from "@/lib/news/weather-locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/geocode?q=Lagos
 *
 * Looks up a free-text location query via Open-Meteo's free geocoding API.
 * Returns the first match (label + lat + lon).
 *
 * Used by the Weather widget's location editor so the user can type any
 * city name — we resolve it server-side and return the coordinates.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q parameter required" }, { status: 400 });
  }
  try {
    const loc = await geocodeLocation(q);
    if (!loc) {
      return NextResponse.json({ error: "No matching location found" }, { status: 404 });
    }
    return NextResponse.json(loc);
  } catch {
    return NextResponse.json({ error: "Geocoding service unavailable" }, { status: 502 });
  }
}
