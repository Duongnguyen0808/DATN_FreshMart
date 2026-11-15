import pytest

from inventory_policy import simulate_policy


def test_policy_replenishment_preserves_stock_accounting_and_lead_time():
    metrics, trace = simulate_policy([8, 8, 8, 8, 8], [8] * 5, [4] * 28,
                                     lead_days=2, cover_days=2, policy='forecast')
    assert metrics['initial_stock'] == 16
    assert trace[0]['received'] == trace[1]['received'] == 0
    assert trace[2]['received'] == trace[0]['ordered']
    assert all(row['closing_stock'] >= 0 for row in trace)
    assert sum(row['sold'] + row['unmet_proxy'] for row in trace) == 40


def test_future_sales_do_not_change_orders_already_placed():
    past = [3] * 28
    forecast = [5] * 4
    _, first = simulate_policy([3, 3, 3, 3], forecast, past, policy='forecast')
    _, changed = simulate_policy([3, 3, 100, 3], forecast, past, policy='forecast')
    assert [row['ordered'] for row in first[:2]] == [row['ordered'] for row in changed[:2]]


def test_zero_demand_and_invalid_inputs():
    metrics, _ = simulate_policy([0, 0], [0, 0], [0] * 28)
    assert metrics['fill_rate'] is None
    with pytest.raises(ValueError):
        simulate_policy([1], [-1], [1] * 28)


def test_missing_forecast_uses_historical_baseline_without_peeking_ahead():
    metrics, trace = simulate_policy([2, 2], [float('nan'), 9], [2] * 28, policy='forecast')
    assert metrics['forecast_fallback_days'] == 1
    assert trace[0]['forecast_at_decision'] is None
    assert trace[0]['forecast_fallback'] is True
