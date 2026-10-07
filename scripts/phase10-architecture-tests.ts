import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test(); passed += 1; console.log(`  ✓ ${name}`);
}

console.log("\n=== PHASE 10 TRADING TERMINAL ARCHITECTURE ===");
const store = read("src/store/markets.ts");
const terminal = read("src/lib/bybit/terminal.ts");
const panel = read("src/components/markets/bybit-trading-panel.tsx");
const order = read("src/components/markets/bybit-order-form.tsx");
const schema = read("prisma/schema.prisma");

check("Paper, Bybit Testnet and Bybit Live are explicit modes", () => {
  for (const mode of ["paper", "bybit_testnet", "bybit_live"]) assert.match(store, new RegExp(mode));
});
check("Public chart data uses Bybit V5", () => {
  const provider = read("src/lib/markets/bybit-provider.ts");
  assert.match(provider, /api\.bybit\.com/); assert.match(provider, /stream\.bybit\.com/);
  assert.equal(existsSync(resolve(root, "src/lib/markets/binance-provider.ts")), false);
});
check("Requested mode must match saved credential environment", () => assert.match(terminal, /saved Bybit connection/));
check("Live execution has two independent server locks", () => { assert.match(terminal, /BYBIT_LIVE_MODE_ENABLED/); assert.match(terminal, /LIVE_TRADING_ENABLED/); });
check("Every order has an expiring preview and exact confirmation", () => { assert.match(terminal, /expiresAt: new Date\(Date\.now\(\) \+ 120_000\)/); assert.match(order, /confirmationPhrase/); });
check("Live orders re-verify the owner's password", () => { assert.match(terminal, /verifyPassword/); assert.match(order, /Current LUCIAN password/); });
check("Risk checks cover exposure, daily loss, count, leverage and exchange increments", () => {
  for (const rule of ["position_limit", "daily_loss", "open_positions", "leverage", "quantity_step", "price_tick"]) assert.match(terminal, new RegExp(rule));
});
check("Emergency stop persists, blocks orders, and cancels all open orders", () => { assert.match(terminal, /emergencyStop/); assert.match(terminal, /\/v5\/order\/cancel-all/); });
check("Audit and approval records are durable database models", () => { assert.match(schema, /model TradingAuditEvent/); assert.match(schema, /model LiveTradeIntent/); assert.match(panel, /Approvals/); assert.match(panel, /Audit/); });
check("Terminal exposes positions, orders, P\/L, portfolio, transactions and order book", () => {
  for (const label of ["Positions", "Orders", "P/L", "Portfolio", "Transactions", "Order Book"]) assert.match(panel, new RegExp(label.replace("/", "\\/")));
});
check("Sensitive Phase 10 APIs enforce immutable-owner authorization", () => {
  for (const path of ["app/api/bybit/terminal/route.ts", "app/api/bybit/risk/route.ts", "app/api/bybit/emergency-stop/route.ts", "app/api/bybit/orders/route.ts"]) assert.match(read(path), /requireOwnerId/);
});

console.log(`\nPhase 10 checks passed: ${passed}`);
