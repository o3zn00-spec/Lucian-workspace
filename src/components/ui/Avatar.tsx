"use client";

interface AvatarProps {
  size?: number;
  className?: string;
}

/**
 * Placeholder avatar — an accent-tinted disc with the Lucian initial.
 *
 * Used in the profile menu only. Real user-identity / authentication arrives
 * in a later phase; for now this is just a visual placeholder.
 */
export function Avatar({ size = 32, className = "" }: AvatarProps) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`themed inline-flex select-none items-center justify-center rounded-full border border-line bg-[color-mix(in_srgb,var(--accent)_22%,var(--surface))] font-semibold text-fg ${className}`}
    >
      L
    </span>
  );
}
