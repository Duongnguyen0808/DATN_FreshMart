# Bảng truy vết Message & Source Code – UML Sequence Diagram

Tài liệu đối chiếu các message chính trong 6 sơ đồ tuần tự (`docs/uml/sequence/source/*.puml`) với mã nguồn thực tế trong `ProjectDATN`.

---

## 1. `01-dang-nhap-va-phan-quyen.puml` (5 participants, 12 messages)

| STT | Message | Bên gọi | Bên nhận | File/hàm nguồn | Điều kiện | Kết quả |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST /api/v1/auth/login` | Giao diện Web/Mobile | AuthRoutes | `mobile-app/src/contexts/auth-context.tsx` (`login`), `backend/src/modules/auth/auth.routes.ts` | Email & mật khẩu đã nhập | Gọi endpoint đăng nhập |
| 2 | `login(email, password)` | AuthRoutes | AuthService | `backend/src/modules/auth/auth.service.ts` (`login`) | Qua rate limit, origin & Zod | Thực thi xác thực |
| 3 | Truy vấn người dùng theo email | AuthService | SQL Server | `auth.service.ts:20` (`prisma.user.findUnique`) | Luôn thực hiện | Trả User hoặc null |
| 4 | Ném `401 INVALID_CREDENTIALS` | AuthService | AuthRoutes | `auth.service.ts:22-24` | `!user \|\| !matches \|\| !user.active` | Trả HTTP 401 |
| 5 | Transaction tạo Session & AuditLog | AuthService | SQL Server | `auth.service.ts:27-30` (`prisma.$transaction`) | Tài khoản hợp lệ | Lưu phiên 7 ngày + log |
| 6 | Trả `{accessToken, refreshToken, user}` | AuthService | AuthRoutes | `auth.service.ts:31`, `auth.routes.ts:21-28` | Thành công | HTTP 200 (+ cookie nếu web) |

---

## 2. `02-ban-hang-pos-va-xuat-kho-fefo.puml` (7 participants, 22 messages)

| STT | Message | Bên gọi | Bên nhận | File/hàm nguồn | Điều kiện | Kết quả |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST /api/v1/invoices` | Giao diện POS | InvoiceRoutes | `backend/src/modules/invoices/invoices.routes.ts:22` | JWT hợp lệ & quyền `invoices.create` | Gọi `createInvoice` |
| 2 | Truy vấn ca, kho, khách hàng, SKU | InvoicesService | SQL Server | `invoices.service.ts:291-303` | Luôn thực hiện | Kiểm tra điều kiện bán |
| 3 | Xác minh mã khuyến mãi FEFO | InvoicesService | SQL Server | `invoices.service.ts:204-260` (`resolveVerifiedFefoPromos`) | `opt`: có `fefoPromoCodes` | Trả tổng chiết khấu FEFO |
| 4 | Kiểm tra tồn khả dụng từng SKU | InvoicesService | SQL Server | `invoices.service.ts:321-323` | `loop`: từng SKU | Nếu thiếu ném `409 INSUFFICIENT_STOCK` |
| 5 | `takeLots(tx, stockId, sold, SALE)` | InvoicesService | LotStock | `backend/src/modules/inventory/lot-stock.ts:20-37` | Đủ tồn khả dụng | Trừ lô theo `expiresAt asc` (FEFO) |
| 6 | Giảm `onHand` & ghi `InventoryTransaction` | InvoicesService | SQL Server | `invoices.service.ts:325-326` | Sau `takeLots` | Cập nhật tồn thực tế |
| 7 | Lưu `Invoice`, `Payment`, `Receivable`, `AuditLog` | InvoicesService | SQL Server | `invoices.service.ts:328-356` | Trong `Serializable` transaction | Commit & trả hóa đơn |
| 8 | `publishInventoryUpdate(warehouseId, SALE)` | InvoicesService | Socket.IO | `invoices.service.ts:357`, `iot.realtime.ts:24` | Sau commit (bất đồng bộ) | Phát `inventory:updated` |
| 9 | Phản hồi `HTTP 201 Created` | InvoiceRoutes | Giao diện POS | `invoices.routes.ts:22` | Thành công | Hiển thị hóa đơn |

---

## 3. `03-nhap-hang-theo-lo-va-cap-nhat-ton-kho.puml` (7 participants, 19 messages)

| STT | Message | Bên gọi | Bên nhận | File/hàm nguồn | Điều kiện | Kết quả |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST /api/v1/purchase-orders/:id/receipts` | Giao diện Web | PurchaseOrderRoutes | `purchase-orders.routes.ts:18` | Quyền `purchase_orders.receive` | Gọi `receivePurchaseOrder` |
| 2 | Tải song song ảnh chứng từ (`Promise.all`) | PurchaseOrdersService | Cloudinary | `purchase-orders.service.ts:178` | `opt`: có `evidence` | Danh sách URL ảnh |
| 3 | Tạo `GoodsReceipt` & xác nhận IoT | PurchaseOrdersService | SQL Server | `purchase-orders.service.ts:185-207` | `Serializable` transaction | Tạo phiếu nhập |
| 4 | Tạo `InventoryLot` (`AVAILABLE`/`QUARANTINE`) & tăng `onHand` | PurchaseOrdersService | SQL Server | `purchase-orders.service.ts:212-223`, `lot-stock.ts:39-45` | `loop`: từng dòng nhận | Cập nhật lô & tồn kho |
| 5 | Cập nhật `Payable`, công nợ NCC & trạng thái PO | PurchaseOrdersService | SQL Server | `purchase-orders.service.ts:224-236` | Cuối transaction | Commit & trả PO |
| 6 | `publishInventoryUpdate(..., PURCHASE_RECEIPT)` | PurchaseOrdersService | Socket.IO | `purchase-orders.service.ts:180` | Sau commit | Phát `inventory:updated` |
| 7 | Phản hồi `HTTP 201 Created` | PurchaseOrderRoutes | Giao diện Web | `purchase-orders.routes.ts:18` | Thành công | Hiển thị phiếu nhập |

---

## 4. `04-du-bao-ai-va-canh-bao-thieu-hang.puml` (5 participants, 13 messages)

| STT | Message | Bên gọi | Bên nhận | File/hàm nguồn | Điều kiện | Kết quả |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Truy vấn tồn khả dụng (loại lô cách ly/hết hạn) | ForecastsService | SQL Server | `forecasts.service.ts:99-110` (`createForecast`) | Đã xác thực phạm vi chi nhánh | Nếu rỗng ném `409 NO_STOCK_SKUS` |
| 2 | Truy vấn lịch sử bán hàng 366 ngày | ForecastsService | SQL Server | `forecasts.service.ts:21`, `createForecast` | Có SKU tồn kho | Chuỗi thời gian bán hàng |
| 3 | Gửi lịch sử bán hàng & kỳ dự báo | ForecastsService | Dịch vụ AI | `forecasts.service.ts` (`createForecast`) | Đủ dữ liệu | Trả dự báo & Safety Stock P95 |
| 4 | Lưu `ForecastRun` & `DemandForecast` | ForecastsService | SQL Server | `forecasts.service.ts` | Qua Zod `aiResponse` | Lưu phiên dự báo |

---

## 5. `05-kiem-soat-cua-kho-iot-rfid.puml` (7 participants, 13 messages)

| STT | Message | Bên gọi | Bên nhận | File/hàm nguồn | Điều kiện | Kết quả |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST /api/v1/iot/access/rfid` | Thiết bị IoT | IotRoutes | `iot.routes.ts` (`requireDeviceToken`) | Kèm `IOT_INGEST_TOKEN` | Nếu sai trả `401` |
| 2 | `ingestAccessRfid(input, IOT_DEVICE)` | IotRoutes | WarehouseAccessService | `warehouse-access.service.ts:135-156` | Token hợp lệ | Xử lý quẹt thẻ |
| 3 | Transaction ghi `RFID_SCAN`, `ACCESS_GRANTED`/`DENIED`, `INVALID_RFID` | WarehouseAccessService | SQL Server | `warehouse-access.service.ts:139-148` | Theo `granted` | Lưu sự kiện & cảnh báo |
| 4 | `publishWarehouseAccess` → `iot:access` | WarehouseAccessService | Socket.IO → Web/Mobile | `warehouse-access.service.ts:150`, `realtime.service.ts` | Sau commit (bất đồng bộ) | Cập nhật Timeline realtime |

---

## 6. `06-kiem-dem-nhanh-mobile-va-phe-duyet.puml` (7 participants, 16 messages)

| STT | Message | Bên gọi | Bên nhận | File/hàm nguồn | Điều kiện | Kết quả |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `POST /api/v1/mobile-ops/quick-stocktakes` | Mobile App | MobileOpsRoutes & Service | `mobile-ops.routes.ts:74-86`, `mobile-ops.service.ts:154-207` | Quyền `stocktakes.create` | Lưu `PENDING`, trả `201 Created` |
| 2 | `PATCH /api/v1/mobile-ops/quick-stocktakes/:id/review` | Web Admin | MobileOpsRoutes & Service | `mobile-ops.routes.ts:88-102` | Quyền `stocktakes.approve` | Cập nhật `APPROVED`/`REJECTED`, trả `200 OK` |
| 3 | `publishMobileOpsEvent(ops:stocktake)` → `ops:stocktake` | MobileOpsRoutes | Socket.IO → Mobile App | `mobile-ops.routes.ts:85,101`, `realtime.service.ts` | Sau lưu DB (bất đồng bộ) | Mobile tự làm mới danh sách phiếu |
