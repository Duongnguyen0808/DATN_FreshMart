"""Pipeline train M5 có giải thích từng bước (tiếng Việt).

BƯỚC 1 — Đọc calendar.csv, sell_prices.csv, sales_train_evaluation.csv; kiểm tra thiếu file.
BƯỚC 2 — Lọc CA_1; chọn 30 SKU theo doanh số d_1..d_1913, không dùng holdout để chọn.
BƯỚC 3 — Đổi sales từ wide sang long; ghép ngày/sự kiện và giá theo tuần; lưu dữ liệu xử lý.
BƯỚC 4 — Tạo lag_1/7/28, rolling_mean_7/28 (shift(1)), thứ, tháng, giá; tránh leakage.
BƯỚC 5 — So sánh Moving Average, Seasonal Naive, Random Forest, XGBoost; Prophet chạy 3 SKU.
BƯỚC 6 — Chia theo thời gian: train d_1..1885, validation d_1886..1913, test d_1914..1941.
          Train các model; dự báo validation/test đệ quy; tính MAE, RMSE, MAPE.
BƯỚC 7 — Chọn theo MAE validation; chấm holdout; sau đó fit model triển khai đến ngày cuối có dữ liệu.

MAE/RMSE có đơn vị sản phẩm; MAPE là sai số phần trăm, chỉ tính ngày có bán thực tế > 0.
Chạy ``python train_ai.py --forecast-item ITEM_ID`` để dự báo thử bằng model đã lưu.

Kết quả gồm CSV train/validation/test để xem dữ liệu, bảng điểm được in ra terminal,
metrics CSV/JSON và artifact model. Chương trình sẽ ghi tên model thắng trên validation.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
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
    train_columns = [column for column in day_columns if int(column[2:]) <= 1913]
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
            # Accuracy xấp xỉ = 100 - MAPE; MAPE bỏ ngày actual = 0 nên cần đọc kèm lưu ý.
            "accuracy_pct": round(100 - mape, 4) if mape is not None else None}


def _model(name: str):
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
        feature_row = recursive_features(demand, row.date, float(row.sell_price or 0))
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
        if model_name in ("RandomForest", "XGBoost"):
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


def _prophet_forecasts(frame: pd.DataFrame, item_ids: list[str], start: int, end: int) -> tuple[list, list, list]:
    # CmdStanPy chốt _TMPDIR ngay lúc import, nên chỉ sửa tempfile.tempdir là chưa đủ.
    # Dùng thư mục riêng trong workspace để tương thích môi trường Windows bị giới hạn.
    stan_temp_dir = Path(__file__).resolve().parent / "tmp-ai" / "cmdstan"
    stan_temp_dir.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(stan_temp_dir)
    import cmdstanpy
    import cmdstanpy.model as cmdstan_model
    import cmdstanpy.stanfit.mcmc as cmdstan_mcmc
    import cmdstanpy.stanfit.runset as cmdstan_runset
    import cmdstanpy.utils.filesystem as cmdstan_filesystem

    cmdstanpy._TMPDIR = str(stan_temp_dir)
    cmdstan_model._TMPDIR = str(stan_temp_dir)
    cmdstan_mcmc._TMPDIR = str(stan_temp_dir)
    cmdstan_runset._TMPDIR = str(stan_temp_dir)
    cmdstan_filesystem._TMPDIR = str(stan_temp_dir)
    from prophet import Prophet
    all_actual, all_predicted, rows = [], [], []
    for item_id in item_ids:
        series = frame[frame.item_id.eq(item_id)].sort_values("date")
        train = series[series.d.str[2:].astype(int) < start]
        future = series[series.d.str[2:].astype(int).between(start, end)]
        model = Prophet(weekly_seasonality=True, yearly_seasonality=True, daily_seasonality=False)
        model.fit(train.rename(columns={"date": "ds", "sales": "y"})[["ds", "y"]])
        predicted = model.predict(pd.DataFrame({"ds": future.date.to_list()}))["yhat"].clip(lower=0).tolist()
        actual = future.sales.astype(float).tolist()
        all_actual.extend(actual)
        all_predicted.extend(predicted)
        rows.extend({"model": "Prophet", "item_id": item_id, "date": day.date().isoformat(),
                     "actual": a, "predicted": p}
                    for day, a, p in zip(future.date, actual, predicted))
    return all_actual, all_predicted, rows


def _prophet_failure_reason(error: Exception) -> str:
    message = str(error)
    if isinstance(error, UnboundLocalError) and "fd_out" in message:
        return ("CmdStan không được Windows cấp quyền tạo file output trong thư mục tạm; "
                "Prophet bị bỏ qua, các model còn lại vẫn được đánh giá đầy đủ.")
    cause = error.__cause__ or error
    return f"{type(cause).__name__}: {cause}"


def run_experiment(data_path: Path = PROCESSED_DIR / "m5_processed.csv") -> dict:
    """Huấn luyện/đánh giá theo chuỗi thời gian và xuất các tập để kiểm tra.

    Tập train dùng để fit RF/XGBoost trước validation; sau khi chốt model,
    fit lại bằng dữ liệu đến d_1913 rồi dự báo đệ quy trên holdout d_1914..1941.
    Các CSV split chỉ gồm dữ liệu quan sát gốc, không chứa feature test dùng sai cách.
    """
    frame = pd.read_csv(data_path, parse_dates=["date"])
    frame["d_num"] = frame.d.str[2:].astype(int)
    engineered = build_features(frame)
    train_period = frame[frame.d_num < VALIDATION_START].copy()
    validation_period = frame[frame.d_num.between(VALIDATION_START, VALIDATION_END)].copy()
    test_period = frame[frame.d_num.between(TEST_START, TEST_END)].copy()
    train_frame = engineered[(engineered.d_num < VALIDATION_START) & engineered.lag_28.notna()]
    if frame[frame.d_num.between(VALIDATION_START, VALIDATION_END)].empty or frame[frame.d_num.between(TEST_START, TEST_END)].empty:
        raise ValueError("Dataset does not include the configured validation and test windows")
    item_ids = sorted(frame.item_id.unique())
    # Luu cac tap du lieu goc theo ngay de co the mo CSV va xem tung mau.
    SPLIT_DIR.mkdir(parents=True, exist_ok=True)
    view_columns = [column for column in ("id", "item_id", "store_id", "d", "date", "d_num", "sales", "sell_price") if column in frame]
    train_period[view_columns].to_csv(SPLIT_DIR / "train.csv", index=False)
    validation_period[view_columns].to_csv(SPLIT_DIR / "validation.csv", index=False)
    test_period[view_columns].to_csv(SPLIT_DIR / "test.csv", index=False)
    split_summary = pd.DataFrame([
        {"split": "train", "from_d": 1, "to_d": VALIDATION_START - 1,
         "rows_in_csv": len(train_period), "rows_used_for_model": len(train_frame), "sku_count": train_period.item_id.nunique()},
        {"split": "validation", "from_d": VALIDATION_START, "to_d": VALIDATION_END,
         "rows_in_csv": len(validation_period), "rows_used_for_model": len(validation_period), "sku_count": validation_period.item_id.nunique()},
        {"split": "test_holdout", "from_d": TEST_START, "to_d": TEST_END,
         "rows_in_csv": len(test_period), "rows_used_for_model": len(test_period), "sku_count": test_period.item_id.nunique()},
    ])
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    split_summary.to_csv(OUTPUT_DIR / "dataset_split_summary.csv", index=False)
    representatives = frame.groupby("item_id").sales.sum().nlargest(min(3, len(item_ids))).index.tolist()
    records, representative_metrics, fitted = [], {}, {}

    # Chạy Prophet trên 3 SKU đại diện vì mỗi chuỗi cần fit riêng; so sánh cùng kỳ.
    for name in ("RandomForest", "XGBoost"):
        model = _model(name)
        usable = train_frame.dropna(subset=FEATURE_COLUMNS)
        model.fit(usable[FEATURE_COLUMNS], usable.sales)
        fitted[name] = model
        actual, predicted, rows = _window_predictions(frame, representatives, VALIDATION_START,
                                                       VALIDATION_END, name, model)
        representative_metrics[name] = scores(actual, predicted)
        records.extend({**row, "split": "validation_representative"} for row in rows)
    for name in ("MovingAverage7", "SeasonalNaive7"):
        actual, predicted, rows = _window_predictions(frame, representatives, VALIDATION_START,
                                                       VALIDATION_END, name)
        representative_metrics[name] = scores(actual, predicted)
        records.extend({**row, "split": "validation_representative"} for row in rows)
    prophet_error = None
    try:
        prophet_actual, prophet_predicted, prophet_rows = _prophet_forecasts(
            frame, representatives, VALIDATION_START, VALIDATION_END)
        representative_metrics["Prophet"] = scores(prophet_actual, prophet_predicted)
        records.extend({**row, "split": "validation_representative"} for row in prophet_rows)
    except Exception as error:
        prophet_error = _prophet_failure_reason(error)
        representative_metrics["Prophet"] = {"mae": None, "rmse": None, "mape": None, "accuracy_pct": None}
        print(f"[Cảnh báo] Prophet không chạy được trong môi trường này: {prophet_error}")

    full_validation = {}
    for name in ("MovingAverage7", "SeasonalNaive7", "RandomForest", "XGBoost"):
        actual, predicted, rows = _window_predictions(frame, item_ids, VALIDATION_START,
                                                       VALIDATION_END, name, fitted.get(name))
        full_validation[name] = scores(actual, predicted)
        records.extend({**row, "split": "validation_all_30"} for row in rows)
    # Chỉ dùng validation để chọn model; holdout được giữ riêng để báo cáo cuối.
    selected = min(full_validation, key=lambda name: full_validation[name]["mae"])

    final_train = engineered[(engineered.d_num < TEST_START) & engineered.lag_28.notna()].dropna(subset=FEATURE_COLUMNS)
    representative_test, full_test, test_records, final_models = {}, {}, [], {}
    for name in ("MovingAverage7", "SeasonalNaive7", "RandomForest", "XGBoost"):
        model = None
        if name in ("RandomForest", "XGBoost"):
            model = _model(name)
            model.fit(final_train[FEATURE_COLUMNS], final_train.sales)
            final_models[name] = model
        actual, predicted, rows = _window_predictions(frame, representatives, TEST_START,
                                                       TEST_END, name, model)
        representative_test[name] = scores(actual, predicted)
        test_records.extend({**row, "split": "test_representative"} for row in rows)
        actual, predicted, rows = _window_predictions(frame, item_ids, TEST_START,
                                                       TEST_END, name, model)
        full_test[name] = scores(actual, predicted)
        test_records.extend({**row, "split": "test_all_30"} for row in rows)
    if prophet_error is None:
        try:
            prophet_actual, prophet_predicted, prophet_rows = _prophet_forecasts(
                frame, representatives, TEST_START, TEST_END)
            representative_test["Prophet"] = scores(prophet_actual, prophet_predicted)
            test_records.extend({**row, "split": "test_representative"} for row in prophet_rows)
        except Exception as error:
            prophet_error = _prophet_failure_reason(error)
            representative_test["Prophet"] = {"mae": None, "rmse": None, "mape": None, "accuracy_pct": None}
            print(f"[Cảnh báo] Prophet không chạy được trên test: {prophet_error}")
    else:
        representative_test["Prophet"] = {"mae": None, "rmse": None, "mape": None, "accuracy_pct": None}

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    metric_rows = ([{"model": name, **metric, "split": "validation_representative"}
                    for name, metric in representative_metrics.items()]
                   + [{"model": name, **metric, "split": "test_representative"}
                      for name, metric in representative_test.items()]
                   + [{"model": name, **metric, "split": "validation_all_30"}
                      for name, metric in full_validation.items()]
                   + [{"model": name, **metric, "split": "test_all_30"}
                      for name, metric in full_test.items()])
    pd.DataFrame(metric_rows).to_csv(OUTPUT_DIR / "model_metrics.csv", index=False)
    pd.DataFrame(records + test_records).to_csv(OUTPUT_DIR / "actual_vs_predicted.csv", index=False)
    # Sau khi holdout đã được chấm điểm, refit model triển khai bằng toàn bộ lịch sử M5 quan sát được.
    # Không dùng lần fit này để thay đổi metric test hoặc lựa chọn model.
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    deployment = None
    if selected in ("RandomForest", "XGBoost"):
        deployment = _model(selected)
        deployment_rows = engineered[engineered.lag_28.notna()].dropna(subset=FEATURE_COLUMNS)
        deployment.fit(deployment_rows[FEATURE_COLUMNS], deployment_rows.sales)
        joblib.dump(deployment, MODEL_DIR / f"{selected.lower()}.joblib")
    result = {"representative_validation_metrics": representative_metrics,
              "representative_test_metrics": representative_test,
              "full_sample_validation_metrics": full_validation,
              "full_sample_test_metrics": full_test,
              "selected_model": selected, "selection_metric": "full-sample validation MAE",
              "deployment_fit_through_d": int(frame.d_num.max()),
              "deployment_rows": int(len(engineered[engineered.lag_28.notna()].dropna(subset=FEATURE_COLUMNS))),
              "validation_window": [VALIDATION_START, VALIDATION_END],
              "test_window": [TEST_START, TEST_END], "trained_items": len(item_ids),
              "dataset_splits": split_summary.to_dict(orient="records"),
              "model_algorithms": ["MovingAverage7", "SeasonalNaive7", "RandomForest", "XGBoost", "Prophet (3 SKU representative)"],
              "prophet_error": prophet_error,
              "representative_item_ids": representatives}
    (OUTPUT_DIR / "experiment_summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    # Lưu dự báo theo ngày để kiểm tra kết quả thực nghiệm ngoài ứng dụng.
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    (MODEL_DIR / "selected_model.json").write_text(json.dumps({
        "model": selected, "selection_metric": "full-sample validation MAE",
        "validation_mae": full_validation[selected]["mae"],
        "holdout_test_mae": full_test[selected]["mae"],
        "fit_through_d": int(frame.d_num.max()),
        "training_rows": int(len(engineered[engineered.lag_28.notna()].dropna(subset=FEATURE_COLUMNS)))}, indent=2), encoding="utf-8")
    return result


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
    model = joblib.load(MODEL_DIR / f"{model_name.lower()}.joblib") if model_name in ("RandomForest", "XGBoost") else None
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

    print("\n=== PIPELINE HUẤN LUYỆN VÀ ĐÁNH GIÁ M5 ===")
    print("[Bước 1/7] Đọc calendar.csv, sell_prices.csv, sales_train_evaluation.csv; kiểm tra file")
    print("[Bước 2/7] Lọc CA_1 và chọn SKU theo doanh số train d_1..d_1913")
    processed = preprocess(args.data_dir, args.store, args.items)
    print(f"[Bước 3/7] Wide→long, ghép lịch/giá: {len(processed):,} dòng, {processed.item_id.nunique()} SKU")
    print("[Bước 4/7] Tạo lag, rolling shift(1), thứ, tháng, giá; tránh nhìn dữ liệu tương lai")
    print("[Bước 5/7] So sánh: Moving Average 7 ngày, Seasonal Naive 7 ngày, Random Forest, XGBoost, Prophet (3 SKU)")
    print("[Bước 6/7] Train d_1..d_1885 | Validation d_1886..d_1913 | Test holdout d_1914..d_1941")
    result = run_experiment()

    print("\nKÍCH THƯỚC CÁC TẬP DỮ LIỆU")
    print(pd.DataFrame(result["dataset_splits"]).to_string(index=False))
    validation_rows = [{"model": name, **metric, "split": "validation_all_30"}
                       for name, metric in result["full_sample_validation_metrics"].items()]
    test_rows = [{"model": name, **metric, "split": "test_all_30"}
                 for name, metric in result["full_sample_test_metrics"].items()]
    metric_table = pd.DataFrame(validation_rows + test_rows)
    metric_table = metric_table.rename(columns={"mae": "MAE_sản_phẩm", "rmse": "RMSE_sản_phẩm", "mape": "MAPE_%", "accuracy_pct": "Độ_chính_xác_xấp_xỉ_%"})
    print("\nĐIỂM CÁC MODEL (MAE/RMSE theo sản phẩm; accuracy xấp xỉ = 100 - MAPE trên ngày có bán)")
    print(metric_table.to_string(index=False))
    comparable = [{"model": name, **metric}
                  for name, metric in result["full_sample_test_metrics"].items()
                  if name in ("RandomForest", "XGBoost", "MovingAverage7")]
    comparison = pd.DataFrame(comparable).sort_values("mae")
    print("\nSO SÁNH 3 MODEL TRÊN CÙNG TẬP TEST HOLDOUT (xếp theo MAE thấp nhất):")
    print(comparison.rename(columns={"mae": "MAE_sản_phẩm", "rmse": "RMSE_sản_phẩm",
                                    "mape": "MAPE_%", "accuracy_pct": "Độ_chính_xác_xấp_xỉ_%"}).to_string(index=False))
    print("Lưu ý: accuracy ở đây là 100 - MAPE trên ngày có bán, không phải accuracy phân loại; chọn model vẫn dựa trên validation, không dựa vào test.")
    prophet_table = pd.DataFrame([
        {"model": "Prophet (3 SKU đại diện)", "split": "validation", **result["representative_validation_metrics"]["Prophet"]},
        {"model": "Prophet (3 SKU đại diện)", "split": "test", **result["representative_test_metrics"]["Prophet"]},
    ]).rename(columns={"mae": "MAE_sản_phẩm", "rmse": "RMSE_sản_phẩm", "mape": "MAPE_%", "accuracy_pct": "Độ_chính_xác_xấp_xỉ_%"})
    print("\nProphet chạy riêng trên 3 SKU đại diện (không so trực tiếp với nhóm 30 SKU):")
    print(prophet_table.to_string(index=False))
    if result.get("prophet_error"):
        print(f"  Prophet bị môi trường chặn: {result['prophet_error']}")
    print(f"\n[Bước 7/7] Model chọn theo MAE validation: {result['selected_model']}; holdout được báo cáo riêng; artifact fit đến d_{result['deployment_fit_through_d']}")
    print(f"  - Dữ liệu để mở xem: {SPLIT_DIR / 'train.csv'}, validation.csv, test.csv")
    print(f"  - Kích thước từng tập: {OUTPUT_DIR / 'dataset_split_summary.csv'}")
    print(f"  - Toàn bộ điểm số: {OUTPUT_DIR / 'model_metrics.csv'}")
    print(f"  - Actual vs Predicted từng ngày: {OUTPUT_DIR / 'actual_vs_predicted.csv'}")
    print(f"  - Model đã lưu: {MODEL_DIR / 'selected_model.json'} và file .joblib tương ứng")


if __name__ == "__main__":
    main()
