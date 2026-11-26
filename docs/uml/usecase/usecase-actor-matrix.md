# Ma trận Actor – Use Case – Permission (Đối chiếu RBAC thực tế)

Dữ liệu phân quyền được xác minh trực tiếp từ bảng `Role` và `RolePermission` trong SQL Server và các route middleware `requirePermission(...)`.

| Actor | Use Case | Permission | Source Code | Trạng thái |
| :--- | :--- | :--- | :--- | :---: |
| Người dùng (chung) | Đăng nhập, làm mới token, đăng xuất | Public / JWT | `backend/src/modules/auth/auth.routes.ts` | ĐÃ XÁC MINH |
| Chủ hệ thống (`OWNER`) | Quản lý người dùng, vai trò RBAC, chi nhánh, kho, sản phẩm | `users.manage`, `roles.manage`, `stores.manage`, `warehouses.manage`, `products.manage` | `backend/src/modules/users`, `organization`, `products` | ĐÃ XÁC MINH |
| Quản lý chi nhánh (`BRANCH_MANAGER`) | Xem Dashboard doanh thu & báo cáo | `dashboard.read`, `reports.read` | `backend/src/modules/dashboard`, `reports` | ĐÃ XÁC MINH |
| Quản lý chi nhánh (`BRANCH_MANAGER`) | Hủy hóa đơn, xử lý trả hàng | `invoices.cancel`, `returns.manage` | `backend/src/modules/invoices/invoices.routes.ts` | ĐÃ XÁC MINH |
| Quản lý chi nhánh (`BRANCH_MANAGER`) | Duyệt yêu cầu mua, tạo đơn PO, quản lý công nợ | `purchase_requests.approve`, `purchase_orders.create`, `payables.pay`, `receivables.pay` | `backend/src/modules/purchase-orders`, `payables`, `receivables` | ĐÃ XÁC MINH |
| Quản lý chi nhánh (`BRANCH_MANAGER`) | Duyệt phiếu kiểm đếm nhanh & xử lý báo cáo sự cố | `stocktakes.approve`, `inventory.read` | `backend/src/modules/mobile-ops/mobile-ops.routes.ts`, `web-admin/src/app/van-hanh-mobile/page.tsx` | ĐÃ XÁC MINH |
| Quản lý chi nhánh (`BRANCH_MANAGER`) | Đăng ký thiết bị IoT, cửa kho và gán thẻ RFID | `warehouses.manage` | `backend/src/modules/iot/iot.routes.ts` | ĐÃ XÁC MINH |
| Nhân viên (`EMPLOYEE`) | Mở/chốt ca, tạo hóa đơn POS, tra cứu hóa đơn | `shifts.manage`, `invoices.create`, `invoices.read` | `backend/src/modules/shifts`, `invoices` | ĐÃ XÁC MINH |
| Nhân viên (`EMPLOYEE`) | Tạo yêu cầu mua, nhập hàng theo PO, xuất/nhận điều chuyển | `purchase_requests.create`, `purchase_orders.receive`, `transfers.dispatch`, `transfers.receive` | `backend/src/modules/purchase-orders`, `transfers` | ĐÃ XÁC MINH |
| Nhân viên (`EMPLOYEE`) | Quét Barcode, Checklist ca, Kiểm đếm nhanh, Báo sự cố, Giám sát IoT | `products.read`, `inventory.read`, `stocktakes.create` | `mobile-app/app/(tabs)/*`, `mobile-app/app/ops/*`, `backend/src/modules/mobile-ops` | ĐÃ XÁC MINH |
| Thiết bị IoT (`ESP32`) | Gửi sự kiện quẹt thẻ RFID, trạng thái cửa, khung hình camera | `IOT_INGEST_TOKEN` | `backend/src/modules/iot/iot.routes.ts`, `warehouse-access.service.ts` | ĐÃ XÁC MINH |
| Dịch vụ AI | Tính dự báo nhu cầu & tồn kho an toàn (Backtest P95) | Nội bộ Backend → AI Service | `backend/src/modules/forecasts/forecasts.service.ts` | ĐÃ XÁC MINH |
| Cổng PayOS | Xác minh thanh toán QR chuyển khoản | PayOS Client/API/Checksum Keys | `backend/src/modules/payos/payos.service.ts` | ĐÃ XÁC MINH |
