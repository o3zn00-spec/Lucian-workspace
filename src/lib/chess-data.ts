// Static curriculum data for Chess Academy.
// Designed so an external chess AI / tutor can be plugged in later
// without changing the data shape.

export type ChessLesson = {
  id: string
  type: "opening" | "tactic" | "strategy" | "endgame" | "history"
  title: string
  difficulty: "Beginner" | "Intermediate" | "Advanced"
  fen?: string
  description: string
  moves?: string[] // SAN moves for replay
  concept: string
  source?: string
}

export const CHESS_LESSONS: ChessLesson[] = [
  // Openings
  {
    id: "op-italian",
    type: "opening",
    title: "Italian Game",
    difficulty: "Beginner",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    description: "A classical opening focusing on quick development and central control.",
    concept: "Develop pieces toward the center, eye the f7 weak square.",
  },
  {
    id: "op-sicilian",
    type: "opening",
    title: "Sicilian Defense",
    difficulty: "Intermediate",
    fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR b",
    moves: ["e4", "c5"],
    description: "Black fights for central equality with an asymmetrical structure.",
    concept: "Asymmetry creates dynamic chances for both sides.",
  },
  {
    id: "op-queensgambit",
    type: "opening",
    title: "Queen's Gambit",
    difficulty: "Intermediate",
    fen: "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b",
    moves: ["d4", "d5", "c4"],
    description: "White offers a wing pawn for central control.",
    concept: "Temporary pawn sacrifice to dominate the center.",
  },
  // Tactics
  {
    id: "ta-fork",
    type: "tactic",
    title: "The Knight Fork",
    difficulty: "Beginner",
    fen: "4k3/8/8/3N4/8/8/8/4K3 b",
    description: "A knight attacks two pieces simultaneously.",
    concept: "Knights fork in patterns other pieces cannot.",
  },
  {
    id: "ta-pin",
    type: "tactic",
    title: "The Pin",
    difficulty: "Beginner",
    fen: "4k3/8/8/8/8/3r4/3B4/4K3 b",
    description: "A piece is pinned against a more valuable one.",
    concept: "Pinned pieces cannot move without exposing a stronger piece.",
  },
  {
    id: "ta-skewer",
    type: "tactic",
    title: "The Skewer",
    difficulty: "Intermediate",
    fen: "4k3/8/8/8/8/3R4/8/4K3 b",
    description: "A valuable piece is attacked and must move, exposing a piece behind it.",
    concept: "Skewers win material by force.",
  },
  // Strategy
  {
    id: "st-center",
    type: "strategy",
    title: "Central Control",
    difficulty: "Beginner",
    description: "Occupying the center provides mobility and board dominance.",
    concept: "Central pawns and pieces restrict the opponent's options.",
  },
  {
    id: "st-weak-squares",
    type: "strategy",
    title: "Weak Squares",
    difficulty: "Advanced",
    description: "Squares that cannot be defended by pawns become permanent weaknesses.",
    concept: "Identify and exploit squares no pawn can recapture on.",
  },
  // Endgames
  {
    id: "eg-kq-vs-k",
    type: "endgame",
    title: "King + Queen vs King",
    difficulty: "Beginner",
    fen: "4k3/8/8/8/8/8/3Q4/4K3 b",
    description: "The simplest mating technique using the queen to box the king.",
    concept: "Drive the enemy king to the edge, then deliver mate.",
  },
  {
    id: "eg-kp-vs-k",
    type: "endgame",
    title: "King + Pawn vs King",
    difficulty: "Intermediate",
    fen: "8/8/8/4k3/4P3/4K3/8/8 b",
    description: "Master the opposition to promote the pawn.",
    concept: "Whoever has the opposition wins.",
  },
  // History
  {
    id: "hi-opera",
    type: "history",
    title: "Opera Game (1858)",
    difficulty: "Beginner",
    moves: ["e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5", "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+", "Nxd7", "Qb8+", "Nxb8", "Rd8#"],
    description: "Paul Morphy's celebrated combination at the Paris Opera House.",
    concept: "Rapid development + open lines = decisive attack.",
    source: "Paris Opera House, 1858",
  },
  {
    id: "hi-immortal",
    type: "history",
    title: "Immortal Game (1851)",
    difficulty: "Advanced",
    description: "Anderssen sacrifices both rooks and the queen to mate with three minor pieces.",
    concept: "Activity can outweigh raw material count.",
    source: "London, 1851",
  },
]

export const CHESS_OPENINGS = CHESS_LESSONS.filter((l) => l.type === "opening")
export const CHESS_TACTICS = CHESS_LESSONS.filter((l) => l.type === "tactic")
export const CHESS_STRATEGY = CHESS_LESSONS.filter((l) => l.type === "strategy")
export const CHESS_ENDGAMES = CHESS_LESSONS.filter((l) => l.type === "endgame")
export const CHESS_HISTORY = CHESS_LESSONS.filter((l) => l.type === "history")
