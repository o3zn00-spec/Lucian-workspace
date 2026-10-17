# Bybit autonomous shorts — October 17, 2026

## Reviewed account settings

New USDT perpetual short sessions read the connected account's Cross or Isolated margin mode and each selected symbol's leverage, one-way/hedge short slot and applicable automatic-margin setting. The server replaces any client/template snapshot with exchange observations. The review displays these settings and the separate LUCIAN account limits; no account-setting endpoint is called.

The settings form part of the plan and authorization digest. Approval rechecks them and the reviewed account limits. Entry checks repeat before inference, reservation and final dispatch. Drift blocks new entries. Existing owned protection and reduce-only covers retain their original slot and remain available under the original owner grant. Amendments cannot change product or account settings. Older grants without a settings snapshot retain Isolated/1x/one-way/auto-add-off authority and LastPrice stops.

Cross margin and Isolated auto-add-on use shared collateral: session capital is a software allocation, not an exchange-enforced cap on collateral or loss. Both approval surfaces disclose this before authorization. Account leverage settings never implicitly increase money limits. Portfolio margin remains unsupported because its leverage and margin semantics differ. Hedge support requires both slots returned and no unrelated position on the same symbol; shared symbol execution/ledger ownership remains exclusive.

## Sizing and risk

Maximum order remains gross notional including costs, not initial margin multiplied by leverage. Capital covers initial margin, fee reserve and adverse stop risk. Stop risk, session loss and trade count limits remain independent. Cross available margin is capped by unborrowed/unlocked USDT after existing margin obligations and by account-wide available USD collateral converted using reported USDT equity valuation. Missing or invalid data blocks entries.

Before entry, current exchange risk tiers constrain leverage and size. A conservative standalone solvency check requires initial margin to exceed adverse stop movement, maintenance margin and fees without relying on unrelated collateral or maintenance deductions. Terminal risk validation uses the actual reviewed leverage/slot and adverse ask/mark/slippage exposure. Existing gross account exposure, order, position-count and daily loss limits (including funding) remain enforced.

New native stops use MarkPrice; their exact trigger, slot, reduce-only and close-on-trigger flags must match the durable journal. Actual position liquidation prices are checked during management. Stops and loss limits cannot guarantee fill prices or maximum losses.

## Lifecycle and recovery

The durable worker reconciles Sell entry fills, protects exact remaining size, monitors targets, cancels its exact stop before reduce-only Buy covers, settles matched execution/transaction records including funding and fees, and may enter again. Unknown acknowledgements retain their original order link. Partial fills, cancellation races and replacement workers retain ownership and reservations. Two matching ledger observations at least 60 seconds apart are required before settlement. Protection and exits do not require remaining model budget.

No exchange leverage/margin/position setting changes, transfers or withdrawals occur. Starting a session requires owner password and exact confirmation. Existing live server switches and account limits remain independent gates. Sessions last at most 144 hours for bounded history reconciliation. The main terminal chart's product selection is outside this change; short research/quotes/reports use perpetual data.

## Verification

Local PostgreSQL plus mocked exchange/model tests cover Cross/Isolated, different leverage, one-way/hedge, auto-add review, entry→MarkPrice stop→cover→settlement→repeat, recovery, partial fills, unknown acknowledgements, stop cancellation races, settings changes before approval/before inference/during dispatch/while held, immutable amendments, stale client snapshots, account caps, missing collateral data, margin tiers, model outage and exhausted budget. Spot lifecycle, planning, reconciliation and report regressions pass. Desktop/mobile browser fixtures verify the Cross/10x review, collateral disclosure, exact approval/reject and ambiguous-result behavior.

These tests do not establish actual-account eligibility, real model quality, funded lifecycle or profitability. Production deployment identity is recorded separately in the continuation record.

Official API references used: https://bybit-exchange.github.io/docs/v5/account/account-info ; https://bybit-exchange.github.io/docs/v5/account/wallet-balance ; https://bybit-exchange.github.io/docs/v5/position ; https://bybit-exchange.github.io/docs/v5/market/risk-limit .
