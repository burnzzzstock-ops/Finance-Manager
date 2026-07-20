#!/usr/bin/env python3
"""
24/69/222 EMA + RSI(14) daily backtest — standalone framework.

Long-only, single-ticker signal validation for the triple-EMA trend +
low-RSI pullback entry / high-RSI (or trend-break) exit strategy:

  Indicators (daily closes):
    EMA(24), EMA(69), EMA(222), RSI(14) (Wilder smoothing)

  Bullish alignment:  ema24 > ema69 > ema222

  Entry (long), two selectable modes:
    pullback (default) : alignment is true AND RSI < RSI_LOW
                         (buy the dip inside an established uptrend)
    cross              : alignment just became true AND RSI < RSI_LOW
                         (the literal "triple cross + low RSI" reading;
                         note these rarely coincide on the same day, so
                         expect very few trades in this mode)

  Exit (any of):
    RSI > RSI_HIGH                (overextended)
    ema24 < ema69                 (alignment breaks)
    close < ema222                (price loses the 222 support)

  Position: 100% long when in a setup, flat otherwise. Signals are read
  on the close; returns accrue from that close forward (no look-ahead).
  Commission is charged on each position change.

Data sources (first available wins):
  --csv PATH   offline CSV with Date + Close (or Adj Close) columns
  --selftest   deterministic synthetic series, no network needed
  otherwise    downloads via yfinance

Examples:
  python3 backtest_ema_rsi.py --selftest
  python3 backtest_ema_rsi.py --ticker SPY --start 2010-01-01
  python3 backtest_ema_rsi.py --ticker AAPL,MSFT,SPY --rsi-low 35
  python3 backtest_ema_rsi.py --csv spy.csv --plot spy.png --trades-csv trades.csv

Only pandas/numpy are required; yfinance for downloads and matplotlib for
--plot are optional.
"""

import argparse
import sys

import numpy as np
import pandas as pd

TRADING_DAYS = 252


# ----------------------------- indicators -----------------------------

def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def rsi_wilder(series: pd.Series, period: int = 14) -> pd.Series:
    """Classic Wilder RSI (ewm alpha=1/period), the version charting
    platforms show — a plain rolling mean runs noticeably hotter/colder."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rsi = 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    rsi = rsi.where(avg_loss > 0, 100.0)
    rsi = rsi.where(~(avg_gain.isna() | avg_loss.isna()), np.nan)
    return rsi


# ------------------------------- data ---------------------------------

def load_yfinance(ticker: str, start: str, end: str | None) -> pd.Series:
    try:
        import yfinance as yf
    except ImportError:
        sys.exit("yfinance is not installed — `pip install yfinance`, "
                 "or pass --csv / --selftest instead.")
    df = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
    if df is None or df.empty:
        sys.exit(f"No data returned for {ticker!r} — check the symbol/dates "
                 "and your network connection.")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    close = df["Close"].dropna()
    close.name = "close"
    return close


def load_csv(path: str) -> pd.Series:
    df = pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    date_col = next((cols[k] for k in ("date", "datetime", "timestamp") if k in cols), None)
    close_col = next((cols[k] for k in ("adj close", "adj_close", "close", "price") if k in cols), None)
    if date_col is None or close_col is None:
        sys.exit(f"CSV {path!r} needs a Date column and a Close/Adj Close column "
                 f"(found: {list(df.columns)}).")
    out = pd.Series(
        pd.to_numeric(df[close_col], errors="coerce").values,
        index=pd.to_datetime(df[date_col]),
        name="close",
    ).dropna().sort_index()
    return out


def synthetic_series(n_days: int = 3200, seed: int = 42) -> pd.Series:
    """Regime-switching geometric walk: alternating bull / chop / bear
    stretches so alignment forms and breaks several times."""
    rng = np.random.default_rng(seed)
    regimes = [(0.0009, 0.010), (0.0000, 0.014), (-0.0007, 0.018)]
    drift = np.empty(n_days)
    vol = np.empty(n_days)
    i = 0
    while i < n_days:
        mu, sd = regimes[rng.integers(0, len(regimes))]
        span = int(rng.integers(120, 420))
        drift[i:i + span] = mu
        vol[i:i + span] = sd
        i += span
    rets = rng.normal(drift[:n_days], vol[:n_days])
    prices = 100.0 * np.exp(np.cumsum(rets))
    idx = pd.bdate_range("2012-01-02", periods=n_days)
    return pd.Series(prices, index=idx, name="close")


# ------------------------------ backtest -------------------------------

def run_backtest(close: pd.Series, *, ema_spans=(24, 69, 222), rsi_period=14,
                 rsi_low=40.0, rsi_high=70.0, entry_mode="pullback",
                 commission=0.001, capital=100_000.0) -> dict:
    fast, mid, slow = ema_spans
    df = pd.DataFrame({"close": close})
    df["ema_fast"] = ema(df["close"], fast)
    df["ema_mid"] = ema(df["close"], mid)
    df["ema_slow"] = ema(df["close"], slow)
    df["rsi"] = rsi_wilder(df["close"], rsi_period)

    # Warm-up: EMAs are defined from bar 1 but not meaningful until the
    # slowest span has seen enough data; drop that stretch plus RSI NaNs.
    df = df.iloc[slow:].dropna(subset=["rsi"])
    if len(df) < 2:
        sys.exit(f"Not enough history after the {slow}-day EMA warm-up "
                 f"({len(close)} rows loaded) — extend the date range.")

    aligned = (df["ema_fast"] > df["ema_mid"]) & (df["ema_mid"] > df["ema_slow"])
    if entry_mode == "cross":
        entry = aligned & ~aligned.shift(1, fill_value=False) & (df["rsi"] < rsi_low)
    else:
        entry = aligned & (df["rsi"] < rsi_low)
    exit_ = (df["rsi"] > rsi_high) | (df["ema_fast"] < df["ema_mid"]) \
        | (df["close"] < df["ema_slow"])

    # State machine over signal arrays. Exit has priority, and a bar whose
    # entry and exit conditions are both true never opens a position.
    entry_a, exit_a = entry.to_numpy(), exit_.to_numpy()
    position = np.zeros(len(df), dtype=float)
    in_pos = False
    for i in range(len(df)):
        if in_pos:
            if exit_a[i]:
                in_pos = False
        elif entry_a[i] and not exit_a[i]:
            in_pos = True
        position[i] = 1.0 if in_pos else 0.0
    df["position"] = position

    # Signal on close t -> exposed to the t -> t+1 return.
    df["ret"] = df["close"].pct_change().fillna(0.0)
    df["strat_ret"] = df["position"].shift(1, fill_value=0.0) * df["ret"]
    # One commission charge per side, applied on the bar the trade executes.
    turnover = df["position"].diff().abs().fillna(df["position"].iloc[0])
    df["strat_ret_net"] = df["strat_ret"] - turnover.shift(1, fill_value=0.0) * commission

    df["bh_equity"] = capital * (1.0 + df["ret"]).cumprod()
    df["strat_equity"] = capital * (1.0 + df["strat_ret_net"]).cumprod()

    return {"df": df, "trades": extract_trades(df, commission),
            "params": dict(ema_spans=ema_spans, rsi_period=rsi_period,
                           rsi_low=rsi_low, rsi_high=rsi_high,
                           entry_mode=entry_mode, commission=commission,
                           capital=capital)}


def extract_trades(df: pd.DataFrame, commission: float) -> pd.DataFrame:
    """Round trips implied by the position series: entry at the close of the
    signal bar, exit at the close of the exit-signal bar (matching how the
    daily returns are accrued)."""
    pos = df["position"].to_numpy()
    changes = np.flatnonzero(np.diff(pos, prepend=0.0) != 0)
    rows = []
    open_i = None
    for i in changes:
        if pos[i] == 1.0:
            open_i = i
        elif open_i is not None:
            gross = df["close"].iloc[i] / df["close"].iloc[open_i] - 1.0
            rows.append({
                "entry_date": df.index[open_i].date(),
                "exit_date": df.index[i].date(),
                "days_held": i - open_i,
                "entry_close": round(float(df["close"].iloc[open_i]), 4),
                "exit_close": round(float(df["close"].iloc[i]), 4),
                "gross_return": gross,
                "net_return": gross - 2.0 * commission,
            })
            open_i = None
    if open_i is not None:  # still open at the end of the data
        gross = df["close"].iloc[-1] / df["close"].iloc[open_i] - 1.0
        rows.append({
            "entry_date": df.index[open_i].date(),
            "exit_date": None,
            "days_held": len(df) - 1 - open_i,
            "entry_close": round(float(df["close"].iloc[open_i]), 4),
            "exit_close": round(float(df["close"].iloc[-1]), 4),
            "gross_return": gross,
            "net_return": gross - commission,
        })
    return pd.DataFrame(rows)


# ------------------------------ reporting ------------------------------

def series_metrics(equity: pd.Series, rets: pd.Series) -> dict:
    years = len(equity) / TRADING_DAYS
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1 if years > 0 else 0.0
    max_dd = float((equity / equity.cummax() - 1.0).min())
    sd = rets.std()
    sharpe = float(rets.mean() / sd * np.sqrt(TRADING_DAYS)) if sd > 0 else 0.0
    return {"final": float(equity.iloc[-1]), "cagr": float(cagr),
            "max_dd": max_dd, "sharpe": sharpe}


def print_report(label: str, result: dict) -> dict:
    df, trades, p = result["df"], result["trades"], result["params"]
    strat = series_metrics(df["strat_equity"], df["strat_ret_net"])
    bench = series_metrics(df["bh_equity"], df["ret"])
    exposure = float(df["position"].mean())

    closed = trades[trades["exit_date"].notna()] if len(trades) else trades
    n_closed = len(closed)
    win_rate = float((closed["net_return"] > 0).mean()) if n_closed else float("nan")
    avg_win = float(closed.loc[closed["net_return"] > 0, "net_return"].mean()) if n_closed else float("nan")
    avg_loss = float(closed.loc[closed["net_return"] <= 0, "net_return"].mean()) if n_closed else float("nan")
    avg_hold = float(closed["days_held"].mean()) if n_closed else float("nan")

    fast, mid, slow = p["ema_spans"]
    pct = lambda x: f"{x * 100:.2f}%" if x == x else "n/a"  # noqa: E731
    print(f"\n=== {label} | {df.index[0].date()} -> {df.index[-1].date()} "
          f"({len(df)} bars) ===")
    print(f"Rules: EMA {fast}/{mid}/{slow}, RSI({p['rsi_period']}) "
          f"<{p['rsi_low']:g} entry / >{p['rsi_high']:g} exit, "
          f"entry mode: {p['entry_mode']}, commission {p['commission'] * 100:.2f}%/side")
    print(f"{'':22}{'Strategy (net)':>16}{'Buy & Hold':>16}")
    print(f"{'Final equity':22}{'$' + format(strat['final'], ',.0f'):>16}"
          f"{'$' + format(bench['final'], ',.0f'):>16}")
    print(f"{'CAGR':22}{pct(strat['cagr']):>16}{pct(bench['cagr']):>16}")
    print(f"{'Max drawdown':22}{pct(strat['max_dd']):>16}{pct(bench['max_dd']):>16}")
    print(f"{'Sharpe (daily ann.)':22}{strat['sharpe']:>16.2f}{bench['sharpe']:>16.2f}")
    print(f"Time in market: {pct(exposure)}   Round trips: {n_closed}"
          + (f" (+1 open)" if len(trades) > n_closed else ""))
    if n_closed:
        print(f"Trade win rate: {pct(win_rate)}   avg win: {pct(avg_win)}   "
              f"avg loss: {pct(avg_loss)}   avg hold: {avg_hold:.0f} days")
    else:
        print("No closed trades — with the 222 EMA + RSI filter this can be "
              "normal on short histories; try a longer range, a higher "
              "--rsi-low, or --entry-mode pullback.")
    return {"label": label, "strat": strat, "bench": bench,
            "exposure": exposure, "trades": n_closed, "win_rate": win_rate}


def save_plot(result: dict, label: str, path: str) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print(f"[plot skipped] matplotlib not installed — `pip install matplotlib`")
        return
    df = result["df"]
    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(12, 8), sharex=True,
        gridspec_kw={"height_ratios": [3, 1]})
    ax1.plot(df.index, df["bh_equity"], label="Buy & Hold", linewidth=1.5)
    ax1.plot(df.index, df["strat_equity"], label="EMA triple + RSI (net)", linewidth=1.5)
    ax1.set_title(f"{label} — 24/69/222 EMA + RSI backtest")
    ax1.set_ylabel("Equity ($)")
    ax1.legend()
    ax1.grid(alpha=0.3)
    ax2.fill_between(df.index, df["position"], step="pre", alpha=0.4)
    ax2.set_ylabel("Position")
    ax2.set_yticks([0, 1])
    ax2.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    print(f"Plot saved to {path}")


# -------------------------------- main ---------------------------------

def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="24/69/222 EMA + RSI(14) daily long-only backtest")
    ap.add_argument("--ticker", default="SPY",
                    help="symbol, or comma-separated list (default SPY)")
    ap.add_argument("--start", default="2010-01-01")
    ap.add_argument("--end", default=None)
    ap.add_argument("--csv", default=None,
                    help="offline CSV (Date + Close/Adj Close) instead of yfinance")
    ap.add_argument("--selftest", action="store_true",
                    help="run on deterministic synthetic data (no network)")
    ap.add_argument("--emas", default="24,69,222",
                    help="fast,mid,slow EMA spans (default 24,69,222)")
    ap.add_argument("--rsi-period", type=int, default=14)
    ap.add_argument("--rsi-low", type=float, default=40.0)
    ap.add_argument("--rsi-high", type=float, default=70.0)
    ap.add_argument("--entry-mode", choices=["pullback", "cross"], default="pullback")
    ap.add_argument("--commission", type=float, default=0.001,
                    help="fractional cost per side (default 0.001 = 0.1%%)")
    ap.add_argument("--capital", type=float, default=100_000.0)
    ap.add_argument("--plot", default=None, metavar="PATH",
                    help="save an equity-curve PNG (needs matplotlib)")
    ap.add_argument("--trades-csv", default=None, metavar="PATH",
                    help="write the trade log to CSV")
    args = ap.parse_args(argv)
    spans = tuple(int(s) for s in args.emas.split(","))
    if len(spans) != 3 or sorted(spans) != list(spans):
        ap.error("--emas must be three ascending integers, e.g. 24,69,222")
    args.ema_spans = spans
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    kwargs = dict(ema_spans=args.ema_spans, rsi_period=args.rsi_period,
                  rsi_low=args.rsi_low, rsi_high=args.rsi_high,
                  entry_mode=args.entry_mode, commission=args.commission,
                  capital=args.capital)

    if args.selftest:
        datasets = [("SYNTHETIC", synthetic_series())]
    elif args.csv:
        datasets = [(args.csv, load_csv(args.csv))]
    else:
        datasets = [(t.strip().upper(),
                     load_yfinance(t.strip(), args.start, args.end))
                    for t in args.ticker.split(",") if t.strip()]

    summaries = []
    last_result = None
    for label, close in datasets:
        result = run_backtest(close, **kwargs)
        last_result = result
        summaries.append(print_report(label, result))
        if args.plot:
            path = args.plot if len(datasets) == 1 else \
                f"{label.replace('/', '_')}_{args.plot}"
            save_plot(result, label, path)
        if args.trades_csv:
            path = args.trades_csv if len(datasets) == 1 else \
                f"{label.replace('/', '_')}_{args.trades_csv}"
            result["trades"].to_csv(path, index=False)
            print(f"Trade log saved to {path}")

    if len(summaries) > 1:
        print("\n=== Summary (strategy CAGR / B&H CAGR / max DD / trades) ===")
        for s in summaries:
            print(f"  {s['label']:8} {s['strat']['cagr'] * 100:7.2f}% "
                  f"/ {s['bench']['cagr'] * 100:7.2f}% "
                  f"/ {s['strat']['max_dd'] * 100:7.2f}% / {s['trades']}")

    if args.selftest:
        res = last_result["df"]
        assert not res[["strat_equity", "bh_equity"]].isna().any().any()
        assert (res["strat_equity"] > 0).all()
        flat = res["position"].shift(1, fill_value=0.0) == 0
        assert (res.loc[flat, "strat_ret"] == 0).all(), "earned returns while flat"
        print("\nSelf-test assertions passed (no NaNs, positive equity, "
              "no returns while flat).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
