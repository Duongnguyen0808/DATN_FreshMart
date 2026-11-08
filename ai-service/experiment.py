"""Reproducible, chronological CSV benchmark. Never select on the test set."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json

import joblib
import numpy as np
import pandas as pd

from train_ai import (CANDIDATES, LEARNED_MODELS, FEATURE_COLUMNS, VALIDATION_START,
                      VALIDATION_END, TEST_START, TEST_END, build_features,
                      _model, _window_predictions, scores)


def validate_frame(frame):
    required = {'item_id', 'store_id', 'date', 'd', 'sales', 'sell_price'}
    if not required.issubset(frame.columns):
        raise ValueError(f"Missing CSV columns: {sorted(required - set(frame.columns))}")
    frame = frame.copy()
    frame['date'] = pd.to_datetime(frame.date, errors='raise')
    frame['d_num'] = frame.d.str.removeprefix('d_').astype(int)
    frame['sales'] = pd.to_numeric(frame.sales, errors='raise')
    frame['sell_price'] = pd.to_numeric(frame.sell_price, errors='raise').fillna(0)
    if frame[['item_id', 'store_id', 'date']].isna().any().any():
        raise ValueError('CSV contains missing identifiers or dates')
    if frame.store_id.nunique() != 1:
        raise ValueError('Benchmark expects one store; select a store before training')
    if not np.isfinite(frame[['sales', 'sell_price']]).all().all() or (frame[['sales', 'sell_price']] < 0).any().any():
        raise ValueError('Sales and prices must be finite non-negative values')
    # A daily grid is required: lag_7 must mean seven days, not seven arbitrary rows.
    for _, rows in frame.groupby('item_id'):
        rows = rows.sort_values('d_num')
        if rows.d_num.tolist() != list(range(1, TEST_END + 1)):
            raise ValueError(f'Each item must contain exactly d_1..d_{TEST_END}, without missing or duplicate days')
        if not rows.date.diff().iloc[1:].eq(pd.Timedelta(days=1)).all():
            raise ValueError('Dates must be consecutive daily observations')
    if frame.groupby('d_num').date.nunique().max() != 1:
        raise ValueError('Day indices must map to the same date for all items')
    return frame.sort_values(['item_id', 'date']).reset_index(drop=True)


def select_model(validation):
    return min(validation, key=lambda name: (validation[name]['mae'], validation[name]['rmse'], name))


def run(data_path: Path, output_dir: Path, model_dir: Path, split_dir: Path):
    frame = validate_frame(pd.read_csv(data_path))
    engineered = build_features(frame)
    items = sorted(frame.item_id.unique())
    splits = {'train': frame[frame.d_num < VALIDATION_START],
              'validation': frame[frame.d_num.between(VALIDATION_START, VALIDATION_END)],
              'test': frame[frame.d_num.between(TEST_START, TEST_END)]}
    for directory in (output_dir, model_dir, split_dir):
        directory.mkdir(parents=True, exist_ok=True)
    split_summary = []
    for name, rows in splits.items():
        rows.to_csv(split_dir / f'{name}.csv', index=False)
        split_summary.append({'split': name, 'from_d': int(rows.d_num.min()), 'to_d': int(rows.d_num.max()),
                              'from_date': rows.date.min().date().isoformat(), 'to_date': rows.date.max().date().isoformat(),
                              'rows_in_csv': len(rows), 'sku_count': len(items),
                              'rows_used_for_model': len(rows) - 28 * len(items) if name == 'train' else len(rows)})
    pd.DataFrame(split_summary).to_csv(output_dir / 'dataset_split_summary.csv', index=False)
    train = engineered[(engineered.d_num < VALIDATION_START) & engineered.lag_28.notna()]
    validation, records, metric_rows = {}, [], []
    for name in CANDIDATES:
        print(f'[Validation] {name}', flush=True)
        estimator = _model(name) if name in LEARNED_MODELS else None
        if estimator is not None:
            estimator.fit(train[FEATURE_COLUMNS], train.sales)
        actual, predicted, rows = _window_predictions(frame, items, VALIDATION_START, VALIDATION_END, name, estimator)
        validation[name] = scores(actual, predicted)
        metric_rows.append({'model': name, 'split': 'validation', **validation[name]})
        records.extend({**row, 'split': 'validation'} for row in rows)
    # All seven candidates must succeed. A failed algorithm cannot count as surveyed.
    selected = select_model(validation)
    print(f'[Selected] {selected}; refit train + validation, then evaluate untouched test', flush=True)
    final_train = engineered[(engineered.d_num < TEST_START) & engineered.lag_28.notna()]
    estimator = _model(selected) if selected in LEARNED_MODELS else None
    if estimator is not None:
        estimator.fit(final_train[FEATURE_COLUMNS], final_train.sales)
        joblib.dump(estimator, model_dir / f'{selected.lower()}.joblib')
    actual, predicted, rows = _window_predictions(frame, items, TEST_START, TEST_END, selected, estimator)
    test = scores(actual, predicted)
    records.extend({**row, 'split': 'test'} for row in rows)
    metric_rows.append({'model': selected, 'split': 'test', **test})
    pd.DataFrame(metric_rows).to_csv(output_dir / 'model_metrics.csv', index=False)
    predictions = pd.DataFrame(records)
    predictions.to_csv(output_dir / 'actual_vs_predicted.csv', index=False)
    result = {'schema_version': 2, 'generated_at': datetime.now(timezone.utc).isoformat(),
              'dataset': {'name': 'M5 daily sales CSV', 'store': str(frame.store_id.iloc[0]),
                          'sha256': hashlib.sha256(data_path.read_bytes()).hexdigest(), 'rows': len(frame)},
              'model_algorithms': list(CANDIDATES), 'selected_model': selected,
              'selection_metric': 'validation MAE (lower is better)',
              'full_sample_validation_metrics': validation, 'full_sample_test_metrics': {selected: test},
              'validation_window': [VALIDATION_START, VALIDATION_END], 'test_window': [TEST_START, TEST_END],
              'trained_items': len(items), 'dataset_splits': split_summary,
              'artifact_fit_through_d': TEST_START - 1, 'training_rows': len(final_train),
              'random_seed': 42, 'forecast_strategy': '28-day recursive forecast; last observed selling price',
              'notes': ['All candidates use the same items and validation dates.',
                        'Test is evaluated only after choosing the winner; it never selects a model.',
                        'The saved artifact is fitted on train + validation; test is excluded.',
                        'M5 is research data, not FreshMart operational sales.']}
    (model_dir / 'selected_model.json').write_text(json.dumps({
        'model': selected, 'selection_metric': result['selection_metric'],
        'validation_mae': validation[selected]['mae'], 'holdout_test_mae': test['mae'],
        'fit_through_d': TEST_START - 1, 'training_rows': len(final_train)}, indent=2), encoding='utf-8')
    from experiment_report import write_report
    write_report(result, predictions, output_dir)
    # Publish summary last, after all report artifacts have been generated successfully.
    (output_dir / 'experiment_summary.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result
