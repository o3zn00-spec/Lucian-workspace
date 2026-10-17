# Bybit autonomous shorts — October 16, 2026

## Delivered scope

Reviewed sessions may select `linear_short`: USDT linear perpetual shorts, isolated margin, one-way position mode, 1x leverage, automatic margin additions off. An omitted product retains Spot behavior. Products cannot change through a session amendment. Short sessions last at most 144 hours so bounded reconciliation stays within exchange history limits.

The durable worker researches perpetual candles, opens a Sell, reconciles exact fills, installs a reduce-only Buy conditional stop, monitors its target, cancels the exact stop before covering, reconciles residual fills, and repeats within the reviewed limits. Lost acknowledgements retain the original order link. Unknown/external executions, liquidation or mismatched positions retain reservations for reconciliation. Protection and requested exits do not depend on remaining model calls. Model outages do not themselves select an exit.

Accounting matches execution IDs and transaction-log rows, including USDT trading fees and signed funding. Flat trades settle only after two matching ledger observations at least 60 seconds apart; ledger outages prevent another entry. Reports distinguish estimated open net value from settled net results. Entry validation includes account order/exposure/position limits and daily losses including funding debits.

## Activation and boundaries

No production setting, owner password, account limit, existing Spot grant, exchange margin/leverage mode or live trade was changed. The existing live Spot-only server switch still blocks shorts unless separately changed under an exact reviewed activation. Account eligibility is checked, never automatically configured. Approval remains bound to the product, account, assets, model, capital, duration and risk limits.

The main terminal chart remains its existing Spot chart; short worker research, execution quotes and trade reports use perpetual data. Native protection is installed after reconciled entry fills; it is not an atomic attached stop. The worker and exchange history have latency. No guarantee of loss ceilings or profitability is implied.

Cross margin, hedge mode, inverse/USDC contracts, leveraged shorts above 1x and other brokers are outside this implementation. Independent broker adapters are required for other connections.

## Verification

Local PostgreSQL lifecycle tests and mocked exchange/model services cover concurrent workers, partial entry/cover, lost acknowledgements, cancellation/stop-fill races, recovery, stable funding settlement, delayed ledgers, mismatched protection, foreign fills, connection rotation, pause during validation, expiry, exhausted model budget, model outage and immutable product amendments. Real terminal validation with mocked exchange checks Spot lock and combined account risk. Existing Spot lifecycle tests remain passing.

Isolated desktop/mobile browser fixtures verify short product review, exact approval, stale model invalidation, ambiguous-result handling and layout. Production authenticated UI, actual model inference, real Bybit eligibility and funded browser-closed short lifecycle/recovery remain unverified. Local mocks are not funded acceptance.

API references: Bybit V5 create-order, position/list, account/wallet-balance and account/transaction-log at https://bybit-exchange.github.io/docs/v5/ .
