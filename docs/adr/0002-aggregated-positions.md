# Aggregated positions abstract Ostium slots

The app treats all open Ostium position **Slots** on one pair + direction as a
single net **Position**, sized in base-asset units (1.0 BTC slot + 0.5 BTC slot =
one 1.5 BTC long). Signals act on this aggregate and never reference `idx`. A close
of less than the full aggregate is mapped onto Slots **largest Slot first**: a
1.2 BTC close against 1.0 + 0.5 closes the 1.0 Slot fully and 0.2 of the 0.5 Slot
(40%, leaving 0.3 open), via per-Slot `closePercent`.

## Considered Options

- **Raw Ostium passthrough (Poster supplies `idx`/`price`/`orderId`).** Rejected:
  a Poster (e.g. a TradingView alert) cannot know `idx` or live price without
  querying chain state first - effectively unusable from the tools this app exists
  to serve.
- **Reject when multiple Slots match.** Rejected after discussion: a strategy with
  two longs on one pair could then never exit via webhook.
- **FIFO / LIFO Slot consumption.** Reasonable accounting defaults, but produce
  more, smaller closes and don't match the intended mental model.
- **Aggregate net position, largest-Slot-first (chosen).** Matches how a strategy
  thinks ("I'm long 1.5 BTC, take off 1.2"), and largest-first minimises the number
  of on-chain close transactions.

## Consequences

- The server resolves Slots, live price, and per-Slot `closePercent` from
  `getOpenPositions` at execution time; the Signal stays a high-level intent.
- A single Signal may fan out into multiple Ostium transactions.
- Long and short on the same pair remain distinct Positions (a hedged pair has two
  aggregates), so direction is always part of a Signal.
