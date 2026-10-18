from datetime import date

from fastapi.testclient import TestClient

from app.forecast import SeriesInput, predict_daily, predict_operational_batch
from app.main import app

client = TestClient(app)


def test_zero_recent_sales_do_not_create_demand_without_model_call():
    assert predict_daily([2] * 28 + [0] * 28, date(2026, 9, 19), 14) == (0, "NO_SALES")


def test_live_forecast_endpoint_trains_from_operational_sales_and_handles_no_sales():
    response = client.post("/forecast/demand", json={
        "last_day": "2026-10-12",
        "horizon_days": 14,
        "items": [
            {"sku_id": "sku-live-1", "daily_sales": [4, 5, 6, 4, 5, 4, 0] * 8},
            {"sku_id": "sku-live-2", "daily_sales": [0] * 56},
        ],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["model"].startswith("Live-")
    assert [item["skuId"] for item in body["items"]] == ["sku-live-1", "sku-live-2"]
    assert body["items"][0]["predictedQuantity"] > 0
    assert body["items"][0]["dataQuality"] == "SUFFICIENT"
    assert body["items"][1]["predictedQuantity"] == 0
    assert body["items"][1]["dataQuality"] == "NO_SALES"
    # Lịch sử 56 ngày chưa đủ số mẫu để xác thực các model học máy; dùng baseline.
    assert body["validationMae"] is None


def test_live_forecast_rejects_negative_sales():
    response = client.post("/forecast/demand", json={
        "last_day": "2026-10-12", "horizon_days": 7,
        "items": [{"sku_id": "sku-live-1", "daily_sales": [-1] + [0] * 55}],
    })
    assert response.status_code == 422


def test_operational_forecast_compares_models_on_real_series():
    items = [
        SeriesInput(sku_id=f"sku-{index}", daily_sales=[4 + (day % 7) for day in range(120)])
        for index in range(3)
    ]
    model, predictions, validation = predict_operational_batch(items, date(2026, 10, 12), 14)

    assert model in validation
    assert {"MovingAverage7", "SeasonalNaive7", "RandomForest", "XGBoost"}.issubset(validation)
    assert len(predictions) == 3
    assert all(quantity > 0 and quality == "SUFFICIENT" for quantity, quality in predictions)
