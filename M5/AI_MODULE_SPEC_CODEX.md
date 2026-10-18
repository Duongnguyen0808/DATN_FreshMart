# AI MODULE SPECIFICATION
## Đề tài: Xây dựng hệ thống quản trị vận hành chuỗi cửa hàng thông minh

## 1. Mục tiêu AI

AI của hệ thống dùng để hỗ trợ quản lý tồn kho và ra quyết định vận hành chuỗi cửa hàng.

AI không tự động phê duyệt chứng từ và không tự ý thay đổi dữ liệu nghiệp vụ.

Luồng chính:

Dữ liệu bán hàng
→ Dự báo nhu cầu
→ So sánh với tồn kho
→ Cảnh báo nguy cơ thiếu hàng
→ Tìm chi nhánh đang dư hàng
→ Đề xuất điều chuyển
→ Nếu vẫn thiếu thì đề xuất mua thêm
→ Quản lý xem và phê duyệt trên Web Admin

---

# 2. Phạm vi AI cần code

AI gồm 6 phần chính:

1. Tiền xử lý dữ liệu M5.
2. Feature Engineering.
3. Huấn luyện và so sánh nhiều mô hình.
4. Dự báo nhu cầu.
5. Logic cảnh báo thiếu hàng.
6. Logic đề xuất điều chuyển và mua hàng.

---

# 3. Dataset nghiên cứu

Sử dụng bộ dữ liệu M5 Forecasting - Accuracy.

Thư mục dữ liệu:

```text
M5/
└── m5-forecasting-accuracy/
    ├── calendar.csv
    ├── sell_prices.csv
    ├── sales_train_validation.csv
    ├── sales_train_evaluation.csv
    └── sample_submission.csv
```

Các file dùng chính:

```text
calendar.csv
sell_prices.csv
sales_train_evaluation.csv
```

Có thể dùng `sales_train_validation.csv` để thử pipeline trước.

M5 dùng để:

- nghiên cứu;
- train model;
- test model;
- so sánh hiệu quả các thuật toán.

Không dùng M5 làm dữ liệu vận hành chính của Web Admin.

Dữ liệu vận hành thật của hệ thống nằm trong PostgreSQL.

---

# 4. Cấu trúc thư mục AI đề xuất

```text
AI/
├── data/
│   ├── processed/
│   └── output/
│
├── models/
│
├── src/
│   ├── config.py
│   ├── preprocess.py
│   ├── features.py
│   ├── train_baseline.py
│   ├── train_random_forest.py
│   ├── train_xgboost.py
│   ├── train_prophet.py
│   ├── evaluate.py
│   ├── predict.py
│   ├── inventory_logic.py
│   └── db_service.py
│
├── app.py
├── requirements.txt
└── README.md
```

Không bắt buộc dùng Jupyter Notebook.

Ưu tiên code bằng file `.py` để dễ tích hợp thành AI Service.

---

# 5. Bước 1 - Tiền xử lý dữ liệu M5

File:

```text
src/preprocess.py
```

## 5.1. Đọc dữ liệu

Đọc:

```text
calendar.csv
sell_prices.csv
sales_train_evaluation.csv
```

## 5.2. Lọc dữ liệu khi phát triển

Không xử lý toàn bộ M5 ngay từ đầu.

Ban đầu dùng:

```text
1 store
20 - 30 item
```

Ví dụ:

```text
store_id = CA_1
```

Sau khi pipeline chạy ổn mới tăng số lượng sản phẩm.

## 5.3. Chuyển dữ liệu wide sang long

Dữ liệu ban đầu:

```text
item_id | store_id | d_1 | d_2 | ... | d_1941
```

Chuyển thành:

```text
item_id | store_id | d | sales
```

Sau đó merge `calendar.csv` để có ngày thực.

Kết quả mong muốn:

```text
date
item_id
store_id
sales
wm_yr_wk
weekday
month
year
event_name_1
event_type_1
snap_CA
```

Merge thêm `sell_prices.csv` theo:

```text
store_id
item_id
wm_yr_wk
```

Sau merge có thêm:

```text
sell_price
```

## 5.4. Output

Lưu dữ liệu sau xử lý:

```text
AI/data/processed/m5_processed.csv
```

---

# 6. Bước 2 - Feature Engineering

File:

```text
src/features.py
```

Tạo các feature sau:

```text
lag_1
lag_7
lag_28
rolling_mean_7
rolling_mean_28
day_of_week
month
sell_price
```

Công thức:

```text
lag_1 = y(t-1)
lag_7 = y(t-7)
lag_28 = y(t-28)
```

Rolling phải dùng dữ liệu quá khứ, không được nhìn thấy dữ liệu hiện tại.

Ví dụ:

```python
rolling_mean_7 = sales.shift(1).rolling(7).mean()
rolling_mean_28 = sales.shift(1).rolling(28).mean()
```

Mục tiêu là tránh Data Leakage.

Target:

```text
sales
```

---

# 7. Bước 3 - Chia Train/Test

Không random split.

Dữ liệu phải chia theo thời gian.

Ví dụ:

```text
Train:
d_1 -> d_1913

Test:
d_1914 -> d_1941
```

Test gồm 28 ngày cuối.

Mọi model phải dùng cùng train/test để so sánh công bằng.

---

# 8. Bước 4 - Các model cần huấn luyện

Cần ít nhất 4 model:

```text
Baseline
Random Forest
XGBoost
Prophet
```

Có thể thêm:

```text
LightGBM
```

nếu muốn tăng số model so sánh.

---

# 9. Baseline

File:

```text
src/train_baseline.py
```

Baseline có thể dùng:

```text
prediction = lag_1
```

hoặc moving average 7 ngày.

Ví dụ:

```text
ŷ(t+1) = trung bình 7 ngày gần nhất
```

Baseline dùng làm mốc để biết các model Machine Learning có thực sự tốt hơn hay không.

---

# 10. Random Forest

File:

```text
src/train_random_forest.py
```

Input feature:

```text
lag_1
lag_7
lag_28
rolling_mean_7
rolling_mean_28
sell_price
day_of_week
month
```

Target:

```text
sales
```

Model:

```text
RandomForestRegressor
```

Sau khi train:

```text
AI/models/random_forest.pkl
```

---

# 11. XGBoost

File:

```text
src/train_xgboost.py
```

Dùng cùng bộ feature với Random Forest.

Model:

```text
XGBRegressor
```

Sau khi train:

```text
AI/models/xgboost.json
```

hoặc định dạng phù hợp với thư viện.

---

# 12. Prophet

File:

```text
src/train_prophet.py
```

Prophet xử lý dữ liệu khác RF/XGBoost.

Input cơ bản:

```text
ds = date
y = sales
```

Ban đầu chỉ cần train Prophet cho một số SKU đại diện.

Không cần chạy Prophet cho toàn bộ 30.000+ chuỗi ngay từ đầu.

---

# 13. Đánh giá model

File:

```text
src/evaluate.py
```

Các metric bắt buộc:

```text
MAE
RMSE
MAPE
```

Kết quả lưu thành:

```text
AI/data/output/model_metrics.csv
```

Format:

```text
model,mae,rmse,mape
Baseline,...
RandomForest,...
XGBoost,...
Prophet,...
```

Sau đó chọn model tốt nhất.

Không hard-code model tốt nhất trước khi có kết quả thực nghiệm.

---

# 14. Dự báo nhu cầu

File:

```text
src/predict.py
```

Input:

```text
store_id
item_id
forecast_horizon
```

Ví dụ:

```text
store_id = STORE_01
item_id = SKU001
forecast_horizon = 7
```

Output:

```json
{
  "store_id": "STORE_01",
  "item_id": "SKU001",
  "horizon": 7,
  "predictions": [
    {"date": "2026-10-14", "quantity": 10},
    {"date": "2026-10-15", "quantity": 12}
  ],
  "total_forecast": 80,
  "model": "XGBoost"
}
```

---

# 15. Logic cảnh báo thiếu hàng

File:

```text
src/inventory_logic.py
```

Input lấy từ PostgreSQL:

```text
forecast_demand
current_inventory
incoming_quantity
safety_stock
```

Ký hiệu:

```text
D = nhu cầu dự báo
I = tồn hiện tại
R = hàng đang về
SS = tồn an toàn
```

Công thức:

```text
Qshort = max(0, D + SS - I - R)
```

Nếu:

```text
Qshort > 0
```

thì tạo cảnh báo thiếu hàng.

Ví dụ:

```text
D = 80
SS = 10
I = 30
R = 10
```

Kết quả:

```text
Qshort = 50
```

Tức là chi nhánh dự kiến thiếu 50 sản phẩm.

---

# 16. Logic đề xuất điều chuyển

Sau khi phát hiện thiếu hàng, hệ thống kiểm tra tồn của các chi nhánh khác.

Ký hiệu:

```text
Isource = tồn của chi nhánh nguồn
Ksource = mức cần giữ tại chi nhánh nguồn
```

Tính số lượng dư:

```text
Qsurplus = max(0, Isource - Ksource)
```

Số lượng có thể điều chuyển:

```text
Qtransfer = min(Qshort, Qsurplus)
```

Ví dụ:

```text
Chi nhánh B thiếu = 50

Chi nhánh A:
Isource = 100
Ksource = 60

Qsurplus = 40
Qtransfer = min(50, 40)
Qtransfer = 40
```

Kết quả:

```text
Đề xuất chuyển 40 sản phẩm từ A sang B
```

---

# 17. Logic đề xuất mua hàng

Nếu sau điều chuyển vẫn thiếu:

```text
Qpurchase = max(0, Qshort - Qtransfer)
```

Ví dụ:

```text
Qshort = 50
Qtransfer = 40
```

Kết quả:

```text
Qpurchase = 10
```

Hệ thống đề xuất mua thêm 10 sản phẩm.

AI chỉ tạo đề xuất.

Không tự tạo PO đã duyệt.

Quản lý phải phê duyệt trên Web Admin.

---

# 18. Các bảng PostgreSQL liên quan AI

Có thể tạo các bảng:

## forecast_results

```text
id
branch_id
sku_id
forecast_date
forecast_quantity
forecast_horizon
model_name
created_at
```

## stock_alerts

```text
id
branch_id
sku_id
current_inventory
incoming_quantity
safety_stock
forecast_demand
shortage_quantity
risk_level
status
created_at
```

Status:

```text
OPEN
ACKNOWLEDGED
RESOLVED
```

## transfer_suggestions

```text
id
source_branch_id
destination_branch_id
sku_id
suggested_quantity
reason
status
created_at
```

Status:

```text
PENDING
APPROVED
REJECTED
```

## purchase_suggestions

```text
id
branch_id
sku_id
suggested_quantity
reason
status
created_at
```

Status:

```text
PENDING
APPROVED
REJECTED
```

---

# 19. Kết nối AI với dữ liệu hệ thống

Giai đoạn nghiên cứu:

```text
M5 CSV
→ preprocess
→ features
→ train
→ evaluate
→ chọn model
```

Giai đoạn chạy thật:

```text
PostgreSQL
→ sales history
→ feature engineering
→ model đã train
→ forecast
→ inventory logic
→ PostgreSQL
```

AI cần lấy dữ liệu nghiệp vụ thật từ PostgreSQL như:

```text
sales
sales_items
inventory
purchase_orders
purchase_order_items
stock_transfers
```

Tên bảng thực tế có thể thay đổi theo database hiện tại.

---

# 20. AI Service

Tạo Python AI Service.

Có thể dùng:

```text
FastAPI
```

File:

```text
app.py
```

API đề xuất:

## Health Check

```text
GET /health
```

## Train

```text
POST /ai/train
```

Không bắt buộc expose train ra production nếu không cần.

## Forecast

```text
POST /ai/forecast
```

Request:

```json
{
  "branch_id": "BR001",
  "sku_id": "SKU001",
  "horizon": 7
}
```

## Chạy phân tích tồn kho

```text
POST /ai/analyze-inventory
```

Request:

```json
{
  "branch_id": "BR001",
  "sku_id": "SKU001",
  "horizon": 7
}
```

Response có thể gồm:

```json
{
  "forecast_demand": 80,
  "current_inventory": 30,
  "incoming_quantity": 10,
  "safety_stock": 10,
  "shortage_quantity": 50,
  "has_shortage": true
}
```

## Lấy cảnh báo

```text
GET /ai/alerts
```

## Lấy đề xuất điều chuyển

```text
GET /ai/transfer-suggestions
```

## Lấy đề xuất mua hàng

```text
GET /ai/purchase-suggestions
```

---

# 21. Web Admin cần hiển thị gì từ AI

Web Admin cần có:

## Dashboard AI

- Tổng SKU có nguy cơ thiếu.
- Tổng cảnh báo mức cao.
- Tổng đề xuất điều chuyển.
- Tổng đề xuất mua hàng.

## Forecast Detail

- Sản phẩm.
- Chi nhánh.
- Biểu đồ bán thực tế.
- Biểu đồ dự báo.
- Model đang dùng.
- Forecast 7/14/28 ngày.

## Stock Alert

Hiển thị:

```text
Tồn hiện tại
Hàng đang về
Tồn an toàn
Nhu cầu dự báo
Số lượng thiếu
Mức độ rủi ro
```

## Transfer Suggestion

Hiển thị:

```text
Chi nhánh nguồn
Chi nhánh đích
SKU
Số lượng đề xuất
Lý do
```

Có nút:

```text
Approve
Reject
```

## Purchase Suggestion

Hiển thị:

```text
SKU
Chi nhánh
Số lượng đề xuất mua
Lý do
```

Có nút:

```text
Approve
Reject
```

---

# 22. Mobile cần nhận gì từ AI

Mobile không cần màn AI riêng phức tạp.

Mobile chỉ nhận cảnh báo/nghiệp vụ đã liên quan đến chi nhánh.

Ví dụ trong màn Thông báo:

```text
SKU001 có nguy cơ thiếu trong 4 ngày tới.
```

Hoặc:

```text
Có phiếu điều chuyển TR001 cần xuất.
```

Mobile không train model và không chạy ML trực tiếp trên điện thoại.

---

# 23. Quy tắc nghiệp vụ bắt buộc

1. AI chỉ hỗ trợ ra quyết định.
2. AI không tự phê duyệt chuyển kho.
3. AI không tự tạo đơn mua đã duyệt.
4. AI không trực tiếp chỉnh tồn kho.
5. AI chỉ tạo forecast, alert và suggestion.
6. Backend nghiệp vụ chịu trách nhiệm tạo chứng từ thật.
7. Mọi thay đổi tồn kho phải thông qua nghiệp vụ của Backend.
8. Model phải được đánh giá trên dữ liệu test theo thời gian.
9. Không dùng random shuffle cho time series.
10. Không để feature nhìn thấy dữ liệu tương lai.
11. Không hard-code kết quả MAE/RMSE/MAPE.
12. Không hard-code model tốt nhất.
13. Kết quả thực nghiệm phải được tạo từ model thực tế.
14. Các lỗi model/API phải được log.

---

# 24. Yêu cầu đầu ra khi Codex hoàn thành

Codex cần tạo được:

```text
AI/
├── src/
├── models/
├── data/processed/
├── data/output/
├── app.py
├── requirements.txt
└── README.md
```

Chạy được:

```bash
python src/preprocess.py
```

Sau đó:

```bash
python src/features.py
```

Train được ít nhất:

```text
Baseline
Random Forest
XGBoost
Prophet
```

Xuất được:

```text
model_metrics.csv
```

Có model tốt nhất được lưu vào:

```text
models/
```

Chạy được AI API:

```bash
uvicorn app:app --reload
```

Có endpoint forecast và analyze inventory.

---

# 25. Thứ tự Codex nên triển khai

## Phase 1

- Kiểm tra đường dẫn M5.
- Đọc CSV.
- Lọc `CA_1`.
- Lấy khoảng 20 - 30 sản phẩm.
- Chuyển wide → long.
- Merge calendar.
- Merge prices.
- Lưu processed CSV.

## Phase 2

- Tạo lag features.
- Tạo rolling features.
- Tạo calendar features.
- Chia train/test theo thời gian.

## Phase 3

- Baseline.
- Random Forest.
- XGBoost.
- Prophet.
- Tính MAE/RMSE/MAPE.
- Xuất bảng comparison.

## Phase 4

- Chọn/lưu model tốt nhất.
- Viết predict service.
- Forecast 7/14/28 ngày.

## Phase 5

- Viết shortage logic.
- Viết transfer suggestion.
- Viết purchase suggestion.

## Phase 6

- FastAPI.
- Kết nối PostgreSQL.
- Lưu forecast_results.
- Lưu stock_alerts.
- Lưu transfer_suggestions.
- Lưu purchase_suggestions.

## Phase 7

- Test API.
- Viết README.
- Thêm error handling.
- Thêm logging.

---

# 26. Luồng demo cuối cùng

```text
Dữ liệu bán hàng
→ AI dự báo nhu cầu 7 ngày
→ Chi nhánh B dự kiến cần 80 sản phẩm
→ Tồn hiện tại 30
→ Hàng đang về 10
→ Tồn an toàn 10
→ Dự kiến thiếu 50
→ AI tìm chi nhánh A đang dư 40
→ Đề xuất chuyển A → B: 40
→ Còn thiếu 10
→ Đề xuất mua thêm 10
→ Web Admin hiển thị đề xuất
→ Quản lý phê duyệt
→ Backend tạo phiếu điều chuyển / đơn mua
→ Mobile nhân viên thực hiện nghiệp vụ
```

---

# 27. Kết quả cuối cùng của AI trong đề tài

AI phải trả lời được 4 câu hỏi:

```text
1. Sản phẩm này thời gian tới dự kiến bán bao nhiêu?
2. Với lượng tồn hiện tại có nguy cơ thiếu hàng không?
3. Nếu thiếu thì có thể chuyển hàng từ chi nhánh nào?
4. Sau khi điều chuyển vẫn thiếu thì cần mua thêm bao nhiêu?
```

Đây là phạm vi AI chính thức của đề tài.
