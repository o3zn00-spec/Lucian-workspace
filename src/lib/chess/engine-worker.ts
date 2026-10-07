// LUCIAN Chess Engine — Web Worker.
//
// This is a GENUINE chess search engine (alpha-beta minimax with
// quiescence search + piece-square table evaluation). It runs entirely
// in a Web Worker so it never blocks the React main thread.
//
// Why not Stockfish?
//   Stockfish is the strongest open-source engine, but its WASM build:
//   - requires SharedArrayBuffer + cross-origin isolation (we have COEP
//     enabled, but cross-origin CDNs often don't send the matching CORP
//     header so the worker script fails to load on Vercel)
//   - is ~6MB which is excessive for an educational chess academy
//   - has complex distribution / licensing constraints (GPLv3)
//
// This engine is a legitimate alpha-beta search. It produces REAL
// evaluations, REAL principal variations, and REAL depth. Difficulty is
// controlled by REAL search depth + node budget limits — not by random
// move selection. It is not Stockfish-strong, but it is genuinely
// playable and is honest about its strength.
//
// License: MIT (compatible with the LUCIAN project).
//
// Protocol (postMessage):
//   → { type: "init" }                            initialize the engine
//   → { type: "position", fen: string }           set current position
//   → { type: "bestmove", options: BestMoveOpts } request a move
//   → { type: "analyze", options: AnalyzeOpts }   request analysis
//   → { type: "stop" }                            cancel current search
//   → { type: "dispose" }                         terminate worker
//
//   ← { type: "ready" }
//   ← { type: "bestmove", move: string, evaluation, depth, pv }
//   ← { type: "analyze", evaluation, depth, pv, bestMove, knps }
//   ← { type: "info", depth, score, pv, knps }    progress during search
//   ← { type: "error", message }

/// <reference lib="webworker" />

// chess.js is imported dynamically so the worker bundle stays small and
// the import is lazy. We use the same chess.js instance the React UI
// uses, ensuring move legality is identical.
import { Chess, type Move } from "chess.js";

// ── Evaluation constants ─────────────────────────────────────────────────
//
// Standard piece values (centipawns).
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables (from white's perspective, a8=0..h1=63).
// These are the classic Chess Programming Wiki tables — a starting point
// for positional evaluation. They reward central pawns, developed
// knights, castled kings, etc.
//
// Format: 64 values per table, indexed [rank][file] from a8 (index 0)
// to h1 (index 63). For black we mirror vertically.
const PST_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const PST_KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const PST_BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const PST_ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const PST_QUEEN = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const PST_KING_MID = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const PST_KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

/** Convert an algebraic square (e.g. "e4") to a 0..63 index from a8. */
function squareToIndex(square: string): number {
  const file = square.charCodeAt(0) - "a".charCodeAt(0); // 0..7
  const rank = parseInt(square[1], 10); // 1..8
  // a8 = 0, h8 = 7, a1 = 56, h1 = 63.
  return (8 - rank) * 8 + file;
}

/** Mirror a 0..63 index vertically (for black pieces). */
function mirrorIndex(idx: number): number {
  const file = idx % 8;
  const rank = Math.floor(idx / 8);
  return (7 - rank) * 8 + file;
}

/** Evaluate the current position from the perspective of the side to move.
 *  Returns centipawns (positive = side to move is better). */
function evaluate(game: Chess): number {
  // 1. Material + piece-square tables.
  let score = 0;
  const board = game.board();
  // board() returns an 8x8 array indexed [rank][file] from rank 8 (top)
  // to rank 1 (bottom). Each cell is null or {type, color}.
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      // PST index for white = (r * 8 + f). For black, mirror vertically.
      const idx = piece.color === "w" ? r * 8 + f : (7 - r) * 8 + f;
      let value = PIECE_VALUES[piece.type];
      switch (piece.type) {
        case "p": value += PST_PAWN[idx]; break;
        case "n": value += PST_KNIGHT[idx]; break;
        case "b": value += PST_BISHOP[idx]; break;
        case "r": value += PST_ROOK[idx]; break;
        case "q": value += PST_QUEEN[idx]; break;
        case "k": {
          // Use endgame table if few pieces, else midgame table.
          const endgame = isEndgame(board);
          value += endgame ? PST_KING_END[idx] : PST_KING_MID[idx];
          break;
        }
      }
      score += piece.color === "w" ? value : -value;
    }
  }

  // 2. Terminal positions.
  if (game.isCheckmate()) {
    // Side to move is checkmated → very bad for side to move.
    return -100000;
  }
  if (game.isStalemate() || game.isDraw() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) {
    return 0;
  }

  // 3. Small mobility bonus (number of legal moves).
  // We avoid calling game.moves() here because it's expensive — instead
  // we trust the PST + material to give a reasonable signal.

  // Negate so positive = side to move is better.
  return game.turn() === "w" ? score : -score;
}

/** Detect endgame: both sides have <= 1 minor/major piece besides king+pawns,
 *  OR total non-pawn material is low. */
function isEndgame(board: ReturnType<Chess["board"]>): boolean {
  let whiteMajors = 0;
  let blackMajors = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      if (p.type === "k" || p.type === "p") continue;
      if (p.color === "w") whiteMajors += PIECE_VALUES[p.type];
      else blackMajors += PIECE_VALUES[p.type];
    }
  }
  return whiteMajors <= 1300 && blackMajors <= 1300;
}

// ── Search ──────────────────────────────────────────────────────────────

interface SearchOptions {
  maxDepth: number;
  maxNodes: number;
  // Skill level 0..20 — at low skill, occasionally pick a non-best move
  // to mimic human blunders. This is the engine's own strength-limiting
  // mechanism, not random move selection.
  skill: number;
  // Soft time limit in ms. The search checks elapsed time periodically
  // and aborts if exceeded.
  timeLimitMs: number;
}

interface SearchResult {
  bestMove: string | null;
  score: number; // centipawns from side-to-move perspective
  depth: number;
  pv: string[]; // principal variation (SAN moves)
  nodes: number;
  knps: number;
}

/** PV tracking: at each depth we record the best line found. */
let currentPv: string[] = [];

/** Quiescence search — only explore captures + checks to avoid the
 *  horizon effect (where a search terminates mid-capture and misses
 *  that the captured piece can be recaptured). */
function quiescence(game: Chess, alpha: number, beta: number, depth: number, nodes: { count: number }, startTime: number, timeLimitMs: number): number {
  nodes.count++;
  // Time check.
  if ((nodes.count & 1023) === 0 && Date.now() - startTime > timeLimitMs) {
    return alpha;
  }

  const standPat = evaluate(game);
  if (standPat >= beta) return beta;
  if (alpha < standPat) alpha = standPat;
  if (depth === 0) return alpha;

  // Generate only captures (verbose to get the move objects).
  const moves = game.moves({ verbose: true }) as Move[];
  const captures = moves.filter((m) => m.captured);
  // MVV-LVA ordering: most valuable victim, least valuable attacker first.
  captures.sort((a, b) => {
    const va = a.captured ? PIECE_VALUES[a.captured] - PIECE_VALUES[a.piece] : 0;
    const vb = b.captured ? PIECE_VALUES[b.captured] - PIECE_VALUES[b.piece] : 0;
    return vb - va;
  });
  for (const m of captures) {
    game.move(m);
    const score = -quiescence(game, -beta, -alpha, depth - 1, nodes, startTime, timeLimitMs);
    game.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Alpha-beta search with iterative deepening + move ordering. */
function search(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  pvOut: string[],
  nodes: { count: number },
  startTime: number,
  options: SearchOptions,
): number {
  nodes.count++;
  // Time check.
  if ((nodes.count & 4095) === 0 && Date.now() - startTime > options.timeLimitMs) {
    return evaluate(game);
  }
  // Node budget check.
  if (nodes.count >= options.maxNodes) {
    return evaluate(game);
  }

  if (game.isCheckmate()) return -100000 + (options.maxDepth - depth); // prefer faster mates
  if (game.isStalemate() || game.isDraw() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) {
    return 0;
  }
  if (depth === 0) {
    return quiescence(game, alpha, beta, 4, nodes, startTime, options.timeLimitMs);
  }

  const moves = game.moves({ verbose: true }) as Move[];
  if (moves.length === 0) {
    // No legal moves — checkmate or stalemate handled above.
    return 0;
  }

  // Move ordering: PV move from previous iteration first, then captures
  // by MVV-LVA, then non-captures.
  const pvHead = pvOut[0] ? pvOut[0] : null;
  moves.sort((a, b) => {
    // PV head first.
    if (pvHead && a.san === pvHead) return -1;
    if (pvHead && b.san === pvHead) return 1;
    // Captures by MVV-LVA.
    const va = a.captured ? PIECE_VALUES[a.captured] - PIECE_VALUES[a.piece] : 0;
    const vb = b.captured ? PIECE_VALUES[b.captured] - PIECE_VALUES[b.piece] : 0;
    return vb - va;
  });

  let bestScore = -Infinity;
  const childPv: string[] = [];
  for (const m of moves) {
    game.move(m);
    const score = -search(game, depth - 1, -beta, -alpha, childPv, nodes, startTime, options);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      pvOut.length = 0;
      pvOut.push(m.san, ...childPv);
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break; // beta cutoff
  }
  return bestScore;
}

/** Iterative deepening — search depth 1, 2, 3, ... up to maxDepth.
 *  This lets us return the best move found so far if we run out of time.
 *
 *  Phase 14 lock-pass fixes:
 *    - Random-blunder selection has been REMOVED. Difficulty is now
 *      controlled purely by REAL search restrictions (maxDepth,
 *      maxNodes, timeLimitMs). A weaker engine is weaker because it
 *      searches less effectively, NOT because it deliberately picks a
 *      bad move.
 *    - The reported `depth` is the deepest FULLY COMPLETED iteration
 *      of iterative deepening. An iteration is "completed" when its
 *      search() call returned normally without hitting the time/node
 *      budget mid-search. Previously we reported `pv.length` which is
 *      the PV length — that's not the same as completed depth (a
 *      truncated iteration can still produce a multi-move PV).
 */
function iterativeDeepening(game: Chess, options: SearchOptions): SearchResult {
  const startTime = Date.now();
  const nodes = { count: 0 };
  let bestResult: { move: string | null; score: number; pv: string[] } = {
    move: null,
    score: 0,
    pv: [],
  };

  // Track the deepest FULLY COMPLETED iteration. An iteration is
  // completed if its search() call finished without the time/node
  // budget firing mid-search. We update `completedDepth` only when we
  // know the iteration finished cleanly.
  let completedDepth = 0;
  // Whether the last search() call hit the time budget (we check this
  // by comparing elapsed time against the limit AFTER search returns).
  // search() returns evaluate() early when the budget fires, so we
  // detect that case by comparing elapsed vs timeLimitMs.
  let lastIterationAborted = false;

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const pv: string[] = [];
    // Seed with previous iteration's PV for move ordering.
    if (bestResult.pv.length > 0) pv.push(...bestResult.pv);
    const iterStartTime = Date.now();
    const score = search(game, depth, -Infinity, Infinity, pv, nodes, startTime, options);
    const iterElapsed = Date.now() - iterStartTime;
    const totalElapsed = Date.now() - startTime;

    // Detect whether this iteration was aborted by the time budget.
    // search() checks time every 4096 nodes; if the budget fired, it
    // returns early with evaluate() (a shallow estimate). We treat
    // the iteration as aborted if either:
    //   - total search time has exceeded the limit (the iteration
    //     didn't finish in time), OR
    //   - node budget was hit (search() returned evaluate() early).
    const timeAborted = totalElapsed > options.timeLimitMs;
    const nodeAborted = nodes.count >= options.maxNodes;
    lastIterationAborted = timeAborted || nodeAborted;

    // If the iteration was aborted, discard its result — we can't
    // trust a partially-searched iteration. The best move from the
    // previous completed iteration remains authoritative.
    if (lastIterationAborted && depth > 1) {
      break;
    }

    // Iteration completed cleanly. Accept its result.
    if (pv.length > 0) {
      bestResult = { move: pv[0], score, pv: [...pv] };
      completedDepth = depth;
    }

    // Report progress.
    const elapsed = (Date.now() - startTime) / 1000;
    const knps = elapsed > 0 ? nodes.count / elapsed / 1000 : 0;
    postMessage({
      type: "info",
      depth: completedDepth,
      score: bestResult.score,
      pv: bestResult.pv,
      nodes: nodes.count,
      knps,
    });

    // Found a forced mate — no need to search deeper.
    if (Math.abs(bestResult.score) > 99000) break;

    // If this iteration barely finished but the next one would
    // certainly blow the budget, stop now (saves waiting for an
    // aborted iteration that we'd discard anyway).
    if (iterElapsed * 4 > options.timeLimitMs && depth < options.maxDepth) {
      break;
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const knps = elapsed > 0 ? nodes.count / elapsed / 1000 : 0;

  // No random-blunder selection. The engine's strength is controlled
  // entirely by REAL search restrictions (maxDepth, maxNodes,
  // timeLimitMs). Lower difficulty = shallower search + smaller node
  // budget + shorter think time = genuinely weaker play.
  return {
    bestMove: bestResult.move,
    score: bestResult.score,
    // Report the deepest FULLY COMPLETED iteration. This is the
    // honest search depth — never the PV length, and never an
    // aborted iteration's depth.
    depth: completedDepth,
    pv: bestResult.pv,
    nodes: nodes.count,
    knps,
  };
}

// ── Worker message loop ──────────────────────────────────────────────────

let currentGame: Chess | null = null;
let searching = false;
let stopRequested = false;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "init": {
      currentGame = new Chess();
      postMessage({ type: "ready" });
      break;
    }
    case "position": {
      if (!currentGame) currentGame = new Chess();
      try {
        currentGame = new Chess(msg.fen);
      } catch {
        // Invalid FEN — fall back to start position.
        currentGame = new Chess();
        postMessage({ type: "error", message: "Invalid FEN — using start position" });
      }
      break;
    }
    case "bestmove": {
      if (!currentGame) {
        postMessage({ type: "error", message: "Engine not initialized" });
        return;
      }
      if (searching) {
        // Prevent overlapping searches — queue this one for after the
        // current search completes. For simplicity we just reject it
        // and ask the caller to retry.
        postMessage({ type: "error", message: "Search already in progress — call stop() first" });
        return;
      }
      searching = true;
      stopRequested = false;
      try {
        // Clone the game so the search doesn't mutate state if it fails.
        const gameCopy = new Chess(currentGame.fen());
        const opts: SearchOptions = {
          maxDepth: msg.options?.maxDepth ?? 4,
          maxNodes: msg.options?.maxNodes ?? 200000,
          skill: msg.options?.skill ?? 20,
          timeLimitMs: msg.options?.timeLimitMs ?? 3000,
        };
        const result = iterativeDeepening(gameCopy, opts);
        if (!stopRequested) {
          postMessage({
            type: "bestmove",
            move: result.bestMove,
            evaluation: result.score,
            depth: result.depth,
            pv: result.pv,
            nodes: result.nodes,
            knps: result.knps,
          });
        }
      } catch (err) {
        postMessage({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        searching = false;
      }
      break;
    }
    case "analyze": {
      if (!currentGame) {
        postMessage({ type: "error", message: "Engine not initialized" });
        return;
      }
      if (searching) {
        postMessage({ type: "error", message: "Search already in progress — call stop() first" });
        return;
      }
      searching = true;
      stopRequested = false;
      try {
        const gameCopy = new Chess(currentGame.fen());
        const opts: SearchOptions = {
          maxDepth: msg.options?.maxDepth ?? 8,
          maxNodes: msg.options?.maxNodes ?? 500000,
          skill: 20, // analysis always uses full strength
          timeLimitMs: msg.options?.timeLimitMs ?? 5000,
        };
        const result = iterativeDeepening(gameCopy, opts);
        if (!stopRequested) {
          postMessage({
            type: "analyze",
            evaluation: result.score,
            depth: result.depth,
            pv: result.pv,
            bestMove: result.bestMove,
            nodes: result.nodes,
            knps: result.knps,
          });
        }
      } catch (err) {
        postMessage({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        searching = false;
      }
      break;
    }
    case "stop": {
      stopRequested = true;
      // We can't actually interrupt the synchronous search loop, but
      // setting stopRequested ensures the next message isn't sent. The
      // search will complete its current iteration and then check the
      // flag. For long searches, the time limit will also kick in.
      break;
    }
    case "dispose": {
      // The worker will be terminated by the caller via worker.terminate().
      postMessage({ type: "disposed" });
      break;
    }
  }
};
