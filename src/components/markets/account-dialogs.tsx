"use client";

/* LUCIAN Markets — Account dialogs + Operation History drawer.
 *
 * Phase 3 introduces honest behavior for the financial action buttons
 * (Deposit / Withdraw / Transfer) and the Operation History button.
 *
 *   - Virtual mode actions: Virtual Account → Reset to $1,000 (a
 *     clearly simulated action, not a fake bank deposit).
 *   - Real mode actions: every button shows an honest
 *     "Broker / Financial Provider Required" state.
 *   - Operation History: opens a real right-side drawer showing every
 *     Virtual-account event (positions opened/closed, pending placed/
 *     triggered/cancelled/rejected, account resets) from persisted
 *     localStorage data.
 */

import { useEffect, useMemo, useState } from "react";
import {
  X,
  AlertCircle,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  History,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Plus,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketsStore } from "@/store/markets";
import { resetPaperAccount } from "@/lib/markets/paper-trading";
import type { OperationHistoryEntry } from "@/lib/markets/types";

/* ------------------------------------------------------------------ */
/* Account actions dialog — opened by the rail's Deposit/Withdraw/    */
/* Transfer buttons + the account-strip Deposit button.               */
/* ------------------------------------------------------------------ */

export type AccountActionKind = "deposit" | "withdraw" | "transfer";

export function AccountActionDialog({
  action,
  onClose,
}: {
  action: AccountActionKind;
  onClose: () => void;
}) {
  const accountMode = useMarketsStore((s) => s.accountMode);
  const refreshTrading = useMarketsStore((s) => s.refreshTrading);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const title =
    action === "deposit"
      ? "Deposit"
      : action === "withdraw"
      ? "Withdraw"
      : "Transfer";

  // ── Real mode — honest broker-required state ──
  if (accountMode !== "paper") {
    return (
      <DialogShell title={title} onClose={onClose}>
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <AlertCircle className="h-10 w-10 text-[#f5a623]" />
          <h3 className="text-[14px] font-semibold text-fg">
            Continue in Bybit Vault
          </h3>
          <p className="max-w-[280px] text-[11px] leading-relaxed text-fg-muted">
            {accountMode === "bybit_testnet" ? "Testnet" : "Live"} fund operations are handled by the protected Bybit Money Center in Vault.
            Deposits, withdrawals and transfers never run from this dialog.
          </p>
          <div className="mt-2 rounded border border-line-muted bg-surface-2 px-3 py-2 text-[10px] text-fg-faint">
            [ Open Vault → Money → Bybit ]
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 rounded bg-[var(--accent)] px-4 py-1.5 text-[12px] font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] themed"
          >
            Close
          </button>
        </div>
      </DialogShell>
    );
  }

  // ── Virtual mode — honest simulated-account behavior ──
  // We do NOT pretend these are real bank transfers. Each action shows
  // an honest explanation of what Virtual mode means.
  if (action === "deposit") {
    return (
      <DialogShell title="Virtual Deposit" onClose={onClose}>
        <div className="flex flex-col gap-3 px-5 py-5">
          <div className="rounded border border-line-muted bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
            This is a <span className="font-semibold text-fg">Virtual</span> (paper-trading) account.
            Virtual funds are simulated — they have no real-world value and cannot be deposited
            from or withdrawn to a real bank account.
          </div>
          <p className="text-[11px] text-fg">
            To reset your Virtual account back to the default $1,000.00 starting balance, use the
            button below. This will close all open positions and clear pending orders.
          </p>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Reset Virtual account to $1,000.00?\n\nThis will close all open positions and clear pending orders. Closed-position history is preserved.",
                )
              ) {
                resetPaperAccount();
                refreshTrading();
                onClose();
              }
            }}
            className="flex items-center justify-center gap-2 rounded bg-[var(--accent)] px-4 py-2 text-[12px] font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] themed"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset Virtual Account to $1,000.00
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-muted px-4 py-1.5 text-[11px] text-fg-muted hover:bg-hover"
          >
            Close
          </button>
        </div>
      </DialogShell>
    );
  }

  if (action === "withdraw") {
    return (
      <DialogShell title="Virtual Withdraw" onClose={onClose}>
        <div className="flex flex-col gap-3 px-5 py-5">
          <div className="rounded border border-line-muted bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
            This is a <span className="font-semibold text-fg">Virtual</span> (paper-trading) account.
            Virtual funds are simulated — they cannot be withdrawn as real money.
          </div>
          <p className="text-[11px] text-fg">
            To restart trading with a fresh $1,000.00 balance, use the Virtual Account Reset action.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-muted px-4 py-1.5 text-[11px] text-fg-muted hover:bg-hover"
          >
            Close
          </button>
        </div>
      </DialogShell>
    );
  }

  // transfer
  return (
    <DialogShell title="Virtual Transfer" onClose={onClose}>
      <div className="flex flex-col gap-3 px-5 py-5">
        <div className="rounded border border-line-muted bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
          LUCIAN Virtual mode does not currently have a connected internal fund-transfer system.
          Virtual funds cannot be transferred to another LUCIAN account or to a real bank account.
        </div>
        <p className="text-[11px] text-fg-muted">
          [ Provider / Account Connection Required ]
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-line-muted px-4 py-1.5 text-[11px] text-fg-muted hover:bg-hover"
        >
          Close
        </button>
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */
/* Operation History drawer — opens from the rail's "Operation        */
/* History" button. Shows every persisted Virtual-account event.      */
/* ------------------------------------------------------------------ */

export function OperationHistoryDrawer({ onClose }: { onClose: () => void }) {
  const history = useMarketsStore((s) => s.operationHistory);
  const refreshHistory = useMarketsStore((s) => s.refreshHistory);

  // Refresh on mount in case new entries were written since last refresh.
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Group entries by date for readability.
  const groups = useMemo(() => {
    const map = new Map<string, OperationHistoryEntry[]>();
    for (const e of history) {
      const key = new Date(e.timestamp).toLocaleDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [history]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Operation history">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <aside className="themed relative flex h-full w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-pop">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-muted px-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-[13px] font-semibold text-fg">Operation History</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-faint hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <Clock className="h-8 w-8 text-fg-faint opacity-40" />
              <p className="mt-2 text-[12px] font-medium text-fg-muted">No history yet</p>
              <p className="mt-1 text-[10px] text-fg-faint">
                Trading actions (open positions, pending orders, SL/TP closes, etc.) will appear here.
              </p>
            </div>
          ) : (
            groups.map(([date, items]) => (
              <div key={date} className="mb-3">
                <div className="sticky top-0 z-10 bg-surface px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                  {date}
                </div>
                <div className="space-y-1">
                  {items.map((e) => (
                    <HistoryEntryRow key={e.id} entry={e} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label={title}>
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="themed relative w-full max-w-[360px] rounded-md border border-line bg-surface shadow-pop">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line-muted px-4">
          <span className="text-[12px] font-semibold text-fg">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-faint hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HistoryEntryRow({ entry }: { entry: OperationHistoryEntry }) {
  const { icon: Icon, color } = historyEntryVisual(entry.kind);
  const time = new Date(entry.timestamp).toLocaleTimeString();
  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-hover">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-fg">
            {entry.kind.replace(/_/g, " ")}
          </span>
          <span className="shrink-0 text-[9px] text-fg-faint">{time}</span>
        </div>
        <p className="text-[10px] leading-snug text-fg-muted">{entry.detail}</p>
        {entry.realizedPnl !== null && (
          <span
            className={cn(
              "mt-0.5 inline-block font-mono text-[10px] tabular-nums",
              entry.realizedPnl > 0 ? "text-[#4bfa8f]" : entry.realizedPnl < 0 ? "text-[#ff5b5b]" : "text-fg-muted",
            )}
          >
            {entry.realizedPnl >= 0 ? "+" : ""}${entry.realizedPnl.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

function historyEntryVisual(kind: OperationHistoryEntry["kind"]): {
  icon: typeof Plus;
  color: string;
} {
  switch (kind) {
    case "position_opened":
      return { icon: Plus, color: "text-[var(--accent)]" };
    case "position_closed_manual":
      return { icon: CheckCircle2, color: "text-fg-muted" };
    case "position_closed_stop_loss":
      return { icon: XCircle, color: "text-[#ff5b5b]" };
    case "position_closed_take_profit":
      return { icon: CheckCircle2, color: "text-[#4bfa8f]" };
    case "pending_placed":
      return { icon: Clock, color: "text-fg-muted" };
    case "pending_triggered":
      return { icon: CheckCircle2, color: "text-[var(--accent)]" };
    case "pending_cancelled":
      return { icon: XCircle, color: "text-fg-faint" };
    case "pending_rejected":
      return { icon: AlertCircle, color: "text-[#f5a623]" };
    case "account_reset":
      return { icon: RefreshCw, color: "text-[var(--accent)]" };
    default:
      return { icon: History, color: "text-fg-muted" };
  }
}

/* Re-export icons used by the rail so the markets-frame can import them
   from one place if needed. */
export {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  History,
  RefreshCw,
};
