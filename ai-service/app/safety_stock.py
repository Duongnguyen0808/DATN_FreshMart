"""Empirical protection-period buffer; M5 and operational data use this same procedure."""
from datetime import timedelta
from math import ceil

from .forecast import SeriesInput, predict_operational_batch

MIN_BLOCKS = 8
MAX_BLOCKS = 12
SERVICE_LEVEL = 0.95


def buffer_from_errors(errors):
    # Nearest-rank empirical quantile, rounded up to whole selling units.
    return max(0, ceil(sorted(errors)[ceil(SERVICE_LEVEL * len(errors)) - 1]))


def estimate_safety_stock(items, last_day, horizon):
    """Expanding-window backtest. Each disjoint target block is unseen by model selection.

    The horizon is a review/protection period, NOT a supplier lead-time estimate.
    Leading zero padding is not accepted as evidence of observed sales history.
    """
    errors = {item.sku_id: [] for item in items}
    for block in range(MAX_BLOCKS, 0, -1):
        offset = block * horizon
        prefixes, actuals = [], {}
        for item in items:
            cutoff = len(item.daily_sales) - offset
            first_sale = next((i for i, n in enumerate(item.daily_sales) if n > 0), len(item.daily_sales))
            if cutoff - first_sale < 56 or sum(n > 0 for n in item.daily_sales[max(0, cutoff - 28):cutoff]) < 7:
                continue
            prefixes.append(SeriesInput(sku_id=item.sku_id, daily_sales=item.daily_sales[:cutoff]))
            actuals[item.sku_id] = sum(item.daily_sales[cutoff:cutoff + horizon])
        if not prefixes:
            continue
        _, forecasts, _ = predict_operational_batch(prefixes, last_day - timedelta(days=offset), horizon)
        for item, (prediction, _) in zip(prefixes, forecasts):
            errors[item.sku_id].append(actuals[item.sku_id] - prediction)
    result = {}
    for item in items:
        residuals = errors[item.sku_id]
        enough = len(residuals) >= MIN_BLOCKS
        result[item.sku_id] = {
            "quantity": buffer_from_errors(residuals) if enough else None,
            "source": "BACKTEST_P95" if enough else "TEMPORARY_CONFIG",
            "sampleCount": len(residuals), "serviceLevel": SERVICE_LEVEL,
            "horizonDays": horizon,
            "basis": (f"P95 sai số tổng lượng bán của {len(residuals)} kỳ {horizon} ngày không chồng lấn; kiểm tra cuốn chiếu, chỉ học dữ liệu trước mỗi kỳ. Mục tiêu 95%, không phải cam kết."
                      if enough else f"Tạm dùng mức kho cấu hình: chỉ có {len(residuals)}/{MIN_BLOCKS} kỳ kiểm tra đủ dữ liệu; mỗi kỳ {horizon} ngày cần ít nhất 56 ngày kể từ lần bán đầu và 7 ngày có bán trong 28 ngày trước đó."),
        }
    return result
