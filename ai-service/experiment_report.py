"""Standalone presentation report and exportable plots, without a CDN dependency."""
from html import escape
import io
import os
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', str(Path(__file__).resolve().parent / 'tmp-ai' / 'matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd


def write_report(result, predictions, output_dir):
    ranking = pd.DataFrame(result['full_sample_validation_metrics']).T.sort_values(['mae', 'rmse'])
    ranking.index.name = 'Mô hình'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11})
    charts = []

    def save(fig, name):
        fig.tight_layout()
        fig.savefig(output_dir / f'{name}.png', dpi=160)
        buf = io.StringIO()
        fig.savefig(buf, format='svg')
        plt.close(fig)
        svg = buf.getvalue()
        charts.append(svg[svg.index('<svg'):])

    fig, ax = plt.subplots(figsize=(10, 4))
    ax.barh(ranking.index, ranking.mae, color=['#17664d' if n == result['selected_model'] else '#a9c9bb' for n in ranking.index])
    ax.invert_yaxis()
    ax.set(xlabel='MAE validation (sản phẩm/ngày) — thấp hơn tốt hơn', title='So sánh trên cùng tập validation')
    for i, value in enumerate(ranking.mae):
        ax.text(value, i, f' {value:.3f}', va='center')
    ax.set_xlim(0, ranking.mae.max() * 1.18)
    save(fig, 'validation_comparison')
    test = predictions[predictions.split.eq('test')]
    daily = test.groupby('date')[['actual', 'predicted']].sum()
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(pd.to_datetime(daily.index), daily.actual, label='Thực tế', color='#25372f')
    ax.plot(pd.to_datetime(daily.index), daily.predicted, label='Dự báo', color='#168567', linestyle='--')
    ax.set(title='Test: tổng lượng bán mỗi ngày của các sản phẩm', ylabel='Số sản phẩm')
    ax.legend(); fig.autofmt_xdate()
    save(fig, 'test_actual_vs_predicted')
    metric_labels = {'mae': 'MAE ↓', 'rmse': 'RMSE ↓', 'mape': 'MAPE (%) ↓', 'wape': 'WAPE (%) ↓', 'r2': 'R² ↑'}
    table = ranking.rename(columns=metric_labels).to_html(float_format=lambda v: f'{v:.4f}', na_rep='Không xác định', border=0)
    test_table = pd.DataFrame(result['full_sample_test_metrics']).T.rename(columns=metric_labels).to_html(float_format=lambda v: f'{v:.4f}', na_rep='Không xác định', border=0)
    splits = pd.DataFrame(result['dataset_splits'])[['split', 'from_date', 'to_date', 'rows_in_csv', 'rows_used_for_model', 'sku_count']]
    splits.columns = ['Tập', 'Từ ngày', 'Đến ngày', 'Số dòng CSV', 'Số mẫu sử dụng', 'Số sản phẩm']
    item_tables = ''.join(f'<details><summary>{escape(str(item))} · 28 ngày test</summary>{rows[["date", "actual", "predicted"]].to_html(index=False, border=0, float_format=lambda v: f"{v:.3f}")}</details>' for item, rows in test.groupby('item_id'))
    html = f'''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FreshMart · Khảo sát mô hình dự báo</title><style>
body{{font:15px/1.6 system-ui,sans-serif;color:#25372f;background:#f3f6f3;margin:0}}main{{max-width:1100px;margin:auto;padding:28px}}h1{{font-size:28px}}h2{{font-size:20px}}section,header{{background:white;border:1px solid #dce5df;padding:24px;border-radius:12px;margin-bottom:20px}}header{{border-top:5px solid #17664d}}.scroll{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:14px}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #dce5df;white-space:nowrap}}th{{background:#e8f3df}}svg{{width:100%;height:auto}}summary{{cursor:pointer;padding:12px}}.note{{color:#586b61}}@media print{{body{{background:white}}section{{break-inside:avoid}}}}
</style><main><header><p>FRESHMART · THỰC NGHIỆM CSV</p><h1>Khảo sát 7 mô hình dự báo lượng bán</h1>
<p>Mô hình được chọn: <strong>{escape(result['selected_model'])}</strong> — MAE validation thấp nhất.</p>
<p class="note">Dữ liệu M5, kho {escape(result['dataset']['store'])}, {result['trained_items']} sản phẩm. Đây là kết quả nghiên cứu; không phải độ chính xác trên dữ liệu FreshMart.</p></header>
<section><h2>1. Chia dữ liệu theo thời gian</h2><p>Train → Validation → Test. Không xáo trộn các ngày. 28 ngày đầu mỗi chuỗi dùng làm lịch sử tạo đặc trưng.</p><div class="scroll">{splits.to_html(index=False, border=0)}</div></section>
<section><h2>2. So sánh và chọn mô hình</h2><p>Mỗi mô hình được huấn luyện trên train, dự báo đệ quy 28 ngày validation. Chọn theo MAE; nếu bằng nhau, xét RMSE.</p><div class="scroll">{table}</div>{charts[0]}</section>
<section><h2>3. Đánh giá cuối cùng trên test</h2><p>Chốt mô hình trước, huấn luyện lại trên train + validation, sau đó mới đánh giá test. Artifact lưu lại không được huấn luyện bằng test.</p><div class="scroll">{test_table}</div>{charts[1]}<p class="note">Biểu đồ tổng có thể che khuất sai số giữa sản phẩm. Bảng điểm tính trên từng sản phẩm/ngày; xem chi tiết bên dưới.</p>{item_tables}</section>
<section><h2>Giải thích khi trình bày</h2><p>MAE: trung bình lệch bao nhiêu sản phẩm/ngày. RMSE phạt mạnh sai lệch lớn. MAPE bỏ ngày bán bằng 0; WAPE dùng tổng lượng bán thực tế làm mẫu số. R² càng cao càng tốt và có thể âm. Không gọi 100 − MAPE là “độ chính xác”.</p><p>Mô hình học từ lượng bán trễ 1/7/28 ngày, trung bình 7/28 ngày, thứ, tháng và giá bán gần nhất. Không đưa lượng bán hoặc giá tương lai vào dự báo.</p><p class="note">Tạo lúc {escape(result['generated_at'])} · Seed 42 · SHA256 CSV: {result['dataset']['sha256']}</p></section></main></html>'''
    (output_dir / 'experiment_report.html').write_text(html, encoding='utf-8')
