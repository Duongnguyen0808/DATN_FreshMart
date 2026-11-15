"""Deterministic inventory-policy comparison on an untouched chronological holdout.

M5 sales are a proxy for demand. Costs and starting stock are scenario assumptions,
not measured FreshMart operating results.
"""
from __future__ import annotations

from collections import defaultdict
from math import ceil, isfinite

import pandas as pd


def simulate_policy(demand: list[int], forecast: list[float], history: list[int], *,
                    lead_days: int = 3, cover_days: int = 7, policy: str = 'fixed') -> tuple[dict, list[dict]]:
    if policy not in ('fixed', 'forecast') or lead_days < 1 or cover_days < 1:
        raise ValueError('Invalid inventory policy configuration')
    if len(demand) != len(forecast) or len(history) < 28 or any(v < 0 for v in demand + history):
        raise ValueError('Need aligned nonnegative holdout and at least 28 past days')
    if any(not isfinite(v) or v < 0 for v in forecast if not pd.isna(v)):
        raise ValueError('Forecast values must be finite and nonnegative')
    baseline_rate = sum(history[-28:]) / 28
    initial_stock = ceil(baseline_rate * (lead_days + cover_days))
    stock = initial_stock
    pending: dict[int, int] = defaultdict(int)
    rows = []
    for day, actual in enumerate(demand):
        arrived = pending.pop(day, 0)
        stock += arrived
        sold = min(stock, actual)
        missed = actual - sold
        stock -= sold
        # Decisions use only forecasts made before this holdout; never future actuals.
        missing_forecast = policy == 'forecast' and pd.isna(forecast[day])
        rate = baseline_rate if policy == 'fixed' or missing_forecast else forecast[day]
        reorder_point = ceil(rate * lead_days)
        target = ceil(rate * (lead_days + cover_days))
        on_order = sum(pending.values())
        ordered = max(0, target - stock - on_order) if stock + on_order <= reorder_point else 0
        if ordered:
            pending[day + lead_days] += ordered
        rows.append({'day': day + 1, 'demand_proxy': actual, 'received': arrived,
                     'sold': sold, 'unmet_proxy': missed, 'closing_stock': stock,
                     'ordered': ordered, 'forecast_at_decision': forecast[day] if policy == 'forecast' and not missing_forecast else None,
                     'forecast_fallback': missing_forecast})
    total = sum(demand)
    sold = sum(row['sold'] for row in rows)
    # Illustrative normalized cost units; change through scenario parameters before interpretation.
    metrics = {'policy': policy, 'initial_stock': initial_stock, 'lead_days': lead_days,
               'cover_days': cover_days, 'stockout_days': sum(row['unmet_proxy'] > 0 for row in rows),
               'unmet_units_proxy': total - sold, 'fill_rate': sold / total if total else None,
               'average_stock': sum(row['closing_stock'] for row in rows) / len(rows) if rows else 0,
               'order_count': sum(row['ordered'] > 0 for row in rows),
               'ordered_units': sum(row['ordered'] for row in rows),
               'forecast_fallback_days': sum(row['forecast_fallback'] for row in rows)}
    return metrics, rows


def compare_policies(frame: pd.DataFrame, test_predictions: pd.DataFrame, test_start: int,
                     *, lead_days: int = 3, cover_days: int = 7) -> tuple[dict, pd.DataFrame]:
    traces = []
    item_results = []
    for item_id, predicted in test_predictions.groupby('item_id', sort=True):
        past = frame[(frame.item_id == item_id) & (frame.d_num < test_start)].sort_values('d_num')
        future = predicted.sort_values('date')
        demand = future.actual.astype(int).tolist()
        estimates = future.predicted.astype(float).tolist()
        for policy in ('fixed', 'forecast'):
            metrics, rows = simulate_policy(demand, estimates, past.sales.astype(int).tolist(),
                                            lead_days=lead_days, cover_days=cover_days, policy=policy)
            item_results.append({'item_id': item_id, **metrics})
            traces.extend({'item_id': item_id, 'date': date, 'policy': policy, **row}
                          for date, row in zip(future.date, rows))
    summary = {}
    for policy in ('fixed', 'forecast'):
        selected = [row for row in item_results if row['policy'] == policy]
        selected_traces = [row for row in traces if row['policy'] == policy]
        total_demand = sum(row['demand_proxy'] for row in selected_traces)
        total_sold = sum(row['sold'] for row in selected_traces)
        summary[policy] = {'stockout_days': sum(row['stockout_days'] for row in selected),
                           'unmet_units_proxy': total_demand - total_sold,
                           'fill_rate': total_sold / total_demand if total_demand else None,
                           'average_stock': sum(row['average_stock'] for row in selected) / len(selected) if selected else 0,
                           'order_count': sum(row['order_count'] for row in selected),
                           'ordered_units': sum(row['ordered_units'] for row in selected),
                           'forecast_fallback_days': sum(row['forecast_fallback_days'] for row in selected)}
    return {'assumptions': {'dataset': 'M5 observed sales as demand proxy', 'lead_days': lead_days,
                            'cover_days': cover_days, 'initial_stock': 'mean of 28 pre-test sales days × (lead + cover)',
                            'fixed_policy': '28-day historical average',
                            'forecast_policy': 'pre-test holdout forecast; no test actuals used for decisions',
                            'costs': 'not estimated; no real procurement or carrying cost available'},
            'summary': summary, 'items': item_results}, pd.DataFrame(traces)
