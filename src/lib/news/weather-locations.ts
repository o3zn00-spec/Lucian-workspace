// LUCIAN News — Weather location catalog.
//
// A small curated set of well-known cities with their lat/lon. This is the
// data source for the Weather location dropdown — the user picks from this
// list (or types a custom query, which we geocode via the Open-Meteo
// geocoding API).
//
// We deliberately keep the list small + curated: every entry is a major
// world city. The user is NOT restricted to this list — typing a custom
// query goes through `geocodeLocation()` which hits Open-Meteo's free
// geocoding API.

export interface CatalogLocation {
  label: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

/** Curated quick-pick locations. */
export const WEATHER_LOCATION_CATALOG: CatalogLocation[] = [
  { label: "Lagos, Nigeria", city: "Lagos", country: "Nigeria", lat: 6.5244, lon: 3.3792 },
  { label: "Abuja, Nigeria", city: "Abuja", country: "Nigeria", lat: 9.0765, lon: 7.3986 },
  { label: "New York, USA", city: "New York", country: "USA", lat: 40.7128, lon: -74.006 },
  { label: "London, UK", city: "London", country: "UK", lat: 51.5074, lon: -0.1278 },
  { label: "Tokyo, Japan", city: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
  { label: "Paris, France", city: "Paris", country: "France", lat: 48.8566, lon: 2.3522 },
  { label: "Berlin, Germany", city: "Berlin", country: "Germany", lat: 52.52, lon: 13.405 },
  { label: "Dubai, UAE", city: "Dubai", country: "UAE", lat: 25.2048, lon: 55.2708 },
  { label: "Singapore", city: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198 },
  { label: "Sydney, Australia", city: "Sydney", country: "Australia", lat: -33.8688, lon: 151.2093 },
  { label: "Johannesburg, South Africa", city: "Johannesburg", country: "South Africa", lat: -26.2041, lon: 28.0473 },
  { label: "Nairobi, Kenya", city: "Nairobi", country: "Kenya", lat: -1.2921, lon: 36.8219 },
  { label: "Cairo, Egypt", city: "Cairo", country: "Egypt", lat: 30.0444, lon: 31.2357 },
  { label: "Mumbai, India", city: "Mumbai", country: "India", lat: 19.076, lon: 72.8777 },
  { label: "Hong Kong", city: "Hong Kong", country: "China", lat: 22.3193, lon: 114.1694 },
  { label: "Toronto, Canada", city: "Toronto", country: "Canada", lat: 43.6532, lon: -79.3832 },
];

/**
 * Geocode a free-text query via Open-Meteo's free geocoding API.
 *
 * Returns the first match (most populous usually). Returns null on
 * failure or no match.
 *
 * Server-side friendly: the caller decides whether to call from server
 * (server route) or client (server-side fetch). Open-Meteo allows CORS
 * from browsers, so client-side is fine here.
 */
export async function geocodeLocation(query: string): Promise<CatalogLocation | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
    const res = await fetch(url, {
      // Open-Meteo's geocoding API is free + public. We cache for 1h to
      // avoid hammering the service. `cache: 'no-store'` is also fine here
      // — the same query is unlikely to be repeated within a session.
      cache: "no-store" as RequestCache,
      headers: {
        "User-Agent": "LUCIAN-NewsBot/1.0 (+https://lucian.app)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[geocode] Open-Meteo returned ${res.status} for "${q}"`);
      return null;
    }
    const data = await res.json();
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
      console.warn(`[geocode] Open-Meteo returned no results for "${q}"`);
      return null;
    }
    const r = data.results[0];
    return {
      label: `${r.name}${r.admin1 ? ", " + r.admin1 : ""}, ${r.country ?? ""}`.trim(),
      city: r.name,
      country: r.country ?? "",
      lat: r.latitude,
      lon: r.longitude,
    };
  } catch {
    return null;
  }
}
