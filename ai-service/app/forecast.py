from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
import json
from pathlib import Path
from math import ceil
import logging

import joblib
import pandas as pd
from pydantic import BaseModel, Field, field_validator

from train_ai import FEATURE_COLUMNS, recursive_features

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
LIVE_FEATURES = ["lag_1", "lag_7", "lag_28", "mean_7", "mean_28", "dow", "month"]
logger = logging.getLogger("ai-service")


def _live_features(history: list[float], day: date) -> dict[str, float]:
    return {"lag_1": history[-1], "lag_7": history[-7], "lag_28": history[-28],
            "mean_7": sum(history[-7:]) / 7, "mean_28": sum(history[-28:]) / 28,
            "dow": day.weekday(), "month": day.month}


def _live_model(name: str):
    if name == "RandomForest":
        from sklearn.ensemble import RandomForestRegressor
        return RandomForestRegressor(n_estimators=50, max_depth=12, min_samples_leaf=2,
                                     n_jobs=1, random_state=42)
    if name == "XGBoost":
        from xgboost import XGBRegressor
        return XGBRegressor(n_estimators=120, max_depth=5, learning_rate=0.05,
                            subsample=0.85, colsample_bytree=0.9,
                            objective="reg:squarederror", n_jobs=1, random_state=42)
    raise ValueError(name)


def _live_training_rows(histories: list[list[int]], last_day: date, cutoff: int):
    features, targets = [], []
    for history in histories:
        for index in range(28, min(cutoff, len(history))):
            features.append(_live_features([float(value) for value in history[:index]],
                                           last_day - timedelta(days=len(history) - index - 1)))
            targets.append(float(history[index]))
    return pd.DataFrame(features, columns=LIVE_FEATURES), targets


def _recursive_live(model, history: list[int], last_day: date, horizon: int) -> list[float]:
    values = [float(value) for value in history]
    result = []
    for offset in range(1, horizon + 1):
        day = last_day + timedelta(days=offset)
        if model == "MovingAverage7":
            prediction = sum(values[-7:]) / 7
        elif model == "SeasonalNaive7":
            prediction = values[-7]
        else:
            prediction = float(model.predict(pd.DataFrame([_live_features(values, day)], columns=LIVE_FEATURES))[0])
        prediction = max(0.0, prediction)
        result.append(prediction)
        values.append(prediction)
    return result


def _recursive_live_batch(model, histories: list[list[int]], last_day: date, horizon: int) -> list[list[float]]:
    values = [[float(value) for value in history] for history in histories]
    outputs = [[] for _ in histories]
    for offset in range(1, horizon + 1):
        day = last_day + timedelta(days=offset)
        if model == "MovingAverage7":
            predictions = [sum(history[-7:]) / 7 for history in values]
        elif model == "SeasonalNaive7":
            predictions = [history[-7] for history in values]
        else:
            matrix = pd.DataFrame([_live_features(history, day) for history in values], columns=LIVE_FEATURES)
            predictions = model.predict(matrix)
        for index, prediction in enumerate(predictions):
            value = max(0.0, float(prediction))
            outputs[index].append(value)
            values[index].append(value)
    return outputs


def predict_operational_batch(items: list[SeriesInput], last_day: date, horizon_days: int):
    """Chọn và huấn luyện model từ doanh số thật gửi lên; tuyệt đối không nạp artifact M5."""
    histories = [item.daily_sales for item in items]
    eligible = [history for history in histories if len(history) >= 42 and any(history[-28:])]
    validation_horizon = min(14, max(7, horizon_days))
    selected = "MovingAverage7"
    scores: dict[str, float] = {}
    deployed_model = None

    if eligible and min(map(len, eligible)) > validation_horizon + 28:
        cutoff = min(map(len, eligible)) - validation_horizon
        # Chỉ dùng dữ liệu trước validation để chọn model; holdout là các ngày gần nhất.
        train_x, train_y = _live_training_rows(eligible, last_day, cutoff)
        if len(train_y) >= 100:
            if len(train_y) > 60_000:
                train_x = train_x.sample(n=60_000, random_state=42)
                train_y = [train_y[index] for index in train_x.index]
                train_x = train_x.reset_index(drop=True)
            validation_day = last_day - timedelta(days=(min(map(len, eligible)) - cutoff))
            candidates = ["MovingAverage7", "SeasonalNaive7", "RandomForest", "XGBoost"]
            fitted = {}
            for name in candidates[2:]:
                try:
                    estimator = _live_model(name)
                    estimator.fit(train_x, train_y)
                    fitted[name] = estimator
                except Exception as exc:
                    logger.warning("Bỏ qua model %s cho dự báo vận hành: %s", name, exc)
            for name in candidates:
                validation_histories = [history[:cutoff] for history in eligible]
                validation_predictions = _recursive_live_batch(fitted.get(name, name), validation_histories,
                                                               validation_day, validation_horizon)
                errors = [abs(float(actual) - guess)
                          for history, predicted in zip(eligible, validation_predictions)
                          for actual, guess in zip(history[cutoff:cutoff + validation_horizon], predicted)]
                if errors:
                    scores[name] = sum(errors) / len(errors)
            if scores:
                selected = min(scores, key=scores.get)
                if selected in ("RandomForest", "XGBoost"):
                    full_x, full_y = _live_training_rows(eligible, last_day, min(map(len, eligible)))
                    if len(full_y) > 60_000:
                        full_x = full_x.sample(n=60_000, random_state=42)
                        full_y = [full_y[index] for index in full_x.index]
                        full_x = full_x.reset_index(drop=True)
                    deployed_model = _live_model(selected)
                    deployed_model.fit(full_x, full_y)

    logger.info("Dự báo theo dữ liệu vận hành: model=%s, validation_MAE=%s, so_sánh=%s, SKU=%s, lịch_sử_ngày=%s",
                selected, round(scores[selected], 4) if selected in scores else None,
                {name: round(value, 4) for name, value in scores.items()}, len(items),
                max(map(len, histories), default=0))
    active_indices = [index for index, history in enumerate(histories) if any(history[-28:])]
    prediction_histories = [histories[index] for index in active_indices]
    batch_predictions = _recursive_live_batch(deployed_model if deployed_model is not None else selected,
                                              prediction_histories, last_day, horizon_days)
    prediction_by_index = dict(zip(active_indices, batch_predictions))
    output = []
    for index, history in enumerate(histories):
        recent = history[-28:]
        quality = "SUFFICIENT" if sum(value > 0 for value in recent) >= 7 else "SPARSE"
        if not any(recent):
            output.append((0, "NO_SALES"))
            continue
        prediction = ceil(sum(prediction_by_index[index]))
        output.append((max(0, prediction), quality))
    return selected, output, scores


class SeriesInput(BaseModel):
    sku_id: str
    daily_sales: list[int] = Field(min_length=28, max_length=366)

    @field_validator("daily_sales")
    @classmethod
    def validate_sales(cls, values: list[int]) -> list[int]:
        if any(value < 0 for value in values):
            raise ValueError("daily_sales cannot contain negative values")
        return values


class ForecastInput(BaseModel):
    last_day: date
    horizon_days: int = Field(ge=1, le=30)
    items: list[SeriesInput] = Field(max_length=2000)


@lru_cache(maxsize=1)
def load_selected_model():
    """Load the artifact selected by train_ai.py once per service process."""
    selection_path = MODEL_DIR / "selected_model.json"
    if not selection_path.is_file():
        raise RuntimeError("No selected model; run python train_ai.py first")
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    name = selection["model"]
    model_path = MODEL_DIR / f"{name.lower()}.joblib"
    if name not in ("RandomForest", "XGBoost", "MovingAverage7", "SeasonalNaive7"):
        raise RuntimeError(f"Unsupported selected model: {name}")
    if name in ("RandomForest", "XGBoost") and not model_path.is_file():
        raise RuntimeError(f"Selected model artifact is missing: {model_path}")
    processed_path = MODEL_DIR.parent / "data" / "processed" / "m5_processed.csv"
    processed = pd.read_csv(processed_path, usecols=["sell_price"])
    median_price = float(processed["sell_price"].dropna().median()) if processed["sell_price"].notna().any() else 0.0
    model = joblib.load(model_path) if name in ("RandomForest", "XGBoost") else None
    return name, model, median_price


def predict_daily(sales: list[int], last_day: date, horizon_days: int) -> tuple[int, str]:
    """Run the persisted M5-trained model recursively on a live SKU's sales history."""
    history = [float(value) for value in sales]
    recent = history[-28:]
    quality = "SUFFICIENT" if sum(value > 0 for value in recent) >= 7 else "SPARSE"
    if not any(recent):
        return 0, "NO_SALES"
    model_name, model, reference_price = load_selected_model()

    for offset in range(1, horizon_days + 1):
        if model_name in ("RandomForest", "XGBoost"):
            day = pd.Timestamp(last_day + timedelta(days=offset))
            features = recursive_features(history, day, reference_price)
            quantity = max(0.0, float(model.predict(pd.DataFrame([features], columns=FEATURE_COLUMNS))[0]))
        elif model_name == "SeasonalNaive7":
            quantity = max(0.0, history[-7])
        else:
            quantity = max(0.0, sum(history[-7:]) / 7)
        history.append(quantity)
    predicted = ceil(sum(history[-horizon_days:]))
    return predicted, quality


def predict_series_batch(items: list[SeriesInput], last_day: date, horizon_days: int) -> list[tuple[int, str]]:
    """Predict a whole store in horizon-sized batches rather than SKU by SKU."""
    histories = [[float(value) for value in item.daily_sales] for item in items]
    qualities = ["SUFFICIENT" if sum(value > 0 for value in history[-28:]) >= 7
                 else "SPARSE" for history in histories]
    active = [index for index, history in enumerate(histories) if any(history[-28:])]
    if active:
        model_name, model, reference_price = load_selected_model()
        for offset in range(1, horizon_days + 1):
            if model_name in ("RandomForest", "XGBoost"):
                day = pd.Timestamp(last_day + timedelta(days=offset))
                features = [recursive_features(histories[index], day, reference_price) for index in active]
                predictions = model.predict(pd.DataFrame(features, columns=FEATURE_COLUMNS))
            elif model_name == "SeasonalNaive7":
                predictions = [histories[index][-7] for index in active]
            else:
                predictions = [sum(histories[index][-7:]) / 7 for index in active]
            for index, prediction in zip(active, predictions):
                histories[index].append(max(0.0, float(prediction)))
    active_set = set(active)
    return [(ceil(sum(history[-horizon_days:])) if index in active_set else 0,
             qualities[index] if index in active else "NO_SALES")
            for index, history in enumerate(histories)]

