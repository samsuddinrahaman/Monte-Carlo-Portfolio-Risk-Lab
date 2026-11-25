"""Lightweight web server for the Indian Market Monte Carlo Risk Dashboard."""

from __future__ import annotations

import json
import mimetypes
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np
import yfinance as yf

from monte_carlo_var import (
    DEFAULT_TICKERS,
    MarketParameters,
    average_off_diagonal_corr,
    calculate_var_and_es,
    estimate_parameters,
    fetch_indian_stock_data,
    run_correlation_sensitivity,
    simulate_portfolio_returns,
)

STATIC_DIR = Path(__file__).parent / "static"
CACHE_TTL_SECONDS = 300
SEARCH_CACHE_TTL_SECONDS = 300
_DATA_CACHE: dict[tuple[tuple[str, ...], str], tuple[float, MarketParameters]] = {}
_SEARCH_CACHE: dict[tuple[str, str], tuple[float, list[dict[str, str]]]] = {}


def _get_market_params(
    tickers: list[str],
    period: str,
    force_refresh: bool = False,
) -> MarketParameters:
    key = (tuple(tickers), period)
    now = time.monotonic()
    if not force_refresh and key in _DATA_CACHE:
        cached_at, cached_params = _DATA_CACHE[key]
        if now - cached_at < CACHE_TTL_SECONDS:
            return cached_params

    prices, latest_prices = fetch_indian_stock_data(tickers, period=period)
    params = estimate_parameters(prices, latest_prices)
    _DATA_CACHE[key] = (now, params)
    return params


def _build_histogram(returns: np.ndarray, bins: int = 60) -> dict[str, list[float]]:
    counts, edges = np.histogram(returns * 100.0, bins=bins)
    return {
        "counts": [int(c) for c in counts],
        "edges": [round(float(e), 4) for e in edges],
    }


def run_simulation_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_tickers = payload.get("tickers") or DEFAULT_TICKERS
    tickers = [str(t).strip().upper() for t in raw_tickers if str(t).strip()]
    if len(tickers) != len(set(tickers)):
        raise ValueError("Duplicate tickers are not allowed.")
    if len(tickers) < 2 or len(tickers) > 10:
        raise ValueError("Provide between 2 and 10 stock tickers (e.g., RELIANCE.NS).")

    period = str(payload.get("period") or "2y").strip()
    if period not in {"2y", "3y", "5y", "max"}:
        raise ValueError("Period must be one of: 2y, 3y, 5y, max.")

    portfolio_value = float(payload.get("portfolioValue", 1_000_000.0))
    if not np.isfinite(portfolio_value) or portfolio_value <= 0:
        raise ValueError("Portfolio value must be greater than 0.")

    horizon_days = int(payload.get("horizonDays", 21))
    if horizon_days < 1 or horizon_days > 252:
        raise ValueError("Horizon days must be between 1 and 252.")

    sims = int(payload.get("sims", 10_000))
    if sims < 500 or sims > 50_000:
        raise ValueError("Simulations must be between 500 and 50,000.")

    confidence = float(payload.get("confidence", 0.95))
    if confidence not in {0.90, 0.95, 0.99}:
        raise ValueError("Confidence must be 0.90, 0.95, or 0.99.")

    raw_weights = payload.get("weights")
    if raw_weights is None or len(raw_weights) == 0:
        weights = np.full(len(tickers), 1.0 / len(tickers), dtype=float)
    else:
        if len(raw_weights) != len(tickers):
            raise ValueError("Weights count must match tickers count.")
        arr = np.asarray([float(w) for w in raw_weights], dtype=float)
        if np.any(arr < 0) or arr.sum() <= 0:
            raise ValueError("Weights must be non-negative and sum to > 0.")
        weights = arr / arr.sum()

    stress_alpha = float(payload.get("stressAlpha", 0.0))
    if not np.isfinite(stress_alpha) or stress_alpha < 0.0 or stress_alpha > 0.98:
        raise ValueError("stressAlpha must be between 0.0 and 0.98.")
    use_cholesky = bool(payload.get("useCholesky", True))
    force_refresh = bool(payload.get("forceRefresh", False))
    seed = int(payload.get("seed", 42))

    params = _get_market_params(tickers, period=period, force_refresh=force_refresh)

    n_assets = len(params.tickers)
    if not use_cholesky:
        active_corr = np.eye(n_assets, dtype=float)
        scenario_label = "Uncorrelated (No Cholesky)"
    else:
        alpha = max(0.0, min(0.98, stress_alpha))
        ones = np.ones((n_assets, n_assets), dtype=float)
        active_corr = (1.0 - alpha) * params.corr_matrix + alpha * ones
        np.fill_diagonal(active_corr, 1.0)
        scenario_label = "Historical" if alpha == 0.0 else f"Stress (alpha={alpha:.2f})"

    sim_returns = simulate_portfolio_returns(
        params=params,
        weights=weights,
        corr_matrix=active_corr,
        n_sims=sims,
        horizon_days=horizon_days,
        seed=seed,
    )
    active_metrics = calculate_var_and_es(
        portfolio_returns=sim_returns,
        portfolio_value=portfolio_value,
        confidence=confidence,
    )
    sensitivity_df = run_correlation_sensitivity(
        params=params,
        weights=weights,
        portfolio_value=portfolio_value,
        n_sims=sims,
        horizon_days=horizon_days,
        confidence=confidence,
        seed=seed,
    )

    return {
        "parameters": {
            "tickers": params.tickers,
            "weights": [round(float(w), 6) for w in weights],
            "latestPrices": [round(float(params.latest_prices[t]), 2) for t in params.tickers],
            "latestDate": params.latest_date,
            "annualMean": [round(float(m), 6) for m in params.annual_mean],
            "annualVol": [round(float(v), 6) for v in params.annual_vol],
            "corrMatrix": [[round(float(c), 4) for c in row] for row in params.corr_matrix],
            "activeCorrMatrix": [[round(float(c), 4) for c in row] for row in active_corr],
            "nObservations": params.n_observations,
        },
        "activeScenario": {
            "label": scenario_label,
            "useCholesky": use_cholesky,
            "stressAlpha": stress_alpha,
            "avgCorr": round(average_off_diagonal_corr(active_corr), 4),
            "varPct": round(active_metrics.var_pct, 6),
            "esPct": round(active_metrics.es_pct, 6),
            "varInr": round(active_metrics.var_inr, 2),
            "esInr": round(active_metrics.es_inr, 2),
            "meanReturnPct": round(active_metrics.mean_return_pct, 6),
            "worstReturnPct": round(active_metrics.worst_return_pct, 6),
            "bestReturnPct": round(active_metrics.best_return_pct, 6),
            "histogram": _build_histogram(active_metrics.portfolio_returns),
        },
        "sensitivity": [
            {
                "scenario": str(row["scenario"]),
                "alpha": float(row["alpha"]),
                "avgCorr": round(float(row["avg_corr"]), 4),
                "varPct": round(float(row["var_pct"]), 6),
                "esPct": round(float(row["es_pct"]), 6),
                "varInr": round(float(row["var_inr"]), 2),
                "esInr": round(float(row["es_inr"]), 2),
            }
            for _, row in sensitivity_df.iterrows()
        ],
    }


class RiskDashboardHandler(BaseHTTPRequestHandler):
    """HTTP request handler serving static UI assets and simulation API."""

    def log_message(self, format: str, *args: Any) -> None:
        # Keep console output concise
        pass

    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return

        if path == "/api/search":
            qs = parse_qs(parsed.query)
            query = (qs.get("q") or [""])[0].strip()
            exchange = (qs.get("exchange") or ["NS"])[0].strip().upper()
            if exchange not in {"NS", "BO"}:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Exchange must be 'NS' or 'BO'."},
                )
                return
            if len(query) < 1:
                self._send_json(HTTPStatus.OK, {"results": []})
                return

            suffix = f".{exchange}"
            cache_key = (query.lower(), exchange)
            now = time.monotonic()
            cached = _SEARCH_CACHE.get(cache_key)
            if cached and now - cached[0] < SEARCH_CACHE_TTL_SECONDS:
                self._send_json(HTTPStatus.OK, {"results": cached[1]})
                return

            try:
                search_obj = yf.Search(query, max_results=20)
                quotes = search_obj.quotes or []

                results = []
                seen = set()
                for item in quotes:
                    sym = str(item.get("symbol") or "").upper()
                    if not sym.endswith(suffix) or sym in seen:
                        continue
                    seen.add(sym)
                    name = str(
                        item.get("longname") or item.get("shortname") or sym
                    ).strip()
                    results.append({"symbol": sym, "name": name, "exchange": exchange})
                top_results = results[:10]
                _SEARCH_CACHE[cache_key] = (now, top_results)
                self._send_json(HTTPStatus.OK, {"results": top_results})
            except Exception as exc:
                self._send_json(HTTPStatus.OK, {"results": [], "warning": str(exc)})
            return

        rel_path = "index.html" if path == "/" else path.lstrip("/")
        target = (STATIC_DIR / rel_path).resolve()
        if not target.is_relative_to(STATIC_DIR.resolve()) or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        content_type, _ = mimetypes.guess_type(str(target))
        content = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/simulate":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            if not raw_body.strip():
                raise ValueError("Request body must be a non-empty JSON object.")
            payload = json.loads(raw_body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            result = run_simulation_payload(payload)
            self._send_json(HTTPStatus.OK, result)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except RuntimeError as exc:
            self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(exc)})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})


def main() -> None:
    host = "127.0.0.1"
    port = 8000
    server = ThreadingHTTPServer((host, port), RiskDashboardHandler)
    print(f"Monte Carlo Indian Market Risk Dashboard running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
