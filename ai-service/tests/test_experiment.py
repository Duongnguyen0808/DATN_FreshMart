import numpy as np
import pandas as pd
import pytest

from experiment import validate_frame, select_model
from train_ai import TEST_END, scores, _forecast_recursive, CANDIDATES, LEARNED_MODELS, _model, FEATURE_COLUMNS


def daily_frame():
    return pd.DataFrame({'item_id': ['a'] * TEST_END, 'store_id': ['CA_1'] * TEST_END,
                         'date': pd.date_range('2011-01-29', periods=TEST_END),
                         'd': [f'd_{i}' for i in range(1, TEST_END + 1)],
                         'sales': [3.] * TEST_END, 'sell_price': [2.] * TEST_END})


def test_csv_rejects_missing_duplicate_and_nonfinite_observations():
    original = daily_frame()
    assert len(validate_frame(original)) == TEST_END
    for bad in (original.iloc[1:], pd.concat([original, original.iloc[:1]]), original.assign(sales=np.inf)):
        with pytest.raises(ValueError):
            validate_frame(bad)


def test_winner_uses_lowest_validation_error_with_deterministic_tie_break():
    assert select_model({'A': {'mae': 2, 'rmse': 4}, 'B': {'mae': 1, 'rmse': 9}}) == 'B'
    assert select_model({'A': {'mae': 1, 'rmse': 4}, 'B': {'mae': 1, 'rmse': 3}}) == 'B'


def test_future_actuals_and_future_price_cannot_change_predictions():
    class PriceAndLag:
        def predict(self, features):
            return features.lag_1 + features.sell_price
    frame = validate_frame(daily_frame())
    history, future = frame.iloc[:28], frame.iloc[28:35]
    before = _forecast_recursive(PriceAndLag(), history, future)
    after = _forecast_recursive(PriceAndLag(), history, future.assign(sales=9999, sell_price=8888))
    assert before == after
    assert before == [5., 7., 9., 11., 13., 15., 17.]


def test_seven_candidates_include_five_trainable_regressors():
    assert len(CANDIDATES) >= 7
    data = pd.DataFrame(np.random.default_rng(42).random((60, len(FEATURE_COLUMNS))), columns=FEATURE_COLUMNS)
    for name in LEARNED_MODELS:
        model = _model(name)
        model.fit(data, np.arange(60) % 7)
        assert np.isfinite(model.predict(data[:2])).all()


def test_metrics_handle_zero_sales_without_fake_accuracy():
    result = scores([0, 0], [1, 2])
    assert result['mape'] is None and result['wape'] is None and result['r2'] is None
    assert 'accuracy_pct' not in result


def test_experiment_endpoint_has_clear_missing_report_state(monkeypatch):
    import train_ai
    from app.main import app
    from fastapi.testclient import TestClient
    monkeypatch.setattr(train_ai, 'OUTPUT_DIR', train_ai.OUTPUT_DIR / 'nonexistent-test-report-directory')
    assert TestClient(app).get('/ai/experiment').status_code == 404


def test_report_matches_real_selected_model_and_holdout():
    import json
    from train_ai import OUTPUT_DIR, MODEL_DIR
    from app.main import app
    from fastapi.testclient import TestClient
    response = TestClient(app).get('/ai/experiment')
    assert response.status_code == 200
    result = response.json()
    summary = result['summary']
    selected = summary['selected_model']
    assert len(summary['full_sample_validation_metrics']) == 7
    assert selected == select_model(summary['full_sample_validation_metrics'])
    assert list(summary['full_sample_test_metrics']) == [selected]
    assert summary['artifact_fit_through_d'] < summary['test_window'][0]
    assert result['html'].count('<svg') == 2
    saved = json.loads((MODEL_DIR / 'selected_model.json').read_text())
    assert saved['model'] == selected
    rows = pd.read_csv(OUTPUT_DIR / 'actual_vs_predicted.csv')
    assert rows[rows.split.eq('test')].model.nunique() == 1
    assert rows[rows.split.eq('validation')].groupby('model').size().nunique() == 1
