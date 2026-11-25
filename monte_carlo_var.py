"""Monte Carlo Portfolio Risk Engine (VaR & Expected Shortfall) for Indian Markets.

Fetches live/latest daily price data from Yahoo Finance (NSE/BSE via .NS/.BO),
estimates annualized return, volatility, and correlation parameters, runs a
10,000-path Monte Carlo simulation using Cholesky decomposition over a 1-month
(21 trading days) horizon, computes 95% VaR and Expected Shortfall (ES), and
performs a correlation sensitivity analysis demonstrating diversification failure.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yfinance as yf

TRADING_DAYS_PER_YEAR = 252
DEFAULT_TICKERS = [
    "RELIANCE.NS",
    "TCS.NS",
    "HDFCBANK.NS",
    "SUNPHARMA.NS",
    "ITC.NS",
]


@dataclass(frozen=True)
class MarketParameters:
    """Estimated return, volatility, and correlation inputs for simulation."""

    tickers: list[str]
    latest_prices: pd.Series
    latest_date: str
    daily_mean: np.ndarray
    daily_vol: np.ndarray
    annual_mean: np.ndarray
    annual_vol: np.ndarray
    corr_matrix: np.ndarray
    n_observations: int


@dataclass(frozen=True)
class RiskMetrics:
    """Portfolio Value at Risk and Expected Shortfall results."""

    var_pct: float
    es_pct: float
    var_inr: float
    es_inr: float
    mean_return_pct: float
    worst_return_pct: float
    best_return_pct: float
    portfolio_returns: np.ndarray


def format_inr(amount: float) -> str:
    """Format a number in Indian Rupee notation (e.g., Rs. 1,00,000)."""
    sign = "-" if amount < 0 else ""
    value = abs(amount)
    integer_part, _, decimal_part = f"{value:,.2f}".partition(".")
    # Convert standard Western grouping to Indian grouping for >= 1,000
    digits = integer_part.replace(",", "")
    if len(digits) > 3:
        last_three = digits[-3:]
        rest = digits[:-3]
        groups = []
        while len(rest) > 2:
            groups.append(rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.append(rest)
        formatted_int = ",".join(reversed(groups)) + "," + last_three
    else:
        formatted_int = digits
    return f"{sign}INR {formatted_int}.{decimal_part}"


def fetch_indian_stock_data(
    tickers: Sequence[str],
    period: str = "2y",
) -> tuple[pd.DataFrame, pd.Series]:
    """Download historical daily adjusted close prices and latest live prices."""
    ticker_list = list(dict.fromkeys(t.strip().upper() for t in tickers if t.strip()))
    if len(ticker_list) < 2:
        raise ValueError("Provide at least 2 distinct stock tickers to compute correlations.")

    raw = yf.download(
        tickers=ticker_list,
        period=period,
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=False,
    )

    if raw.empty:
        raise RuntimeError(f"No data returned from yfinance for {ticker_list}.")

    if isinstance(raw.columns, pd.MultiIndex):
        if "Close" not in raw.columns.get_level_values(0):
            raise RuntimeError("Expected 'Close' column in yfinance output.")
        prices = raw["Close"].copy()
    else:
        prices = raw[["Close"]].copy()
        prices.columns = ticker_list

    # Preserve requested ticker order and drop rows with missing dates across assets
    prices = prices[ticker_list].dropna(how="any")
    if len(prices) < 252:
        raise RuntimeError(
            f"Insufficient overlapping history ({len(prices)} rows). Need >= 252 trading days."
        )

    # Pull latest live quote when available, falling back to latest daily close
    latest_prices = prices.iloc[-1].copy()
    for ticker in ticker_list:
        try:
            info = yf.Ticker(ticker).fast_info
            last_price = info.get("lastPrice") or info.get("regularMarketPrice")
            if last_price and np.isfinite(last_price) and last_price > 0:
                latest_prices[ticker] = float(last_price)
        except Exception:
            # Keep the most recent close if fast_info is unavailable
            pass

    return prices, latest_prices


def estimate_parameters(
    prices: pd.DataFrame,
    latest_prices: pd.Series,
) -> MarketParameters:
    """Compute daily and annualized return, volatility, and correlation matrix."""
    daily_returns = prices.pct_change().dropna(how="any")

    daily_mean = daily_returns.mean().to_numpy(dtype=float)
    daily_vol = daily_returns.std(ddof=1).to_numpy(dtype=float)
    annual_mean = daily_mean * TRADING_DAYS_PER_YEAR
    annual_vol = daily_vol * np.sqrt(TRADING_DAYS_PER_YEAR)
    corr_matrix = daily_returns.corr().to_numpy(dtype=float)

    latest_date = prices.index[-1].strftime("%Y-%m-%d")
    return MarketParameters(
        tickers=list(prices.columns),
        latest_prices=latest_prices,
        latest_date=latest_date,
        daily_mean=daily_mean,
        daily_vol=daily_vol,
        annual_mean=annual_mean,
        annual_vol=annual_vol,
        corr_matrix=corr_matrix,
        n_observations=len(daily_returns),
    )


def _cholesky_with_jitter(corr_matrix: np.ndarray) -> np.ndarray:
    """Compute lower-triangular Cholesky factor, adding tiny jitter if needed."""
    n = corr_matrix.shape[0]
    matrix = 0.5 * (corr_matrix + corr_matrix.T)
    np.fill_diagonal(matrix, 1.0)
    for jitter in (0.0, 1e-10, 1e-8, 1e-6, 1e-4):
        try:
            return np.linalg.cholesky(matrix + jitter * np.eye(n))
        except np.linalg.LinAlgError:
            continue
    raise np.linalg.LinAlgError("Correlation matrix is not positive definite.")


def simulate_portfolio_returns(
    params: MarketParameters,
    weights: np.ndarray,
    corr_matrix: np.ndarray,
    n_sims: int = 10_000,
    horizon_days: int = 21,
    seed: int = 42,
) -> np.ndarray:
    """Simulate correlated multi-day portfolio returns using Cholesky decomposition."""
    n_assets = len(params.tickers)
    chol = _cholesky_with_jitter(corr_matrix)

    rng = np.random.default_rng(seed)
    # Standard normal shocks: (n_sims, horizon_days, n_assets)
    z_uncorrelated = rng.standard_normal(size=(n_sims, horizon_days, n_assets))
    # Embed correlation structure: Z_corr = Z @ L^T
    z_correlated = z_uncorrelated @ chol.T

    # Daily simulated returns for each asset across all paths and days
    daily_sim_returns = (
        params.daily_mean[None, None, :]
        + z_correlated * params.daily_vol[None, None, :]
    )
    # Compound daily returns over the 21-trading-day (1-month) holding period
    horizon_asset_returns = np.prod(1.0 + daily_sim_returns, axis=1) - 1.0
    portfolio_returns = horizon_asset_returns @ weights
    return portfolio_returns


def calculate_var_and_es(
    portfolio_returns: np.ndarray,
    portfolio_value: float,
    confidence: float = 0.95,
) -> RiskMetrics:
    """Sort simulated returns worst-to-best and compute VaR and Expected Shortfall."""
    sorted_returns = np.sort(portfolio_returns)
    tail_fraction = 1.0 - confidence
    cutoff_index = max(1, int(np.floor(tail_fraction * len(sorted_returns))))

    # Loss is negative return; VaR at 95% is the loss at the 5th percentile
    var_return = float(np.percentile(sorted_returns, tail_fraction * 100.0))
    es_return = float(sorted_returns[:cutoff_index].mean())

    var_pct = -var_return
    es_pct = -es_return

    return RiskMetrics(
        var_pct=var_pct,
        es_pct=es_pct,
        var_inr=var_pct * portfolio_value,
        es_inr=es_pct * portfolio_value,
        mean_return_pct=float(sorted_returns.mean()),
        worst_return_pct=float(sorted_returns[0]),
        best_return_pct=float(sorted_returns[-1]),
        portfolio_returns=sorted_returns,
    )


def average_off_diagonal_corr(corr_matrix: np.ndarray) -> float:
    """Return the mean off-diagonal correlation."""
    n = corr_matrix.shape[0]
    mask = ~np.eye(n, dtype=bool)
    return float(corr_matrix[mask].mean())


def run_correlation_sensitivity(
    params: MarketParameters,
    weights: np.ndarray,
    portfolio_value: float,
    n_sims: int = 10_000,
    horizon_days: int = 21,
    confidence: float = 0.95,
    seed: int = 42,
) -> pd.DataFrame:
    """Sweep correlation from uncorrelated (0) through historical up to stress (0.98)."""
    n_assets = len(params.tickers)
    ones = np.ones((n_assets, n_assets), dtype=float)
    rows: list[dict[str, float | str]] = []

    # 1) Baseline without Cholesky (independent stocks, rho = 0)
    uncorr_metrics = calculate_var_and_es(
        simulate_portfolio_returns(
            params, weights, np.eye(n_assets), n_sims, horizon_days, seed
        ),
        portfolio_value,
        confidence,
    )
    rows.append(
        {
            "scenario": "Uncorrelated (No Cholesky)",
            "alpha": -1.0,
            "avg_corr": 0.0,
            "var_pct": uncorr_metrics.var_pct,
            "es_pct": uncorr_metrics.es_pct,
            "var_inr": uncorr_metrics.var_inr,
            "es_inr": uncorr_metrics.es_inr,
        }
    )

    # 2) Blend historical correlation toward an all-ones matrix:
    #    R(alpha) = (1 - alpha) * R_hist + alpha * J
    alphas = [0.0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.92, 0.97]
    for alpha in alphas:
        blended_corr = (1.0 - alpha) * params.corr_matrix + alpha * ones
        np.fill_diagonal(blended_corr, 1.0)
        sim_returns = simulate_portfolio_returns(
            params, weights, blended_corr, n_sims, horizon_days, seed
        )
        metrics = calculate_var_and_es(sim_returns, portfolio_value, confidence)
        label = "Historical" if alpha == 0.0 else f"Stress (alpha={alpha:.2f})"
        rows.append(
            {
                "scenario": label,
                "alpha": alpha,
                "avg_corr": average_off_diagonal_corr(blended_corr),
                "var_pct": metrics.var_pct,
                "es_pct": metrics.es_pct,
                "var_inr": metrics.var_inr,
                "es_inr": metrics.es_inr,
            }
        )

    return pd.DataFrame(rows)


def save_analysis_chart(
    params: MarketParameters,
    base_metrics: RiskMetrics,
    sensitivity_df: pd.DataFrame,
    output_path: Path,
    confidence: float = 0.95,
) -> None:
    """Create a 3-panel summary chart of distribution, sensitivity, and correlations."""
    fig, axes = plt.subplots(1, 3, figsize=(18, 5.2), dpi=140)
    fig.patch.set_facecolor("#ffffff")

    # Panel 1: Simulated 1-month return distribution
    ax1 = axes[0]
    returns_pct = base_metrics.portfolio_returns * 100.0
    var_line = -base_metrics.var_pct * 100.0
    es_line = -base_metrics.es_pct * 100.0

    ax1.hist(returns_pct, bins=75, color="#3b82f6", alpha=0.75, edgecolor="none")
    ax1.axvline(
        var_line,
        color="#f59e0b",
        linestyle="--",
        linewidth=2.0,
        label=f"{int(confidence * 100)}% VaR: {base_metrics.var_pct * 100:.2f}%",
    )
    ax1.axvline(
        es_line,
        color="#dc2626",
        linestyle="-",
        linewidth=2.0,
        label=f"{int(confidence * 100)}% ES: {base_metrics.es_pct * 100:.2f}%",
    )
    ax1.set_title("1-Month Simulated Return Distribution (10,000 Paths)")
    ax1.set_xlabel("Portfolio Return (%)")
    ax1.set_ylabel("Frequency")
    ax1.legend(frameon=True, fontsize=9)
    ax1.grid(alpha=0.25)

    # Panel 2: Correlation Sensitivity Analysis
    ax2 = axes[1]
    sweep = sensitivity_df[sensitivity_df["alpha"] >= 0.0]
    ax2.plot(
        sweep["avg_corr"],
        sweep["var_pct"] * 100.0,
        marker="o",
        linewidth=2.2,
        color="#f59e0b",
        label="95% VaR (%)",
    )
    ax2.plot(
        sweep["avg_corr"],
        sweep["es_pct"] * 100.0,
        marker="s",
        linewidth=2.2,
        color="#dc2626",
        label="95% ES (%)",
    )
    uncorr_row = sensitivity_df[sensitivity_df["alpha"] < 0.0].iloc[0]
    ax2.scatter(
        [0.0],
        [uncorr_row["var_pct"] * 100.0],
        color="#64748b",
        s=70,
        zorder=5,
        label="Uncorrelated VaR (No Cholesky)",
    )
    ax2.set_title("Correlation Sensitivity: Diversification Breakdown")
    ax2.set_xlabel("Average Pairwise Stock Correlation")
    ax2.set_ylabel("1-Month Portfolio Loss (%)")
    ax2.legend(frameon=True, fontsize=8.5)
    ax2.grid(alpha=0.25)

    # Panel 3: Historical Correlation Matrix Heatmap
    ax3 = axes[2]
    short_names = [t.replace(".NS", "").replace(".BO", "") for t in params.tickers]
    im = ax3.imshow(params.corr_matrix, cmap="coolwarm", vmin=-1.0, vmax=1.0)
    ax3.set_xticks(range(len(short_names)))
    ax3.set_yticks(range(len(short_names)))
    ax3.set_xticklabels(short_names, rotation=30, ha="right", fontsize=9)
    ax3.set_yticklabels(short_names, fontsize=9)
    ax3.set_title("Historical Daily Return Correlation")

    for i in range(len(short_names)):
        for j in range(len(short_names)):
            val = params.corr_matrix[i, j]
            text_color = "white" if abs(val) > 0.6 else "black"
            ax3.text(j, i, f"{val:.2f}", ha="center", va="center", color=text_color, fontsize=9)

    fig.colorbar(im, ax=ax3, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)


def print_report(
    params: MarketParameters,
    weights: np.ndarray,
    portfolio_value: float,
    base_metrics: RiskMetrics,
    sensitivity_df: pd.DataFrame,
    horizon_days: int,
    n_sims: int,
    confidence: float,
) -> None:
    """Print a structured report of all 5 steps to stdout."""
    print("=" * 78)
    print("INDIAN EQUITY PORTFOLIO MONTE CARLO RISK REPORT (NSE / yfinance)")
    print("=" * 78)
    print(
        f"Observations: {params.n_observations} daily returns (latest close: {params.latest_date})"
    )
    print(
        f"Portfolio Value: {format_inr(portfolio_value)} | Horizon: {horizon_days} trading days | "
        f"Simulations: {n_sims:,} | Confidence: {int(confidence * 100)}%"
    )

    print("\n--- Step 1 & 2: Live Prices & Annualized Parameters ---")
    param_df = pd.DataFrame(
        {
            "Ticker": params.tickers,
            "Weight": [f"{w * 100:.1f}%" for w in weights],
            "Latest Price": [format_inr(float(params.latest_prices[t])) for t in params.tickers],
            "Ann. Return": [f"{m * 100:.2f}%" for m in params.annual_mean],
            "Ann. Volatility": [f"{v * 100:.2f}%" for v in params.annual_vol],
        }
    )
    print(param_df.to_string(index=False))

    print("\n--- Step 2: Historical Correlation Matrix ---")
    corr_df = pd.DataFrame(
        params.corr_matrix,
        index=params.tickers,
        columns=params.tickers,
    )
    print(corr_df.round(3).to_string())

    print("\n--- Step 3 & 4: Monte Carlo 1-Month Risk Metrics (Cholesky) ---")
    print(f"Expected 1-Month Return : {base_metrics.mean_return_pct * 100:+.2f}%")
    print(f"Worst Simulated Month   : {base_metrics.worst_return_pct * 100:+.2f}%")
    print(f"Best Simulated Month    : {base_metrics.best_return_pct * 100:+.2f}%")
    print(
        f"95% Value at Risk (VaR) : {base_metrics.var_pct * 100:.2f}% "
        f"({format_inr(base_metrics.var_inr)})"
    )
    print(
        f"95% Expected Shortfall  : {base_metrics.es_pct * 100:.2f}% "
        f"({format_inr(base_metrics.es_inr)})"
    )

    print("\n--- Step 5: Correlation Sensitivity Analysis ---")
    display_df = pd.DataFrame(
        {
            "Scenario": sensitivity_df["scenario"],
            "Avg Corr": sensitivity_df["avg_corr"].map(lambda x: f"{x:.3f}"),
            "95% VaR (%)": sensitivity_df["var_pct"].map(lambda x: f"{x * 100:.2f}%"),
            "95% VaR (INR)": sensitivity_df["var_inr"].map(format_inr),
            "95% ES (%)": sensitivity_df["es_pct"].map(lambda x: f"{x * 100:.2f}%"),
            "95% ES (INR)": sensitivity_df["es_inr"].map(format_inr),
        }
    )
    print(display_df.to_string(index=False))
    print("=" * 78)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Monte Carlo VaR & Expected Shortfall for Indian stocks via yfinance."
    )
    parser.add_argument(
        "--tickers",
        nargs="+",
        default=DEFAULT_TICKERS,
        help="3 to 5 NSE/BSE tickers (e.g. RELIANCE.NS TCS.NS HDFCBANK.NS).",
    )
    parser.add_argument(
        "--weights",
        nargs="+",
        type=float,
        default=None,
        help="Optional portfolio weights (normalized automatically; defaults to equal weight).",
    )
    parser.add_argument(
        "--period",
        default="2y",
        help="Historical lookback period for yfinance (default: 2y; minimum 2y recommended).",
    )
    parser.add_argument(
        "--portfolio-value",
        type=float,
        default=1_000_000.0,
        help="Portfolio notional value in INR (default: 1,000,000).",
    )
    parser.add_argument(
        "--horizon-days",
        type=int,
        default=21,
        help="Holding period in trading days (default: 21 for 1 month).",
    )
    parser.add_argument(
        "--sims",
        type=int,
        default=10_000,
        help="Number of Monte Carlo simulation paths (default: 10,000).",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.95,
        help="Confidence level for VaR and ES (default: 0.95).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42).",
    )
    parser.add_argument(
        "--chart-path",
        type=Path,
        default=Path("portfolio_risk_analysis.png"),
        help="Output path for the summary chart PNG.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.weights is None:
        weights = np.full(len(args.tickers), 1.0 / len(args.tickers), dtype=float)
    else:
        if len(args.weights) != len(args.tickers):
            raise ValueError("Number of weights must match number of tickers.")
        raw_weights = np.asarray(args.weights, dtype=float)
        if np.any(raw_weights < 0) or raw_weights.sum() <= 0:
            raise ValueError("Weights must be non-negative and sum to > 0.")
        weights = raw_weights / raw_weights.sum()

    prices, latest_prices = fetch_indian_stock_data(args.tickers, period=args.period)
    params = estimate_parameters(prices, latest_prices)

    sim_returns = simulate_portfolio_returns(
        params=params,
        weights=weights,
        corr_matrix=params.corr_matrix,
        n_sims=args.sims,
        horizon_days=args.horizon_days,
        seed=args.seed,
    )
    base_metrics = calculate_var_and_es(
        portfolio_returns=sim_returns,
        portfolio_value=args.portfolio_value,
        confidence=args.confidence,
    )
    sensitivity_df = run_correlation_sensitivity(
        params=params,
        weights=weights,
        portfolio_value=args.portfolio_value,
        n_sims=args.sims,
        horizon_days=args.horizon_days,
        confidence=args.confidence,
        seed=args.seed,
    )

    print_report(
        params=params,
        weights=weights,
        portfolio_value=args.portfolio_value,
        base_metrics=base_metrics,
        sensitivity_df=sensitivity_df,
        horizon_days=args.horizon_days,
        n_sims=args.sims,
        confidence=args.confidence,
    )
    save_analysis_chart(
        params=params,
        base_metrics=base_metrics,
        sensitivity_df=sensitivity_df,
        output_path=args.chart_path,
        confidence=args.confidence,
    )
    print(f"\nSaved visualization to: {args.chart_path.resolve()}")


if __name__ == "__main__":
    main()
