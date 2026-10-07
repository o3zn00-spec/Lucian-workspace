"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSettingsStore } from "@/store/settings";

const SIDEBAR_STORAGE_KEY = "lucian-sidebar-collapsed";

interface SidebarContextValue {
  /** True when the desktop sidebar is collapsed to the icon rail. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (next: boolean) => void;
  /** True when the mobile drawer is open. */
  mobileOpen: boolean;
  setMobileOpen: (next: boolean) => void;
  toggleMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* Sidebar collapsed state as an external store (useSyncExternalStore) */
/* ------------------------------------------------------------------ */

const sidebarListeners = new Set<() => void>();

function subscribeSidebar(cb: () => void): () => void {
  sidebarListeners.add(cb);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onSidebarStorageEvent);
  }
  return () => {
    sidebarListeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onSidebarStorageEvent);
    }
  };
}

function onSidebarStorageEvent(event: StorageEvent) {
  if (event.key === SIDEBAR_STORAGE_KEY) {
    sidebarListeners.forEach((cb) => cb());
  }
}

function notifySidebarListeners() {
  sidebarListeners.forEach((cb) => cb());
}

function getCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  // Settings → General → Navigation → rememberSidebarCollapsed.
  // When OFF, the sidebar always starts expanded — we ignore the
  // persisted value. When ON (default), we read from localStorage.
  try {
    const settings = useSettingsStore.getState();
    if (!settings.general.navigation.rememberSidebarCollapsed) {
      return false;
    }
  } catch {
    /* settings store not available — fall through to localStorage read */
  }
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

function getServerCollapsedSnapshot(): boolean {
  return false;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // `collapsed` is persisted to localStorage and synced across tabs via
  // useSyncExternalStore. This avoids setState-in-effect lint warnings
  // and gives us cross-tab sync for free. The snapshot function consults
  // the Settings store's rememberSidebarCollapsed flag.
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getCollapsedSnapshot,
    getServerCollapsedSnapshot
  );

  // Subscribe to the rememberSidebarCollapsed setting so the sidebar
  // re-renders immediately when the user toggles it in Settings. Without
  // this, the sidebar would only update on the next storage event.
  const rememberSidebarCollapsed = useSettingsStore(
    (s) => s.general.navigation.rememberSidebarCollapsed
  );

  // `mobileOpen` is ephemeral — drawer open state is per-tab, not persisted.
  const [mobileOpen, setMobileOpen] = useState(false);

  const setCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
    notifySidebarListeners();
  }, []);

  const toggleCollapsed = useCallback(() => {
    const current = getCollapsedSnapshot();
    const next = !current;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
    notifySidebarListeners();
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((v) => !v);
  }, []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      collapsed,
      toggleCollapsed,
      setCollapsed,
      mobileOpen,
      setMobileOpen,
      toggleMobile,
    }),
    // `collapsed` already reflects the rememberSidebarCollapsed setting
    // because getCollapsedSnapshot() consults the settings store. We
    // subscribe to rememberSidebarCollapsed above so the component re-
    // renders when it changes; the memo recomputes because `collapsed`
    // changes value.
    [collapsed, toggleCollapsed, setCollapsed, mobileOpen, toggleMobile]
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}
