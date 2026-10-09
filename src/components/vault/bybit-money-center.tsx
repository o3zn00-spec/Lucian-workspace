"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Bitcoin, Copy, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { toast } from "@/hooks/use-toast";
import { VaultCard, VaultCardBody, VaultCardHeader } from "@/components/vault/primitives";
import { startVisiblePolling } from "@/lib/visible-polling";

type Wallet = { id: string; name: string; asset: string; balance: string; available: string; convertedBalance: string; accountType: string; networks: Array<{ id: string; name: string; depositsEnabled: boolean; withdrawsEnabled: boolean }> };
type Settings = { configured: boolean; environment: "testnet" | "mainnet"; transfersEnabled: boolean; maxSendUsd: number; allowedAssets: string[]; allowedNetworks: string[]; publicWebSocketBase: string };
type Address = { id: string; asset: string; network: string; address: string; tag?: string | null; createdAt: string };
type ActivityRow = { id?: string; orderId?: string; symbol?: string; side?: string; size?: string; avgPrice?: string; unrealisedPnl?: string; orderStatus?: string; execPrice?: string; execQty?: string; asset?: string; network?: string; amount?: string; status?: string; state?: string; createdAt?: string };
type Preview = { intentId: string; asset: string; network: string; amount: string; estimatedUsd: number; destinationMasked: string; confirmationText: string; expiresAt: string; transfersEnabled: boolean; warning: string };
type Connection = { state: "not_configured" | "connected" | "error"; environment: "testnet" | "mainnet"; stateDetail: string };

async function json<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

// Read requests are bounded; mutation requests retain their existing confirmation flow.
async function readBybit<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 45000);
  try {
    return await json<T>(await fetch(url, { cache: "no-store", signal: controller.signal }));
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Bybit check timed out. Retry the connection check.");
    throw error;
  } finally { window.clearTimeout(timer); }
}

export function BybitMoneyCenter() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [deposits, setDeposits] = useState<ActivityRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<ActivityRow[]>([]);
  const [orders, setOrders] = useState<ActivityRow[]>([]);
  const [positions, setPositions] = useState<ActivityRow[]>([]);
  const [trades, setTrades] = useState<ActivityRow[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiveAccountId, setReceiveAccountId] = useState("");
  const [receiveNetwork, setReceiveNetwork] = useState("");
  const [sendAccountId, setSendAccountId] = useState("");
  const [sendNetwork, setSendNetwork] = useState("");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationTag, setDestinationTag] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [working, setWorking] = useState(false);
  const [ticker, setTicker] = useState<{ symbol: string; price: string; connected: boolean }>({ symbol: "BTCUSDT", price: "—", connected: false });
  const socketRef = useRef<WebSocket | null>(null);
  const tradingRefreshRef = useRef<Promise<boolean> | null>(null);

  const refreshTrading = useCallback(() => {
    if (tradingRefreshRef.current) return tradingRefreshRef.current;
    const request = (async () => {
    const [orderResult, positionResult, tradeResult] = await Promise.allSettled([
      readBybit<{ open: ActivityRow[]; history: ActivityRow[] }>("/api/bybit/orders"),
      readBybit<{ positions: ActivityRow[] }>("/api/bybit/positions"),
      readBybit<{ trades: ActivityRow[] }>("/api/bybit/trades"),
    ]);
    if (orderResult.status === "fulfilled") setOrders([...orderResult.value.open, ...orderResult.value.history].slice(0, 30));
    if (positionResult.status === "fulfilled") setPositions(positionResult.value.positions.filter((row) => Number((row as { size?: string }).size ?? 0) !== 0));
    if (tradeResult.status === "fulfilled") setTrades(tradeResult.value.trades);
    const failures = [orderResult, positionResult, tradeResult].flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "Private activity unavailable"] : []);
    setActivityError(failures.length ? failures.join(" · ") : null);
    return failures.length === 0;
    })();
    tradingRefreshRef.current = request;
    void request.finally(() => { tradingRefreshRef.current = null; });
    return request;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await readBybit<Connection>("/api/integrations/bybit/status");
      setConnection(status);
      if (status.state !== "connected") throw new Error(status.stateDetail);
      const [walletData, depositData, withdrawalData] = await Promise.all([
        readBybit<{ accounts: Wallet[]; settings: Settings }>("/api/bybit/wallets"),
        readBybit<{ addresses: Address[]; deposits: ActivityRow[] }>("/api/bybit/deposits"),
        readBybit<{ remote: ActivityRow[]; local: ActivityRow[] }>("/api/bybit/withdrawals"),
      ]);
      setWallets(walletData.accounts);
      setSettings(walletData.settings);
      setAddresses(depositData.addresses);
      setDeposits(depositData.deposits);
      setWithdrawals([...withdrawalData.remote, ...withdrawalData.local]);
      const first = walletData.accounts[0];
      if (first) {
        setReceiveAccountId((current) => current || first.id);
        setSendAccountId((current) => current || first.id);
        setReceiveNetwork((current) => current || first.networks.find((network) => network.depositsEnabled)?.id || "");
        setSendNetwork((current) => current || first.networks.find((network) => network.withdrawsEnabled)?.id || "");
      }
      await refreshTrading();
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Bybit could not be loaded.");
    } finally { setLoading(false); }
  }, [refreshTrading]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (connection?.state !== "connected") return;
    return startVisiblePolling(async () => { if (!await refreshTrading()) throw Error("Private activity unavailable"); }, 60_000, false);
  }, [connection?.state, refreshTrading]);

  const tickerSymbol = useMemo(() => {
    const asset = wallets.find((wallet) => !["USDT", "USDC", "USD"].includes(wallet.asset))?.asset ?? "BTC";
    return `${asset}USDT`;
  }, [wallets]);

  useEffect(() => {
    if (!settings?.publicWebSocketBase) return;
    const socket = new WebSocket(`${settings.publicWebSocketBase}/spot`);
    socketRef.current = socket;
    socket.onopen = () => {
      setTicker((current) => ({ ...current, symbol: tickerSymbol, connected: true }));
      socket.send(JSON.stringify({ op: "subscribe", args: [`tickers.${tickerSymbol}`] }));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { topic?: string; data?: { lastPrice?: string } };
        if (message.topic === `tickers.${tickerSymbol}` && message.data?.lastPrice) setTicker({ symbol: tickerSymbol, price: message.data.lastPrice, connected: true });
      } catch { /* Ignore non-ticker frames. */ }
    };
    socket.onerror = () => setTicker((current) => ({ ...current, connected: false }));
    socket.onclose = () => setTicker((current) => ({ ...current, connected: false }));
    return () => { socket.close(); socketRef.current = null; };
  }, [settings?.publicWebSocketBase, tickerSymbol]);

  const receiveWallet = wallets.find((wallet) => wallet.id === receiveAccountId);
  const sendWallet = wallets.find((wallet) => wallet.id === sendAccountId);

  async function loadAddress() {
    setWorking(true);
    try {
      const data = await fetch("/api/bybit/deposits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: receiveAccountId, network: receiveNetwork }) }).then((response) => json<{ address: Address }>(response));
      setAddresses((current) => [data.address, ...current.filter((item) => item.id !== data.address.id)]);
      toast({ title: "Bybit deposit address loaded", description: `Verify ${data.address.asset} on ${data.address.network} before sending.` });
    } catch (requestError) { toast({ title: "Deposit address failed", description: requestError instanceof Error ? requestError.message : "Unknown error", variant: "destructive" }); }
    finally { setWorking(false); }
  }

  async function createPreview() {
    setWorking(true);
    setPreview(null);
    try {
      const data = await fetch("/api/bybit/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: sendAccountId, network: sendNetwork, amount, destination, destinationTag }) }).then((response) => json<Preview>(response));
      setPreview(data);
      setPassword("");
      setConfirmationText("");
    } catch (requestError) { toast({ title: "Withdrawal preview failed", description: requestError instanceof Error ? requestError.message : "Unknown error", variant: "destructive" }); }
    finally { setWorking(false); }
  }

  async function confirmWithdrawal() {
    if (!preview) return;
    setWorking(true);
    try {
      const result = await fetch("/api/bybit/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, intentId: preview.intentId, password, confirmationText }) }).then((response) => json<{ providerTransactionId: string; state: string }>(response));
      toast({ title: "Bybit withdrawal submitted", description: `${result.providerTransactionId} · ${result.state}` });
      setPreview(null); setAmount(""); setDestination(""); setDestinationTag(""); setPassword(""); setConfirmationText("");
      await load();
    } catch (requestError) { toast({ title: "Withdrawal not submitted", description: requestError instanceof Error ? requestError.message : "Unknown error", variant: "destructive" }); }
    finally { setWorking(false); }
  }

  if (loading) return <VaultCard><VaultCardBody><div className="flex items-center gap-2 text-[11px] text-fg-muted"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Authenticating Bybit…</div></VaultCardBody></VaultCard>;

  if (connection?.state !== "connected" || error || !settings) {
    return <VaultCard><VaultCardHeader title="Bybit" subtitle={connection?.environment ?? "testnet"} icon={<Bitcoin className="h-4 w-4" />} /><VaultCardBody><div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-200/80">{error ?? connection?.stateDetail ?? "Bybit is not configured. Save encrypted credentials in Settings → Connections."}</div><Button className="mt-3" variant="outline" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Test connection</Button></VaultCardBody></VaultCard>;
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 themed">
      <div className="flex items-center gap-2 text-[11px] text-fg-muted"><ShieldCheck className="h-4 w-4 text-emerald-400" />Bybit {connection.environment} authenticated · keys remain server-side</div>
      <div className="flex items-center gap-3 text-[10px] text-fg-muted">{ticker.connected ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-amber-400" />}<span className="font-mono">{ticker.symbol} {ticker.price}</span><Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button></div>
    </div>

    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <VaultCard><VaultCardHeader title="Bybit balances" subtitle="Unified and Funding accounts" icon={<Bitcoin className="h-4 w-4" />} /><VaultCardBody><div className="space-y-2">{wallets.map((wallet) => <div key={wallet.id} className="flex items-center justify-between rounded border border-line-muted bg-surface p-3"><div><div className="text-[11px] font-medium text-fg">{wallet.name}</div><div className="text-[10px] text-fg-faint">{wallet.accountType} · available {wallet.available}</div></div><div className="text-right font-mono text-[11px] text-fg">{wallet.balance} {wallet.asset}<div className="text-[9px] text-fg-faint">≈ ${Number(wallet.convertedBalance).toFixed(2)}</div></div></div>)}</div></VaultCardBody></VaultCard>

      <VaultCard><VaultCardHeader title="Live account activity" subtitle="WebSocket price · private data refreshes every 30 seconds when no check is running" icon={<Activity className="h-4 w-4" />} /><VaultCardBody><div className="grid grid-cols-3 gap-2"><Metric label="Orders" value={orders.length} /><Metric label="Positions" value={positions.length} /><Metric label="Trades" value={trades.length} /></div>{activityError && <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-200/80">Some private activity could not be read: {activityError}</div>}<ActivityList rows={[...positions.slice(0, 3), ...orders.slice(0, 3), ...trades.slice(0, 3)]} empty="No recent Bybit order, position, or execution activity." /></VaultCardBody></VaultCard>

      <VaultCard><VaultCardHeader title="Deposit crypto" subtitle="Use the exact Bybit coin and chain" icon={<ArrowDownToLine className="h-4 w-4" />} /><VaultCardBody><div className="space-y-3"><SelectField label="Bybit wallet" value={receiveAccountId} onChange={(value) => { setReceiveAccountId(value); setReceiveNetwork(""); }} options={wallets.map((wallet) => ({ value: wallet.id, label: `${wallet.name} · ${wallet.available}` }))} /><SelectField label="Network" value={receiveNetwork} onChange={setReceiveNetwork} options={(receiveWallet?.networks ?? []).filter((network) => network.depositsEnabled).map((network) => ({ value: network.id, label: `${network.name} (${network.id})` }))} /><Button onClick={() => void loadAddress()} disabled={working || !receiveNetwork}>Load deposit address</Button>{addresses.slice(0, 4).map((item) => <div key={item.id} className="rounded border border-line-muted bg-inset p-3"><div className="flex justify-between text-[10px]"><span>{item.asset} · {item.network}</span><button type="button" aria-label={`Copy ${item.asset} deposit address`} onClick={() => { void navigator.clipboard.writeText(item.address); toast({ title: "Address copied" }); }}><Copy className="h-3.5 w-3.5" /></button></div><code className="mt-2 block break-all text-[10px] text-fg-muted">{item.address}</code>{item.tag && <code className="mt-1 block text-[10px] text-amber-300">Tag: {item.tag}</code>}</div>)}<ActivityList rows={deposits.slice(0, 5)} empty="No recent Bybit deposits." /></div></VaultCardBody></VaultCard>

      <VaultCard><VaultCardHeader title="Withdraw crypto" subtitle={`Owner-only · $${settings.maxSendUsd.toFixed(2)} server limit`} icon={<ArrowUpFromLine className="h-4 w-4" />} /><VaultCardBody>{!settings.transfersEnabled && <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10.5px] text-amber-200/80">Submission is locked. Set BYBIT_WITHDRAWALS_ENABLED=true only after testnet balance and deposit tests pass.</div>}<div className="space-y-3"><SelectField label="From wallet" value={sendAccountId} onChange={(value) => { setSendAccountId(value); setSendNetwork(""); setPreview(null); }} options={wallets.map((wallet) => ({ value: wallet.id, label: `${wallet.name} · ${wallet.available}` }))} /><div className="grid grid-cols-2 gap-3"><Field label={`Amount${sendWallet ? ` (${sendWallet.asset})` : ""}`} value={amount} onChange={setAmount} type="number" /><SelectField label="Network" value={sendNetwork} onChange={setSendNetwork} options={(sendWallet?.networks ?? []).filter((network) => network.withdrawsEnabled).map((network) => ({ value: network.id, label: `${network.name} (${network.id})` }))} /></div><Field label="Destination address" value={destination} onChange={setDestination} /><Field label="Tag / memo (if required)" value={destinationTag} onChange={setDestinationTag} /><Button variant="outline" onClick={() => void createPreview()} disabled={working || !sendNetwork}>Review withdrawal</Button></div>{preview && <div className="mt-4 space-y-3 rounded border border-red-500/35 bg-red-500/5 p-3"><div className="text-[11px] font-semibold text-red-300">Irreversible withdrawal confirmation</div><p className="text-[10.5px] text-red-200/80">{preview.warning}</p><div className="text-[10px] text-fg-muted">{preview.amount} {preview.asset} · {preview.network} · ~${Number(preview.estimatedUsd).toFixed(2)} · {preview.destinationMasked}</div><Field label="Current LUCIAN password" value={password} onChange={setPassword} type="password" /><div><Label className="text-[10px] text-fg-muted">Type exactly: <code className="text-red-300">{preview.confirmationText}</code></Label><Input className="mt-1.5 font-mono text-[11px]" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} /></div><Button className="w-full" onClick={() => void confirmWithdrawal()} disabled={working || !settings.transfersEnabled || !password || confirmationText !== preview.confirmationText}>Confirm Bybit withdrawal</Button></div>}<ActivityList rows={withdrawals.slice(0, 5)} empty="No recent Bybit withdrawals." /></VaultCardBody></VaultCard>
    </div>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded border border-line-muted bg-inset p-2 text-center"><div className="font-mono text-base text-fg">{value}</div><div className="text-[9px] uppercase text-fg-faint">{label}</div></div>; }
function ActivityList({ rows, empty }: { rows: ActivityRow[]; empty: string }) { return <div className="mt-3 space-y-1.5">{rows.length === 0 ? <div className="text-[10px] text-fg-faint">{empty}</div> : rows.map((row, index) => <div key={row.id ?? row.orderId ?? index} className="flex justify-between rounded border border-line-muted bg-surface px-2.5 py-2 text-[10px]"><span>{row.symbol ?? row.asset ?? "Bybit"} {row.side ?? row.network ?? ""}</span><span className="font-mono text-fg-muted">{row.orderStatus ?? row.status ?? row.state ?? (row.size ? `size ${row.size} · PnL ${row.unrealisedPnl ?? "0"}` : undefined) ?? row.execPrice ?? "recorded"}</span></div>)}</div>; }
function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <div><Label className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 font-mono text-[11px]" autoComplete={type === "password" ? "current-password" : "off"} /></div>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <div><Label className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</Label><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-line-muted bg-surface px-3 text-[11px] text-fg"><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
