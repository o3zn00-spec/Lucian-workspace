"use client";

/* LUCIAN Cross-Module Bridge.
 *
 * Phase 8: ONE canonical bridge for cross-module handoffs.
 *
 * Architecture:
 *   source module → createHandoff() → sessionStorage (short-lived)
 *   → navigate with ?handoff=<id>
 *   → target module consumes handoff → resolveContext() → use data
 *
 * Handoffs expire after 5 minutes. They are consumed once.
 * Dynamic references are resolved at send time via the context resolver.
 */

import { useRouter } from "next/navigation";

/** Module identifiers. */
export type ModuleId =
  | "lilith"
  | "economic-agent"
  | "dev-workspace"
  | "markets"
  | "investing"
  | "economy-hub"
  | "notes"
  | "chess-academy"
  | "vault"
  | "news-feed"
  | "knowledge-library"
  | "mindset-library"
  | "research";

/** A dynamic reference to an entity in a module's store.
 *  The resolver reads the latest data from the store at resolution time. */
export interface ContextRef {
  module: ModuleId;
  entityType: "market-symbol" | "investment" | "opportunity" | "business" | "research" | "note-page" | "chess-position";
  entityId: string;
}

/** A static snapshot of content (e.g. selected text from Notes). */
export interface StaticContext {
  module: ModuleId;
  label: string;
  content: string;
}

/** A cross-module handoff. */
export interface CrossModuleHandoff {
  id: string;
  sourceModule: ModuleId;
  targetModule: ModuleId;
  intent: string;
  createdAt: number;
  contextRefs: ContextRef[];
  staticContext: StaticContext[];
  prompt: string;
  autoSend: boolean;
  metadata: Record<string, unknown>;
}

const STORAGE_KEY = "lucian-cross-module-handoffs";
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HANDOFFS = 20;

function loadHandoffs(): Record<string, CrossModuleHandoff> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CrossModuleHandoff>;
    // Expire old handoffs.
    const now = Date.now();
    const valid: Record<string, CrossModuleHandoff> = {};
    for (const [id, h] of Object.entries(parsed)) {
      if (now - h.createdAt < EXPIRY_MS) {
        valid[id] = h;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

function saveHandoffs(handoffs: Record<string, CrossModuleHandoff>): void {
  if (typeof window === "undefined") return;
  try {
    // Bound to MAX_HANDOFFS — drop oldest if exceeded.
    const entries = Object.values(handoffs).sort((a, b) => b.createdAt - a.createdAt);
    const trimmed = entries.slice(0, MAX_HANDOFFS);
    const obj: Record<string, CrossModuleHandoff> = {};
    for (const h of trimmed) obj[h.id] = h;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // storage full — ignore
  }
}

/** Create a handoff and return its ID. Stores in sessionStorage. */
export function createHandoff(config: Omit<CrossModuleHandoff, "id" | "createdAt">): string {
  const id = `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const handoff: CrossModuleHandoff = {
    ...config,
    id,
    createdAt: Date.now(),
  };
  const handoffs = loadHandoffs();
  handoffs[id] = handoff;
  saveHandoffs(handoffs);
  return id;
}

/** Consume a handoff by ID. Returns the handoff and removes it from storage
 *  (one-time consumption). Returns null if not found or expired. */
export function consumeHandoff(id: string): CrossModuleHandoff | null {
  const handoffs = loadHandoffs();
  const handoff = handoffs[id];
  if (!handoff) return null;
  // Remove consumed handoff.
  delete handoffs[id];
  saveHandoffs(handoffs);
  return handoff;
}

/** Peek at a handoff without consuming it. Returns null if not found. */
export function peekHandoff(id: string): CrossModuleHandoff | null {
  const handoffs = loadHandoffs();
  return handoffs[id] ?? null;
}

/* ── Convenience helpers for common cross-module actions ── */

/** Route paths for modules. */
const MODULE_ROUTES: Record<ModuleId, string> = {
  lilith: "/", // Lilith is global — no route needed, just open the panel
  "economic-agent": "/economic-agent",
  "dev-workspace": "/dev-workspace",
  markets: "/markets",
  investing: "/investing",
  "economy-hub": "/economy-hub",
  notes: "/notes",
  "chess-academy": "/chess-academy",
  vault: "/vault",
  "news-feed": "/news-feed",
  "knowledge-library": "/knowledge-library",
  "mindset-library": "/mindset-library",
  research: "/research",
};

/** Send context to Lilith (opens her panel + attaches context).
 *  Lilith is a global layer — no navigation needed, just open the panel
 *  and set the input/prompt. */
export function sendToLilith(opts: {
  prompt?: string;
  staticContext?: StaticContext[];
  contextRefs?: ContextRef[];
  autoSend?: boolean;
}): void {
  const { useLilithStore } = require("@/store/lilith");
  const store = useLilithStore.getState();

  // Open the panel.
  store.setPanelOpen(true);

  // Set the prompt if provided.
  if (opts.prompt) {
    store.setInputText(opts.prompt);
  }

  // Store the context for Lilith to pick up.
  if (opts.staticContext?.length || opts.contextRefs?.length) {
    // Lilith reads handoff context from a dedicated field.
    // We store it in sessionStorage with a well-known key.
    if (typeof window !== "undefined") {
      const ctx = {
        staticContext: opts.staticContext ?? [],
        contextRefs: opts.contextRefs ?? [],
        prompt: opts.prompt ?? "",
        autoSend: opts.autoSend ?? false,
        createdAt: Date.now(),
      };
      sessionStorage.setItem("lilith-handoff-context", JSON.stringify(ctx));
    }
  }
}

/** Send context to the Economic Agent (navigates + attaches context). */
export function sendToEconomicAgent(opts: {
  prompt?: string;
  staticContext?: StaticContext[];
  contextRefs?: ContextRef[];
  autoSend?: boolean;
}): void {
  const handoffId = createHandoff({
    sourceModule: opts.contextRefs?.[0]?.module ?? opts.staticContext?.[0]?.module ?? "unknown" as ModuleId,
    targetModule: "economic-agent",
    intent: "ask",
    contextRefs: opts.contextRefs ?? [],
    staticContext: opts.staticContext ?? [],
    prompt: opts.prompt ?? "",
    autoSend: opts.autoSend ?? false,
    metadata: {},
  });

  // Navigate to the Economic Agent page with the handoff ID.
  if (typeof window !== "undefined") {
    // This framework-agnostic bridge is called outside React components;
    // a full navigation also guarantees the handoff is read on page mount.
    const target = `${MODULE_ROUTES["economic-agent"]}?handoff=${handoffId}`;
    window.dispatchEvent(new CustomEvent("lucian:navigation-start", { detail: target }));
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = target;
  }
}

/** Open DevWorkspace with an optional handoff (e.g. prototype brief). */
export function openInDevWorkspace(opts: {
  prompt?: string;
  staticContext?: StaticContext[];
  contextRefs?: ContextRef[];
  metadata?: Record<string, unknown>;
}): void {
  const handoffId = createHandoff({
    sourceModule: opts.contextRefs?.[0]?.module ?? opts.staticContext?.[0]?.module ?? "unknown" as ModuleId,
    targetModule: "dev-workspace",
    intent: "open-project",
    contextRefs: opts.contextRefs ?? [],
    staticContext: opts.staticContext ?? [],
    prompt: opts.prompt ?? "",
    autoSend: false,
    metadata: opts.metadata ?? {},
  });

  if (typeof window !== "undefined") {
    // See sendToEconomicAgent: this bridge intentionally performs a full load.
    const target = `${MODULE_ROUTES["dev-workspace"]}?handoff=${handoffId}`;
    window.dispatchEvent(new CustomEvent("lucian:navigation-start", { detail: target }));
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = target;
  }
}

/** Open a module with an optional handoff. */
export function openModule(target: ModuleId, opts?: {
  handoffId?: string;
  queryParams?: Record<string, string>;
}): void {
  let url = MODULE_ROUTES[target];
  const params = new URLSearchParams();
  if (opts?.handoffId) params.set("handoff", opts.handoffId);
  if (opts?.queryParams) {
    for (const [k, v] of Object.entries(opts.queryParams)) {
      params.set(k, v);
    }
  }
  if (params.toString()) url += `?${params.toString()}`;
  if (typeof window !== "undefined") {
    // See sendToEconomicAgent: this bridge intentionally performs a full load.
    window.dispatchEvent(new CustomEvent("lucian:navigation-start", { detail: url }));
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = url;
  }
}

/* ── Lilith handoff context reader ── */

/** Read and consume Lilith's handoff context (set by sendToLilith). */
export function consumeLilithHandoff(): {
  staticContext: StaticContext[];
  contextRefs: ContextRef[];
  prompt: string;
  autoSend: boolean;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("lilith-handoff-context");
    if (!raw) return null;
    sessionStorage.removeItem("lilith-handoff-context");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
