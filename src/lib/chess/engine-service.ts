"use client";

/* LUCIAN Chess Engine Service — clean async API over a Web Worker.
 *
 * Architecture:
 *   Chess UI (React)
 *     ↓ getBestMove() / analyze() / stop() / dispose()
 *   ChessEngineService (this file)
 *     ↓ postMessage
 *   Web Worker (engine-worker.ts)
 *     ↓ alpha-beta minimax + quiescence + PST eval
 *   Real chess search
 *
 * API (matches Phase 14 spec A2):
 *   initialize()
 *   setPosition(fen, moves?)
 *   getBestMove(options)
 *   analyze(options)
 *   stop()
 *   dispose()
 *
 * Concurrency:
 *   - ONE worker per service instance.
 *   - Searches are serialized — if a search is in progress, new
 *     requests are rejected with "search already in progress". The
 *     caller MUST call stop() first.
 *   - dispose() terminates the worker; subsequent calls throw.
 *
 * Worker lifecycle:
 *   - The worker is created lazily on first initialize() call.
 *   - It is reused across multiple searches (no per-search spawn cost).
 *   - dispose() terminates it cleanly.
 */

export interface BestMoveOptions {
  /** Max search depth in plies (1 = 1 ply = 1 half-move). */
  maxDepth?: number;
  /** Max nodes to evaluate before stopping. */
  maxNodes?: number;
  /** Engine skill level 0..20. Kept for API stability — the worker no
   *  longer uses this for random-blunder selection (Phase 14 lock pass
   *  removed that mechanism). Difficulty is now controlled purely by
   *  the REAL search restrictions: maxDepth + maxNodes + timeLimitMs.
   *  Lower difficulty → shallower search + smaller node budget + shorter
   *  think time → genuinely weaker play. */
  skill?: number;
  /** Soft time limit in ms. */
  timeLimitMs?: number;
}

export interface AnalyzeOptions {
  maxDepth?: number;
  maxNodes?: number;
  timeLimitMs?: number;
}

export interface BestMoveResult {
  /** SAN move string (e.g. "Nf3", "exd5", "O-O"). */
  move: string | null;
  /** Evaluation in centipawns from the perspective of the side to move. */
  evaluation: number;
  /** Search depth reached (plies). */
  depth: number;
  /** Principal variation (SAN moves). */
  pv: string[];
  /** Total nodes searched. */
  nodes: number;
  /** Thousands of nodes per second. */
  knps: number;
}

export interface AnalyzeResult {
  evaluation: number;
  depth: number;
  pv: string[];
  bestMove: string | null;
  nodes: number;
  knps: number;
}

export interface SearchProgress {
  depth: number;
  score: number;
  pv: string[];
  nodes: number;
  knps: number;
}

type MessageHandler = (msg: unknown) => void;

export class ChessEngineService {
  private worker: Worker | null = null;
  private ready: boolean = false;
  private readyResolvers: Array<() => void> = [];
  private currentResolver: ((result: BestMoveResult | AnalyzeResult) => void) | null = null;
  private currentRejecter: ((err: Error) => void) | null = null;
  private progressHandler: ((progress: SearchProgress) => void) | null = null;
  private disposed = false;

  /** Initialize the worker. Idempotent — calling again when already
   *  initialized is a no-op. Returns a promise that resolves when the
   *  worker has reported "ready". */
  initialize(): Promise<void> {
    if (this.disposed) throw new Error("ChessEngineService has been disposed");
    if (this.worker && this.ready) return Promise.resolve();
    if (this.worker) {
      // Worker exists but not ready yet — wait for the pending ready.
      return new Promise<void>((resolve) => {
        this.readyResolvers.push(resolve);
      });
    }
    // Create the worker. We use new URL() so Next.js bundles it as a
    // separate chunk and serves it from the app's own origin (no CORS /
    // COEP issues — same-origin resources are always allowed).
    this.worker = new Worker(new URL("./engine-worker.ts", import.meta.url));
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
    this.worker.onerror = (e: ErrorEvent) => {
      console.error("[chess-engine] Worker error:", e.message);
      if (this.currentRejecter) {
        this.currentRejecter(new Error(`Worker error: ${e.message}`));
        this.currentRejecter = null;
        this.currentResolver = null;
      }
    };
    return new Promise<void>((resolve) => {
      this.readyResolvers.push(resolve);
      this.postMessage({ type: "init" });
    });
  }

  /** Set the current position. Accepts a FEN string. */
  setPosition(fen: string, _moves?: string[]): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("disposed"));
    if (!this.worker) return Promise.reject(new Error("not initialized — call initialize() first"));
    // The worker's `position` message is synchronous (no response).
    // We send it and resolve immediately — the worker applies the FEN
    // before processing any subsequent bestmove/analyze message.
    this.postMessage({ type: "position", fen });
    return Promise.resolve();
  }

  /** Request the engine's best move for the current position. */
  getBestMove(options: BestMoveOptions = {}): Promise<BestMoveResult> {
    if (this.disposed) return Promise.reject(new Error("disposed"));
    if (!this.worker || !this.ready) {
      return Promise.reject(new Error("not initialized — call initialize() first"));
    }
    if (this.currentResolver) {
      return Promise.reject(new Error("search already in progress — call stop() first"));
    }
    return new Promise<BestMoveResult>((resolve, reject) => {
      this.currentResolver = resolve as (r: BestMoveResult | AnalyzeResult) => void;
      this.currentRejecter = reject;
      this.postMessage({ type: "bestmove", options });
    });
  }

  /** Request a deeper analysis of the current position. Always uses
   *  full engine strength (skill=20) regardless of difficulty. */
  analyze(options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    if (this.disposed) return Promise.reject(new Error("disposed"));
    if (!this.worker || !this.ready) {
      return Promise.reject(new Error("not initialized — call initialize() first"));
    }
    if (this.currentResolver) {
      return Promise.reject(new Error("search already in progress — call stop() first"));
    }
    return new Promise<AnalyzeResult>((resolve, reject) => {
      this.currentResolver = resolve as (r: BestMoveResult | AnalyzeResult) => void;
      this.currentRejecter = reject;
      this.postMessage({ type: "analyze", options });
    });
  }

  /** Stop the current search. The current promise will reject with
   *  "search stopped" if no result was produced. */
  stop(): void {
    if (!this.worker || !this.currentResolver) return;
    this.postMessage({ type: "stop" });
    // The worker will not send a final result (it checks stopRequested).
    // We reject the pending promise so the caller can move on.
    if (this.currentRejecter) {
      this.currentRejecter(new Error("search stopped"));
      this.currentRejecter = null;
      this.currentResolver = null;
    }
  }

  /** Terminate the worker. After dispose(), the service is unusable. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.currentRejecter) {
      this.currentRejecter(new Error("disposed"));
      this.currentRejecter = null;
      this.currentResolver = null;
    }
    if (this.worker) {
      try { this.postMessage({ type: "dispose" }); } catch { /* ignore */ }
      // Terminate after a microtask so the dispose message has a chance
      // to flush. (terminate() is synchronous and kills the worker.)
      setTimeout(() => {
        try { this.worker?.terminate(); } catch { /* ignore */ }
        this.worker = null;
      }, 0);
    }
  }

  /** Subscribe to search progress events (depth/score/PV updates during
   *  iterative deepening). Returns an unsubscribe function. */
  onProgress(handler: ((progress: SearchProgress) => void) | null): () => void {
    this.progressHandler = handler;
    return () => {
      if (this.progressHandler === handler) this.progressHandler = null;
    };
  }

  // ── Internal ──

  private postMessage(msg: unknown): void {
    if (!this.worker) return;
    this.worker.postMessage(msg);
  }

  private handleMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    switch (msg.type) {
      case "ready": {
        this.ready = true;
        const resolvers = this.readyResolvers.splice(0);
        for (const r of resolvers) r();
        break;
      }
      case "bestmove": {
        if (this.currentResolver) {
          this.currentResolver({
            move: (msg.move as string) ?? null,
            evaluation: (msg.evaluation as number) ?? 0,
            depth: (msg.depth as number) ?? 0,
            pv: (msg.pv as string[]) ?? [],
            nodes: (msg.nodes as number) ?? 0,
            knps: (msg.knps as number) ?? 0,
          } satisfies BestMoveResult);
          this.currentResolver = null;
          this.currentRejecter = null;
        }
        break;
      }
      case "analyze": {
        if (this.currentResolver) {
          this.currentResolver({
            evaluation: (msg.evaluation as number) ?? 0,
            depth: (msg.depth as number) ?? 0,
            pv: (msg.pv as string[]) ?? [],
            bestMove: (msg.bestMove as string) ?? null,
            nodes: (msg.nodes as number) ?? 0,
            knps: (msg.knps as number) ?? 0,
          } satisfies AnalyzeResult);
          this.currentResolver = null;
          this.currentRejecter = null;
        }
        break;
      }
      case "info": {
        if (this.progressHandler) {
          this.progressHandler({
            depth: (msg.depth as number) ?? 0,
            score: (msg.score as number) ?? 0,
            pv: (msg.pv as string[]) ?? [],
            nodes: (msg.nodes as number) ?? 0,
            knps: (msg.knps as number) ?? 0,
          });
        }
        break;
      }
      case "error": {
        if (this.currentRejecter) {
          this.currentRejecter(new Error((msg.message as string) ?? "unknown error"));
          this.currentRejecter = null;
          this.currentResolver = null;
        } else {
          console.warn("[chess-engine]", msg.message);
        }
        break;
      }
      case "disposed":
        // Worker acknowledged dispose — termination follows.
        break;
    }
  }
}

// ── Singleton accessor ──────────────────────────────────────────────────
//
// The Chess Academy page creates ONE engine service for the lifetime of
// the page. We export a factory (not a singleton instance) so the page
// can manage the lifecycle explicitly — important for proper cleanup on
// unmount.

export function createChessEngine(): ChessEngineService {
  return new ChessEngineService();
}

// ── Difficulty → engine options mapping ─────────────────────────────────
//
// Phase 14 lock pass: difficulty maps to REAL engine search restrictions
// ONLY. The previous version had a `skill` field that caused the worker
// to randomly select a non-best move at low skill levels — that mechanism
// has been REMOVED. A weaker engine is now weaker because it SEARCHES
// LESS (shallower depth, smaller node budget, shorter think time), not
// because it deliberately picks a bad move.
//
// The `skill` field is still accepted on BestMoveOptions for API
// stability but is ignored by the worker. Difficulty is determined by:
//   - maxDepth    (deeper = stronger)
//   - maxNodes    (more nodes searched = stronger)
//   - timeLimitMs (more time = stronger)
//
// The `skill` value shown below is kept for display + backward compat
// but does NOT affect move selection.

export type ChessDifficulty = "beginner" | "easy" | "intermediate" | "advanced" | "expert";

export const DIFFICULTY_OPTIONS: Record<ChessDifficulty, BestMoveOptions & { label: string; description: string }> = {
  beginner: {
    label: "Beginner",
    description: "Depth 2 · 20k nodes · 800ms — searches very shallowly",
    maxDepth: 2,
    maxNodes: 20000,
    skill: 5,
    timeLimitMs: 800,
  },
  easy: {
    label: "Easy",
    description: "Depth 3 · 40k nodes · 1.2s — searches at a casual level",
    maxDepth: 3,
    maxNodes: 40000,
    skill: 8,
    timeLimitMs: 1200,
  },
  intermediate: {
    label: "Intermediate",
    description: "Depth 4 · 100k nodes · 2s — solid club-player strength",
    maxDepth: 4,
    maxNodes: 100000,
    skill: 12,
    timeLimitMs: 2000,
  },
  advanced: {
    label: "Advanced",
    description: "Depth 5 · 250k nodes · 3s — strong tournament-player strength",
    maxDepth: 5,
    maxNodes: 250000,
    skill: 16,
    timeLimitMs: 3000,
  },
  expert: {
    label: "Expert",
    description: "Depth 6 · 500k nodes · 4s — full engine strength",
    maxDepth: 6,
    maxNodes: 500000,
    skill: 20,
    timeLimitMs: 4000,
  },
};

// ── Move quality labels (Phase 14 spec A5) ───────────────────────────────
//
// Derived from real evaluation loss. We compare the eval BEFORE the
// player's move vs AFTER — the loss (in centipawns) determines the
// quality label. These thresholds are documented + honest — we do NOT
// claim to match Chess.com/Lichess accuracy systems.

export type MoveQuality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface MoveQualityThresholds {
  /** Loss in centipawns (from the mover's perspective) at or below
   *  which the move is labeled "best". */
  best: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  // Above `mistake` → blunder.
}

export const DEFAULT_QUALITY_THRESHOLDS: MoveQualityThresholds = {
  best: 10,       // ≤ 0.10 pawns loss
  good: 30,       // ≤ 0.30 pawns loss
  inaccuracy: 80,  // ≤ 0.80 pawns loss
  mistake: 200,    // ≤ 2.00 pawns loss
};

/** Classify a move by its evaluation loss.
 *
 * @param evalBefore  Engine eval (centipawns, side-to-move perspective) BEFORE the move.
 * @param evalAfter   Engine eval (centipawns, side-to-move perspective) AFTER the move + opponent's best reply.
 * @param thresholds  Optional override thresholds.
 * @returns The quality label + the loss in centipawns.
 */
export function classifyMove(
  evalBefore: number,
  evalAfter: number,
  thresholds: MoveQualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): { quality: MoveQuality; loss: number } {
  // Loss = how much worse the position got for the mover (in centipawns).
  // evalAfter is already from the mover's perspective (the engine
  // returns it from the side-to-move's perspective AFTER the move +
  // opponent reply — which IS the original mover).
  const loss = Math.max(0, evalBefore - evalAfter);
  if (loss <= thresholds.best) return { quality: "best", loss };
  if (loss <= thresholds.good) return { quality: "good", loss };
  if (loss <= thresholds.inaccuracy) return { quality: "inaccuracy", loss };
  if (loss <= thresholds.mistake) return { quality: "mistake", loss };
  return { quality: "blunder", loss };
}

/** Human-readable label + color for a move quality. */
export function moveQualityDisplay(quality: MoveQuality): { label: string; className: string } {
  switch (quality) {
    case "best": return { label: "Best", className: "text-green-500" };
    case "good": return { label: "Good", className: "text-emerald-500" };
    case "inaccuracy": return { label: "Inaccuracy", className: "text-amber-500" };
    case "mistake": return { label: "Mistake", className: "text-orange-500" };
    case "blunder": return { label: "Blunder", className: "text-red-500" };
  }
}

/** Format an evaluation in centipawns as a human-readable string.
 *  Positive = side to move is winning. Mate scores are shown as #N. */
export function formatEvaluation(cp: number): string {
  if (Math.abs(cp) > 99000) {
    const mateIn = Math.ceil((100000 - Math.abs(cp)) / 100);
    return cp > 0 ? `#${mateIn}` : `#-${mateIn}`;
  }
  const pawns = cp / 100;
  return (pawns >= 0 ? "+" : "") + pawns.toFixed(2);
}
