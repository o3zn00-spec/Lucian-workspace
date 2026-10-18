export type ChatInteraction =
  | { lilthe_ui: "question"; question: string; options: string[] }
  | { lilthe_ui: "trade_review"; summary: string }
  | { lilthe_ui: "chart"; symbol: string; interval: "15" | "60" | "D"; summary: string; lines: { label: string; from: { time: number; price: number }; to: { time: number; price: number } }[] };

// Model output is presentation data only. Choices submit normal owner messages;
// review always loads the saved owner plan from the server, never model fields.
export function parseChatInteraction(content: string): ChatInteraction | null {
  try {
    const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.lilthe_ui === "question" && Object.keys(value).every(k => ["lilthe_ui", "question", "options"].includes(k)) &&
      typeof value.question === "string" && value.question.trim() && value.question.length <= 500 &&
      Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 5 &&
      value.options.every((o: unknown) => typeof o === "string" && o.trim() && o.length <= 120) && new Set(value.options).size === value.options.length) return value;
    if (value.lilthe_ui === "chart" && Object.keys(value).every(k => ["lilthe_ui","symbol","interval","summary","lines"].includes(k)) &&
      typeof value.symbol === "string" && /^[A-Z0-9]{2,16}USDT$/.test(value.symbol) && ["15","60","D"].includes(value.interval) && typeof value.summary === "string" && value.summary.length <= 1200 &&
      Array.isArray(value.lines) && value.lines.length <= 4 && value.lines.every((line: { label?: unknown; from?: unknown; to?: unknown }) => {
        if (!line || Object.keys(line).sort().join(",") !== "from,label,to" || typeof line.label !== "string" || !line.label.trim() || line.label.length > 80) return false;
        const point = (p: unknown) => { if (!p || typeof p !== "object") return false; const v = p as Record<string, unknown>; return Object.keys(v).sort().join(",") === "price,time" && typeof v.time === "number" && Number.isSafeInteger(v.time) && v.time > 0 && typeof v.price === "number" && Number.isFinite(v.price) && v.price > 0 && v.price < 1e12; };
        return point(line.from) && point(line.to);
      })) return value;
    if (value.lilthe_ui === "trade_review" && Object.keys(value).every(k => ["lilthe_ui", "summary"].includes(k)) &&
      typeof value.summary === "string" && value.summary.length <= 4000) return value;
  } catch { /* Ordinary prose is not an interactive request. */ }
  return null;
}

export const CHAT_INTERACTION_INSTRUCTIONS = `
CONVERSATIONAL INTERFACE
When a decision benefits from choices, return ONLY a JSON object:
{"lilthe_ui":"question","question":"One short, natural question","options":["First choice","Second choice"]}
Use two to five concise options. The owner can always type another answer.
These choices collect preferences; they cannot authorize financial actions or grant permissions.
For trading, gather direction, duration, capital and research preference progressively,
skipping what the owner already supplied. Ask one compact question at a time.
Explain proposed risk, exit and technical settings in plain language and include them
in the review; do not dump a long missing-fields checklist or raw draft JSON.
A proposal is never permission. Do not invent owner preferences or claim that
a recommended plan guarantees profit. Short execution uses product linear_short: USDT perpetuals using exchange-detected Cross or Isolated margin, per-symbol leverage and one-way or hedge short slots, shown in the server review. It requires a new reviewed session and separately enabled derivatives access. Never promise account eligibility before server preview passes. Existing Spot grants remain Spot-only.
Save supplied rules using planning tools before claiming they are saved.
After tools confirm a complete saved plan, return ONLY:
{"lilthe_ui":"trade_review","summary":"Brief explanation of the saved proposal, under 1000 characters"}
This renders a real server-backed review in this conversation. The owner loads and
reviews exact rules, then authorizes with their password and confirmation phrase.
Never put passwords, authority, order parameters or an execution URL in UI JSON.
Do not redirect to Markets forms when this review can handle the saved plan.
After public market research, you may show an annotated chart using ONLY JSON:
{"lilthe_ui":"chart","symbol":"BTCUSDT","interval":"15","summary":"Evidence and uncertainty","lines":[{"label":"Proposed support","from":{"time":1700000000,"price":1},"to":{"time":1700000900,"price":1}}]}
Use actual research candle timestamps converted from milliseconds to seconds and observed prices, never example values. Up to four lines. Intervals are 15, 60 or D. Labels describe your interpretation, not verified patterns or certain predictions. The card fetches exchange candles independently and rejects out-of-window anchors. Explain evidence, counter-evidence and invalidation in the summary. If evidence is insufficient, use prose instead.
For other answers use readable Markdown. Never describe an unconfirmed action as completed.
`;
