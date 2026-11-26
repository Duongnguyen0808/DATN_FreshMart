# Báo cáo kiểm tra chất lượng UML Sequence Diagram

- **Công cụ kiểm tra & render**: PlantUML `v1.2025.2` (OpenJDK 25 + Graphviz `dot 2.44.1`, UTF-8).
- **Chuẩn áp dụng**: UML 2.5.1 (Interactions, Lifelines, Execution Specifications, Combined Fragments).

---

## 1. Kết quả kiểm tra cú pháp và xuất file

| STT | File `.puml` | Số Participant | Số Message | `.svg` | `.png` | Trạng thái |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | `01-dang-nhap-va-phan-quyen.puml` | 5 | 12 | 41.3 KB | 78.8 KB | **PASS** |
| 2 | `02-ban-hang-pos-va-xuat-kho-fefo.puml` | 7 | 22 | 69.7 KB | 136.8 KB | **PASS** |
| 3 | `03-nhap-hang-theo-lo-va-cap-nhat-ton-kho.puml` | 7 | 19 | 55.7 KB | 117.4 KB | **PASS** |
| 4 | `04-du-bao-ai-va-canh-bao-thieu-hang.puml` | 5 | 13 | 55.7 KB | 87.9 KB | **PASS** |
| 5 | `05-kiem-soat-cua-kho-iot-rfid.puml` | 7 | 13 | 41.0 KB | 93.8 KB | **PASS** |
| 6 | `06-kiem-dem-nhanh-mobile-va-phe-duyet.puml` | 7 | 16 | 50.7 KB | 102.4 KB | **PASS** |

---

## 2. Bảng kiểm tra Activation Bar

| Participant | Thời điểm activate | Thời điểm deactivate | Lời gọi tương ứng | Hợp lệ |
| :--- | :--- | :--- | :--- | :---: |
| `UI` / `POS` / `Mobile` / `Web` | Khi Actor kích hoạt thao tác | Khi trả kết quả hiển thị cho Actor | Mọi thao tác người dùng | ĐẠT |
| `Route` (`AuthRoutes`, `InvoiceRoutes`, `PurchaseOrderRoutes`, `IotRoutes`) | Khi nhận HTTP request | Khi trả HTTP response về client | `POST` / `PATCH` endpoints | ĐẠT |
| `Service` (`AuthService`, `InvoicesService`, `PurchaseOrdersService`, `ForecastsService`, `WarehouseAccessService`) | Khi Route gọi hàm nghiệp vụ | Khi trả kết quả hoặc ném `AppError` | Các hàm service chính | ĐẠT |
| `LotStock` (`02`) | Khi gọi `takeLots(...)` trong vòng lặp SKU | Khi hoàn tất xuất lô trả về `InvoicesService` | `takeLots` | ĐẠT |
| `DB` (`SQL Server`) | Riêng biệt cho từng lần truy vấn/ghi độc lập | Ngay khi DB trả kết quả truy vấn/commit | Mọi lệnh Prisma trong 6 sơ đồ | ĐẠT |
| `Cloudinary` (`03`) / `AI` (`04`) | Khi gửi request sang dịch vụ ngoài | Khi nhận phản hồi trả về | `Promise.all(upload...)`, gọi AI Service | ĐẠT |
| `Socket.IO` (`05`, `06`) | Khi nhận sự kiện `publish...` (bất đồng bộ `->>`) | Ngay sau khi emit tới Client | `iot:access`, `ops:stocktake` | ĐẠT |

---

## 3. Xác minh HTTP Status Code & Nhánh lỗi

- `POST /api/v1/auth/login`: `200 OK` (Express default `response.json`), `401 INVALID_CREDENTIALS`, `403 INVALID_ORIGIN` — **ĐÃ XÁC MINH** (`auth.routes.ts`, `auth.service.ts`).
- `POST /api/v1/invoices`: `201 Created`, `400`, `403`, `404`, `409 INSUFFICIENT_STOCK` / `PAYOS_VERIFICATION_REQUIRED` — **ĐÃ XÁC MINH** (`invoices.routes.ts`, `invoices.service.ts`).
- `POST /api/v1/purchase-orders/:id/receipts`: `201 Created`, `400`, `403`, `404`, `409` — **ĐÃ XÁC MINH** (`purchase-orders.routes.ts`, `purchase-orders.service.ts`).
- `POST /api/v1/iot/access/rfid`: `401 IOT_DEVICE_UNAUTHENTICATED` — **ĐÃ XÁC MINH** (`iot.routes.ts:40-43`).
- `POST /api/v1/mobile-ops/quick-stocktakes`: `201 Created`, `404 SKU_NOT_FOUND` — **ĐÃ XÁC MINH** (`mobile-ops.routes.ts:85`, `mobile-ops.service.ts:171`).
- `PATCH /api/v1/mobile-ops/quick-stocktakes/:id/review`: `200 OK` — **ĐÃ XÁC MINH** (`mobile-ops.routes.ts:101`).

---

## 4. Những điểm chưa xác minh riêng
- Mã HTTP status code thành công cụ thể của route `POST /forecasts` (đã giữ nhãn trung lập *"Kết quả dự báo và danh sách cảnh báo"* trong sơ đồ `04` để không suy đoán).
- Tương tác chi tiết bên trong Python AI Service được gom gọn thành self-call xử lý nội bộ trên lifeline `Dịch vụ AI` nhằm đảm bảo độ gọn cho khổ giấy A4.
