from datetime import date
from app.forecast import SeriesInput
from app.safety_stock import buffer_from_errors, estimate_safety_stock


def test_quantile_never_negative_and_rounds_up():
    assert buffer_from_errors([-5, -2]) == 0
    assert buffer_from_errors([0] * 19 + [4.2]) == 0
    assert buffer_from_errors([0] * 18 + [4.2, 9]) == 5


def test_padding_is_not_observed_history():
    item = SeriesInput(sku_id='new', daily_sales=[0] * 170 + [5] * 10)
    result = estimate_safety_stock([item], date(2026, 10, 18), 7)['new']
    assert result['source'] == 'TEMPORARY_CONFIG'
    assert result['quantity'] is None
    assert result['sampleCount'] == 0


def test_backtest_only_receives_past_and_disjoint_blocks(monkeypatch):
    seen = []
    def predict(items, day, horizon):
        seen.append((len(items[0].daily_sales), day))
        return 'test', [(horizon * 2, 'SUFFICIENT') for _ in items], {}
    monkeypatch.setattr('app.safety_stock.predict_operational_batch', predict)
    item = SeriesInput(sku_id='sku', daily_sales=[3] * 180)
    result = estimate_safety_stock([item], date(2026, 10, 18), 7)['sku']
    assert result['quantity'] == 7
    assert result['sampleCount'] == 12
    assert result['source'] == 'BACKTEST_P95'
    assert all((date(2026, 10, 18) - day).days == 180 - length for length, day in seen)
    assert all(b[0] - a[0] == 7 for a, b in zip(seen, seen[1:]))
