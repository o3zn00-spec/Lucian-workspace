import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/weather?lat=6.5244&lon=3.3792
 *
 * Fetches real weather from Open-Meteo (free, no API key required).
 *
 * The Weather widget stores the user's selected location (label + lat +
 * lon) in localStorage via `useNewsWeatherStore` and passes only the
 * coordinates here. The label is purely for display — we never re-resolve
 * it on the server side.
 *
 * If the provider returns an error (network down, invalid coordinates,
 * rate-limited), we return HTTP 502 with an honest error message —
 * never fake temperature/condition values.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

  // Validate coordinate ranges — Open-Meteo accepts -90..90 / -180..180.
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }
  if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return NextResponse.json({ error: "Coordinates out of range" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latNum}&longitude=${lonNum}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5`,
      { next: { revalidate: 600 } }, // 10 minute server-side cache
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Weather service unavailable" },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch weather" },
      { status: 502 },
    );
  }
}
