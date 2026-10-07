"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import { BrandMark } from "@/components/branding/BrandMark";
import { IconButton } from "@/components/ui/IconButton";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { useSidebar } from "@/components/layout/SidebarContext";
import { useGlobalSearchStore } from "@/store/global-search";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { useNotificationStore } from "@/store/notifications";
import { useSettingsStore } from "@/store/settings";
import { cn } from "@/lib/utils";
import { navigationLabelForPath } from "@/components/layout/navigation";

export function TopNav() {
  const { toggleCollapsed, toggleMobile, collapsed } = useSidebar();
  const pathname = usePathname();
  const crumb = navigationLabelForPath(pathname);

  // Phase 9: the canonical Global Search overlay is mounted at the AppShell
  // level. TopNav only opens it via the shared store — no overlay instance
  // lives here anymore.
  const openSearch = useGlobalSearchStore((s) => s.openWith);
  const setQuery = useGlobalSearchStore((s) => s.setQuery);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  // Select raw notifications array (stable reference) then derive count
  // with useMemo. Calling s.unreadCount() inside the selector creates a new
  // value every render → infinite loop in Zustand 5.
  const notifications = useNotificationStore((s) => s.notifications);
  // Settings: badge visibility. Quiet mode suppresses the badge (per the
  // Settings definition) but keeps notification records intact.
  const showBadge = useSettingsStore((s) => s.notifications.unreadBadge && !s.notifications.quietMode);
  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (n) => !n.dismissed && !n.resolved && !n.read,
      ).length,
    [notifications],
  );

  // Global keyboard shortcuts: / and Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        openSearch();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [openSearch]);

  // Phase 9 wrap-up: listen for "lucian:open-notifications" so Global
  // Search can open the Notification Center + focus an exact record
  // (for notifications without a deepLink). Decouples the search overlay
  // from this component's local notifOpen state.
  useEffect(() => {
    const handler = () => setNotifOpen(true);
    window.addEventListener("lucian:open-notifications", handler);
    return () => window.removeEventListener("lucian:open-notifications", handler);
  }, []);

  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
    setQuery(e.target.value);
    if (e.target.value.trim()) openSearch(e.target.value);
  }, [openSearch, setQuery]);

  return (
    <>
      <header className="themed z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line-muted bg-surface-2/80 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapsed} className="hidden lg:inline-flex" aria-pressed={collapsed}>
            <Menu size={16} />
          </IconButton>
          <IconButton label="Open navigation" onClick={toggleMobile} className="lg:hidden">
            <Menu size={16} />
          </IconButton>
          <Link href="/" aria-label="Lucian home" className="focus-ring themed flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-90">
            <BrandMark size={28} />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden text-sm font-semibold text-fg sm:block">Lucian</span>
            <span className="hidden text-fg-faint sm:block">/</span>
            <h1 className="truncate text-sm font-semibold text-fg">{crumb}</h1>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Compact search (desktop) */}
          <div className="relative hidden md:block">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <input
              type="search"
              value={searchInput}
              onChange={handleSearchInput}
              onFocus={() => searchInput.trim() && openSearch(searchInput)}
              placeholder="Search or jump to…"
              className="focus-ring themed h-8 w-52 rounded-md border border-line bg-inset pl-8 pr-10 text-sm text-fg placeholder:text-fg-faint transition-[width,border-color] duration-200 focus:w-64 lg:w-64 lg:focus:w-80"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-px font-sans text-[10px] leading-4 text-fg-faint lg:block">/</kbd>
          </div>

          {/* Compact search (mobile) */}
          <IconButton label="Search" className="md:hidden" onClick={() => openSearch()}>
            <Search size={16} />
          </IconButton>

          {/* Notifications */}
          <button
            onClick={() => setNotifOpen(v => !v)}
            className="relative flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            aria-label="Notifications"
          >
            <Bell size={16} />
            {showBadge && unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[8px] font-bold text-[var(--accent-fg)]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          <div className="mx-1 hidden h-5 w-px bg-line sm:block" />

          <ProfileMenu />
        </div>
      </header>

      {/* Overlays */}
      {/* Phase 9: GlobalSearchOverlay is mounted at AppShell level.
          TopNav only reads/writes the canonical store. */}
      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  );
}
