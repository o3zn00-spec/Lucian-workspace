import Image from "next/image";

interface BrandWordmarkProps {
  /** Rendered height in px. Width scales proportionally (~3:1). */
  height?: number;
  className?: string;
  label?: string;
}

/**
 * Full Lucian Workspace horizontal wordmark (emblem + Lucian + WORKSPACE).
 *
 * Used where a larger brand statement is needed (auth screens, marketing
 * pages, dialog headers). For the small top-nav icon use <BrandMark>.
 */
export function BrandWordmark({
  height = 32,
  className = "",
  label = "Lucian Workspace",
}: BrandWordmarkProps) {
  // The full wordmark asset is 927x378 → aspect ≈ 2.452:1
  const width = Math.round(height * (927 / 378));
  return (
    <Image
      src="/branding/lucian-workspace-logo.png"
      alt={label}
      width={width}
      height={height}
      priority
      className={`pointer-events-none select-none ${className}`}
    />
  );
}
