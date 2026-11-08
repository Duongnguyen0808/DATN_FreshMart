"""M5 CSV benchmark: seven models, chronological train/validation/test.
Select lowest validation MAE, refit train + validation, evaluate test once.
Run python train_ai.py, then open data/output/experiment_report.html.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, ExtraTreesRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parent.parent
M5_DIR = ROOT / "M5" / "m5-forecasting-accuracy"
DATA_DIR = Path(__file__).resolve().parent / "data"
PROCESSED_DIR = DATA_DIR / "processed"
SPLIT_DIR = PROCESSED_DIR / "splits"
OUTPUT_DIR = DATA_DIR / "output"
MODEL_DIR = Path(__file__).resolve().parent / "models"
STORE_ID = "CA_1"
ITEM_LIMIT = 30
VALIDATION_START, VALIDATION_END = 1886, 1913
TEST_START, TEST_END = 1914, 1941
LEARNED_MODELS = ("Ridge", "RandomForest", "ExtraTrees", "GradientBoosting", "XGBoost")
CANDIDATES = ("MovingAverage7", "SeasonalNaive7", *LEARNED_MODELS)
FEATURE_COLUMNS = ["lag_1", "lag_7", "lag_28", "rolling_mean_7", "rolling_mean_28",
                   "day_of_week", "month", "sell_price"]


def preprocess(data_dir: Path = M5_DIR, store_id: str = STORE_ID, item_limit: int = ITEM_LIMIT,
               output: Path | None = None) -> pd.DataFrame:
    """Đọc M5, chọn SKU chỉ dựa trên train và tạo CSV dạng long để xử lý tiếp."""
    sales_path, calendar_path, prices_path = (data_dir / "sales_train_evaluation.csv",
                                               data_dir / "calendar.csv", data_dir / "sell_prices.csv")
    for path in (sales_path, calendar_path, prices_path):
        if not path.is_file():
            raise FileNotFoundError(f"Required M5 file not found: {path}")
    if item_limit < 1:
        raise ValueError("item_limit must be positive")
    sales = pd.read_csv(sales_path)
    selected = sales.loc[sales["store_id"].eq(store_id)].copy()
    if selected.empty:
        raise ValueError(f"No M5 series found for store {store_id}")
    day_columns = [column for column in selected.columns if column.startswith("d_")]
    train_columns = [column for column in day_columns if int(column[2:]) < VALIDATION_START]
    selected["_train_total"] = selected[train_columns].sum(axis=1)
    selected = selected.nlargest(item_limit, "_train_total").drop(columns="_train_total")
    id_columns = ["id", "item_id", "dept_id", "cat_id", "store_id", "state_id"]
    long = selected.melt(id_vars=id_columns, value_vars=day_columns, var_name="d", value_name="sales")
    long = long.merge(pd.read_csv(calendar_path), on="d", how="left", validate="many_to_one")
    long = long.merge(pd.read_csv(prices_path), on=["store_id", "item_id", "wm_yr_wk"],
                      how="left", validate="many_to_one")
    long["date"] = pd.to_datetime(long["date"])
    long["sales"] = pd.to_numeric(long["sales"], errors="raise").astype("int32")
    long = long.sort_values(["store_id", "item_id", "date"]).reset_index(drop=True)
    target = output or PROCESSED_DIR / "m5_processed.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    long.to_csv(target, index=False)
    return long


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Tạo đặc trưng trễ/trung bình trượt/lịch/giá, không dùng doanh số tương lai."""
    result = frame.sort_values(["item_id", "date"]).copy()
    groups = result.groupby("item_id", sort=False)["sales"]
    for lag in (1, 7, 28):
        result[f"lag_{lag}"] = groups.shift(lag)
    shifted = groups.shift(1)
    result["rolling_mean_7"] = shifted.groupby(result["item_id"]).rolling(7).mean().reset_index(level=0, drop=True)
    result["rolling_mean_28"] = shifted.groupby(result["item_id"]).rolling(28).mean().reset_index(level=0, drop=True)
    result["day_of_week"] = result["date"].dt.dayofweek
    result["month"] = result["date"].dt.month
    result["sell_price"] = result["sell_price"].fillna(0)
    return result


def recursive_features(history: list[float], day: pd.Timestamp, price: float) -> dict[str, float]:
    if len(history) < 28:
        raise ValueError("At least 28 historical observations are required")
    return {"lag_1": history[-1], "lag_7": history[-7], "lag_28": history[-28],
            "rolling_mean_7": sum(history[-7:]) / 7, "rolling_mean_28": sum(history[-28:]) / 28,
            "day_of_week": day.dayofweek, "month": day.month, "sell_price": price}


def scores(actual: list[float], predicted: list[float]) -> dict:
    errors = np.asarray(predicted, dtype=float) - np.asarray(actual, dtype=float)
    actual_values = np.asarray(actual, dtype=float)
    nonzero = actual_values != 0
    mape = round(float(np.mean(np.abs(errors[nonzero]) / actual_values[nonzero]) * 100), 4) if nonzero.any() else None
    return {"mae": round(float(np.mean(np.abs(errors))), 4),
            "rmse": round(float(np.sqrt(np.mean(errors ** 2))), 4),
            "mape": mape,
            "wape": round(float(np.abs(errors).sum() / np.abs(actual_values).sum() * 100), 4) if np.abs(actual_values).sum() else None,
            "r2": round(float(1 - np.sum(errors ** 2) / np.sum((actual_values - actual_values.mean()) ** 2)), 4) if np.var(actual_values) > 0 else None}


def _model(name: str):
    if name == "Ridge":
        return make_pipeline(StandardScaler(), Ridge(alpha=10))
    if name == "ExtraTrees":
        return ExtraTreesRegressor(n_estimators=120, max_depth=14, min_samples_leaf=2, n_jobs=1, random_state=42)
    if name == "GradientBoosting":
        return GradientBoostingRegressor(n_estimators=120, max_depth=3, learning_rate=0.05, random_state=42)
    if name == "RandomForest":
        return RandomForestRegressor(n_estimators=120, max_depth=14, min_samples_leaf=2,
                                     max_features=0.9, n_jobs=1, random_state=42)
    if name == "XGBoost":
        return XGBRegressor(n_estimators=350, max_depth=7, learning_rate=0.05,
                            subsample=0.85, colsample_bytree=0.9, objective="reg:squarederror",
                            n_jobs=1, random_state=42)
    raise ValueError(name)


def _forecast_recursive(model, history: pd.DataFrame, future: pd.DataFrame) -> list[float]:
    demand = history.sales.astype(float).tolist()
    result = []
    for row in future.itertuples():
        # At forecast time future selling prices are not guaranteed to be known.
        price = float(history.sell_price.fillna(0).iloc[-1])
        feature_row = recursive_features(demand, row.date, price)
        prediction = max(0.0, float(model.predict(pd.DataFrame([feature_row], columns=FEATURE_COLUMNS))[0]))
        result.append(prediction)
        demand.append(prediction)
    return result


def _baseline(history: pd.DataFrame, horizon: int, method: str) -> list[float]:
    values = history.sales.astype(float).tolist()
    output = []
    for _ in range(horizon):
        prediction = values[-7] if method == "SeasonalNaive" else sum(values[-7:]) / 7
        prediction = max(0.0, prediction)
        output.append(prediction)
        values.append(prediction)
    return output


def _window_predictions(frame: pd.DataFrame, item_ids: list[str], start: int, end: int,
                        model_name: str, model=None) -> tuple[list[float], list[float], list[dict]]:
    actuals, predictions, rows = [], [], []
    for item_id in item_ids:
        history = frame[(frame.item_id.eq(item_id)) & (frame.d_num < start)]
        future = frame[(frame.item_id.eq(item_id)) & frame.d_num.between(start, end)]
        if model_name in LEARNED_MODELS:
            predicted = _forecast_recursive(model, history, future)
        else:
            method = "SeasonalNaive" if model_name == "SeasonalNaive7" else "MovingAverage"
            predicted = _baseline(history, len(future), method)
        actual = future.sales.astype(float).tolist()
        actuals.extend(actual)
        predictions.extend(predicted)
        rows.extend({"model": model_name, "item_id": item_id, "date": day.date().isoformat(),
                     "actual": a, "predicted": p}
                    for day, a, p in zip(future.date, actual, predicted))
    return actuals, predictions, rows


def run_experiment(data_path: Path = PROCESSED_DIR / "m5_processed.csv") -> dict:
    from experiment import run
    return run(data_path, OUTPUT_DIR, MODEL_DIR, SPLIT_DIR)


def forecast_item(item_id: str, horizon: int, data_path: Path = PROCESSED_DIR / "m5_processed.csv") -> dict:
    if horizon not in (7, 14, 28):
        raise ValueError("horizon must be 7, 14, or 28 days")
    frame = pd.read_csv(data_path, parse_dates=["date"])
    history = frame[frame.item_id.eq(item_id)].sort_values("date")
    if history.empty:
        raise ValueError(f"item_id {item_id!r} is not in the prepared M5 sample")
    selection = json.loads((MODEL_DIR / "selected_model.json").read_text(encoding="utf-8"))
    model_name = selection["model"]
    sales = history.sales.astype(float).tolist()
    last_date = history.date.iloc[-1]
    last_price = float(history.sell_price.dropna().iloc[-1]) if history.sell_price.notna().any() else 0.0
    model = joblib.load(MODEL_DIR / f"{model_name.lower()}.joblib") if model_name in LEARNED_MODELS else None
    predictions = []
    for offset in range(1, horizon + 1):
        day = last_date + timedelta(days=offset)
        if model is not None:
            feature_row = recursive_features(sales, pd.Timestamp(day), last_price)
            quantity = max(0.0, float(model.predict(pd.DataFrame([feature_row], columns=FEATURE_COLUMNS))[0]))
        elif model_name == "SeasonalNaive7":
            quantity = max(0.0, sales[-7])
        else:
            quantity = max(0.0, sum(sales[-7:]) / 7)
        predictions.append({"date": day.date().isoformat(), "quantity": round(quantity, 3)})
        sales.append(quantity)
    return {"store_id": history.store_id.iloc[0], "item_id": item_id, "horizon": horizon,
            "predictions": predictions, "total_forecast": round(sum(row["quantity"] for row in predictions), 3),
            "model": model_name,
            "note": "M5 research forecast; validate mapping before applying to live store/SKU data."}


def main() -> None:
    # Ép terminal Windows dùng UTF-8 để các ghi chú tiếng Việt không lỗi mã hóa.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=M5_DIR)
    parser.add_argument("--store", default=STORE_ID)
    parser.add_argument("--items", type=int, default=ITEM_LIMIT)
    parser.add_argument("--forecast-item", help="SKU M5 dùng để chạy dự báo thử")
    parser.add_argument("--horizon", type=int, choices=(7, 14, 28), default=7)
    args = parser.parse_args()
    if args.forecast_item:
        print("[Dự báo thử] Nạp model đã train và dự báo SKU M5 được chọn")
        print(json.dumps(forecast_item(args.forecast_item, args.horizon), indent=2))
        return

    print("CSV benchmark: 7 candidates; chronological train / validation / test")
    preprocess(args.data_dir, args.store, args.items)
    result = run_experiment()
    print(pd.DataFrame(result["full_sample_validation_metrics"]).T.sort_values("mae").to_string())
    print("Selected:", result["selected_model"])
    print("Test:", result["full_sample_test_metrics"])
    print("Report:", OUTPUT_DIR / "experiment_report.html")
    print("Split CSV files:", SPLIT_DIR)


if __name__ == "__main__":
    main()
