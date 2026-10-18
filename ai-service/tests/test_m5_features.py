import pandas as pd

from train_ai import build_features, recursive_features


def test_lag_and_rolling_features_use_only_prior_days():
    frame = pd.DataFrame({
        "item_id": ["a"] * 30,
        "date": pd.date_range("2020-01-01", periods=30),
        "sales": list(range(1, 31)),
        "sell_price": [2.0] * 30,
    })
    result = build_features(frame)
    last = result.iloc[-1]
    assert last.lag_1 == 29
    assert last.lag_7 == 23
    assert last.lag_28 == 2
    assert last.rolling_mean_7 == 26
    assert last.rolling_mean_28 == 15.5


def test_recursive_feature_builder_uses_prediction_history():
    result = recursive_features(list(range(1, 29)), pd.Timestamp("2020-02-01"), 3.5)
    assert result["lag_1"] == 28
    assert result["lag_7"] == 22
    assert result["lag_28"] == 1
    assert result["rolling_mean_7"] == 25
    assert result["sell_price"] == 3.5
