# Bảng truy vết Source Code – UML Activity Diagram

Tài liệu đối chiếu từng bước trên 6 sơ đồ hoạt động (`docs/uml/activity/source/*.puml`) với mã nguồn thực tế trong repository `ProjectDATN`.

---

## 1. Sơ đồ `01-dang-nhap-va-phan-quyen.puml`

| Bước trên sơ đồ | File source | Hàm liên quan | Điều kiện/logic thực tế | Kết quả xác minh |
| :--- | :--- | :--- | :--- | :--- |
| Kiểm tra dữ liệu đầu vào rỗng | `mobile-app/app/(auth)/login.tsx` | `handleLogin` | `if (!email.trim() \|\| !password)` báo lỗi client trước khi gọi API | ĐÃ XÁC MINH |
| Truy vấn tài khoản theo email kèm vai trò, quyền, chi nhánh | `backend/src/modules/auth/auth.service.ts` | `login` | `prisma.user.findUnique({ where: { email }, include: userInclude })` | ĐÃ XÁC MINH |
| So sánh mật khẩu và kiểm tra trạng thái hoạt động | `backend/src/modules/auth/auth.service.ts` | `login` | `verifyPassword(password, user?.passwordHash ?? await dummyHash)`; nếu `!user \|\| !matches \|\| !user.active` ném `AppError(401, 'INVALID_CREDENTIALS')` | ĐÃ XÁC MINH |
| Lưu phiên đăng nhập (7 ngày) và ghi AuditLog | `backend/src/modules/auth/auth.service.ts` | `login` | `prisma.$transaction([prisma.session.create(...), prisma.auditLog.create({ action: 'auth.login' })])` | ĐÃ XÁC MINH |
| Ký JWT Access Token (15 phút) | `backend/src/modules/auth/auth.service.ts` | `signAccess` | `SignJWT({ sid: sessionId })`, thuật toán `HS256`, `expiration = '15m'` | ĐÃ XÁC MINH |
| Lưu token và chọn chi nhánh mặc định | `mobile-app/src/contexts/auth-context.tsx` | `login` | `saveAuthTokens(...)`, `setActiveStore(result.user.stores[0])`, `saveActiveStoreId(...)` | ĐÃ XÁC MINH |

---

## 2. Sơ đồ `02-ban-hang-pos-va-xuat-kho-fefo.puml`

| Bước trên sơ đồ | File source | Hàm liên quan | Điều kiện/logic thực tế | Kết quả xác minh |
| :--- | :--- | :--- | :--- | :--- |
| Kiểm tra thanh toán QR khi đã cấu hình PayOS | `backend/src/modules/invoices/invoices.service.ts` | `createInvoice` | `if (payosConfigured() && input.payments.some(p => p.method === 'QR'))` ném `409 PAYOS_VERIFICATION_REQUIRED` | ĐÃ XÁC MINH |
| Kiểm tra ca mở, phạm vi chi nhánh, kho, khách hàng, SKU | `backend/src/modules/invoices/invoices.service.ts` | `createInvoice` | Kiểm tra `shift.status === 'OPEN'`, `assertStoreScope`, `warehouses.length`, `skus.length === input.items.length`, `isInvoicePaymentBalanced` | ĐÃ XÁC MINH |
| Xác minh mã khuyến mãi FEFO (nếu có) | `backend/src/modules/invoices/invoices.service.ts` | `resolveVerifiedFefoPromos` | Kiểm tra lô thuộc kho, `status === 'AVAILABLE'`, chưa hết hạn, `discount >= promoResult.totalDiscount` | ĐÃ XÁC MINH |
| Vòng lặp kiểm tra tồn khả dụng và trừ lô FEFO | `backend/src/modules/invoices/invoices.service.ts`, `backend/src/modules/inventory/lot-stock.ts` | `createInvoice`, `takeLots` | `stock.onHand - stock.reserved < sold` ném `409 INSUFFICIENT_STOCK`; `takeLots` sắp xếp `expiresAt asc, createdAt asc, id asc`, trừ từng lô và ghi `lotMovement` | ĐÃ XÁC MINH |
| Cập nhật doanh thu ca, lưu hóa đơn, công nợ và AuditLog | `backend/src/modules/invoices/invoices.service.ts` | `createInvoice` | Thực thi trong `prisma.$transaction(..., { isolationLevel: 'Serializable' })`; nếu `creditAmount > 0` tạo `receivable` | ĐÃ XÁC MINH |
| Phát sự kiện Socket.IO `inventory:updated` | `backend/src/modules/iot/iot.realtime.ts` | `publishInventoryUpdate` | Gọi sau khi transaction commit thành công | ĐÃ XÁC MINH |

---

## 3. Sơ đồ `03-nhap-hang-theo-lo-va-cap-nhat-ton-kho.puml`

| Bước trên sơ đồ | File source | Hàm liên quan | Điều kiện/logic thực tế | Kết quả xác minh |
| :--- | :--- | :--- | :--- | :--- |
| Kiểm tra đơn PO đang `OPEN`, đúng chi nhánh, số nhận hợp lệ | `backend/src/modules/purchase-orders/purchase-orders.service.ts` | `receivePurchaseOrder` | `row.status !== 'OPEN'` ném `409`; `inputItem.quantity > ordered - received` ném `400 RECEIPT_EXCEEDS_REMAINING` | ĐÃ XÁC MINH |
| Tải song song ảnh chứng từ lên Cloudinary | `backend/src/modules/purchase-orders/purchase-orders.service.ts` | `receivePurchaseOrder` | `await Promise.all(input.evidence.map(uploadOperationalEvidence))` | ĐÃ XÁC MINH |
| Xác nhận sự kiện IoT đầu vào và tạo phiếu nhập `GoodsReceipt` | `backend/src/modules/purchase-orders/purchase-orders.service.ts` | `receivePurchaseOrderInTransaction` | `confirmIotEvents(...)`, `tx.goodsReceipt.create(...)` trong `Serializable` transaction | ĐÃ XÁC MINH |
| Kiểm tra mã lô và tạo lô mới (`AVAILABLE` / `QUARANTINE`) | `backend/src/modules/purchase-orders/purchase-orders.service.ts`, `backend/src/modules/inventory/lot-stock.ts` | `receivePurchaseOrderInTransaction`, `receiveLot` | Nếu `(tracked \|\| expiresAt) && !lotCode` ném `400 LOT_REQUIRED`; `expired(expiresAt) ? 'QUARANTINE' : 'AVAILABLE'` | ĐÃ XÁC MINH |
| Cập nhật tồn kho `onHand`, công nợ phải trả `Payable` và trạng thái PO | `backend/src/modules/purchase-orders/purchase-orders.service.ts` | `receivePurchaseOrderInTransaction` | Tăng `onHand`, ghi `inventoryTransaction`, cập nhật `payable` & `supplier.currentDebt`, đặt PO `COMPLETED` nếu nhận đủ | ĐÃ XÁC MINH |
| Phát sự kiện Socket.IO `inventory:updated` | `backend/src/modules/iot/iot.realtime.ts` | `publishInventoryUpdate` | Gọi sau khi transaction commit | ĐÃ XÁC MINH |

---

## 4. Sơ đồ `04-du-bao-ai-va-canh-bao-thieu-hang.puml`

| Bước trên sơ đồ | File source | Hàm liên quan | Điều kiện/logic thực tế | Kết quả xác minh |
| :--- | :--- | :--- | :--- | :--- |
| Kiểm tra quyền chi nhánh và truy vấn tồn khả dụng | `backend/src/modules/forecasts/forecasts.service.ts` | `createForecast`, `assertStore` | Loại trừ lô `QUARANTINE` hoặc `expired(lot.expiresAt)`; nếu `!stockBySku.size` ném `409 NO_STOCK_SKUS` | ĐÃ XÁC MINH |
| Tổng hợp lịch sử bán 366 ngày và gọi AI Service | `backend/src/modules/forecasts/forecasts.service.ts` | `createForecast` | `HISTORY_DAYS = 366`; gọi AI Service và xác thực phản hồi bằng Zod schema `aiResponse` | ĐÃ XÁC MINH |
| Lưu phiên dự báo `ForecastRun` và `DemandForecast` | `backend/src/modules/forecasts/forecasts.service.ts` | `createForecast` | Lưu `model`, `horizonDays`, `forecastFrom`, `forecastTo`, `predictedQuantity`, `safetyStock`, `dataQuality` | ĐÃ XÁC MINH |
| Đánh giá thiếu hụt và lập kế hoạch bổ sung/điều chuyển | `backend/src/modules/forecasts/forecasts.service.ts`, `shortage-rule.ts`, `recommendation-plan.ts` | `getShortageAlerts`, `assessShortage`, `planReplenishment` | So sánh `available`, `inTransfer`, `incomingPurchase`, `safetyStock` và `predictedQuantity` | ĐÃ XÁC MINH |

---

## 5. Sơ đồ `05-kiem-soat-cua-kho-iot-rfid.puml`

| Bước trên sơ đồ | File source | Hàm liên quan | Điều kiện/logic thực tế | Kết quả xác minh |
| :--- | :--- | :--- | :--- | :--- |
| Kiểm tra thiết bị đăng ký và chống trùng `eventId` | `backend/src/modules/iot/warehouse-access.service.ts` | `ingestAccessRfid`, `deviceFor` | Kiểm tra `device.active && device.warehouseId === warehouseId`; bắt lỗi unique `P2002` trả về `duplicate: true` | ĐÃ XÁC MINH |
| Kiểm tra thẻ `ACTIVE`, đúng kho và quyền nhân viên | `backend/src/modules/iot/warehouse-access.service.ts` | `ingestAccessRfid` | `card.status === 'ACTIVE' && card.warehouseId === input.warehouseId && employee.active` và có quyền `inventory.read` / `warehouses.manage` hoặc `OWNER` | ĐÃ XÁC MINH |
| Ghi sự kiện `RFID_SCAN`, `ACCESS_GRANTED` / `ACCESS_DENIED` và cảnh báo `INVALID_RFID` | `backend/src/modules/iot/warehouse-access.service.ts` | `ingestAccessRfid` | Thực thi trong `prisma.$transaction`; nếu `!granted && door` tạo `warehouseSecurityAlert` (`INVALID_RFID`) và `ALERT_CREATED` | ĐÃ XÁC MINH |
| Phát sự kiện thời gian thực `iot:access` qua Socket.IO | `backend/src/modules/iot/iot.realtime.ts`, `mobile-app/src/services/realtime.service.ts` | `publishWarehouseAccess`, `useRealtimeSync` | Emit kênh `iot:access`; Mobile nhận sự kiện và `invalidateQueries(['iot-monitor'])` | ĐÃ XÁC MINH |

---

## 6. Sơ đồ `06-kiem-dem-nhanh-mobile-va-phe-duyet.puml`

| Bước trên sơ đồ | File source | Hàm liên quan | Điều kiện/logic thực tế | Kết quả xác minh |
| :--- | :--- | :--- | :--- | :--- |
| Quét barcode, tra cứu tồn hệ thống và gửi phiếu kiểm đếm | `mobile-app/app/ops/quick-stocktake.tsx`, `mobile-app/src/services/mobile-ops.service.ts` | `handleLookup`, `submitQuickStocktake` | Gọi `POST /mobile-ops/quick-stocktakes` | ĐÃ XÁC MINH |
| Xác thực quyền `stocktakes.create`, tìm SKU và tính chênh lệch | `backend/src/modules/mobile-ops/mobile-ops.routes.ts`, `mobile-ops.service.ts` | `createQuickStocktake` | Nếu `!sku \|\| !sku.active` ném `404 SKU_NOT_FOUND`; `difference = actualQuantity - systemQuantity` | ĐÃ XÁC MINH |
| Lưu `QuickStocktakeReport` trạng thái `PENDING` và ghi `MobileActivityLog` | `backend/src/modules/mobile-ops/mobile-ops.service.ts` | `createQuickStocktake` | Thực thi trong `prisma.$transaction`, **không tự động sửa `inventory.onHand`** | ĐÃ XÁC MINH |
| Quản lý duyệt/từ chối phiếu trên Web Admin | `web-admin/src/app/van-hanh-mobile/page.tsx`, `backend/src/modules/mobile-ops/mobile-ops.routes.ts` | `reviewQuickStocktake` | `PATCH /mobile-ops/quick-stocktakes/:id/review` yêu cầu quyền `stocktakes.approve`, cập nhật `APPROVED`/`REJECTED` | ĐÃ XÁC MINH |
| Phát sự kiện Socket.IO `ops:stocktake` về Mobile | `backend/src/modules/iot/iot.realtime.ts`, `mobile-app/src/services/realtime.service.ts` | `publishMobileOpsEvent`, `useRealtimeSync` | Emit `ops:stocktake`; Mobile tự động `invalidateQueries(['quick-stocktakes'])` | ĐÃ XÁC MINH |
