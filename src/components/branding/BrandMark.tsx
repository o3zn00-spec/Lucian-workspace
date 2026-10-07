import Image from "next/image";

interface BrandMarkProps {
  /** Pixel size of the rendered mark (square) */
  size?: number;
  className?: string;
  /** Optional tooltip/screen-reader label override */
  label?: string;
}

/**
 * Compact Lucian rising-building and arc gold emblem.
 *
 * Used as the small application icon in the top navigation, in the sidebar
 * header, and anywhere a compact brand mark is needed.
 *
 * The mark is a static asset under app/icon.png (served as /icon.png)
 * and intentionally does NOT inherit the active accent color — the gold
 * branding is its own visual identity, independent of the chosen accent.
 */
export function BrandMark({
  size = 32,
  className = "",
  label = "Lucian Workspace",
}: BrandMarkProps) {
  return (
    <Image
      src="/icon.png"
      alt={label}
      width={size}
      height={size}
      priority
      className={`pointer-events-none select-none ${className}`}
    />
  );
}
