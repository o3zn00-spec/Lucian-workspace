# Lilthe requirements audit — October 17, 2026

Owner intent: a capable conversational assistant and trader that exercises calculated judgment under uncertainty, within the owner's approved mandate. Missing data, unsupported connections and genuine risk constraints must be distinguished from ordinary market uncertainty. A trade is not required merely to prove activity.

## Current repair

- Market watchlist previously loaded quotes only for chart/held symbols. One authenticated bulk Bybit Spot snapshot now refreshes supported catalog symbols, including Daily aliases, every 30 seconds while visible. Missing/malformed exchange rows remain unavailable, not fabricated. HTTP quotes are labeled delayed.
- Candle history now continues refreshing when streaming has not delivered a candle for 30 seconds. Previously a successful initial request permanently stopped the fallback.
- Drawing layer now receives pointer input above the chart canvas. Horizontal/vertical lines use independent price/time coordinates. Pointer capture preserves drags; rectangles use valid CSS color/opacity. A newly drawn object goes to the actual chart pane clicked.
- Autonomous shorts and chat planning explicitly permit calculated judgment without a mandatory crossover/perfect-indicator gate. Approved symbols, costs, sizing, account limits and protection still govern dispatch.
- Chat public research accepts explicit spot/linear category, so perpetual research need not silently use Spot candles.

## Requirement coverage and evidence boundaries

| Requirement | Current implementation | Remaining acceptance work |
| --- | --- | --- |
| Compact inline choices | Shared interaction card and structured chat interaction parser exist | Check full requested question sequences in live conversation |
| Market research | Closed candles across four intervals, announcements, independent context, publisher news and bounded OpenRouter web search exist | Verify ranked multi-instrument research and source freshness in live responses; coverage is not every news/social source |
| Manual/assisted/autonomous modes | Manual preview/confirmation and owner-approved bounded background sessions exist | Funded entry/protection/exit lifecycle has not been observed; no claim of live lifecycle certification |
| Calculated trading judgment | Explicit mandate now distinguishes uncertainty from hard blockers | Actual model choices remain variable; prompt wording cannot guarantee frequency or profit |
| Main/floating UI consistency | Shared messages/composer, attachments, interaction cards, model selector, voice controls; dedicated chat history exist | Deployed main route and composer inspected; full acceptance remains open. Conversation menu currently has rename/pin/archive/delete but no sharing action |
| Models/reasoning | Live provider catalog and capability-based OpenRouter effort options exist | Verify each configured provider; unsupported models must not receive invented capabilities |
| Natural voice/dictation | Separate voice and dictation controls and realtime transport exist | Live microphone/audio round trip not tested in this repair |
| Header cleanup | No literal Lilthe Trading/Research Practice shortcuts found in current main chat route | Deployed main-chat presentation checked: both shortcuts absent |
| Market availability | Bybit crypto feed implemented; other asset adapters are not implemented | Unconfigured asset classes remain unavailable; enabling labels does not create a feed |
| Drawings | Real browser tests exercise horizontal line, trend drag, rectangle, updates and resize | Instrument-specific drawing storage, drawing edits and future whitespace coordinates remain follow-up gaps |

## Validation

Quote/provider tests include bulk snapshots and rejection of malformed rows. API tests verify owner authentication, fixed upstream endpoints and bounded input. Real browser chart fixture uses real chart code, pointer clicks/drags, streaming updates and mobile resize with external requests blocked. Risk/policy tests retain order/exposure/loss bounds. Typecheck, lint, architecture, consolidation and completed build are required before release. Production verification is recorded separately; source presence is not equivalent to end-to-end acceptance.
