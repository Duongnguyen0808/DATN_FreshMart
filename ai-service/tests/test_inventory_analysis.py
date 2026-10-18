from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_shortage_formula_matches_spec_example():
    response = client.post("/ai/analyze-inventory", json={
        "forecast_demand": 80,
        "current_inventory": 30,
        "incoming_quantity": 10,
        "safety_stock": 10,
    })
    assert response.status_code == 200
    assert response.json()["shortage_quantity"] == 50
    assert response.json()["has_shortage"] is True


def test_recommendations_keep_source_safety_stock_and_suggest_purchase_remainder():
    response = client.post("/ai/recommendations", json={
        "forecast_demand": 80,
        "current_inventory": 30,
        "incoming_quantity": 10,
        "safety_stock": 10,
        "destination_branch_id": "B",
        "sources": [
            {"branch_id": "A", "current_inventory": 100, "safety_stock": 60},
            {"branch_id": "B", "current_inventory": 900, "safety_stock": 0},
        ],
    })
    body = response.json()
    assert response.status_code == 200
    assert body["transfer_suggestions"] == [{
        "source_branch_id": "A",
        "destination_branch_id": "B",
        "suggested_quantity": 40,
    }]
    assert body["purchase_suggestion_quantity"] == 10
    assert body["requires_manager_approval"] is True


def test_recommendations_do_not_suggest_when_inventory_is_sufficient():
    response = client.post("/ai/recommendations", json={
        "forecast_demand": 5,
        "current_inventory": 20,
        "incoming_quantity": 0,
        "safety_stock": 2,
        "destination_branch_id": "B",
        "sources": [{"branch_id": "A", "current_inventory": 100, "safety_stock": 10}],
    })
    body = response.json()
    assert response.status_code == 200
    assert body["shortage_quantity"] == 0
    assert body["transfer_suggestions"] == []
    assert body["purchase_suggestion_quantity"] == 0
