"""Run: python evaluate_safety_stock.py. M5 research only; never writes operational DB."""
import json
from pathlib import Path
import pandas as pd
from app.forecast import SeriesInput, predict_operational_batch
from app.safety_stock import estimate_safety_stock

root = Path(__file__).parent
data = pd.read_csv(root / 'data/processed/m5_processed.csv')
ids = sorted(data['id'].unique())[:3]
rows = []
for horizon in (7, 14, 30):
    items, actuals = [], {}
    for key in ids:
        series = data[data.id == key].sort_values('date').tail(366 + horizon)
        history = series.iloc[:-horizon]
        items.append(SeriesInput(sku_id=key, daily_sales=history.sales.astype(int).tolist()))
        actuals[key] = int(series.iloc[-horizon:].sales.sum())
    last_day = pd.Timestamp(history.iloc[-1]['date']).date()
    evidence = estimate_safety_stock(items, last_day, horizon)
    model, predictions, _ = predict_operational_batch(items, last_day, horizon)
    for item, (prediction, _) in zip(items, predictions):
        buffer = evidence[item.sku_id]
        rows.append({'series': item.sku_id, 'horizon': horizon, 'model': model,
                     'actual': actuals[item.sku_id], 'prediction': prediction,
                     **buffer, 'covered': actuals[item.sku_id] <= prediction + (buffer['quantity'] or 0)})
report = {'dataset': 'M5 processed sample', 'method': 'disjoint expanding-window calibration + untouched final horizon',
          'note': 'Small reproducible smoke evaluation, not proof of 95% coverage; no M5 quantities transferred to FreshMart.',
          'rows': rows, 'testCoverage': sum(r['covered'] for r in rows) / len(rows)}
path = root / 'data/output/safety_stock_evaluation.json'
path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(path, 'coverage=', report['testCoverage'])
