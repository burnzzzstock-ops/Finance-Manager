# 24/69/222 EMA + RSI Backtest (standalone)

> **Note:** this directory is a self-contained experiment and has **nothing to do
> with the F&I Scoreboard app** in the rest of this repo. Nothing here is loaded
> by the web app, the inventory sync workflow, or GitHub Pages.

A daily, long-only backtest for the triple-EMA trend strategy:

- **Indicators:** EMA(24), EMA(69), EMA(222), RSI(14) with Wilder smoothing
  (the version charting platforms display).
- **Bullish alignment:** `ema24 > ema69 > ema222`.
- **Entry:** while aligned, RSI(14) drops below **40** (a pullback inside the
  uptrend). `--entry-mode cross` instead requires the alignment to form on the
  same bar RSI is low — the literal "triple cross + low RSI" reading, which
  fires very rarely because a fresh alignment usually means RSI is elevated.
- **Exit:** RSI(14) above **70** (overextended), the alignment breaking
  (`ema24 < ema69`), or the close losing the 222 EMA.
- **Execution model:** signals are read on the close and exposure starts from
  that close forward (no look-ahead). A commission (default 0.1% per side) is
  charged on every position change.

## Run it

```bash
pip install -r requirements.txt        # pandas + numpy + yfinance (+ matplotlib for plots)

# quick logic check on synthetic data, no network needed
python3 backtest_ema_rsi.py --selftest

# the real thing
python3 backtest_ema_rsi.py --ticker SPY --start 2010-01-01
python3 backtest_ema_rsi.py --ticker AAPL,MSFT,SPY            # compares and prints a summary table
python3 backtest_ema_rsi.py --ticker SPY --plot spy.png --trades-csv trades.csv
python3 backtest_ema_rsi.py --csv my_data.csv                 # offline: Date + Close columns
```

Everything is tweakable from the command line: `--rsi-low`, `--rsi-high`,
`--rsi-period`, `--emas 24,69,222`, `--commission`, `--capital`,
`--entry-mode {pullback,cross}`, `--start/--end`.

## What you get

Per ticker: final equity, CAGR, max drawdown, and Sharpe for the strategy
(net of costs) side by side with buy & hold, plus time-in-market, round-trip
count, trade win rate, average win/loss, and average holding period. Optional
outputs: an equity-curve + position PNG (`--plot`) and a full trade log CSV
(`--trades-csv`).

## Reading the results honestly

- The 222 EMA makes this **very selective** — few trades, long flat stretches.
  Expect it to lag buy & hold in strong bull runs and to earn its keep (if it
  does) via smaller drawdowns in choppy/bearish regimes.
- Test across regimes (e.g. 2010–2020 bull, 2022 bear, 2023+) and on tickers
  you actually trade, not just SPY.
- Past ≠ future; custom periods like 24/69/222 can be curve-fit. Check
  robustness with different start dates and out-of-sample windows before
  trusting anything.
- Costs here are simple commissions — no slippage, taxes, or dividends on the
  strategy side (buy & hold uses adjusted closes, so it *does* include
  dividends; treat the comparison as conservative for the strategy).

## Next step: rotation version

This single-ticker harness validates signal quality first. A true "scan the
universe, buy low-RSI setups, rotate capital" portfolio needs a ticker list,
daily ranking, position limits, and rebalancing rules — extend from
`run_backtest()`, which already returns the full signal/position frame per
ticker.
