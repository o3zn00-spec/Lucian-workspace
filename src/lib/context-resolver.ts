"use client";

/* LUCIAN Central Context Resolver.
 *
 * Phase 8: ONE canonical place that resolves context references to
 * real serialized data. Called at SEND TIME so the AI request always
 * includes the latest data, not a stale snapshot.
 *
 * Both Lilith and Economic Agent use this resolver.
 */

import type { ContextRef, StaticContext } from "./cross-module-bridge";

export interface ResolvedContext {
  type: string;
  label: string;
  description: string;
  data: string;
}

/** Resolve a single context reference to real serialized data.
 *  Reads from the relevant store at resolution time. */
export function resolveContextRef(ref: ContextRef): ResolvedContext | null {
  switch (ref.module) {
    case "markets":
      return resolveMarketsContext(ref);
    case "investing":
      return resolveInvestingContext(ref);
    case "economy-hub":
      return resolveEconomyContext(ref);
    case "notes":
      return resolveNotesContext(ref);
    case "chess-academy":
      return resolveChessContext(ref);
    default:
      return null;
  }
}

/** Resolve a static context (already has content). */
export function resolveStaticContext(ctx: StaticContext): ResolvedContext {
  return {
    type: ctx.module,
    label: ctx.label,
    description: `Static content from ${ctx.module}`,
    data: ctx.content,
  };
}

/** Resolve all context (refs + static) into a flat array of resolved items. */
export function resolveAllContext(
  refs: ContextRef[],
  staticCtx: StaticContext[],
): ResolvedContext[] {
  const resolved: ResolvedContext[] = [];
  for (const ref of refs) {
    const r = resolveContextRef(ref);
    if (r) resolved.push(r);
  }
  for (const s of staticCtx) {
    resolved.push(resolveStaticContext(s));
  }
  return resolved;
}

/**
 * Resolve the page the owner is currently viewing into bounded, factual
 * context. This powers Lilith's global panel without requiring a manual
 * handoff. Sensitive Vault details are withheld while the Vault is locked;
 * DevWorkspace contributes metadata only unless the coding tool explicitly
 * reads a file.
 */
export function resolvePageContext(pathname: string): ResolvedContext[] {
  try {
    if (pathname.startsWith("/markets")) {
      const { useMarketsStore } = require("@/store/markets");
      const state = useMarketsStore.getState();
      const pane = state.paneStates[state.activePaneIndex] ?? state.paneStates[0];
      if (!pane?.symbol) return [];
      return [resolveMarketsContext({ module: "markets", entityType: "market-symbol", entityId: pane.symbol })].filter(Boolean) as ResolvedContext[];
    }
    if (pathname.startsWith("/vault")) {
      const { useVaultStore } = require("@/store/vault");
      const state = useVaultStore.getState();
      if (state.locked || state.settings.hideBalances || state.settings.security.maskSensitiveValues) {
        return [{ type: "vault", label: "Vault", description: "Protected", data: "Vault financial values are hidden by the owner's privacy controls. Do not infer or expose balances." }];
      }
      const balances = state.balances;
      return [{
        type: "vault",
        label: "Owner Vault",
        description: balances.providerConnected ? "Provider-connected balances" : "Manual or unavailable balances",
        data: [
          `Provider connected: ${balances.providerConnected ? "yes" : "no"}`,
          `Total value: ${balances.totalValue} ${balances.totalCurrency}`,
          `Available cash: ${balances.cash.available} ${balances.cash.currency}`,
          `Trading buying power: ${balances.trading.buyingPower} ${balances.trading.currency}`,
          `Crypto holdings: ${balances.crypto.holdings.length}`,
          `Recent transactions: ${state.transactions.length}`,
        ].join("\n"),
      }];
    }
    if (pathname.startsWith("/dev-workspace")) {
      const { useWorkspaceStore } = require("@/store/workspace");
      const project = useWorkspaceStore.getState().activeProject;
      if (!project) return [{ type: "workspace", label: "DevWorkspace", description: "No active project", data: "The project library is open; no project is active." }];
      return [{
        type: "workspace",
        label: project.name,
        description: `${project.framework} · ${project.fileCount} files`,
        data: [
          `Project: ${project.name}`,
          `Description: ${project.description || "—"}`,
          `Framework: ${project.framework}`,
          `Files: ${project.fileCount}`,
          `Current view: ${useWorkspaceStore.getState().view}`,
          `File index: ${project.files.slice(0, 80).map((file: { path: string }) => file.path).join(", ")}`,
        ].join("\n"),
      }];
    }
    if (pathname.startsWith("/notes")) {
      const activePageId = sessionStorage.getItem("lucian-active-note-page");
      if (!activePageId) return [{ type: "note", label: "Notes", description: "No page selected", data: "The Notes module is open." }];
      const resolved = resolveNotesContext({ module: "notes", entityType: "note-page", entityId: activePageId });
      return resolved ? [resolved] : [];
    }
    if (pathname.startsWith("/chess-academy")) {
      const raw = sessionStorage.getItem("lucian-current-chess-context");
      if (!raw) return [{ type: "chess", label: "Chess Academy", description: "Current module", data: "Chess Academy is open." }];
      const parsed = JSON.parse(raw) as { fen?: string; turn?: string; recentMoves?: string };
      return [{ type: "chess", label: "Current chess position", description: `${parsed.turn ?? "Unknown"} to move`, data: `FEN: ${parsed.fen ?? "unknown"}\nSide to move: ${parsed.turn ?? "unknown"}\nRecent moves: ${parsed.recentMoves || "none"}` }];
    }
    if (pathname.startsWith("/news-feed")) {
      const { useNewsFeedStore } = require("@/store/news-feed");
      const state = useNewsFeedStore.getState();
      const selected = sessionStorage.getItem("lucian-current-news-context");
      return [{
        type: "news",
        label: selected ? "Selected news story" : "News",
        description: `${state.preferences.category} feed · ${state.saved.length} saved`,
        data: selected || [
          `Active category: ${state.preferences.category}`,
          `Saved articles: ${state.saved.length}`,
          ...state.saved.slice(0, 8).map((article: { title: string; source: string; description: string }) =>
            `- ${article.title} (${article.source}): ${article.description.slice(0, 240)}`,
          ),
        ].join("\n"),
      }];
    }
    if (pathname.startsWith("/investing")) {
      const { useInvestingStore } = require("@/store/investing");
      const state = useInvestingStore.getState();
      return [{
        type: "investment",
        label: "Investment portfolio",
        description: `${state.investments.length} holdings · ${state.watchlist.length} watched`,
        data: [
          `Active portfolio: ${state.portfolios.find((p: { id: string }) => p.id === state.activePortfolioId)?.name ?? "Main Portfolio"}`,
          `Holdings: ${state.investments.length}`,
          `Transactions: ${state.transactions.length}`,
          `Watchlist: ${state.watchlist.slice(0, 12).map((item: { symbol: string }) => item.symbol).join(", ") || "none"}`,
          `Saved research: ${state.research.length}`,
          ...state.investments.slice(0, 12).map((item: { symbol: string; name: string; assetType: string }) =>
            `- ${item.symbol}: ${item.name} (${item.assetType})`,
          ),
        ].join("\n"),
      }];
    }
    if (pathname.startsWith("/mindset-library") || pathname.startsWith("/knowledge-library")) {
      const current = sessionStorage.getItem("lucian-current-learning-context");
      return [{
        type: "learning",
        label: current ? "Current learning material" : "Mindset Library",
        description: current ? "Selected reading" : "Learning and reflection workspace",
        data: current || "The owner is viewing the Mindset Library. Ask which idea, material, highlight, or personal principle they want to explore.",
      }];
    }
    if (pathname.startsWith("/research")) {
      const { useEconomyHubStore } = require("@/store/economy-hub");
      const { useInvestingStore } = require("@/store/investing");
      const economy = useEconomyHubStore.getState();
      const investing = useInvestingStore.getState();
      return [{
        type: "research",
        label: "Research workspace",
        description: `${economy.researchRecords.length + investing.research.length} saved records`,
        data: [
          "Economic research:",
          ...economy.researchRecords.slice(0, 10).map((item: { title: string; type: string; notes: string }) => `- ${item.title} (${item.type}): ${item.notes?.slice(0, 220) || "no notes"}`),
          "Investment research:",
          ...investing.research.slice(0, 10).map((item: { title: string; symbol: string; notes: string }) => `- ${item.title}${item.symbol ? ` [${item.symbol}]` : ""}: ${item.notes?.slice(0, 220) || "no notes"}`),
        ].join("\n"),
      }];
    }
    if (pathname.startsWith("/economic-agent")) {
      return [{ type: "capability", label: "Economic workspace", description: "Lilith economic capability", data: "The owner is viewing Lilith's full conversation workspace with economic and research tools available." }];
    }
  } catch {
    return [];
  }
  return [];
}

/* ── Module-specific resolvers ── */

function resolveMarketsContext(ref: ContextRef): ResolvedContext | null {
  if (ref.entityType !== "market-symbol") return null;
  const symbol = ref.entityId;
  try {
    const { useMarketsStore } = require("@/store/markets");
    const { getInstrumentBySymbol } = require("@/lib/markets/catalog");
    const state = useMarketsStore.getState();
    const livePrice = state.prices.get(symbol);
    const ticker = state.tickers.get(symbol);
    const status = state.statusBySymbol.get(symbol);
    const inst = getInstrumentBySymbol(symbol) ?? getInstrumentBySymbol(symbol + ".Daily");
    const positions = state.positions.filter((p: { symbol: string }) => p.symbol === symbol);

    const lines: string[] = [
      `Symbol: ${symbol}`,
      `Name: ${inst?.name ?? "Unknown"}`,
      `Asset class: ${inst?.assetClass ?? "unknown"}`,
    ];

    if (livePrice !== undefined) {
      lines.push(`Live price: $${livePrice.toFixed(2)}`);
      lines.push(`Status: ${status === "disconnected" ? "UNAVAILABLE" : "LIVE"}`);
    }

    if (ticker) {
      lines.push(`24h change: ${ticker.priceChangePercent?.toFixed(2)}%`);
      lines.push(`24h high: $${ticker.highPrice?.toFixed(2)}`);
      lines.push(`24h low: $${ticker.lowPrice?.toFixed(2)}`);
      lines.push(`Bid/Ask: $${ticker.bidPrice?.toFixed(2)} / $${ticker.askPrice?.toFixed(2)}`);
    }

    if (positions.length > 0) {
      lines.push(`Open positions: ${positions.length}`);
      for (const p of positions) {
        lines.push(`  — ${p.side.toUpperCase()} ${p.volume} lots @ ${p.entryPrice}, P/L: $${p.unrealizedPnl.toFixed(2)}`);
      }
    }

    return {
      type: "market",
      label: symbol,
      description: `${inst?.name ?? symbol}`,
      data: lines.join("\n"),
    };
  } catch {
    return null;
  }
}

function resolveInvestingContext(ref: ContextRef): ResolvedContext | null {
  if (ref.entityType !== "investment") return null;
  const investmentId = ref.entityId;
  try {
    const { useInvestingStore, getCurrentPriceWithStatus } = require("@/store/investing");
    const state = useInvestingStore.getState();
    const inv = state.investments.find((i: { id: string }) => i.id === investmentId);
    if (!inv) return null;

    const txns = state.transactions.filter((t: { investmentId: string }) => t.investmentId === investmentId);
    const divs = state.dividends.filter((d: { investmentId: string }) => d.investmentId === investmentId);
    const thesis = state.theses.find((t: { investmentId: string }) => t.investmentId === investmentId);
    const { price, status } = getCurrentPriceWithStatus(inv.symbol);

    const buys = txns.filter((t: { type: string }) => t.type === "buy");
    const sells = txns.filter((t: { type: string }) => t.type === "sell");
    const totalBoughtQty = buys.reduce((s: number, t: { quantity: number }) => s + t.quantity, 0);
    const totalBoughtCost = buys.reduce((s: number, t: { quantity: number; price: number; fees: number }) => s + t.quantity * t.price + t.fees, 0);
    const totalSoldQty = sells.reduce((s: number, t: { quantity: number }) => s + t.quantity, 0);
    const remainingQty = totalBoughtQty - totalSoldQty;
    const avgCost = totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0;

    const lines: string[] = [
      `Holding: ${inv.symbol}`,
      `Name: ${inv.name}`,
      `Type: ${inv.assetType}`,
      `Quantity: ${remainingQty}`,
      `Average cost: $${avgCost.toFixed(2)}`,
      `Cost basis: $${(remainingQty * avgCost).toFixed(2)}`,
    ];

    if (price > 0) {
      lines.push(`Current price: $${price.toFixed(2)} (${status})`);
      lines.push(`Market value: $${(remainingQty * price).toFixed(2)}`);
      lines.push(`Unrealized P/L: $${(remainingQty * price - remainingQty * avgCost).toFixed(2)}`);
    }

    if (thesis) {
      lines.push("", "Thesis:");
      if (thesis.reason) lines.push(`  Reason: ${thesis.reason}`);
      if (thesis.horizon) lines.push(`  Horizon: ${thesis.horizon}`);
      lines.push(`  Confidence: ${thesis.confidence}`);
    }

    return {
      type: "investment",
      label: inv.symbol,
      description: `${inv.name} · ${inv.assetType}`,
      data: lines.join("\n"),
    };
  } catch {
    return null;
  }
}

function resolveEconomyContext(ref: ContextRef): ResolvedContext | null {
  try {
    const { useEconomyHubStore } = require("@/store/economy-hub");
    const state = useEconomyHubStore.getState();

    if (ref.entityType === "opportunity") {
      const opp = state.opportunities.find((o: { id: string }) => o.id === ref.entityId);
      if (!opp) return null;
      const lines: string[] = [
        `Opportunity: ${opp.name}`,
        `Status: ${opp.status}`,
        `Score: ${opp.score}`,
        `Category: ${opp.category ?? "unknown"}`,
      ];
      if (opp.description) lines.push(`Description: ${opp.description}`);
      if (opp.notes) lines.push(`Notes: ${opp.notes}`);
      if (opp.startupCostMin || opp.startupCostMax) {
        lines.push(`Startup cost: $${opp.startupCostMin ?? 0} - $${opp.startupCostMax ?? 0}`);
      }
      if (opp.revenueModel) lines.push(`Revenue model: ${opp.revenueModel}`);
      if (opp.risks) lines.push(`Risks: ${opp.risks}`);

      const businesses = state.businesses.filter((b: { sourceOpportunityId: string | null }) => b.sourceOpportunityId === opp.id);
      if (businesses.length > 0) {
        lines.push("", `Related businesses: ${businesses.length}`);
        for (const b of businesses.slice(0, 3)) {
          lines.push(`  — ${b.name}: revenue $${b.revenue?.toFixed(2) ?? 0}, expenses $${b.expenses?.toFixed(2) ?? 0}`);
        }
      }

      const research = state.researchRecords.filter((r: { relatedOpportunityIds: string[] }) =>
        r.relatedOpportunityIds?.includes(opp.id),
      );
      if (research.length > 0) {
        lines.push("", `Related research: ${research.length}`);
        for (const r of research.slice(0, 3)) {
          lines.push(`  — ${r.title} (${r.type})`);
        }
      }

      return {
        type: "economy",
        label: opp.name,
        description: `Score: ${opp.score} · ${opp.status}`,
        data: lines.join("\n"),
      };
    }

    if (ref.entityType === "business") {
      const biz = state.businesses.find((b: { id: string }) => b.id === ref.entityId);
      if (!biz) return null;
      const lines: string[] = [
        `Business: ${biz.name}`,
        `Status: ${biz.status}`,
        `Revenue: $${biz.revenue?.toFixed(2) ?? 0}`,
        `Expenses: $${biz.expenses?.toFixed(2) ?? 0}`,
        `Profit: $${(biz.revenue ?? 0) - (biz.expenses ?? 0)}`,
      ];
      if (biz.sourceOpportunityId) {
        const opp = state.opportunities.find((o: { id: string }) => o.id === biz.sourceOpportunityId);
        if (opp) lines.push(`Source opportunity: ${opp.name}`);
      }
      return {
        type: "business",
        label: biz.name,
        description: `${biz.status}`,
        data: lines.join("\n"),
      };
    }

    if (ref.entityType === "research") {
      const rec = state.researchRecords.find((r: { id: string }) => r.id === ref.entityId);
      if (!rec) return null;
      const lines: string[] = [
        `Research: ${rec.title}`,
        `Type: ${rec.type}`,
        `Summary: ${rec.summary || "—"}`,
        `Findings: ${rec.findings || "—"}`,
        `Sources: ${rec.sources || "—"}`,
      ];
      return {
        type: "research",
        label: rec.title,
        description: `${rec.type}`,
        data: lines.join("\n"),
      };
    }

    return null;
  } catch {
    return null;
  }
}

function resolveNotesContext(ref: ContextRef): ResolvedContext | null {
  if (ref.entityType !== "note-page") return null;
  try {
    // Notes are stored in localStorage under "lucian-notes-v2".
    const raw = localStorage.getItem("lucian-notes-v2");
    if (!raw) return null;
    const data = JSON.parse(raw);
    const page = data.sections?.flatMap((s: { pages: unknown[] }) => s.pages)?.find(
      (p: { id: string }) => p.id === ref.entityId,
    );
    if (!page) return null;
    return {
      type: "note",
      label: page.title || "Untitled",
      description: "Notes page",
      data: `Note: ${page.title}\n\nContent: ${page.content?.replace(/<[^>]+>/g, "").slice(0, 2000) ?? ""}`,
    };
  } catch {
    return null;
  }
}

function resolveChessContext(ref: ContextRef): ResolvedContext | null {
  if (ref.entityType !== "chess-position") return null;
  // Chess positions are passed as static context (FEN string in entityId).
  return {
    type: "chess",
    label: "Chess Position",
    description: "Current board state",
    data: `FEN: ${ref.entityId}`,
  };
}
