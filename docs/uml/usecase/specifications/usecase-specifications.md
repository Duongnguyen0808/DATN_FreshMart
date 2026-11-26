# Đặc tả chi tiết các Use Case cốt lõi – Hệ thống FreshMart

---

## UC03 / UC_POS_02: Tạo hóa đơn bán hàng POS và xuất kho FEFO

- **Mã Use Case**: `UC_POS_02`
- **Tên Use Case**: Tạo hóa đơn bán hàng POS
- **Mục tiêu**: Ghi nhận giao dịch bán lẻ tại quầy, trừ tồn kho theo đúng nguyên tắc FEFO (lô hết hạn trước xuất trước) và cập nhật doanh thu ca.
- **Actor chính**: Nhân viên (`EMPLOYEE`), Quản lý chi nhánh (`BRANCH_MANAGER`)
- **Actor phụ**: Cổng PayOS (khi thanh toán QR), Socket.IO Realtime
- **Mô tả**: Thu ngân chọn/quét sản phẩm vào giỏ, áp dụng mã giảm giá xả cận hạn FEFO (nếu có), chọn phương thức thanh toán và hoàn tất hóa đơn.
- **Sự kiện kích hoạt**: Khách hàng thanh toán tại quầy POS.
- **Tiền điều kiện**: Người dùng đã đăng nhập, có quyền `invoices.create`, đang có ca làm việc (`WorkShift`) ở trạng thái `OPEN` thuộc chi nhánh được phân công.
- **Hậu điều kiện thành công**: Hóa đơn được lưu, tồn kho và từng lô FEFO được trừ chính xác, doanh thu ca được cộng dồn, công nợ phải thu được tạo (nếu có ghi nợ), sự kiện `inventory:updated` được phát qua Socket.IO.
- **Hậu điều kiện thất bại**: Giao dịch `Serializable` rollback toàn bộ, tồn kho và doanh thu ca không bị thay đổi.
- **Luồng chính**:
  1. Thu ngân quét hoặc chọn các SKU vào giỏ hàng và nhập số lượng.
  2. Thu ngân chọn phương thức thanh toán (Tiền mặt, Chuyển khoản/QR hoặc Ghi nợ) và xác nhận tạo hóa đơn.
  3. Hệ thống kiểm tra ca làm việc đang mở, phạm vi chi nhánh, hiệu lực SKU và cân đối thanh toán (`isInvoicePaymentBalanced`).
  4. Hệ thống thực thi giao dịch `Serializable`: kiểm tra tồn khả dụng từng SKU, gọi `takeLots` để trừ lô `AVAILABLE` chưa hết hạn theo thứ tự `expiresAt` tăng dần (FEFO), cập nhật `onHand` và ghi `InventoryTransaction`.
  5. Hệ thống cập nhật doanh thu ca, lưu hóa đơn, ghi `AuditLog`, commit giao dịch và phát sự kiện `inventory:updated`.
  6. Hệ thống trả về HTTP `201 Created` và hiển thị hóa đơn thành công.
- **Luồng thay thế**:
  - *Bước 2a*: Áp dụng mã xả cận hạn FEFO (`UC_POS_04`) → Hệ thống gọi `resolveVerifiedFefoPromos` xác minh lô và chiết khấu.
  - *Bước 2b*: Thanh toán QR khi đã cấu hình PayOS (`UC_POS_05`) → Chuyển luồng xác minh thanh toán qua PayOS.
  - *Bước 2c*: Có số tiền ghi nợ > 0 (`UC_POS_06`) → Tạo bản ghi công nợ `Receivable`.
- **Luồng ngoại lệ**:
  - *Bước 3a*: Ca chưa mở hoặc sai quyền → Trả lỗi `409 SHIFT_NOT_OPEN` / `403 SHIFT_FORBIDDEN`.
  - *Bước 4a*: Tồn khả dụng nhỏ hơn số bán → Rollback và trả `409 INSUFFICIENT_STOCK`.
- **Quy tắc nghiệp vụ**: Không được xuất bán hàng hết hạn hoặc hàng cách ly (`QUARANTINE`/`LEGACY`).
- **Quyền truy cập**: `invoices.create`
- **Use Case liên quan**: `<<include>> UC_POS_03`, `<<extend>> UC_POS_04`, `UC_POS_05`, `UC_POS_06`
- **Source code chứng minh**: `backend/src/modules/invoices/invoices.routes.ts`, `invoices.service.ts`, `inventory/lot-stock.ts`
- **Trạng thái xác minh**: ĐÃ XÁC MINH

---

## UC05 / UC_INV_03: Nhập hàng theo đơn đặt hàng (PO) và ghi nhận lô

- **Mã Use Case**: `UC_INV_03`
- **Tên Use Case**: Nhập hàng theo PO và ghi nhận lô
- **Mục tiêu**: Ghi nhận hàng nhập từ nhà cung cấp theo đơn đặt hàng, tạo lô hạn sử dụng, tăng tồn kho và cập nhật công nợ phải trả.
- **Actor chính**: Nhân viên (`EMPLOYEE`), Quản lý chi nhánh (`BRANCH_MANAGER`)
- **Actor phụ**: Cloudinary (tải ảnh chứng từ)
- **Tiền điều kiện**: Đơn PO ở trạng thái `OPEN`, người dùng có quyền `purchase_orders.receive` trong phạm vi chi nhánh.
- **Hậu điều kiện thành công**: Tạo phiếu nhập `GoodsReceipt`, tạo `InventoryLot` (`AVAILABLE` nếu còn hạn, `QUARANTINE` nếu đã hết hạn), tăng `onHand`, cập nhật `Payable` và chuyển PO sang `COMPLETED` nếu nhận đủ.
- **Luồng chính**:
  1. Nhân viên kho mở đơn PO đang mở và nhập số lượng thực nhận, mã lô, hạn sử dụng.
  2. Hệ thống kiểm tra số nhận không vượt quá số còn lại của từng dòng PO.
  3. Hệ thống thực thi `Serializable` transaction: tạo `GoodsReceipt`, gọi `receiveLot`, tăng tồn kho `onHand`, ghi `InventoryTransaction` và cập nhật `receivedQuantity`.
  4. Hệ thống cập nhật công nợ phải trả (`Payable`), công nợ nhà cung cấp (`currentDebt`), trạng thái PO và `AuditLog`.
  5. Hệ thống phát sự kiện `inventory:updated` và trả HTTP `201 Created`.
- **Luồng thay thế**:
  - *Bước 1a*: Có ảnh chứng từ (`UC_INV_04`) → Tải song song lên Cloudinary (`Promise.all`).
- **Luồng ngoại lệ**:
  - *Bước 2a*: Số nhận vượt quá số còn lại → Trả `400 RECEIPT_EXCEEDS_REMAINING`.
  - *Bước 3a*: Hàng quản lý lô/có hạn dùng nhưng thiếu mã lô → Rollback và trả `400 LOT_REQUIRED`.
- **Quyền truy cập**: `purchase_orders.receive`
- **Source code chứng minh**: `backend/src/modules/purchase-orders/purchase-orders.routes.ts`, `purchase-orders.service.ts`
- **Trạng thái xác minh**: ĐÃ XÁC MINH

---

## UC10 / UC_AI_01: Chạy dự báo nhu cầu AI (7/14/30 ngày)

- **Mã Use Case**: `UC_AI_01`
- **Tên Use Case**: Chạy dự báo nhu cầu AI (7/14/30 ngày)
- **Mục tiêu**: Dự báo sản lượng tiêu thụ tương lai bằng mô hình học máy và phát hiện SKU có nguy cơ thiếu hàng.
- **Actor chính**: Quản lý chi nhánh (`BRANCH_MANAGER`), Chủ hệ thống (`OWNER`)
- **Actor phụ**: Dịch vụ AI (`Live-GradientBoosting`)
- **Tiền điều kiện**: Chi nhánh đang hoạt động và có ít nhất 1 SKU tồn kho.
- **Hậu điều kiện thành công**: Lưu `ForecastRun`, `DemandForecast`, tính mức thiếu hụt và đề xuất bổ sung/điều chuyển.
- **Luồng chính**:
  1. Quản lý chọn chi nhánh và kỳ dự báo (`7`, `14` hoặc `30` ngày).
  2. Backend truy vấn tồn khả dụng (loại trừ lô `QUARANTINE`/hết hạn) và lịch sử bán hàng 366 ngày.
  3. Backend gửi chuỗi thời gian sang Dịch vụ AI để chạy mô hình Gradient Boosting và tính Safety Stock (Backtest P95).
  4. Backend xác thực phản hồi AI bằng Zod schema `aiResponse`, lưu `ForecastRun` & `DemandForecast`.
  5. Hệ thống đánh giá thiếu hụt (`assessShortage`) và hiển thị danh sách SKU cảnh báo.
- **Luồng ngoại lệ**:
  - *Bước 2a*: Chi nhánh không có SKU tồn kho → Trả `409 NO_STOCK_SKUS`.
- **Source code chứng minh**: `backend/src/modules/forecasts/forecasts.service.ts`, `forecasts.schemas.ts`
- **Trạng thái xác minh**: ĐÃ XÁC MINH

---

## UC11 / UC_MOB_09: Ghi nhận sự kiện quẹt thẻ RFID và kiểm soát cửa kho

- **Mã Use Case**: `UC_MOB_09`
- **Tên Use Case**: Ghi nhận sự kiện quẹt thẻ và cửa
- **Mục tiêu**: Xác thực quyền ra vào kho của nhân viên theo thẻ RFID, ghi nhận lịch sử và cảnh báo an ninh tức thời.
- **Actor chính**: Thiết bị IoT (`ESP32-RC522`)
- **Actor phụ**: Nhân viên kho, Quản lý chi nhánh (nhận đồng bộ thời gian thực qua Socket.IO)
- **Tiền điều kiện**: Thiết bị đã đăng ký cho kho và gửi kèm `IOT_INGEST_TOKEN` hợp lệ.
- **Luồng chính**:
  1. Thiết bị ESP32 đọc UID thẻ RFID và gửi `POST /api/v1/iot/access/rfid`.
  2. Backend xác thực `IOT_INGEST_TOKEN`, kiểm tra thiết bị và chống trùng `eventId`.
  3. Backend kiểm tra thẻ `ACTIVE`, đúng kho, nhân viên đang hoạt động và có quyền kho (`inventory.read` / `warehouses.manage` / `OWNER`).
  4. Hệ thống ghi `RFID_SCAN` và `ACCESS_GRANTED` (hoặc `ACCESS_DENIED` + cảnh báo `INVALID_RFID`).
  5. Backend phát sự kiện `iot:access` qua Socket.IO tới Web Admin và Mobile App.
- **Luồng ngoại lệ**:
  - *Bước 2a*: Token không hợp lệ → Trả `401 IOT_DEVICE_UNAUTHENTICATED`.
  - *Bước 2b*: Trùng `eventId` → Trả `{ duplicate: true }` không ghi lặp.
- **Source code chứng minh**: `backend/src/modules/iot/iot.routes.ts`, `warehouse-access.service.ts`, `iot.realtime.ts`
- **Trạng thái xác minh**: ĐÃ XÁC MINH

---

## UC08 / UC_MOB_03 & UC_MOB_04: Kiểm đếm tồn kho nhanh trên Mobile và Phê duyệt trên Web Admin

- **Mã Use Case**: `UC_MOB_03`, `UC_MOB_04`
- **Tên Use Case**: Gửi phiếu kiểm đếm nhanh trên Mobile / Phê duyệt phiếu kiểm đếm nhanh
- **Mục tiêu**: Cho phép nhân viên kiểm đếm nhanh tồn kho bằng camera iPhone và gửi Quản lý đối chiếu, đảm bảo không tự ý thay đổi tồn kho hệ thống.
- **Actor chính**: Nhân viên (`EMPLOYEE` – gửi phiếu), Quản lý chi nhánh (`BRANCH_MANAGER` – phê duyệt)
- **Tiền điều kiện**: Nhân viên có quyền `stocktakes.create`; Quản lý có quyền `stocktakes.approve`.
- **Luồng chính**:
  1. Nhân viên quét barcode trên Mobile App, xem ảnh sản phẩm và tồn hệ thống.
  2. Nhân viên nhập số lượng thực tế và ghi chú, bấm gửi (`POST /mobile-ops/quick-stocktakes`).
  3. Backend tính chênh lệch (`actualQuantity - systemQuantity`), lưu `QuickStocktakeReport` ở trạng thái `PENDING`, ghi `MobileActivityLog` và phát Socket.IO `ops:stocktake`.
  4. Quản lý mở trang `/van-hanh-mobile` trên Web Admin, kiểm tra chênh lệch và chọn Phê duyệt (`APPROVED`) hoặc Từ chối (`REJECTED`) qua `PATCH /mobile-ops/quick-stocktakes/:id/review`.
  5. Backend cập nhật trạng thái phiếu và phát Socket.IO `ops:stocktake` để Mobile cập nhật tức thì.
- **Quy tắc nghiệp vụ**: Phiếu kiểm đếm nhanh trên Mobile không bao giờ tự động sửa `inventory.onHand`.
- **Source code chứng minh**: `backend/src/modules/mobile-ops/mobile-ops.routes.ts`, `mobile-ops.service.ts`, `mobile-app/app/ops/quick-stocktake.tsx`, `web-admin/src/app/van-hanh-mobile/page.tsx`
- **Trạng thái xác minh**: ĐÃ XÁC MINH
