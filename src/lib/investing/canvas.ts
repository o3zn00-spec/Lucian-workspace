export interface InvestmentConnection { id: string; from: string; to: string; label: string }

/** References only: the canvas never creates balances or copies holding records. */
export function validateConnection(
  existingIds: readonly string[], connections: readonly InvestmentConnection[],
  from: string, to: string, label: string,
): string | null {
  if (!existingIds.includes(from) || !existingIds.includes(to)) return "Choose two existing investments.";
  if (from === to) return "Choose two different investments.";
  if (!label.trim() || label.trim().length > 80) return "Describe the relationship in 1–80 characters.";
  if (connections.some((c) => c.from === from && c.to === to && c.label === label.trim())) return "That relationship already exists.";
  return null;
}

export function clampCanvasZoom(value: number) { return Math.max(0.4, Math.min(2, value)); }
