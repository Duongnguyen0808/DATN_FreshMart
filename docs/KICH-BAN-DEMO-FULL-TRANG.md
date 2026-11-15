# Kịch bản Demo Full Toàn Bộ Hệ Thống (55/55 Route)

Mốc dữ liệu demo: **14/11/2026** (30 ngày lịch sử bán hàng đã seed sẵn, SQL Server + Prisma + AI Service `:8000` + Next.js `:3000` + Backend `:4000`).

Tài khoản đăng nhập:
- **Owner:** `owner@smartstore.local`
- **Quản lý chi nhánh:** `manager.demo@freshmart.local`
- **Thu ngân / Nhân viên:** `cashier@smartstore.local`, `employee.demo@freshmart.local`

---

## CHẶNG 1: Đăng nhập, Tổng quan, Tổ chức & Phân quyền (8 trang)

1. **`/login` — Đăng nhập**
   - Mở `http://localhost:3000/` khi chưa đăng nhập → tự chuyển về `/login`.
   - Thử nhập sai mật khẩu → báo lỗi `401`.
   - Đăng nhập bằng `owner@smartstore.local` → tự chuyển vào `/`.
2. **`/` — Bảng điều hành tổng quan**
   - Kiểm tra 4 KPI card (doanh thu, đơn hàng, tồn kho, công nợ).
   - Đổi bộ lọc `7 ngày` / `30 ngày` / `90 ngày` và lọc theo chi nhánh `CN001`–`CN003` → số liệu & biểu đồ cập nhật theo thời gian thực.
3. **`/preview` — Chế độ xem trước điều hành**
   - Truy cập `/preview` để đối chiếu màn hình `OperationsDashboard` ở chế độ preview.
4. **`/chi-nhanh` — Quản lý chi nhánh**
   - Xem danh sách 3 chi nhánh (`CN001`, `CN002`, `CN003`), trạng thái hoạt động, thông tin chi nhánh.
5. **`/kho` — Quản lý kho hàng**
   - Xem danh sách 3 kho (`KHO001`–`KHO003`) gắn với từng chi nhánh.
   - Bấm nút **Mở mô hình kho 3D** để kiểm tra liên kết chuyển sang `/kho/mo-hinh-3d`.
6. **`/users` — Quản lý tài khoản nhân viên**
   - Xem danh sách nhân viên, vai trò và phạm vi chi nhánh được gán (dữ liệu này cũng là nguồn cho mục gán thẻ RFID cửa kho).
7. **`/roles` — Quản lý vai trò**
   - Xem 3 vai trò hệ thống: `OWNER`, `BRANCH_MANAGER`, `EMPLOYEE`.
8. **`/permissions` — Ma trận phân quyền RBAC**
   - Đối chiếu các quyền theo từng vai trò (tồn kho, POS, nhập hàng, báo cáo, IoT).

---

## CHẶNG 2: Danh mục gốc — Thêm Sản phẩm, Nhà cung cấp & Khách hàng (6 trang)

9. **`/nha-cung-cap` — Danh sách nhà cung cấp**
   - Xem danh sách NCC hiện có; thử bấm **Thêm nhà cung cấp** (hoặc mở sửa) để xem form mã/tên/liên hệ/điều khoản công nợ.
10. **`/nha-cung-cap/[id]` — Chi tiết nhà cung cấp**
    - Bấm vào 1 NCC từ danh sách → xem lịch sử đơn mua và công nợ phải trả liên quan tới NCC đó.
11. **`/san-pham` — Quản lý sản phẩm (THAO TÁC THÊM SẢN PHẨM MỚI)**
    - Kiểm tra danh sách SKU, barcode, giá vốn, giá bán, bộ lọc danh mục/trạng thái.
    - Bấm **Thêm sản phẩm**:
      - Hệ thống tự sinh mã kế tiếp (`nextCode`).
      - Nhập **Tên sản phẩm** (ví dụ: `Sữa tươi Demo 1L`), chọn **Danh mục**, nhập **Đơn vị** (`Hộp` / `Thùng`), **Barcode** (hệ thống kiểm tra trùng realtime), **Giá vốn**, **Giá bán**, chọn ảnh sản phẩm (tuỳ chọn).
      - Bấm **Lưu** → hiện thông báo `Đã thêm sản phẩm. Mã sản phẩm: ...` và sản phẩm mới xuất hiện ngay trên bảng.
    - Thử bấm nút **Xuất Excel** (`danh-sach-san-pham.xls`) hoặc xem nhanh chi tiết trên dòng.
12. **`/san-pham/[id]` — Chi tiết sản phẩm**
    - Bấm mở trang chi tiết của sản phẩm vừa tạo (hoặc sản phẩm mẫu) → kiểm tra thông tin SKU, giá vốn/giá bán, lịch sử giá và liên kết tồn kho.
13. **`/khach-hang` — Danh sách khách hàng**
    - Xem danh sách khách hàng thân thiết / khách ghi nợ, tìm kiếm theo tên hoặc SĐT.
14. **`/khach-hang/[id]` — Chi tiết khách hàng**
    - Mở 1 khách hàng → duyệt đủ **4 tab**: `Tổng quan`, `Nợ cần thu`, `Thanh toán`, `Lịch sử bán hàng`.

---

## CHẶNG 3: AI Dự báo nhu cầu & Tái cân bằng chi nhánh (6 trang)

15. **`/du-bao-nhu-cau` — Trung tâm Dự báo nhu cầu AI & Tái cân bằng thông minh**
    - Bấm **Cập nhật dự đoán** → gọi `ai-service` (`:8000`) chạy dự báo mới.
    - Mở phần giải thích công thức: `Dự báo + Tồn an toàn (P95/cấu hình) − Tồn khả dụng − Hàng đang về`.
    - Xem **Bảng 1 — Tái cân bằng chi nhánh thông minh**: chỉ ra chỉ số **Tiết kiệm vốn nhập** (ưu tiên điều chuyển nội bộ trước khi đặt mua mới).
    - Bấm 1 chạm **Tạo chuyển + mua** / **Tạo điều chuyển** / **Tạo đề nghị mua** → hiện link `Phiếu <mã> →` hoặc `Đề nghị <mã> →`.
    - Xem **Bảng 2 — Cảnh báo rủi ro cận hạn (AI × FEFO)** đồng bộ với trang Lô hạn dùng.
16. **`/du-bao-nhu-cau/khao-sat` — Khảo sát mô hình AI & Policy Backtest**
    - Trình bày bảng so sánh **7 mô hình** trên dữ liệu M5 và kết quả mô phỏng chính sách đặt hàng (Policy Backtest).
17. **3 Route chuyển hướng alias (kiểm tra link cũ vẫn chạy):**
    - `/canh-bao-thieu-hang` → tự chuyển về `/du-bao-nhu-cau`.
    - `/de-xuat` → tự chuyển về `/du-bao-nhu-cau`.
    - `/du-bao-nhu-cau/[id]` → tự chuyển về `/du-bao-nhu-cau`.

---

## CHẶNG 4: Chuỗi Nhập hàng, Camera QR ESP32, Trả hàng NCC & Công nợ phải trả (10 trang)

18. **`/nhap-hang` — Đề nghị mua hàng**
    - Xem danh sách đề nghị mua (bao gồm đề nghị vừa tạo 1 chạm từ `/du-bao-nhu-cau`), kiểm tra trạng thái duyệt.
    - Kiểm tra 2 route alias cũ: `/de-nghi-mua` và `/de-nghi-mua-hang` → đều tự chuyển về `/nhap-hang`.
19. **`/de-nghi-mua/[id]` — Chi tiết đề nghị mua hàng**
    - Mở 1 đề nghị mua để xem chi tiết từng dòng hàng, số lượng gợi ý và chuyển thành đơn mua hàng.
20. **`/don-mua-hang` — Danh sách đơn mua hàng (PO)**
    - Xem danh sách đơn mua hàng (`PO-DEMO-001`, ...), trạng thái chờ nhận / đã nhận một phần / hoàn tất.
21. **`/don-mua-hang/[id]` — Chi tiết đơn mua hàng & Phiếu nhập kho (GR)**
    - Mở `PO-DEMO-001` (và phiếu nhập `GR-DEMO-001`) → đối chiếu số lượng đặt (`orderedQuantity`) vs đã nhận (`receivedQuantity`), tạo/xem phiếu nhập kho.
22. **`/kho/mo-hinh-3d/camera` — Trạm Camera ESP32-CAM quét QR nhập kho**
    - Mô phỏng/nhận sự kiện quét QR từ ESP32-CAM: **Quét QR chỉ nhận diện kiện hàng** (hiển thị thông tin kiện, kiểm tra đúng kho/thiết bị).
    - Bấm **Xác nhận nhập kho** → tồn kho, lô FEFO và công nợ phải trả chỉ cập nhật **đúng 1 lần** (chống trùng lặp theo `eventId`).
23. **`/tra-hang-ncc` — Trả hàng nhà cung cấp**
    - Xem / tạo phiếu xuất trả hàng lỗi hoặc cận hạn về cho nhà cung cấp, đối chiếu giảm tồn kho và giảm công nợ phải trả.
24. **`/cong-no` — Công nợ phải trả NCC**
    - Xem tổng hợp công nợ phải trả theo từng nhà cung cấp.
25. **`/cong-no/[id]` — Chi tiết công nợ phải trả & Thanh toán NCC**
    - Mở `CN-DEMO-001` → đối chiếu số tiền nợ phát sinh từ phiếu nhập `GR-DEMO-001` và ghi nhận thanh toán cho NCC.

---

## CHẶNG 5: Tồn kho, Sổ cái, Lô FEFO, Điều chuyển, Kiểm kho & Kho 3D IoT (11 trang)

26. **`/ton-kho` — Tồn kho hiện tại**
    - Kiểm tra tồn theo kho (`KHO001`–`KHO003`), cột `onHand`, `reserved`, `available`, `incoming`, `inTransfer`.
    - Tìm lại sản phẩm vừa thêm ở Chặng 2 (nếu đã nhập hàng) hoặc sản phẩm demo để kiểm tra số lượng khớp.
27. **`/ton-kho/[id]` — Chi tiết tồn kho theo mặt hàng/kho**
    - Mở 1 dòng tồn kho → xem chi tiết các lô FEFO bên trong và biến động riêng của mặt hàng đó tại kho đó.
28. **`/lich-su-ton-kho` — Sổ cái biến động tồn kho (Inventory Ledger)**
    - Kiểm tra dòng log từng giao dịch (`PURCHASE_RECEIPT`, `SALE`, `TRANSFER_OUT`, `TRANSFER_IN`, `STOCKTAKE`, ...) với `beforeQuantity -> afterQuantity`.
29. **`/lo-han-dung` — Quản lý lô & Hạn sử dụng (FEFO × AI)**
    - Kiểm tra cột **Nguy cơ dư (AI × FEFO)** và số lượng dự kiến chưa bán kịp trước hạn dựa trên tốc độ bán AI/ngày.
    - Xem gợi ý giảm giá `%` hoặc bấm **Chuyển → [Kho bán nhanh hơn]** để đẩy hàng sang chi nhánh tiêu thụ nhanh hơn.
30. **`/dieu-chuyen` — Danh sách phiếu điều chuyển nội bộ**
    - Xem `DC-DEMO-001`, `DC-DEMO-002` và phiếu điều chuyển vừa tạo từ màn AI/FEFO.
31. **`/dieu-chuyen/[id]` — Chi tiết & Quy trình duyệt/xuất/nhận điều chuyển**
    - Mở chi tiết phiếu điều chuyển → xem luồng chuyển trạng thái (Duyệt → Xuất kho nguồn → Nhận kho đích) cập nhật `inTransfer` và `onHand` giữa 2 kho.
32. **`/kiem-kho` — Danh sách phiên kiểm kho**
    - Xem `KK-DEMO-001`, `KK-DEMO-002`, tạo hoặc mở phiên kiểm kê định kỳ.
33. **`/kiem-kho/[id]` — Chi tiết kiểm kho & Chốt chênh lệch**
    - Nhập số lượng thực đếm, xem chênh lệch hệ thống vs thực tế, duyệt cân bằng kho (ghi sổ cái `STOCKTAKE`).
34. **`/kho/mo-hinh-3d` — Mô hình Kho 3D & Giám sát cửa kho IoT**
    - **Tab Nhập hàng trực quan 3D:** xem xe nâng/pallet di chuyển vào vị trí kệ sau khi xác nhận nhập.
    - **Tab Chuyển hàng giữa kho:** giải thích rõ đây là mô phỏng trực quan trên 3D; chứng từ điều chuyển thật nằm ở `/dieu-chuyen`.
    - **Tab Truy cập cửa kho (6 bước chuẩn phần cứng):**
      1. Quét thẻ RFID (`RC522`)
      2. Backend xác thực quyền vào kho
      3. Chờ cảm biến cửa (`Reed Switch`) báo cửa mở
      4. Hiển thị trạng thái truy cập hợp lệ
      5. Cảm biến `Reed Switch` báo cửa đóng
      6. Lưu nhật ký vào kho (**không** suy ra ca làm, checkout hay giờ công)
    - Test/trình bày 3 cảnh báo: **Thẻ không hợp lệ**, **Mở không xác thực (`UNAUTHORIZED_ACCESS`)**, **Mở cửa quá lâu (`DOOR_OPEN_TOO_LONG`)**.
    - Mở phần **Gán thẻ nhân viên**: chọn trực tiếp từ danh sách nhân viên hiện có (không tạo nhân viên riêng trong IoT).
    - Kiểm tra 2 route alias cũ: `/kho/giam-sat-cua` và `/kho/mo-hinh-3d/rfid` → tự chuyển về `/kho/mo-hinh-3d`.

---

## CHẶNG 6: Ca làm việc, Bán hàng POS, PayOS, Hóa đơn, Trả hàng & Công nợ phải thu (10 trang)

35. **`/ca-lam-viec` — Quản lý ca làm việc thu ngân**
    - Xem danh sách ca (`CA-DEMO-*`, `CA-DEMO-TL-*`), mở ca mới / đóng ca / kiểm tiền đầu ca - cuối ca.
36. **`/hoa-don/tao` — Màn hình POS bán hàng**
    - Chọn ca đang mở và kho `KHO001`.
    - Thêm sản phẩm vào giỏ (gồm sản phẩm vừa tạo hoặc sản phẩm sẵn có) → kiểm tra chặn vượt `available` và link gợi ý sang `/du-bao-nhu-cau`.
    - Test tạo **đơn tiền mặt**, **đơn ghi nợ** hoặc **đơn chuyển khoản PayOS**.
37. **`/thanh-toan/payos` — Cổng thanh toán QR PayOS**
    - Kiểm tra trạng thái giữ tồn (`reserved`), quét/mô phỏng thanh toán thành công hoặc hủy đơn để nhả `reserved`.
38. **`/hoa-don` — Danh sách hóa đơn bán hàng**
    - Xem danh sách hóa đơn gồm 3 hóa đơn ngày `14/11/2026` (`HD-DEMO-TL-20261114-CN001` .. `CN003`), hóa đơn ghi nợ `HD-DEMO-CREDIT-001` và hóa đơn vừa tạo ở POS.
39. **`/hoa-don/[id]` — Chi tiết hóa đơn**
    - Mở hóa đơn vừa tạo hoặc `HD-DEMO-TL-20261114-CN001` / `HD-DEMO-CREDIT-001` → xem từng dòng hàng, trạng thái thanh toán, link sang `/cong-no-phai-thu/[id]` (nếu là đơn ghi nợ).
40. **`/tra-hang` — Khách trả hàng / Hoàn tiền**
    - Chọn hóa đơn đã bán → thực hiện trả hàng (nhập lại tồn kho + hoàn tiền/giảm nợ).
41. **`/cong-no-phai-thu` — Danh sách công nợ phải thu khách hàng**
    - Theo dõi các khoản khách mua chịu (`PT-DEMO-001`, ...).
42. **`/cong-no-phai-thu/[id]` — Chi tiết & Thu nợ khách hàng**
    - Mở `PT-DEMO-001` → thu nợ một phần hoặc tất cả, xem lịch sử phiếu thu.
43. **`/doi-soat-cong-no` — Đối soát công nợ tổng hợp**
    - Bấm **Đối soát lại** để kiểm tra khớp số dư giữa hóa đơn/phiếu nhập và sổ thanh toán.
44. **`/giao-dich` — Nhật ký dòng tiền & Giao dịch**
    - Đối chiếu toàn bộ giao dịch thu/chi phát sinh từ bán hàng, thu nợ và trả nợ NCC.

---

## CHẶNG 7: Bộ 5 Báo cáo quản trị & Kiểm tra phân quyền (5 trang)

45. **`/bao-cao-doanh-thu` — Báo cáo doanh thu & lợi nhuận** (lọc 30 ngày đến `14/11/2026`, xuất Excel).
46. **`/bao-cao-ton-kho` — Báo cáo tồn kho & giá trị kho** (lọc theo kho/chi nhánh, xuất Excel).
47. **`/bao-cao-san-pham` — Báo cáo top sản phẩm bán chạy / chậm** (đối chiếu sản phẩm vừa bán ở POS).
48. **`/so-sanh-chi-nhanh` — So sánh hiệu quả 3 chi nhánh (`CN001`, `CN002`, `CN003`)**.
49. **`/bao-cao-cong-no` — Báo cáo công nợ phải thu & phải trả**.

*(Kết thúc demo có thể đăng xuất, đăng nhập nhanh bằng `employee.demo@freshmart.local` để chứng minh truy cập trang quản trị `/users` hoặc `/permissions` bị chặn `403`, và dữ liệu được cô lập đúng theo chi nhánh.)*
