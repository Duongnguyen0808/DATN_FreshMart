import logging
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import JSONResponse
from .forecast import ForecastInput, predict_operational_batch

app = FastAPI(title="Smart Store AI Service", version="0.1.0")
logger = logging.getLogger("ai-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    logger.exception("Unhandled AI service error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "AI service failed"})


class InventoryAnalysisInput(BaseModel):
    forecast_demand: float = Field(ge=0)
    current_inventory: float = Field(ge=0)
    incoming_quantity: float = Field(default=0, ge=0)
    safety_stock: float = Field(default=0, ge=0)


class TransferCandidate(BaseModel):
    branch_id: str
    current_inventory: float = Field(ge=0)
    safety_stock: float = Field(default=0, ge=0)


class RecommendationAnalysisInput(InventoryAnalysisInput):
    destination_branch_id: str
    sources: list[TransferCandidate] = Field(default_factory=list)


class ResearchForecastInput(BaseModel):
    store_id: str
    item_id: str
    horizon: Literal[7, 14, 28]


def _analyze_shortage(payload: InventoryAnalysisInput) -> dict:
    shortage = max(0.0, payload.forecast_demand + payload.safety_stock
                   - payload.current_inventory - payload.incoming_quantity)
    if shortage <= 0:
        risk = "NONE"
    elif payload.current_inventory + payload.incoming_quantity <= payload.forecast_demand:
        risk = "HIGH"
    elif shortage >= max(1.0, payload.safety_stock * 0.5):
        risk = "MEDIUM"
    else:
        risk = "LOW"
    return {
        "forecast_demand": payload.forecast_demand,
        "current_inventory": payload.current_inventory,
        "incoming_quantity": payload.incoming_quantity,
        "safety_stock": payload.safety_stock,
        "shortage_quantity": shortage,
        "has_shortage": shortage > 0,
        "risk_level": risk,
    }


@app.get("/health")
def health() -> dict:
    return {
        "success": True,
        "message": "Success",
        "data": {"service": "ai-service", "status": "ok"},
    }


@app.post("/forecast/demand")
def forecast_demand(payload: ForecastInput) -> dict:
    model_name, predictions, validation_mae = predict_operational_batch(
        payload.items, payload.last_day, payload.horizon_days)
    return {
        "model": f"Live-{model_name}",
        "validationMae": validation_mae.get(model_name),
        "items": [
            {
                "skuId": item.sku_id,
                "predictedQuantity": prediction,
                "dataQuality": quality,
            }
            for item, (prediction, quality) in zip(payload.items, predictions)
        ],
    }


@app.post("/ai/forecast")
def research_forecast(payload: ResearchForecastInput) -> dict:
    """Forecast an item in the trained M5 research sample using the selected artifact."""
    from train_ai import forecast_item

    result = forecast_item(payload.item_id, payload.horizon)
    if result["store_id"] != payload.store_id:
        return JSONResponse(status_code=404, content={"detail": "store_id is not in the prepared M5 sample"})
    return result


@app.post("/ai/analyze-inventory")
def analyze_inventory(payload: InventoryAnalysisInput) -> dict:
    """Pure calculation only; Node Backend remains responsible for persistence and workflows."""
    return _analyze_shortage(payload)


@app.post("/ai/recommendations")
def analyze_recommendations(payload: RecommendationAnalysisInput) -> dict:
    result = _analyze_shortage(payload)
    remaining = result["shortage_quantity"]
    transfers = []
    for source in payload.sources:
        if source.branch_id == payload.destination_branch_id or remaining <= 0:
            continue
        surplus = max(0.0, source.current_inventory - source.safety_stock)
        quantity = min(remaining, surplus)
        if quantity > 0:
            transfers.append({"source_branch_id": source.branch_id,
                              "destination_branch_id": payload.destination_branch_id,
                              "suggested_quantity": quantity})
            remaining -= quantity
    return {**result, "transfer_suggestions": transfers,
            "purchase_suggestion_quantity": max(0.0, remaining),
            "requires_manager_approval": True}
