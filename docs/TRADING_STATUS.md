# Lucian trading status and owner steps

Updated 2026-10-08. This is a short companion to RESTORATION_CHECKPOINT.md;
it does not mark unfinished checkpoints complete.

## Already working and deployed

- Lilthe chat/model connection, mainnet account reads and balance display.
- Manual Spot live preview/submission gates, exact confirmation and password.
- Saved limits: 6 USDT per order, 10 USDT exposure, 1 USDT daily realized loss,
  one position, no borrowing/leverage.
- Stable order identity, duplicate-submission prevention, ambiguous-request
  reservation retention and read-only exchange reconciliation.
- Bounded background observer code. A real production observation run still
  needs to be verified after an order is acknowledged.
- Paper strategy/runtime trials and historical research/results. These do not
  establish profitable performance.

## Still unfinished

1. Real exchange fill, fee, protective child-order and exit evidence.
2. Recovery validation using those real records; no blind order resubmission.
3. Lilthe's unattended live decision/execution worker and its end-to-end validation.
4. Broader app tools, voice, zoomable Investing canvas and remaining stability work.

## The next action and why

The trial is a small operational test, not evidence of a profitable strategy.
The old preview has expired. Its draft is a 0.00007 BTCUSDT Spot Limit Buy,
limit 81750, stop 81330, target 82170 (5.7225 USDT before fees). A fresh preview
must check current prices, inventory, fees and risk before any submission.

1. Open Markets and the existing order-details panel. Keep Bybit Live, Spot and
   the existing draft. Do not increase the saved caps.
2. Use Review again (or Cancel the expired preview, then Review order on the
   currently deployed older interface). Review does not place an exchange order.
3. Read the fresh checks and amount. If rejected, leave it unsubmitted and share
   the displayed reason. If passed, type the exact displayed confirmation phrase
   and your current Lucian login password.
4. Click Submit to Bybit once. The browser tool requires you to perform this final
   financial action, even though you already approved the test in chat.
5. Keep the order ID/status. Submitted means acknowledged, not filled. Check
   Orders and Approvals; if unclear, use exchange reconciliation instead of
   sending another order. The next validation uses actual exchange records.

You do not need to transfer funds again based on the last successful balance
check. No new Bybit key permissions or withdrawals are part of this trial.
