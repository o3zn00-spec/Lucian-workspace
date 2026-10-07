"use client";

// LUCIAN Browser — Phase 15.
//
// Honest web-browser shell within normal browser-security limits.
//
// What works:
//   - tabs (create / switch / close / restore-active / persist after reload)
//   - per-tab LUCIAN-controlled history (back / forward / refresh)
//   - bookmarks (add / remove / open / persist)
//   - history panel (LUCIAN-known navigations only)
//   - address normalization (example.com → https://example.com)
//   - search-provider URL construction
//   - unsafe-scheme rejection (javascript: / data: / file: / blob:)
//   - SSRF-safe server-side embed-policy check (cached 15min)
//   - honest blocked-state UX with "Open Externally" + "Copy Address"
//   - Web vs Desktop capability info panel
//
// What does NOT work (honestly):
//   - bypassing X-Frame-Options / CSP frame-ancestors
//   - reading cross-origin iframe DOM (titles, links, navigation)
//   - authenticated third-party sites (Google, banking, GitHub, etc.)
//
// The unrestricted embedded browser experience is reserved for a
// future LUCIAN Desktop / Electron build — explicitly NOT in Phase 15.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, RotateCw, Plus, X, Star, StarOff,
  Search, Globe, ExternalLink, Home, Clock, Info, Copy, Check,
  ShieldAlert, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  useBrowserStore,
  selectActiveTab,
  type BrowserTab,
  type BrowserBookmark,
  type BrowserHistoryEntry,
  type TabLoadState,
  type EmbedPolicy,
} from "@/store/browser";
import {
  normalizeUrl,
  isUnsafeScheme,
  hostnameForDisplay,
  UnsafeAddressError,
} from "@/lib/browser/url";
import {
  BROWSER_CAPABILITY_MATRIX,
  WEB_CAN_DO,
  WEB_CANNOT_DO,
  DESKTOP_FUTURE,
} from "@/lib/browser/capabilities";
import { getCachedPolicy, setCachedPolicy } from "@/lib/browser/embed-cache";

export default function BrowserPage() {
  return (
    <Suspense fallback={null}>
      <BrowserInner />
    </Suspense>
  );
}

// ── Main Browser component ────────────────────────────────────────────────

function BrowserInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs = useBrowserStore((s) => s.tabs);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const bookmarks = useBrowserStore((s) => s.bookmarks);
  const history = useBrowserStore((s) => s.history);
  const newTab = useBrowserStore((s) => s.newTab);
  const closeTab = useBrowserStore((s) => s.closeTab);
  const setActiveTab = useBrowserStore((s) => s.setActiveTab);
  const navigateActive = useBrowserStore((s) => s.navigateActive);
  const goBack = useBrowserStore((s) => s.goBack);
  const goForward = useBrowserStore((s) => s.goForward);
  const reloadActive = useBrowserStore((s) => s.reloadActive);
  const setTabLoadState = useBrowserStore((s) => s.setTabLoadState);
  const setTabEmbedPolicy = useBrowserStore((s) => s.setTabEmbedPolicy);
  const addBookmark = useBrowserStore((s) => s.addBookmark);
  const removeBookmarkByUrl = useBrowserStore((s) => s.removeBookmarkByUrl);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Address-bar input is LOCAL state — we don't want it to bounce back
  // to the tab's URL on every keystroke. We sync it when the active tab
  // changes or when navigation completes.
  const [addressInput, setAddressInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // Sync address input when the active tab changes.
  // Defer setState to a microtask to avoid synchronous setState in the
  // effect body (React 19 set-state-in-effect rule).
  useEffect(() => {
    if (!activeTab) return;
    const displayed = activeTab.requestedUrl.replace(/^https?:\/\//, "");
    const id = window.setTimeout(() => setAddressInput(displayed), 0);
    return () => window.clearTimeout(id);
  }, [activeTabId, activeTab]);

  // ── Phase 9 + 15: deep-link handling ───────────────────────────────────
  // We read ?url=<URL> directly in this component (not via a separate
  // receiver + CustomEvent). This fixes a timing bug where the event
  // fired before the listener was registered. The `consumedRef` prevents
  // re-processing on re-render.
  const consumedRef = useRef<string | null>(null);
  useEffect(() => {
    const raw = searchParams.get("url");
    if (!raw) return;
    if (consumedRef.current === raw) return;

    // Reject unsafe schemes BEFORE navigating. The store also validates,
    // but we double-check here so a malicious payload never even fires.
    if (isUnsafeScheme(raw)) {
      toast({
        title: "Unsupported address",
        description: "LUCIAN Browser only allows http and https URLs.",
        variant: "destructive",
      });
      const next = new URLSearchParams(searchParams.toString());
      next.delete("url");
      const qs = next.toString();
      router.replace(qs ? `/browser?${qs}` : "/browser");
      consumedRef.current = raw;
      return;
    }

    let normalized: string;
    try {
      normalized = normalizeUrl(raw);
    } catch {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("url");
      const qs = next.toString();
      router.replace(qs ? `/browser?${qs}` : "/browser");
      consumedRef.current = raw;
      return;
    }
    if (!normalized) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("url");
      const qs = next.toString();
      router.replace(qs ? `/browser?${qs}` : "/browser");
      consumedRef.current = raw;
      return;
    }

    consumedRef.current = raw;
    const result = navigateActive(normalized);
    if (!result.ok) {
      toast({ title: "Unsupported address", description: result.error, variant: "destructive" });
    }
    // Always strip the ?url= param so a refresh doesn't re-trigger it.
    // We defer this to the next event loop tick because the Next.js
    // router may not be fully hydrated when the effect first fires on
    // a full page load. Using window.history.replaceState directly is
    // more reliable than router.replace in this context.
    if (typeof window !== "undefined" && window.location.search.includes("url=")) {
      // Defer to the next event loop tick — the Next.js router may not
      // be fully hydrated when the effect first fires on a full page load.
      // We use window.history.replaceState ONLY (not router.replace)
      // because router.replace can override the replaceState change.
      setTimeout(() => {
        try {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("url");
          const newPath = cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : "");
          window.history.replaceState(null, "", newPath);
        } catch {
          // replaceState failed — non-critical, the deep-link still works.
        }
      }, 100);
    }
  }, [searchParams, navigateActive, router]);

  // ── Embed-policy check on navigation ────────────────────────────────────
  // When the active tab's requestedUrl changes, fire the embed-policy
  // check (cached). If it returns "blocked", the store marks the tab
  // blocked-by-policy. We don't block iframe rendering preemptively —
  // we let the iframe try to load, and if the policy says blocked OR
  // the iframe onLoad fires with no content, we show the blocked state.
  //
  // SAME-ORIGIN SKIP: if the URL's origin matches LUCIAN's origin, we
  // skip the check entirely — same-origin iframes can always be embedded
  // (no XFO/CSP issue). This also avoids hitting the SSRF guard on
  // localhost, which is correct for the LUCIAN-served test pages.
  useEffect(() => {
    if (!activeTab) return;
    const url = activeTab.requestedUrl;
    if (!url) return;
    if (activeTab.loadState === "blocked-by-policy") return;
    // Don't re-check if we already have a policy for this URL.
    if (activeTab.embedPolicy.state !== "not-checked") return;

    // Same-origin URLs: skip the policy check — same-origin iframes
    // always work (browser allows same-origin embedding regardless of
    // XFO/CSP). This is per spec section 24: "Same-origin content may
    // support richer behavior because normal origin rules permit it."
    try {
      const targetOrigin = new URL(url).origin;
      if (typeof window !== "undefined" && targetOrigin === window.location.origin) {
        const sameOriginPolicy: EmbedPolicy = {
          state: "potentially-embeddable",
          reason: "Same-origin — embedding permitted by browser policy.",
        };
        setCachedPolicy(url, sameOriginPolicy);
        setTabEmbedPolicy(activeTab.id, sameOriginPolicy);
        return;
      }
    } catch {
      // URL parse failed — fall through to the server-side check.
    }

    // Check cache first.
    const cached = getCachedPolicy(url);
    if (cached) {
      setTabEmbedPolicy(activeTab.id, cached);
      return;
    }
    // Fire the server-side check.
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch(`/api/browser/embed-policy?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((policy: EmbedPolicy) => {
        if (cancelled) return;
        setCachedPolicy(url, policy);
        setTabEmbedPolicy(activeTab.id, policy);
      })
      .catch(() => {
        if (cancelled) return;
        // Network/timeout error → mark as unknown (don't claim blocked).
        const unknown: EmbedPolicy = { state: "unknown", reason: "Policy check failed" };
        setCachedPolicy(url, unknown);
        setTabEmbedPolicy(activeTab.id, unknown);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [activeTab?.id, activeTab?.requestedUrl, activeTab?.loadState, activeTab?.embedPolicy.state, setTabEmbedPolicy]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation handlers ─────────────────────────────────────────────────
  const handleNavigate = useCallback(() => {
    const result = navigateActive(addressInput);
    if (!result.ok) {
      toast({ title: "Unsupported address", description: result.error, variant: "destructive" });
    }
  }, [addressInput, navigateActive]);

  const canGoBack = !!activeTab && activeTab.historyIndex > 0;
  const canGoForward = !!activeTab && activeTab.historyIndex < activeTab.history.length - 1;

  const handleBookmarkToggle = useCallback(() => {
    if (!activeTab?.requestedUrl) return;
    const url = activeTab.requestedUrl;
    if (bookmarks.some((b) => b.url === url)) {
      removeBookmarkByUrl(url);
      toast({ title: "Bookmark removed" });
    } else {
      addBookmark(url, activeTab.label);
      toast({ title: "Bookmarked", description: activeTab.label });
    }
  }, [activeTab, bookmarks, addBookmark, removeBookmarkByUrl]);

  const isCurrentBookmarked = activeTab?.requestedUrl
    ? bookmarks.some((b) => b.url === activeTab.requestedUrl)
    : false;

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-line-muted px-3 py-2">
        <div className="flex items-center gap-1">
          <button onClick={goBack} disabled={!canGoBack} title="Back"
            className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={goForward} disabled={!canGoForward} title="Forward"
            className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">
            <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={reloadActive} disabled={!activeTab?.requestedUrl} title="Refresh"
            className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">
            <RotateCw className="h-4 w-4" />
          </button>
          {/* Address bar */}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
            <input
              value={addressInput}
              onChange={e => setAddressInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleNavigate()}
              placeholder="Search or enter web address..."
              spellCheck={false}
              className="w-full rounded-full border border-line bg-surface py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
          <button onClick={handleBookmarkToggle} disabled={!activeTab?.requestedUrl} title="Bookmark"
            className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">
            {isCurrentBookmarked ? <Star className="h-4 w-4 text-amber-400" /> : <StarOff className="h-4 w-4" />}
          </button>
          <button onClick={() => setShowBookmarks(v => !v)} title="Bookmarks & History"
            className={cn("rounded p-1.5 hover:bg-hover", showBookmarks ? "text-fg" : "text-fg-muted hover:text-fg")}>
            <Clock className="h-4 w-4" />
          </button>
          <button onClick={() => setShowInfo(true)} title="About LUCIAN Browser"
            className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg">
            <Info className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex items-center gap-0.5 border-b border-line-muted px-2 py-1 overflow-x-auto">
        {tabs.map(tab => (
          <TabChip
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onClick={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
        <button onClick={() => newTab()} title="New tab"
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-hidden bg-surface relative">
        {!activeTab?.requestedUrl ? (
          <NewTabPage
            bookmarks={bookmarks}
            history={history}
            onNavigate={(input) => {
              const r = navigateActive(input);
              if (!r.ok) toast({ title: "Unsupported address", description: r.error, variant: "destructive" });
            }}
          />
        ) : (
          <TabContent
            tab={activeTab}
            onLoadStateChange={(state) => setTabLoadState(activeTab.id, state)}
          />
        )}
      </div>

      {/* Bookmarks + History dropdown */}
      {showBookmarks && (
        <BookmarksHistoryPanel
          bookmarks={bookmarks}
          history={history}
          onNavigate={(input) => {
            const r = navigateActive(input);
            if (!r.ok) toast({ title: "Unsupported address", description: r.error, variant: "destructive" });
            setShowBookmarks(false);
          }}
          onRemoveBookmark={(id) => useBrowserStore.getState().removeBookmark(id)}
          onRemoveHistory={(url) => useBrowserStore.getState().removeHistoryEntry(url)}
          onClearHistory={() => useBrowserStore.getState().clearHistory()}
          onClose={() => setShowBookmarks(false)}
        />
      )}

      {/* Info panel */}
      {showInfo && (
        <BrowserInfoPanel onClose={() => setShowInfo(false)} />
      )}
    </div>
  );
}

// ── Tab chip ──────────────────────────────────────────────────────────────

function TabChip({ tab, active, onClick, onClose }: {
  tab: BrowserTab;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] max-w-[180px] transition-colors",
        active ? "bg-surface text-fg ring-1 ring-inset ring-line" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {tab.loadState === "loading" && <Loader2 className="h-3 w-3 animate-spin text-[var(--accent)]" />}
      {tab.loadState === "blocked-by-policy" && <ShieldAlert className="h-3 w-3 text-amber-500" />}
      {tab.loadState === "failed" && <ShieldAlert className="h-3 w-3 text-red-500" />}
      <span className="truncate">{tab.label || "New Tab"}</span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onClose(); } }}
        className="rounded p-0.5 hover:bg-hover"
      >
        <X className="h-2.5 w-2.5" />
      </span>
    </button>
  );
}

// ── Tab content (iframe + blocked/unsafe states) ──────────────────────────

function TabContent({ tab, onLoadStateChange }: {
  tab: BrowserTab;
  onLoadStateChange: (state: TabLoadState) => void;
}) {
  // We use a `key` on the iframe so Reload / navigation re-mounts it
  // cleanly. The iframe's src is the tab's requestedUrl.
  //
  // SANDBOX POLICY (Phase 15 audit):
  //   - allow-scripts: needed for sites that rely on JS (most modern sites)
  //   - allow-same-origin: needed so the iframe can access its own
  //     cookies/storage (e.g. for theme persistence). Without this, sites
  //     break in confusing ways.
  //   - allow-forms: needed for search boxes / login forms to submit.
  //   - allow-popups: allows links with target="_blank" to work.
  //   - allow-popups-to-escape-sandbox: lets opened popups run without
  //     the sandbox restrictions (so a user-clicked link opens normally).
  //   - allow-downloads: allows download links to trigger the browser's
  //     native download — no LUCIAN-side proxy.
  //
  // NOT granted:
  //   - allow-top-navigation: embedded sites CANNOT navigate LUCIAN's
  //     top-level window. Only the LUCIAN address bar can.
  //   - allow-top-navigation-by-user-activation: even with a user click,
  //     we don't let embedded sites take over the top window. The user
  //     must use "Open Externally" if they want to leave LUCIAN.
  const sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";

  // Handle iframe load — be conservative about what "loaded" means.
  // For cross-origin iframes, onLoad fires even when the browser
  // refused to render (XFO/CSP). We can't reliably distinguish "rendered"
  // from "blocked but onLoad fired". So:
  //   - if embedPolicy says "blocked" → show blocked state (the store
  //     already set loadState to "blocked-by-policy")
  //   - if onLoad fires AND policy says "potentially-embeddable" or
  //     "unknown" → mark as "embedded" (optimistic — if it didn't
  //     actually render, the user will see a blank iframe; we can't
  //     detect that without cross-origin DOM access, which we refuse)
  const handleIframeLoad = useCallback(() => {
    // Only update if not already blocked by policy.
    if (tab.loadState === "blocked-by-policy") return;
    // Optimistically mark as embedded. The user will see content if the
    // site rendered, or a blank iframe if it didn't (we can't tell).
    onLoadStateChange("embedded");
  }, [tab.loadState, onLoadStateChange]);

  // If the tab is blocked by policy, show the blocked state.
  if (tab.loadState === "blocked-by-policy" || tab.loadState === "failed") {
    return <BlockedPage url={tab.requestedUrl} policy={tab.embedPolicy} />;
  }
  if (tab.loadState === "unsafe") {
    return <UnsafeAddressPage />;
  }

  return (
    <div className="relative h-full w-full">
      <iframe
        key={`${tab.id}-${tab.historyIndex}`}
        src={tab.requestedUrl}
        onLoad={handleIframeLoad}
        onError={() => onLoadStateChange("failed")}
        className="h-full w-full border-0"
        title={tab.label}
        sandbox={sandbox}
        referrerPolicy="no-referrer-when-downgrade"
      />
      {tab.loadState === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/50">
          <div className="flex items-center gap-2 text-[12px] text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        </div>
      )}
    </div>
  );
}

// ── Blocked page (honest state) ───────────────────────────────────────────

function BlockedPage({ url, policy }: { url: string; policy: EmbedPolicy }) {
  const hostname = hostnameForDisplay(url);
  const [copied, setCopied] = useState(false);

  const handleOpenExternally = useCallback(() => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      toast({ title: "Popup blocked", description: "Allow popups for LUCIAN to open this site externally.", variant: "destructive" });
    }
  }, [url]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Address copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Clipboard unavailable", description: "Copy this address manually: " + url, variant: "destructive" });
    }
  }, [url]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <ShieldAlert className="h-10 w-10 text-amber-500 opacity-70" />
      <p className="mt-3 text-[14px] font-medium text-fg">
        This site can&apos;t be displayed inside LUCIAN Web Browser.
      </p>
      <p className="mt-1 max-w-md text-[12px] text-fg-muted">
        <strong>{hostname}</strong> prevents third-party embedding or requires browser
        capabilities unavailable in the web version.
      </p>

      {policy.state === "blocked" && policy.reason && (
        <details className="mt-3 max-w-md">
          <summary className="cursor-pointer text-[11px] text-fg-faint hover:text-fg-muted">Why?</summary>
          <p className="mt-1 rounded-md border border-line-muted bg-inset p-2 text-left text-[10px] text-fg-muted">
            {policy.reason}
            {policy.xFrameOptions && <><br />X-Frame-Options: <code>{policy.xFrameOptions}</code></>}
            {policy.contentSecurityPolicy && <><br />Content-Security-Policy: <code>{policy.contentSecurityPolicy}</code></>}
          </p>
        </details>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={handleOpenExternally}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open externally
        </button>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] text-fg-muted hover:text-fg"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>
    </div>
  );
}

// ── Unsafe address page ──────────────────────────────────────────────────

function UnsafeAddressPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <ShieldAlert className="h-10 w-10 text-red-500 opacity-70" />
      <p className="mt-3 text-[14px] font-medium text-fg">Unsupported address</p>
      <p className="mt-1 max-w-md text-[12px] text-fg-muted">
        LUCIAN Browser only allows <code>http:</code> and <code>https:</code> URLs.
        Schemes like <code>javascript:</code>, <code>data:</code>, <code>file:</code>,
        and <code>blob:</code> are blocked for security.
      </p>
    </div>
  );
}

// ── New tab page ─────────────────────────────────────────────────────────

function NewTabPage({ bookmarks, history, onNavigate }: {
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];
  onNavigate: (input: string) => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Globe className="mx-auto h-8 w-8 text-[var(--accent)] opacity-50" />
          <p className="mt-2 text-[14px] font-medium text-fg-muted">Search the web</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search && onNavigate(search)}
            placeholder="Search or enter address..."
            spellCheck={false}
            className="w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-3 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        {history.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-fg-faint">Recent</p>
            <div className="flex flex-wrap gap-2">
              {history.slice(0, 4).map((h, i) => (
                <button key={i} onClick={() => onNavigate(h.url)}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] text-fg-muted hover:text-fg">
                  {h.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {bookmarks.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-fg-faint">Favorites</p>
            <div className="flex flex-wrap gap-2">
              {bookmarks.slice(0, 8).map(b => (
                <button key={b.id} onClick={() => onNavigate(b.url)}
                  className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] text-fg-muted hover:text-fg">
                  <Star className="h-3 w-3 text-amber-400" /> {b.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bookmarks + History panel ────────────────────────────────────────────

function BookmarksHistoryPanel({ bookmarks, history, onNavigate, onRemoveBookmark, onRemoveHistory, onClearHistory, onClose }: {
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];
  onNavigate: (input: string) => void;
  onRemoveBookmark: (id: string) => void;
  onRemoveHistory: (url: string) => void;
  onClearHistory: () => void;
  onClose: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-4 top-12 z-40 w-80 overflow-hidden rounded-md border border-line bg-overlay shadow-pop">
        <div className="border-b border-line-muted px-3 py-2 text-[11px] font-semibold text-fg">Bookmarks &amp; History</div>
        <div className="max-h-[360px] overflow-y-auto p-1">
          {bookmarks.length > 0 && (
            <div className="px-2 py-1 text-[9px] uppercase text-fg-faint">Bookmarks</div>
          )}
          {bookmarks.map(b => (
            <div key={b.id} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover">
              <button onClick={() => onNavigate(b.url)} className="flex flex-1 items-center gap-2 text-left text-[11px]">
                <Star className="h-3 w-3 shrink-0 text-amber-400" />
                <span className="flex-1 truncate text-fg">{b.title}</span>
              </button>
              <button onClick={() => onRemoveBookmark(b.id)} title="Remove bookmark"
                className="rounded p-0.5 text-fg-faint opacity-0 hover:text-red-400 group-hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {history.length > 0 && (
            <div className="mt-1 flex items-center justify-between px-2 py-1">
              <span className="text-[9px] uppercase text-fg-faint">Recent</span>
              <button onClick={() => setConfirmClear(true)} title="Clear history"
                className="text-[9px] text-fg-faint hover:text-red-400">
                Clear
              </button>
            </div>
          )}
          {history.slice(0, 15).map((h, i) => (
            <div key={i} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover">
              <button onClick={() => onNavigate(h.url)} className="flex flex-1 items-center gap-2 text-left text-[11px]">
                <Clock className="h-3 w-3 shrink-0 text-fg-faint" />
                <span className="flex-1 truncate text-fg-muted">{h.title}</span>
              </button>
              <button onClick={() => onRemoveHistory(h.url)} title="Remove entry"
                className="rounded p-0.5 text-fg-faint opacity-0 hover:text-red-400 group-hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {bookmarks.length === 0 && history.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-fg-faint">
              No bookmarks or history yet.
            </div>
          )}
        </div>
        {confirmClear && (
          <div className="border-t border-line-muted p-3">
            <p className="text-[11px] text-fg-muted">Clear all LUCIAN browser history? Bookmarks are not affected.</p>
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setConfirmClear(false)} className="rounded px-2 py-1 text-[11px] text-fg-muted hover:text-fg">Cancel</button>
              <button onClick={() => { onClearHistory(); setConfirmClear(false); }}
                className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-500 hover:bg-red-500/20">
                Clear history
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Browser info panel (Web vs Desktop) ──────────────────────────────────

function BrowserInfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="themed w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line-muted px-4 py-3">
          <h2 className="text-[13px] font-semibold text-fg">About LUCIAN Browser</h2>
          <button type="button" aria-label="Close browser information" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
            <Globe className="h-3 w-3" /> Web Mode
          </div>
          <p className="text-[12px] text-fg-muted">
            This is the <strong>web version</strong> of LUCIAN Browser. It works within
            normal browser-security limits and never bypasses website anti-embedding
            protections.
          </p>

          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500">Can do</p>
            <ul className="mt-1 space-y-0.5">
              {WEB_CAN_DO.map(c => <li key={c} className="text-[11px] text-fg-muted">• {c}</li>)}
            </ul>
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">Cannot do</p>
            <ul className="mt-1 space-y-0.5">
              {WEB_CANNOT_DO.map(c => <li key={c} className="text-[11px] text-fg-muted">• {c}</li>)}
            </ul>
          </div>

          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Capability matrix</p>
            <div className="mt-1 overflow-hidden rounded-md border border-line">
              <table className="w-full text-[10px]">
                <thead className="bg-surface-2 text-fg-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Feature</th>
                    <th className="px-2 py-1 text-left">Web</th>
                    <th className="px-2 py-1 text-left">Desktop (future)</th>
                  </tr>
                </thead>
                <tbody>
                  {BROWSER_CAPABILITY_MATRIX.map(row => (
                    <tr key={row.feature} className="border-t border-line-muted">
                      <td className="px-2 py-1 text-fg">{row.feature}</td>
                      <td className="px-2 py-1 text-fg-muted">{row.web}</td>
                      <td className="px-2 py-1 text-fg-faint">{row.desktop}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 rounded-md border border-line-muted bg-inset p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Desktop version — future</p>
            <p className="mt-1 text-[11px] text-fg-muted">
              A future desktop LUCIAN can use Electron WebContents or equivalent for:
            </p>
            <ul className="mt-1 space-y-0.5">
              {DESKTOP_FUTURE.map(c => <li key={c} className="text-[11px] text-fg-faint">• {c}</li>)}
            </ul>
            <p className="mt-2 text-[10px] text-fg-faint italic">
              Desktop mode is explicitly not implemented in Phase 15.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
