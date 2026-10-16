export type ChatInteraction =
  | { lilthe_ui: "question"; question: string; options: string[] }
  | { lilthe_ui: "trade_review"; summary: string };

// Model output is presentation data only. Choices submit normal owner messages;
// review always loads the saved owner plan from the server, never model fields.
export function parseChatInteraction(content: string): ChatInteraction | null {
  try {
    const value = JSON.parse(content.trim());
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.lilthe_ui === "question" && Object.keys(value).every(k => ["lilthe_ui", "question", "options"].includes(k)) &&
      typeof value.question === "string" && value.question.trim() && value.question.length <= 500 &&
      Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 5 &&
      value.options.every((o: unknown) => typeof o === "string" && o.trim() && o.length <= 120) && new Set(value.options).size === value.options.length) return value;
    if (value.lilthe_ui === "trade_review" && Object.keys(value).every(k => ["lilthe_ui", "summary"].includes(k)) &&
      typeof value.summary === "string" && value.summary.length <= 1000) return value;
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
a recommended plan guarantees profit. Do not pretend short execution is supported
by the current Spot-only autonomous engine; offer research with an honest limitation.
Save supplied rules using planning tools before claiming they are saved.
After tools confirm a complete saved plan, return ONLY:
{"lilthe_ui":"trade_review","summary":"Brief explanation of the saved proposal"}
This renders a real server-backed review in this conversation. The owner loads and
reviews exact rules, then authorizes with their password and confirmation phrase.
Never put passwords, authority, order parameters or an execution URL in UI JSON.
Do not redirect to Markets forms when this review can handle the saved plan.
For other answers use readable Markdown. Never describe an unconfirmed action as completed.
`;
