"use client";

/* LUCIAN — Shared Regional Format Helpers.
 *
 * Reads the regional preferences from useSettingsStore and exposes pure
 * formatting helpers that any component can call. This is the SINGLE
 * place where LUCIAN's regional formatting is defined — components do
 * NOT implement their own toLocaleString() / Intl.NumberFormat() calls
 * for these concerns.
 *
 * Used by:
 *   - Vault money / balance displays (where they want to honour the
 *     global currency-display preference)
 *   - Activity timeline timestamps
 *   - Notification timestamps
 *   - Anywhere we render a date / time / number
 *
 * Notes:
 *   - These helpers read the settings store LIVE (via getState()), so
 *     they always reflect the current preference. They are safe to call
 *     during render.
 *   - For SSR safety, helpers fall back to en-US when the store has not
 *     yet hydrated.
 */

import { useSettingsStore, type DateFormat, type NumberFormat, type TimeFormat, type CurrencyDisplay } from "@/store/settings";

/* ─── Locale resolution ─── */

function localeForNumberFormat(fmt: NumberFormat): string {
  switch (fmt) {
    case "us":  return "en-US";
    case "eu":  return "de-DE"; // de-DE uses 1.234,56
    case "iso": return "en-US"; // we override the group separator below
    default:    return "en-US";
  }
}

function localeForDateFormat(fmt: DateFormat): string {
  switch (fmt) {
    case "iso":  return "sv-SE"; // YYYY-MM-DD
    case "us":   return "en-US";
    case "eu":   return "en-GB"; // DD/MM/YYYY
    case "long": return "en-US";
    default:     return "en-US";
  }
}

/* ─── Public formatters ─── */

/** Format a timestamp according to the user's time format preference. */
export function formatTime(ts: number): string {
  if (!Number.isFinite(ts)) return "—";
  const timeFormat = safeReadTimeFormat();
  const locale = localeForDateFormat(safeReadDateFormat());
  const opts: Intl.DateTimeFormatOptions =
    timeFormat === "24h"
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : { hour: "numeric", minute: "2-digit", hour12: true };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
}

/** Format a date according to the user's date format preference. */
export function formatDate(ts: number): string {
  if (!Number.isFinite(ts)) return "—";
  const dateFormat = safeReadDateFormat();
  const locale = localeForDateFormat(dateFormat);
  if (dateFormat === "long") {
    try {
      return new Intl.DateTimeFormat(locale, {
        year: "numeric", month: "short", day: "numeric",
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toDateString();
    }
  }
  try {
    return new Intl.DateTimeFormat(locale).format(new Date(ts));
  } catch {
    return new Date(ts).toDateString();
  }
}

/** Format a date + time together using the user's preferences. */
export function formatDateTime(ts: number): string {
  return `${formatDate(ts)} · ${formatTime(ts)}`;
}

/** Format a number using the user's number-format preference. */
export function formatNumber(value: number, opts?: { maximumFractionDigits?: number }): string {
  if (!Number.isFinite(value)) return "—";
  const numberFormat = safeReadNumberFormat();
  if (numberFormat === "iso") {
    // ISO uses space as the group separator and . as decimal.
    const s = new Intl.NumberFormat("en-US", {
      useGrouping: true,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
    }).format(value);
    return s.replace(/,/g, " ");
  }
  try {
    return new Intl.NumberFormat(localeForNumberFormat(numberFormat), {
      maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
    }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Format a money amount using the user's currency-display preference.
 *
 * NOTE: Vault has its own `formatMoney()` helper in src/store/vault.ts.
 * That helper is the canonical money formatter for Vault internal
 * displays. This helper is the GLOBAL one — components outside Vault
 * (Home, Notifications, Search) should use this so they honour the
 * global currency display preference.
 */
export function formatMoneyGlobal(amount: number, currency = "USD"): string {
  if (!Number.isFinite(amount)) return "—";
  const display = safeReadCurrencyDisplay();
  try {
    const opts: Intl.NumberFormatOptions = {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    };
    if (display === "code") {
      const formatted = new Intl.NumberFormat("en-US", {
        ...opts,
        currencyDisplay: "code",
      }).format(amount);
      return `${formatted} ${currency}`;
    }
    if (display === "name") {
      return new Intl.NumberFormat("en-US", {
        ...opts,
        currencyDisplay: "name",
      }).format(amount);
    }
    return new Intl.NumberFormat("en-US", {
      ...opts,
      currencyDisplay: "symbol",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/* ─── Privacy-aware money formatter (masks the amount when privacy is on) ─── */

/**
 * Format a money amount, applying the global privacy mask when:
 *   - privacyMode is on, OR
 *   - one of the specific mask toggles is on AND `scope` matches.
 *
 * `scope` is which surface is calling: "home" | "search" | "notifications".
 * The dedicated toggles (maskSensitiveOnHome, maskSensitiveInGlobalSearch,
 * maskSensitiveInNotifications) take precedence; privacyMode is the master.
 *
 * The underlying value is NEVER modified — only the rendered string.
 */
export function formatMoneyPrivate(
  amount: number,
  currency: string,
  scope: "home" | "search" | "notifications",
): string {
  if (shouldMaskSensitive(scope)) {
    return maskMoneyString(currency);
  }
  return formatMoneyGlobal(amount, currency);
}

/* ─── Privacy helpers ─── */

/** Read whether a given scope should mask sensitive values. */
export function shouldMaskSensitive(scope: "home" | "search" | "notifications"): boolean {
  if (typeof window === "undefined") return false;
  const s = useSettingsStore.getState();
  if (s.privacy.privacyMode) return true;
  if (scope === "home" && s.privacy.maskSensitiveOnHome) return true;
  if (scope === "search" && s.privacy.maskSensitiveInGlobalSearch) return true;
  if (scope === "notifications" && s.privacy.maskSensitiveInNotifications) return true;
  return false;
}

/** Mask a money string: "$1,234.56" → "••••••". */
export function maskMoneyString(currency: string): string {
  // Show the currency code so the user still knows the unit, but hide
  // the amount. This matches the "mask presentation, not value" rule.
  const display = safeReadCurrencyDisplay();
  if (display === "code") return `•••• ${currency}`;
  if (display === "name") return `•••• ${currency}`;
  return "••••••";
}

/** Mask an account identifier: "Chase •••• 0921" → "Chase •••• ••••". */
export function maskAccountIdentifier(identifier: string): string {
  if (!identifier) return identifier;
  // Replace any 3+ digit run with bullets.
  return identifier.replace(/\d{3,}/g, (match) => "•".repeat(match.length));
}

/* ─── Internal safe reads (SSR-safe) ─── */

function safeReadTimeFormat(): TimeFormat {
  if (typeof window === "undefined") return "12h";
  return useSettingsStore.getState().general.regional.timeFormat;
}

function safeReadDateFormat(): DateFormat {
  if (typeof window === "undefined") return "us";
  return useSettingsStore.getState().general.regional.dateFormat;
}

function safeReadNumberFormat(): NumberFormat {
  if (typeof window === "undefined") return "us";
  return useSettingsStore.getState().general.regional.numberFormat;
}

function safeReadCurrencyDisplay(): CurrencyDisplay {
  if (typeof window === "undefined") return "symbol";
  return useSettingsStore.getState().general.regional.currencyDisplay;
}
