import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind class merger — combines clsx (conditional classes) with
 * tailwind-merge (deduplicates conflicting Tailwind utilities).
 *
 * Used by the ported shadcn-style UI primitives to accept className overrides
 * the same way the rest of the codebase does.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
