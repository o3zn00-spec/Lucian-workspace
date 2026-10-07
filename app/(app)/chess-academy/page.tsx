"use client";

// LUCIAN Chess Academy — Phase 14 complete rewrite.
//
// Preserves the existing layout + LUCIAN styling. Replaces the fake
// random-move "AI" with a REAL alpha-beta search engine running in a
// Web Worker. Adds:
//   - real engine difficulty (depth/skill/time)
//   - real puzzles with verified solutions
//   - progressive hints
//   - real position analysis (eval + best move + PV + depth)
//
// module bridge.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Chess } from "chess.js";
import {
  ArrowLeft, RotateCcw, FlipVertical, Bot, Lightbulb,
  ChevronLeft, ChevronRight, CheckCircle2, BookOpen, Target,
  Swords, Brain, History, X, Loader2, AlertCircle, Activity,
} from "lucide-react";
import { CHESS_LESSONS, type ChessLesson } from "@/lib/chess-data";
import { beginNavigationFeedback } from "@/components/layout/navigation-feedback";
import { CHESS_PUZZLES, type ChessPuzzle } from "@/lib/chess/puzzles";
import {
  createChessEngine,
  ChessEngineService,
  DIFFICULTY_OPTIONS,
  type ChessDifficulty,
  type BestMoveResult,
  type AnalyzeResult,
  type SearchProgress,
  classifyMove,
  moveQualityDisplay,
  formatEvaluation,
} from "@/lib/chess/engine-service";









import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Tab = "play" | "learn" | "puzzles";
type Piece = "p" | "n" | "b" | "r" | "q" | "k";

const PIECE_UNICODE: Record<string, string> = {
  p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔",
  P: "♟", N: "♞", B: "♝", R: "♜", Q: "♛", K: "♚",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

export default function ChessAcademyPageWrapper() {
  return (
    <>
      {/* Phase 9: deep-link receiver for /chess-academy?lesson=<id> */}
      <Suspense fallback={null}>
        <ChessDeepLinkReceiver />
      </Suspense>
      <ChessAcademyPage />
    </>
  );
}

function ChessDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const lessonId = searchParams.get("lesson");
    if (!lessonId) return;
    if (consumedRef.current === lessonId) return;
    consumedRef.current = lessonId;
    const lesson = CHESS_LESSONS.find((l) => l.id === lessonId);
    if (lesson) {
      window.dispatchEvent(new CustomEvent("lucian:chess-deeplink", { detail: lessonId }));
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("lesson");
    const qs = next.toString();
    router.replace(qs ? `/chess-academy?${qs}` : "/chess-academy");
  }, [searchParams, router]);

  return null;
}

export function ChessAcademyPage() {
  const [tab, setTab] = useState<Tab>("play");
  const [pendingLessonId, setPendingLessonId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const lessonId = (e as CustomEvent<string>).detail;
      if (!lessonId) return;
      setTab("learn");
      setPendingLessonId(lessonId);
    };
    window.addEventListener("lucian:chess-deeplink", handler as EventListener);
    return () => window.removeEventListener("lucian:chess-deeplink", handler as EventListener);
  }, []);

  return (
    <div className="themed flex h-full min-h-0 bg-canvas text-fg">
      <aside className="hidden w-[180px] shrink-0 flex-col border-r border-line-muted bg-surface-2/40 sm:flex">
        <div className="shrink-0 px-3 py-3">
          <h2 className="text-[12px] font-semibold text-fg">Chess Academy</h2>
        </div>
        <div className="min-h-0 flex-1 px-2">
          <SidebarBtn icon={Swords} label="Play" active={tab === "play"} onClick={() => setTab("play")} />
          <SidebarBtn icon={BookOpen} label="Learn" active={tab === "learn"} onClick={() => setTab("learn")} />
          <SidebarBtn icon={Target} label="Puzzles" active={tab === "puzzles"} onClick={() => setTab("puzzles")} />
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1">
        {tab === "play" && <PlayTab />}
        {tab === "learn" && (
          <LearnTab
            key={pendingLessonId ?? "default"}
            initialLessonId={pendingLessonId}
            onLessonConsumed={() => setPendingLessonId(null)}
          />
        )}
        {tab === "puzzles" && <PuzzlesTab />}
      </div>
    </div>
  );
}

function SidebarBtn({ icon: Icon, label, active, onClick }: { icon: typeof Swords; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
        active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

/* ═══ Chess Board ═══ */

function ChessBoard({
  fen, onMove, flipped, lastMove, selected, legalTargets, interactive, hintSquare,
}: {
  fen: string;
  onMove?: (square: string, target?: string) => void | boolean;
  flipped?: boolean;
  lastMove?: { from: string; to: string } | null;
  selected?: string | null;
  legalTargets?: string[];
  interactive?: boolean;
  hintSquare?: string | null;
}) {
  const game = useMemo(() => {
    const g = new Chess();
    try { g.load(fen); } catch { /* invalid fen */ }
    return g;
  }, [fen]);

  const board = game.board();
  const files = flipped ? [...FILES].reverse() : FILES;
  const ranks = flipped ? [...RANKS].reverse() : RANKS;

  return (
    <div className="inline-block">
      <div className="grid" style={{ gridTemplateColumns: `repeat(8, 1fr)` }}>
        {ranks.map((rank, rowIdx) =>
          files.map((file, colIdx) => {
            const actualRow = flipped ? 7 - rowIdx : rowIdx;
            const actualCol = flipped ? 7 - colIdx : colIdx;
            const square = `${file}${rank}`;
            const piece = board[actualRow]?.[actualCol];
            const isLight = (actualRow + actualCol) % 2 === 0;
            const isLastMove = lastMove && (lastMove.from === square || lastMove.to === square);
            const isSelected = selected === square;
            const isLegal = legalTargets?.includes(square);
            const isHint = hintSquare === square;

            return (
              <div key={square}
                data-square={square}
                onClick={() => interactive && onMove?.(square, "")}
                className={cn(
                  "relative flex aspect-square w-[40px] items-center justify-center text-[28px] leading-none sm:w-[48px] md:w-[56px] lg:w-[60px]",
                  isLight ? "bg-amber-100 dark:bg-amber-900/30" : "bg-amber-800/60 dark:bg-amber-950/60",
                  isLastMove && "ring-2 ring-yellow-400 ring-inset",
                  isSelected && "ring-2 ring-blue-500 ring-inset",
                  isHint && "ring-2 ring-emerald-500 ring-inset animate-pulse",
                  interactive && "cursor-pointer",
                )}
                style={{ color: piece?.color === "w" ? "#fff" : "#1a1a1a", textShadow: piece?.color === "w" ? "0 0 2px #000" : "none" }}
              >
                {piece && (PIECE_UNICODE[piece.type === "p" ? (piece.color === "w" ? "P" : "p") : piece.type.toUpperCase()] ?? "")}
                {isLegal && <span className="absolute h-3 w-3 rounded-full bg-blue-500/40" />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ═══ Play Tab ═══ */

function PlayTab() {
  const [game, setGame] = useState(() => new Chess());
  const [fen, setFen] = useState(game.fen());
  const [selected, setSelected] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historySanVerbose, setHistorySanVerbose] = useState<{ from: string; to: string; san: string }[]>([]);
  const [difficulty, setDifficulty] = useState<ChessDifficulty>("beginner");
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [gameStarted, setGameStarted] = useState(false);
  const [status, setStatus] = useState("White to move");
  const [engineThinking, setEngineThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [moveQuality, setMoveQuality] = useState<{ quality: ReturnType<typeof classifyMove>["quality"]; label: string; className: string } | null>(null);

  useEffect(() => {
    sessionStorage.setItem("lucian-current-chess-context", JSON.stringify({
      fen,
      turn: game.turn() === "w" ? "White" : "Black",
      recentMoves: history.slice(-10).join(" "),
    }));
  }, [fen, game, history]);

  // Engine service — created once per PlayTab mount.
  const engineRef = useRef<ChessEngineService | null>(null);
  const evalBeforeRef = useRef<number | null>(null);

  // Initialize the engine on mount, dispose on unmount.
  useEffect(() => {
    const engine = createChessEngine();
    engineRef.current = engine;
    void engine.initialize().catch((err) => {
      setEngineError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const updateFromGame = useCallback((g: Chess) => {
    setFen(g.fen());
    if (g.isCheckmate()) setStatus(`Checkmate! ${g.turn() === "w" ? "Black" : "White"} wins`);
    else if (g.isStalemate()) setStatus("Stalemate — draw");
    else if (g.isDraw()) setStatus("Draw");
    else if (g.isCheck()) setStatus(`${g.turn() === "w" ? "White" : "Black"} in check`);
    else setStatus(`${g.turn() === "w" ? "White" : "Black"} to move`);
  }, []);

  const makeMove = useCallback(async (from: string, to: string, promotion?: string): Promise<boolean> => {
    try {
      // Record eval before the move (for move-quality classification).
      if (engineRef.current && !engineThinking) {
        try {
          await engineRef.current.setPosition(game.fen());
          const before = await engineRef.current.analyze({ maxDepth: 3, timeLimitMs: 800 });
          evalBeforeRef.current = before.evaluation;
        } catch { /* engine busy — skip quality classification */ }
      }
      const move = game.move({ from, to, promotion: promotion ?? "q" });
      if (move) {
        setLastMove({ from, to });
        setHistory(h => [...h, move.san]);
        setHistorySanVerbose(h => [...h, { from, to, san: move.san }]);
        updateFromGame(game);
        setSelected(null);
        setLegalTargets([]);
        setHintSquare(null);

        // After the player's move, classify move quality by re-analyzing.
        if (engineRef.current && evalBeforeRef.current !== null) {
          try {
            await engineRef.current.setPosition(game.fen());
            const after = await engineRef.current.analyze({ maxDepth: 3, timeLimitMs: 800 });
            // evalAfter is from the OPPONENT's perspective (side to move now).
            // Negate to get it from the player's perspective.
            const evalAfterPlayer = -after.evaluation;
            const { quality } = classifyMove(evalBeforeRef.current, evalAfterPlayer);
            const disp = moveQualityDisplay(quality);
            setMoveQuality({ quality, label: disp.label, className: disp.className });
          } catch { /* non-fatal */ }
        }
        return true;
      }
    } catch { /* invalid move */ }
    return false;
  }, [game, updateFromGame, engineThinking]);

  const handleSquareClick = useCallback((square: string) => {
    if (!gameStarted) return;
    if (game.turn() !== playerColor) return;
    if (game.isGameOver()) return;
    if (engineThinking) return;

    if (selected) {
      if (square === selected) {
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      void makeMove(selected, square).then((ok) => {
        if (ok) return;
        // Try selecting a new piece.
        const piece = game.get(square as never);
        if (piece && piece.color === playerColor) {
          setSelected(square);
          const moves = game.moves({ square: square as never, verbose: true });
          setLegalTargets(moves.map(m => m.to));
        } else {
          setSelected(null);
          setLegalTargets([]);
        }
      });
    } else {
      const piece = game.get(square as never);
      if (piece && piece.color === playerColor) {
        setSelected(square);
        const moves = game.moves({ square: square as never, verbose: true });
        setLegalTargets(moves.map(m => m.to));
      }
    }
  }, [selected, game, playerColor, gameStarted, engineThinking, makeMove]);

  // Engine move — triggered when it's the engine's turn.
  useEffect(() => {
    if (!gameStarted || game.isGameOver()) return;
    if (game.turn() === playerColor) return;
    if (!engineRef.current) return;
    const engine = engineRef.current;
    let cancelled = false;
    setEngineThinking(true);
    setEngineError(null);
    // Set the position + request the engine's best move at the current
    // difficulty. The engine runs in a Worker so the UI stays responsive.
    void engine.setPosition(game.fen()).then(() => {
      const opts = DIFFICULTY_OPTIONS[difficulty];
      return engine.getBestMove({
        maxDepth: opts.maxDepth,
        maxNodes: opts.maxNodes,
        skill: opts.skill,
        timeLimitMs: opts.timeLimitMs,
      });
    }).then((result: BestMoveResult) => {
      if (cancelled) return;
      if (!result.move) return;
      // Apply the engine's move via SAN. chess.js throws on illegal moves.
      try {
        const move = game.move(result.move);
        if (move) {
          setLastMove({ from: move.from, to: move.to });
          setHistory(h => [...h, move.san]);
          setHistorySanVerbose(h => [...h, { from: move.from, to: move.to, san: move.san }]);
          updateFromGame(game);
        }
      } catch (err) {
        setEngineError(`Engine produced an illegal move: ${err instanceof Error ? err.message : String(err)}`);
      }
    }).catch((err: unknown) => {
      if (cancelled) return;
      // "search stopped" is non-fatal (user clicked New Game mid-think).
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("stopped")) {
        setEngineError(msg);
      }
    }).finally(() => {
      if (!cancelled) setEngineThinking(false);
    });
    return () => { cancelled = true; };
  }, [fen, game, playerColor, gameStarted, difficulty, updateFromGame]);

  const newGame = (color: "w" | "b" | "random") => {
    // Stop any in-progress engine search before starting a new game.
    if (engineRef.current) engineRef.current.stop();
    const g = new Chess();
    setGame(g);
    setFen(g.fen());
    setHistory([]);
    setHistorySanVerbose([]);
    setLastMove(null);
    setSelected(null);
    setLegalTargets([]);
    setHintSquare(null);
    setMoveQuality(null);
    setAnalysis(null);
    setEngineError(null);
    const actualColor = color === "random" ? (Math.random() < 0.5 ? "w" : "b") : color;
    setPlayerColor(actualColor);
    setFlipped(actualColor === "b");
    setGameStarted(true);
    updateFromGame(g);
  };

  const handleHint = async () => {
    if (!gameStarted || !engineRef.current) return;
    setHintSquare(null);
    try {
      await engineRef.current.setPosition(game.fen());
      const result = await engineRef.current.getBestMove({
        maxDepth: 3,
        timeLimitMs: 1000,
        skill: 20,
      });
      if (result.move) {
        // Parse SAN → from/to square for highlighting.
        // chess.js verbose move gives us from/to. We replay the move,
        // capture from/to, then undo.
        const tempGame = new Chess(game.fen());
        try {
          const m = tempGame.move(result.move);
          if (m) {
            setHintSquare(m.from);
            toast({ title: "Hint", description: `Consider ${result.move} (from ${m.from})` });
          }
        } catch { /* SAN parse failure — show as text only */ }
      } else {
        toast({ title: "Hint", description: "No move found — game may be over." });
      }
    } catch (err) {
      toast({ title: "Hint failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleAnalyze = async () => {
    if (!gameStarted || !engineRef.current) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      await engineRef.current.setPosition(game.fen());
      const result = await engineRef.current.analyze({
        maxDepth: 8,
        maxNodes: 500000,
        timeLimitMs: 5000,
      });
      setAnalysis(result);
    } catch (err) {
      toast({ title: "Analysis failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 lg:flex-row">
      <div className="flex flex-col items-center">
        <ChessBoard
          fen={fen}
          onMove={handleSquareClick}
          flipped={flipped}
          lastMove={lastMove}
          selected={selected}
          legalTargets={legalTargets}
          interactive={gameStarted && !engineThinking}
          hintSquare={hintSquare}
        />
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => newGame("w")} className="rounded-md border border-line bg-surface px-3 py-1 text-[11px] text-fg-muted hover:text-fg">New Game (White)</button>
          <button onClick={() => newGame("b")} className="rounded-md border border-line bg-surface px-3 py-1 text-[11px] text-fg-muted hover:text-fg">New Game (Black)</button>
          <button type="button" aria-label="Flip chess board" onClick={() => setFlipped(f => !f)} className="rounded-md border border-line bg-surface p-1.5 text-fg-muted hover:text-fg"><FlipVertical className="h-3.5 w-3.5" /></button>
        </div>
        {engineThinking && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-fg-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Engine thinking...
          </div>
        )}
        {engineError && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-500">
            <AlertCircle className="h-3 w-3" /> {engineError}
          </div>
        )}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 lg:mt-0 lg:ml-4 lg:w-[260px]">
        {/* Status */}
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", game.isCheck() ? "bg-red-500 animate-pulse" : "bg-[var(--accent)]")} />
            <span className="text-[12px] font-medium text-fg">{status}</span>
          </div>
          {moveQuality && (
            <div className={cn("mt-1 text-[10px] font-medium", moveQuality.className)}>
              Last move: {moveQuality.label}
            </div>
          )}
        </div>

        {/* Settings */}
        {!gameStarted && (
          <div className="rounded-md border border-line bg-surface p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase text-fg-faint">New Game</p>
            <div>
              <label className="text-[10px] text-fg-muted">Difficulty</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value as ChessDifficulty)}
                className="mt-0.5 w-full rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-fg focus:outline-none">
                {(Object.keys(DIFFICULTY_OPTIONS) as ChessDifficulty[]).map(d => (
                  <option key={d} value={d}>{DIFFICULTY_OPTIONS[d].label}</option>
                ))}
              </select>
              <p className="mt-1 text-[9px] text-fg-faint">{DIFFICULTY_OPTIONS[difficulty].description}</p>
            </div>
          </div>
        )}

        {/* Move history */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface">
          <div className="border-b border-line-muted px-3 py-1.5 text-[10px] font-semibold uppercase text-fg-faint">Moves</div>
          <div className="p-2">
            {history.length === 0 ? <p className="text-center text-[11px] text-fg-faint">No moves yet</p> : (
              <div className="space-y-0.5">
                {history.map((san, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-6 text-fg-faint">{Math.floor(i / 2) + 1}.</span>
                    <span className="font-mono text-fg">{san}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Analysis */}
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="text-[11px] font-medium text-fg">Position Analysis</span>
          </div>
          {analysis ? (
            <div className="mt-2 space-y-1 text-[10px] text-fg-muted">
              <div className="flex justify-between">
                <span>Evaluation:</span>
                <span className="font-mono font-semibold text-fg">{formatEvaluation(analysis.evaluation)}</span>
              </div>
              <div className="flex justify-between">
                <span>Best move:</span>
                <span className="font-mono text-fg">{analysis.bestMove ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Depth:</span>
                <span className="font-mono text-fg">{analysis.depth} plies</span>
              </div>
              {analysis.pv.length > 0 && (
                <div className="mt-1">
                  <span className="text-fg-faint">PV:</span>
                  <p className="mt-0.5 font-mono text-[9px] text-fg-muted break-words">{analysis.pv.slice(0, 8).join(" ")}</p>
                </div>
              )}
              <p className="mt-1 text-[9px] text-fg-faint">{analysis.nodes.toLocaleString()} nodes · {analysis.knps.toFixed(1)} knps</p>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-fg-faint">
              {analyzing ? "Analyzing..." : "Click Analyze for a real engine evaluation + best line."}
            </p>
          )}
          <button
            onClick={() => void handleAnalyze()}
            disabled={!gameStarted || analyzing}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-[10px] text-fg-muted hover:text-fg disabled:opacity-40"
          >
            {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
            {analyzing ? "Analyzing..." : "Analyze Position"}
          </button>
        </div>

        {}
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="text-[11px] font-medium text-fg">Chess engine hints</span>
          </div>
          <p className="mt-1 text-[10px] text-fg-faint">
            {gameStarted ? "Get a hint from the local chess engine." : "Start a game to use engine hints."}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              onClick={() => void handleHint()}
              disabled={!gameStarted || engineThinking}
              className="flex items-center justify-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-[10px] text-fg-muted hover:text-fg disabled:opacity-40"
            >
              <Lightbulb className="h-3 w-3" /> Hint
            </button>
            
          </div>
        </div>
      </div>
    </div>
  );
}






/* ═══ Learn Tab ═══ */

function LearnTab({ initialLessonId, onLessonConsumed }: { initialLessonId?: string | null; onLessonConsumed?: () => void }) {
  const [selectedLesson, setSelectedLesson] = useState<ChessLesson | null>(() => {
    if (!initialLessonId) return null;
    return CHESS_LESSONS.find((l) => l.id === initialLessonId) ?? null;
  });
  // Phase 14: lazy initializer reads localStorage once on mount — no
  // setState-in-effect.
  const [lessonProgress, setLessonProgress] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("lucian-chess-progress") || "{}"); } catch { return {}; }
  });
  const [moveIndex, setMoveIndex] = useState(0);

  useEffect(() => {
    if (initialLessonId) onLessonConsumed?.();
  }, [initialLessonId, onLessonConsumed]);

  const saveProgress = (p: Record<string, boolean>) => {
    setLessonProgress(p);
    localStorage.setItem("lucian-chess-progress", JSON.stringify(p));
  };

  const lessons = CHESS_LESSONS;

  const openLesson = (lesson: ChessLesson) => {
    setSelectedLesson(lesson);
    setMoveIndex(0);
  };

  if (selectedLesson) {
    const game = new Chess();
    try {
      if (selectedLesson.moves) {
        for (let i = 0; i <= moveIndex && i < selectedLesson.moves.length; i++) {
          game.move(selectedLesson.moves[i]);
        }
      } else if (selectedLesson.fen) {
        game.load(selectedLesson.fen);
      }
    } catch { /* ignore */ }

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 lg:flex-row">
        <div className="flex flex-col items-center">
          <ChessBoard fen={game.fen()} flipped={false} interactive={false} />
          {selectedLesson.moves && (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" aria-label="Previous lesson move" onClick={() => setMoveIndex(i => Math.max(0, i - 1))} disabled={moveIndex === 0}
                className="rounded-md border border-line bg-surface p-1.5 text-fg-muted hover:text-fg disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="text-[11px] text-fg-muted">Move {moveIndex + 1} / {selectedLesson.moves.length}</span>
              <button type="button" aria-label="Next lesson move" onClick={() => setMoveIndex(i => Math.min(selectedLesson.moves!.length - 1, i + 1))} disabled={moveIndex >= selectedLesson.moves.length - 1}
                className="rounded-md border border-line bg-surface p-1.5 text-fg-muted hover:text-fg disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 lg:mt-0 lg:ml-4 lg:w-[280px]">
          <button onClick={() => setSelectedLesson(null)} className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> Lessons
          </button>
          <div className="rounded-md border border-line bg-surface p-4">
            <h2 className="text-[14px] font-semibold text-fg">{selectedLesson.title}</h2>
            <p className="mt-1 text-[11px] text-fg-muted">{selectedLesson.description}</p>
            <div className="mt-3 rounded border border-line-muted bg-surface-2 p-3">
              <p className="text-[10px] uppercase text-fg-faint">Concept</p>
              <p className="mt-0.5 text-[12px] text-fg">{selectedLesson.concept}</p>
            </div>
          </div>
          <button onClick={() => { saveProgress({ ...lessonProgress, [selectedLesson.id]: true }); toast({ title: "Lesson completed" }); }}
            className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5 text-[11px] text-[var(--accent)]">
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark as Completed
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <h2 className="mb-3 text-[14px] font-semibold text-fg">Lessons</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lessons.map(lesson => (
          <button key={lesson.id} onClick={() => openLesson(lesson)}
            className="rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-fg-faint">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-[12px] font-medium text-fg">{lesson.title}</p>
              {lessonProgress[lesson.id] && <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[10px] text-fg-muted">{lesson.description}</p>
            <div className="mt-1.5 flex items-center gap-2 text-[9px] text-fg-faint">
              <span className="capitalize">{lesson.type}</span>
              <span>·</span>
              <span>{lesson.difficulty}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══ Puzzles Tab ═══ */

function PuzzlesTab() {
  const [puzzleIdx, setPuzzleIdx] = useState(0);
  // Phase 14: derive solved state from localStorage lazily on first render
  // (no setState-in-effect). The initializer runs once on mount.
  const [solved, setSolved] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("lucian-chess-puzzles-solved") || "{}"); } catch { return {}; }
  });
  const [solutionIdx, setSolutionIdx] = useState(0);
  const [feedback, setFeedback] = useState<"idle" | "correct" | "incorrect" | "solved">("idle");
  const [hintLevel, setHintLevel] = useState(0);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const puzzle = CHESS_PUZZLES[puzzleIdx];

  const saveSolved = (s: Record<string, boolean>) => {
    setSolved(s);
    localStorage.setItem("lucian-chess-puzzles-solved", JSON.stringify(s));
  };

  // Reset puzzle state when the index changes.
  // The `resetKey` is bumped by `resetPuzzle` so the memoized `game`
  // instance is recreated from the puzzle's starting FEN. Without this,
  // calling resetPuzzle would only update the displayed `fen` state
  // while the underlying `game` instance remained mutated — subsequent
  // moves would be applied to the wrong position.
  const [resetKey, setResetKey] = useState(0);
  const game = useMemo(() => {
    if (!puzzle) return new Chess();
    const g = new Chess(puzzle.fen);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle, resetKey]);
  // Phase 14: derived-state-with-reset pattern (no setState-in-effect).
  // The initializer runs once on mount; the conditional reset runs
  // synchronously during render when the puzzle index OR resetKey
  // changes (i.e. user clicked Reset, or navigated to a different puzzle).
  const [fen, setFen] = useState(() => game.fen());
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [lastPuzzleIdx, setLastPuzzleIdx] = useState(puzzleIdx);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (puzzleIdx !== lastPuzzleIdx || resetKey !== lastResetKey) {
    setLastPuzzleIdx(puzzleIdx);
    setLastResetKey(resetKey);
    setFen(game.fen());
    setLastMove(null);
    setSolutionIdx(0);
    setFeedback("idle");
    setHintLevel(0);
    setHintText(null);
    setHintSquare(null);
    setSelected(null);
    setLegalTargets([]);
  }

  const handleSquareClick = useCallback((square: string) => {
    if (feedback === "solved") return;
    const expectedSan = puzzle?.solutionMoves[solutionIdx];
    if (!expectedSan) return;

    if (selected) {
      // Try this move.
      try {
        const move = game.move({ from: selected, to: square, promotion: "q" });
        if (move) {
          if (move.san === expectedSan || move.san.replace(/[+#]/g, "") === expectedSan.replace(/[+#]/g, "")) {
            // Correct move — apply it + advance the solution index.
            setLastMove({ from: move.from, to: move.to });
            setFen(game.fen());
            setSelected(null);
            setLegalTargets([]);
            const nextIdx = solutionIdx + 1;
            if (nextIdx >= puzzle.solutionMoves.length) {
              // Puzzle solved!
              setFeedback("solved");
              const newSolved = { ...solved, [puzzle.id]: true };
              saveSolved(newSolved);
              toast({ title: "Puzzle solved!", description: puzzle.title });
            } else {
              setFeedback("correct");
              setSolutionIdx(nextIdx);
              // Play the opponent's forced response automatically.
              const opponentMove = puzzle.solutionMoves[nextIdx];
              if (opponentMove) {
                setTimeout(() => {
                  try {
                    const m = game.move(opponentMove);
                    if (m) {
                      setLastMove({ from: m.from, to: m.to });
                      setFen(game.fen());
                      setSolutionIdx(idx => idx + 1);
                    }
                  } catch { /* puzzle solution data error */ }
                }, 400);
              }
            }
          } else {
            // Incorrect move — undo + feedback.
            game.undo();
            setFeedback("incorrect");
            toast({ title: "Not the right move", description: `Expected: ${expectedSan}`, variant: "destructive" });
            setTimeout(() => setFeedback("idle"), 1500);
          }
        }
      } catch {
        // Illegal move — try selecting a new piece.
        const piece = game.get(square as never);
        if (piece && piece.color === puzzle.sideToMove) {
          setSelected(square);
          const moves = game.moves({ square: square as never, verbose: true });
          setLegalTargets(moves.map(m => m.to));
        } else {
          setSelected(null);
          setLegalTargets([]);
        }
      }
    } else {
      const piece = game.get(square as never);
      if (piece && piece.color === puzzle.sideToMove) {
        setSelected(square);
        const moves = game.moves({ square: square as never, verbose: true });
        setLegalTargets(moves.map(m => m.to));
      }
    }
  }, [selected, game, puzzle, solutionIdx, feedback, solved]);

  const handleHint = () => {
    if (!puzzle) return;
    const expectedSan = puzzle.solutionMoves[solutionIdx];
    if (!expectedSan) return;
    // Progressive hints:
    //   Level 1: theme/concept (no specific move).
    //   Level 2: which piece to move (origin square).
    //   Level 3: the full solution move.
    if (hintLevel === 0) {
      const themes = puzzle.themes?.join(", ") ?? "tactical motif";
      setHintText(`Hint 1: Look for a ${themes}. Think about forcing moves.`);
      setHintLevel(1);
    } else if (hintLevel === 1) {
      // Find the origin square by replaying the expected move.
      const tempGame = new Chess(game.fen());
      try {
        const m = tempGame.move(expectedSan);
        if (m) {
          setHintSquare(m.from);
          setHintText(`Hint 2: Start from ${m.from}.`);
          setHintLevel(2);
        }
      } catch { /* solution data error */ }
    } else {
      // Final hint: reveal the full move.
      setHintText(`Solution: ${expectedSan}`);
      setHintLevel(3);
    }
  };

  const resetPuzzle = () => {
    // Bumping resetKey triggers the derived-state-with-reset pattern
    // above, which re-creates `game` from puzzle.fen and re-syncs fen
    // + all dependent state. This guarantees the puzzle returns to its
    // true starting position even after the user has played moves or
    // the opponent response has been auto-played.
    setResetKey(k => k + 1);
  };

  const nextPuzzle = () => {
    setPuzzleIdx(i => Math.min(CHESS_PUZZLES.length - 1, i + 1));
  };

  if (!puzzle) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-8 text-center">
        <div>
          <Target className="mx-auto h-10 w-10 text-fg-faint opacity-30" />
          <p className="mt-2 text-[13px] font-medium text-fg-muted">No puzzles available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 lg:flex-row">
      <div className="flex flex-col items-center">
        <ChessBoard
          fen={fen}
          onMove={handleSquareClick}
          flipped={false}
          lastMove={lastMove}
          selected={selected}
          legalTargets={legalTargets}
          interactive={feedback !== "solved"}
          hintSquare={hintSquare}
        />
        {feedback === "solved" && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-green-500">
            <CheckCircle2 className="h-3 w-3" /> Solved!
          </div>
        )}
        {feedback === "incorrect" && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-500">
            <AlertCircle className="h-3 w-3" /> Incorrect — try again.
          </div>
        )}
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 lg:mt-0 lg:ml-4 lg:w-[280px]">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-fg">{puzzle.title}</h2>
            {solved[puzzle.id] && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />}
          </div>
          <p className="mt-1 text-[10px] text-fg-faint">
            {puzzle.sideToMove === "w" ? "White" : "Black"} to move
            {puzzle.themes && puzzle.themes.length > 0 && ` · ${puzzle.themes.join(", ")}`}
            {puzzle.rating && ` · rating ${puzzle.rating}`}
          </p>
          {puzzle.source && (
            <p className="mt-1 text-[9px] text-fg-faint">Source: {puzzle.source}</p>
          )}
        </div>

        {/* Hint */}
        {hintText && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
            <p className="text-[10px] text-amber-600 dark:text-amber-400">{hintText}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={handleHint}
            disabled={feedback === "solved"}
            className="flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] text-fg-muted hover:text-fg disabled:opacity-40"
          >
            <Lightbulb className="h-3.5 w-3.5" /> Hint {hintLevel > 0 ? `(${hintLevel}/3)` : ""}
          </button>
          
        </div>
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Previous puzzle" onClick={() => setPuzzleIdx(i => Math.max(0, i - 1))} disabled={puzzleIdx === 0}
            className="rounded p-1.5 text-fg-muted hover:bg-hover disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-[11px] text-fg-faint">Puzzle {puzzleIdx + 1} / {CHESS_PUZZLES.length}</span>
          <button type="button" aria-label="Next puzzle" onClick={nextPuzzle} disabled={puzzleIdx >= CHESS_PUZZLES.length - 1}
            className="rounded p-1.5 text-fg-muted hover:bg-hover disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <button onClick={resetPuzzle} className="flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] text-fg-muted hover:text-fg">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>
    </div>
  );
}
