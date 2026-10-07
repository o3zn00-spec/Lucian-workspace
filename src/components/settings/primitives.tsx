"use client";

/* LUCIAN — Settings primitives.
 *
 * Tiny shared building blocks used across all Settings sections.
 * Kept deliberately minimal — the visual style of Settings is
 * intentionally close to GitHub/Linear settings (rows, not boxes).
 */

import { type ReactNode } from "react";

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="settings-group themed">
      {title && <div className="settings-group-heading">{title}</div>}
      {children}
    </div>
  );
}

export function SettingsRow({
  title, description, children, onClick,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button onClick={onClick} className="settings-row themed w-full text-left hover:bg-hover">
        <div className="settings-row-text">
          <div className="settings-row-title">{title}</div>
          {description && <div className="settings-row-desc">{description}</div>}
        </div>
        {children && <div className="settings-row-control">{children}</div>}
      </button>
    );
  }
  return (
    <div className="settings-row themed">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

export function SettingsSectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-1">
      <h2 className="settings-section-title">{title}</h2>
      {subtitle && <p className="settings-section-subtitle">{subtitle}</p>}
    </div>
  );
}

export function SettingsDivider() {
  return <div className="my-3 h-px bg-line-muted/60" />;
}

export function StatusPill({
  status, label,
}: {
  status: "ready" | "configured" | "setup_required" | "not_configured" | "error" | "unavailable";
  label: string;
}) {
  return (
    <span className="settings-status-pill" data-status={status}>
      <span className="dot" />
      {label}
    </span>
  );
}
