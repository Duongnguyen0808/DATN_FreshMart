from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_m5_forecast_endpoint_uses_selected_model_artifact():
    response = client.post("/ai/forecast", json={
        "store_id": "CA_1",
        "item_id": "FOODS_3_090",
        "horizon": 7,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "XGBoost"
    assert len(body["predictions"]) == 7
    assert body["total_forecast"] > 0


def test_m5_forecast_endpoint_rejects_unsupported_horizon():
    response = client.post("/ai/forecast", json={
        "store_id": "CA_1",
        "item_id": "FOODS_3_090",
        "horizon": 10,
    })
    assert response.status_code == 422
