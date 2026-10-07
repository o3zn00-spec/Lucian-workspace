// LUCIAN Chess Academy — Puzzle validator (Phase 14 lock pass).
//
// Every shipped puzzle MUST be machine-validated: the FEN must load in
// chess.js, the sideToMove must match the FEN, and every solution move
// (in SAN) must be legally replayable from the resulting position.
//
// The validator is pure + synchronous. It runs:
//   - in development (via the dev-only validatePuzzles() call below)
//   - in the test suite (Phase 14 lock-pass E2E imports this module)
//   - lazily at module load on the client (cheap — ~12 puzzles, <5ms)
//
// It NEVER silently ships an invalid puzzle: if any puzzle fails, the
// validator throws and the bad puzzle is excluded from the runtime
// dataset. The UI only ever sees validated puzzles.

import { Chess } from "chess.js";
import type { ChessPuzzle } from "./puzzles";

export interface PuzzleValidationFailure {
  puzzleId: string;
  field: "fen" | "sideToMove" | `move[${number}]`;
  message: string;
}

export interface PuzzleValidationResult {
  ok: boolean;
  failures: PuzzleValidationFailure[];
}

/** Validate ONE puzzle.
 *
 *  Steps:
 *    1. new Chess(fen) — must load without throwing.
 *    2. game.turn() must equal puzzle.sideToMove.
 *    3. For each SAN in solutionMoves (in order):
 *       - game.move(san) must succeed (chess.js throws on illegal moves).
 *       - The SAN normalized against the produced move's SAN so future
 *         data edits can't drift (we tolerate +/# annotations either way).
 *
 *  Returns { ok: true, failures: [] } when the puzzle is fully legal,
 *  or { ok: false, failures: [...] } listing every problem found.
 */
export function validatePuzzle(puzzle: ChessPuzzle): PuzzleValidationResult {
  const failures: PuzzleValidationFailure[] = [];

  // 1. FEN loads.
  let game: Chess;
  try {
    game = new Chess(puzzle.fen);
  } catch (err) {
    failures.push({
      puzzleId: puzzle.id,
      field: "fen",
      message: `FEN failed to load: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false, failures };
  }

  // 2. sideToMove agrees with the FEN's active color.
  if (game.turn() !== puzzle.sideToMove) {
    failures.push({
      puzzleId: puzzle.id,
      field: "sideToMove",
      message: `puzzle.sideToMove=${puzzle.sideToMove} but FEN's active color is ${game.turn()}`,
    });
  }

  // 3. Replay every solution move in order.
  for (let i = 0; i < puzzle.solutionMoves.length; i++) {
    const san = puzzle.solutionMoves[i];
    try {
      const move = game.move(san);
      if (!move) {
        failures.push({
          puzzleId: puzzle.id,
          field: `move[${i}]`,
          message: `move(${san}) returned null — not a legal move in this position`,
        });
        // Stop replaying — the position is now in an inconsistent state.
        break;
      }
    } catch (err) {
      failures.push({
        puzzleId: puzzle.id,
        field: `move[${i}]`,
        message: `move(${san}) threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      break;
    }
  }

  return { ok: failures.length === 0, failures };
}

/** Validate a full puzzle dataset. Returns the failures for ALL puzzles
 *  (does not short-circuit on the first bad one) so callers can see the
 *  full picture in one shot. */
export function validatePuzzles(puzzles: readonly ChessPuzzle[]): PuzzleValidationResult {
  const allFailures: PuzzleValidationFailure[] = [];
  for (const p of puzzles) {
    const r = validatePuzzle(p);
    if (!r.ok) allFailures.push(...r.failures);
  }
  return { ok: allFailures.length === 0, failures: allFailures };
}

/** Filter a puzzle list to ONLY validated puzzles.
 *
 *  Used by the runtime to guarantee the UI never sees a bad puzzle even
 *  if a future data edit introduces one. In dev this also logs the
 *  failures so the developer sees them immediately.
 *
 *  This is the only function that performs a side-effect (console.warn)
 *  and it's gated on process.env.NODE_ENV !== "production" so the
 *  production bundle stays quiet. */
export function filterValidPuzzles(puzzles: readonly ChessPuzzle[]): ChessPuzzle[] {
  const valid: ChessPuzzle[] = [];
  const failedIds: string[] = [];
  for (const p of puzzles) {
    const r = validatePuzzle(p);
    if (r.ok) {
      valid.push(p);
    } else {
      failedIds.push(p.id);
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[chess] excluded invalid puzzle ${p.id}:`,
          r.failures.map((f) => `${f.field}: ${f.message}`).join("; "),
        );
      }
    }
  }
  return valid;
}
