# AI dự báo Smart Store

## Chạy tiền xử lý, train và xem kết quả

Chạy từ thư mục `ai-service` bằng môi trường đã cài dependencies:

```powershell
.\.venv\Scripts\python.exe train_ai.py
```

Chương trình in lần lượt các bước, cách chia train/validation/test, kích thước từng tập, các thuật toán được so sánh, điểm validation/test và tên model được chọn.

Các tập dữ liệu sau xử lý để mở xem:

- `data/processed/splits/train.csv`
- `data/processed/splits/validation.csv`
- `data/processed/splits/test.csv`
- Kích thước split: `data/output/dataset_split_summary.csv`

Điểm số in ra terminal cũng được lưu tại `data/output/model_metrics.csv`. `MAPE_%` là sai số theo phần trăm; `MAE` và `RMSE` là số sản phẩm sai lệch. `actual_vs_predicted.csv` lưu giá trị thực tế và dự đoán theo từng SKU/ngày.

Pipeline so sánh **7 mô hình trên cùng 30 sản phẩm của CA_1**: Moving Average 7 ngày,
Seasonal Naive 7 ngày, Ridge, Random Forest, Extra Trees, Gradient Boosting và XGBoost.
Có 5 thuật toán hồi quy được huấn luyện và 2 baseline để đối chứng. Không tính mô hình
bị lỗi là một mô hình đã khảo sát. Prophet của pipeline cũ được thay thế vì lỗi môi trường
và chỉ được chấm trên 3 sản phẩm, không đủ điều kiện so sánh công bằng.

### Ba tập dữ liệu và cách chọn

| Tập | Khoảng ngày M5 | Mục đích |
|---|---|---|
| Train | d_1–d_1885 | Huấn luyện 7 ứng viên; 28 ngày đầu dùng tạo lag |
| Validation | d_1886–d_1913 | So sánh dự báo 28 ngày, chọn MAE thấp nhất |
| Test | d_1914–d_1941 | Đánh giá cuối cùng duy nhất mô hình đã chọn |

Không chia ngẫu nhiên chuỗi thời gian. Chọn 30 sản phẩm chỉ bằng doanh số **train**.
Mỗi mô hình nhận cùng đặc trưng trễ và cùng tập validation. Dự báo đệ quy: không lấy
lượng bán thực tế của ngày validation/test làm lag cho các ngày tiếp theo. Giá tương lai
được giữ bằng giá quan sát cuối cùng tại thời điểm bắt đầu dự báo.
Sau khi chốt mô hình, huấn luyện lại trên train + validation, lưu `.joblib` và đánh giá test.
Không dùng test để chọn, điều chỉnh tham số hay huấn luyện artifact. Seed cố định 42.

MAE/RMSE/WAPE/MAPE càng thấp càng tốt; R² càng cao càng tốt. Tiêu chí chọn duy nhất
là MAE validation (hòa thì xét RMSE). MAPE bỏ ngày actual = 0; WAPE/R² có thể không
xác định khi mẫu số bằng 0. Không trình bày `100 − MAPE` như accuracy phân loại.

### Báo cáo trình bày

- Web: **Dự báo hàng → Khảo sát mô hình AI**, đường dẫn `/du-bao-nhu-cau/khao-sat`.
- Báo cáo độc lập: `data/output/experiment_report.html`, có thể mở không cần server/internet.
- Biểu đồ xuất PNG: `validation_comparison.png`, `test_actual_vs_predicted.png`.
- Bảng CSV: `model_metrics.csv`, `actual_vs_predicted.csv`, `dataset_split_summary.csv`.
- JSON có seed, hash CSV, thời điểm chạy, model thắng và phạm vi huấn luyện.

Kịch bản demo: giới thiệu bài toán dự báo lượng bán → giải thích 3 tập → xem bảng
7 ứng viên → chỉ ra MAE thấp nhất → xem kết quả test và biểu đồ thực tế/dự báo →
mở chi tiết từng sản phẩm. Đường tổng chỉ để minh họa; điểm số tính trên sản phẩm/ngày.
M5 là dữ liệu nghiên cứu, không khẳng định độ chính xác trên cửa hàng FreshMart.

## Dự báo thử một SKU M5

Sau khi train:

```powershell
python train_ai.py --forecast-item FOODS_3_090 --horizon 7
```

Hỗ trợ horizon 7, 14 hoặc 28 ngày.

## AI Service cho dự báo vận hành

Web Admin gửi yêu cầu qua Node.js Backend. Backend lấy doanh số và tồn kho trong phạm vi quyền, gọi Python AI Service tại `POST /forecast/demand`, sau đó lưu kết quả vào PostgreSQL. Kết quả dự báo nghiệp vụ xem ở trang **Dự báo nhu cầu**. Báo cáo nghiên cứu được đọc qua `GET /api/v1/forecasts/experiment` (quyền `reports.read`), proxy tới `GET /ai/experiment`; thao tác xem báo cáo không khởi chạy huấn luyện.

Forecast vận hành **không dùng model đã train trên M5**. Mỗi lần tạo forecast, backend gửi tối đa 180 ngày bán hàng thật của từng SKU/chi nhánh. API so sánh Moving Average 7 ngày, Seasonal Naive 7 ngày, Random Forest và XGBoost trên validation theo thời gian; model có MAE thấp nhất được dùng, còn thiếu dữ liệu thì dùng baseline. Terminal AI Service ghi model thắng và MAE validation. Forecast 14 ngày được backend tự tạo mỗi ngày; mỗi lần Mobile xem cảnh báo, hệ thống tính lại thiếu hàng theo tồn, hàng đang về và tồn an toàn mới nhất.

Mobile hiển thị dự báo ngắn ngay trong màn **Tồn kho**, cảnh báo trong **Thông báo** và nhiệm vụ ưu tiên tại **Trang chủ**. Các thao tác này dùng endpoint chỉ đọc yêu cầu quyền `inventory.read`; quyền duyệt và phân tích toàn chuỗi vẫn thuộc Web Admin. Nhận hàng, điều chuyển hoặc mua thêm vẫn cần luồng chứng từ bình thường và quản lý phê duyệt.

Chạy service từ thư mục `ai-service`:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend mặc định dùng `AI_SERVICE_URL=http://127.0.0.1:8000`.

Kiểm thử AI:

```powershell
python -m pytest -p no:cacheprovider tests -q
```
