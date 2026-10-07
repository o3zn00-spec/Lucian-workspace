"use client";

/* eslint-disable react-hooks/set-state-in-effect */

/* LUCIAN — Settings dashboard.
 *
 * Desktop: fixed left nav + scrollable content panel.
 * Mobile: list of sections; selecting one opens that section page.
 * Search: typing filters / jumps to the matching section.
 *
 * The shell reads `selectedSettingsSection` from useSettingsStore so
 * the user's last visited section persists across reloads. The search
 * input reads `settingsSearchQuery` for the same reason.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings as SettingsIcon, Palette, Sparkles, Bell, Code2, ShieldAlert,
  Database, Plug, Accessibility, User, Info, ChevronLeft, Search,
} from "lucide-react";
import { useSettingsStore, type SettingsSectionId } from "@/store/settings";
import { searchSettings, bestSectionForQuery } from "@/lib/settings-search";
import { cn } from "@/lib/utils";
import { GeneralSection } from "@/components/settings/sections/general-section";
import { AppearanceSection } from "@/components/settings/sections/appearance-section";

import { NotificationsSection } from "@/components/settings/sections/notifications-section";
import { DevWorkspaceSection } from "@/components/settings/sections/dev-workspace-section";
import { PrivacySection } from "@/components/settings/sections/privacy-section";
import { DataStorageSection } from "@/components/settings/sections/data-storage-section";
import { ConnectionsSection } from "@/components/settings/sections/connections-section";
import { AccessibilitySection } from "@/components/settings/sections/accessibility-section";
import { AccountSection } from "@/components/settings/sections/account-section";
import { AboutSection } from "@/components/settings/sections/about-section";

interface NavItem {
  id: SettingsSectionId;
  label: string;
  icon: typeof SettingsIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general",         label: "General",            icon: SettingsIcon },
  { id: "appearance",      label: "Appearance",        icon: Palette },
  { id: "notifications",   label: "Notifications",     icon: Bell },
  { id: "dev-workspace",   label: "DevWorkspace",      icon: Code2 },
  { id: "privacy",         label: "Privacy & Security",icon: ShieldAlert },
  { id: "data-storage",    label: "Data & Storage",    icon: Database },
  { id: "connections",     label: "Connections",       icon: Plug },
  { id: "accessibility",   label: "Accessibility & Shortcuts", icon: Accessibility },
  { id: "account",         label: "Account",           icon: User },
  { id: "about",           label: "About & Diagnostics",icon: Info },
];

export function SettingsDashboard() {
  const router = useRouter();
  const selected = useSettingsStore((s) => s.selectedSettingsSection);
  const setSelected = useSettingsStore((s) => s.setSelectedSettingsSection);
  const searchQuery = useSettingsStore((s) => s.settingsSearchQuery);
  const setSearchQuery = useSettingsStore((s) => s.setSettingsSearchQuery);

  const [hydrated, setHydrated] = useState(false);
  // Mobile view state. On initial mobile load, we ALWAYS show the
  // section list — we do NOT auto-jump into the persisted selected
  // section just because desktop selection persisted. The user must
  // explicitly tap a section to enter it. Back returns to the list.
  // Desktop selected-section persistence remains (for the desktop
  // fixed-nav experience).
  const [mobileView, setMobileView] = useState<"list" | "section">("list");
  // Track whether the user has explicitly navigated on mobile. Once
  // they do, we allow `selected` changes to switch the section view.
  const [mobileUserNavigated, setMobileUserNavigated] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Hydration marker — avoids SSR/client mismatch.
  useEffect(() => { setHydrated(true); }, []);

  // On mobile, only switch to the section view when the user explicitly
  // selects a section (via tap or search click). We do NOT auto-switch
  // on hydration even if `selected` is persisted from a prior session.
  useEffect(() => {
    if (hydrated && mobileUserNavigated) setMobileView("section");
  }, [selected, hydrated, mobileUserNavigated]);

  // Cmd/Ctrl + / focuses the search input (Settings keyboard shortcut).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const searchResults = useMemo(() => searchSettings(searchQuery, 12), [searchQuery]);

  function handleSearchEnter() {
    const section = bestSectionForQuery(searchQuery);
    if (section) {
      setSelected(section);
      setMobileUserNavigated(true);
      setMobileView("section");
    }
  }

  function handleSearchClick(section: SettingsSectionId) {
    setSelected(section);
    setSearchQuery("");
    setMobileUserNavigated(true);
    setMobileView("section");
  }

  // ── Mobile list view ──
  if (hydrated && mobileView === "list" && typeof window !== "undefined" && window.innerWidth < 1024) {
    return (
      <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
        <header className="shrink-0 border-b border-line-muted px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-0.5 text-[12px] text-fg-muted">
            Manage LUCIAN preferences, intelligence, privacy and connected services.
          </p>
          <SearchInput
            ref={searchInputRef}
            value={searchQuery}
            onChange={setSearchQuery}
            onEnter={handleSearchEnter}
            hydrated={hydrated}
          />
          {searchResults.length > 0 && (
            <div className="settings-search-results">
              {searchResults.map((r) => (
                <button
                  key={`${r.section}:${r.label}`}
                  className="settings-search-result"
                  onClick={() => handleSearchClick(r.section)}
                >
                  <div className="settings-search-result-label">{r.label}</div>
                  <div className="settings-search-result-section">
                    {sectionLabel(r.section)} › {r.subsection}
                  </div>
                </button>
              ))}
            </div>
          )}
        </header>
        <nav className="themed flex-1 overflow-y-auto px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => { setSelected(item.id); setMobileUserNavigated(true); setMobileView("section"); }}
                className="themed flex w-full items-center justify-between border-b border-line-muted/50 px-3 py-3.5 text-left hover:bg-hover"
              >
                <span className="flex items-center gap-3 text-sm font-medium text-fg">
                  <Icon className="h-4 w-4 text-fg-muted" />
                  {item.label}
                </span>
                <ChevronLeft className="h-4 w-4 rotate-180 text-fg-faint" />
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  // ── Mobile section view ──
  if (hydrated && mobileView === "section" && typeof window !== "undefined" && window.innerWidth < 1024) {
    return (
      <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
        <header className="themed sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-line-muted bg-surface px-3 py-3">
          <button
            onClick={() => { setMobileView("list"); setMobileUserNavigated(false); }}
            className="themed flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-hover hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
            Settings
          </button>
          <h1 className="text-sm font-semibold text-fg">{sectionLabel(selected)}</h1>
        </header>
        <div className="themed flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-5">
            <SectionContent id={selected} onNavigate={setSelected} />
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop view ──
  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      <header className="themed shrink-0 border-b border-line-muted px-5 py-4 sm:px-7">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[12px] text-fg-muted">
          Manage LUCIAN preferences, intelligence, privacy and connected services.
        </p>
        <div className="mt-3">
          <SearchInput
            ref={searchInputRef}
            value={searchQuery}
            onChange={setSearchQuery}
            onEnter={handleSearchEnter}
            hydrated={hydrated}
          />
          {searchResults.length > 0 && (
            <div className="settings-search-results">
              {searchResults.map((r) => (
                <button
                  key={`${r.section}:${r.label}`}
                  className="settings-search-result"
                  onClick={() => handleSearchClick(r.section)}
                >
                  <div className="settings-search-result-label">{r.label}</div>
                  <div className="settings-search-result-section">
                    {sectionLabel(r.section)} › {r.subsection}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="settings-shell">
        <nav className="settings-nav themed">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = selected === item.id;
            return (
              <button
                key={item.id}
                aria-current={active ? "page" : undefined}
                onClick={() => setSelected(item.id)}
                className={cn("settings-nav-btn themed", active && "active")}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="settings-content themed">
          <SectionContent id={selected} onNavigate={setSelected} />
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function sectionLabel(id: SettingsSectionId): string {
  return NAV_ITEMS.find((n) => n.id === id)?.label ?? id;
}

function SectionContent({ id, onNavigate }: { id: SettingsSectionId; onNavigate: (id: SettingsSectionId) => void }) {
  switch (id) {
    case "general":         return <GeneralSection />;
    case "appearance":      return <AppearanceSection />;
    
    case "notifications":   return <NotificationsSection />;
    case "dev-workspace":   return <DevWorkspaceSection />;
    case "privacy":         return <PrivacySection onNavigate={onNavigate} />;
    case "data-storage":    return <DataStorageSection />;
    case "connections":     return <ConnectionsSection />;
    case "accessibility":   return <AccessibilitySection />;
    case "account":         return <AccountSection />;
    case "about":           return <AboutSection />;
    default:                return null;
  }
}

/* ── Search input ── */

import { forwardRef } from "react";

const SearchInput = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; onEnter: () => void; hydrated: boolean }
>(function SearchInput({ value, onChange, onEnter, hydrated }, ref) {
  return (
    <div className="themed relative mt-2">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
      <input
        ref={ref}
        type="text"
        value={hydrated ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }}
        placeholder="Search settings…  (Ctrl/Cmd + /)"
        className="themed w-full rounded-md border border-line-muted bg-surface pl-9 pr-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
      />
    </div>
  );
});
