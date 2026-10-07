"use client";

/* LUCIAN News — Weather location store.
 *
 * Lets the user pick a manual weather location (no geolocation required).
 * The lat/lon is stored alongside the label so the Weather widget can pass
 * them directly to /api/news/weather without re-resolving the label.
 *
 * Persistence: localStorage via zustand persist.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface WeatherLocation {
  /** Display label — "Lagos, Nigeria" or "New York, USA". */
  label: string;
  /** Latitude. */
  lat: number;
  /** Longitude. */
  lon: number;
}

interface NewsWeatherState {
  /** The user's selected weather location. Defaults to Lagos (legacy). */
  location: WeatherLocation;
  /** Update the weather location. Persisted automatically. */
  setLocation: (loc: WeatherLocation) => void;
}

const DEFAULT_LOCATION: WeatherLocation = {
  label: "Lagos, Nigeria",
  lat: 6.5244,
  lon: 3.3792,
};

export const useNewsWeatherStore = create<NewsWeatherState>()(
  persist(
    (set) => ({
      location: DEFAULT_LOCATION,
      setLocation: (loc) => set({ location: loc }),
    }),
    {
      name: "lucian-news-weather",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
    },
  ),
);
