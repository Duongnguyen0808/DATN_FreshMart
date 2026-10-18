# AI dự báo Smart Store

## Chạy tiền xử lý, train và xem kết quả

Tất cả các bước nằm trong `train_ai.py`. Chạy từ thư mục `ai-service`:

```powershell
python train_ai.py
```

Chương trình in lần lượt các bước, cách chia train/validation/test, kích thước từng tập, các thuật toán được so sánh, điểm validation/test và tên model được chọn.

Các tập dữ liệu sau xử lý để mở xem:

- `data/processed/splits/train.csv`
- `data/processed/splits/validation.csv`
- `data/processed/splits/test.csv`
- Kích thước split: `data/output/dataset_split_summary.csv`

Điểm số in ra terminal cũng được lưu tại `data/output/model_metrics.csv`. `MAPE_%` là sai số theo phần trăm; `MAE` và `RMSE` là số sản phẩm sai lệch. `actual_vs_predicted.csv` lưu giá trị thực tế và dự đoán theo từng SKU/ngày.

Pipeline so sánh Moving Average 7 ngày, Seasonal Naive 7 ngày, Random Forest, XGBoost và Prophet trên 3 SKU đại diện. Model được chọn bằng MAE validation; test holdout chỉ dùng để báo cáo. M5 là dữ liệu nghiên cứu nên cần kiểm thử trên dữ liệu thật trước khi dùng để quyết định mua hàng.

## Dự báo thử một SKU M5

Sau khi train:

```powershell
python train_ai.py --forecast-item FOODS_3_090 --horizon 7
```

Hỗ trợ horizon 7, 14 hoặc 28 ngày.

## AI Service cho dự báo vận hành

Web Admin gửi yêu cầu qua Node.js Backend. Backend lấy doanh số và tồn kho trong phạm vi quyền, gọi Python AI Service tại `POST /forecast/demand`, sau đó lưu kết quả vào PostgreSQL. Kết quả dự báo nghiệp vụ xem ở trang **Dự báo nhu cầu**; bảng đánh giá nghiên cứu model chỉ in khi chạy `train_ai.py`.

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
