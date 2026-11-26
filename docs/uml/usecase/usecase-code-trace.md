# Báo cáo đối chiếu Use Case với Source Code

| Sơ đồ | Phân hệ | File Backend đã đối chiếu | File Frontend / Mobile đã đối chiếu | Trạng thái |
| :--- | :--- | :--- | :--- | :---: |
| `overview/usecase-overview.puml` | Tổng quát toàn hệ thống | Toàn bộ 23 thư mục trong `backend/src/modules/` | `web-admin/src/components/app-shell.tsx`, `mobile-app/app/(tabs)/_layout.tsx` | ĐÃ XÁC MINH |
| `detail/01-tai-khoan-va-phan-quyen.puml` | Tài khoản, phân quyền & tổ chức | `auth/auth.routes.ts`, `auth.service.ts`, `users/`, `organization/` | `mobile-app/app/(auth)/login.tsx`, `mobile-app/src/utils/rbac.ts` | ĐÃ XÁC MINH |
| `detail/02-ban-hang-pos-va-hoa-don.puml` | Bán hàng POS, hóa đơn & thanh toán | `invoices/invoices.routes.ts`, `invoices.service.ts`, `inventory/lot-stock.ts`, `payos/` | `web-admin/src/app/hoa-don/page.tsx`, `[id]/page.tsx` | ĐÃ XÁC MINH |
| `detail/03-kho-hang-nhap-xuat-fefo.puml` | Kho hàng, nhập xuất lô FEFO & chuyển kho | `purchase-orders/purchase-orders.routes.ts`, `purchase-orders.service.ts`, `inventory/lot-stock.ts`, `transfers/` | `web-admin/src/app/lo-han-dung/page.tsx` | ĐÃ XÁC MINH |
| `detail/04-du-bao-ai-va-canh-bao.puml` | Dự báo AI & cảnh báo FEFO | `forecasts/forecasts.service.ts`, `forecasts.schemas.ts`, `inventory/lots.routes.ts` | `mobile-app/app/(tabs)/alerts.tsx`, `mobile-app/src/services/alerts.service.ts` | ĐÃ XÁC MINH |
| `detail/05-iot-rfid-va-van-hanh-mobile.puml` | Giám sát IoT RFID & Mobile Ops | `iot/iot.routes.ts`, `warehouse-access.service.ts`, `mobile-ops/mobile-ops.routes.ts`, `mobile-ops.service.ts` | `mobile-app/app/(tabs)/iot.tsx`, `scan.tsx`, `ops/checklist.tsx`, `ops/quick-stocktake.tsx`, `ops/incident.tsx`, `web-admin/src/app/van-hanh-mobile/page.tsx` | ĐÃ XÁC MINH |
