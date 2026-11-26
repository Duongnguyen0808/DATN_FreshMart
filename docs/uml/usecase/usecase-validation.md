# Báo cáo kiểm tra chất lượng UML Use Case Diagram

- **Công cụ kiểm tra & render**: PlantUML `v1.2025.2` (OpenJDK 25 + Graphviz `dot 2.44.1`, UTF-8).
- **Chuẩn áp dụng**: UML 2.5.1 (Use Case Diagram).

---

## 1. Kết quả kiểm tra cú pháp và xuất file

| STT | File `.puml` | `.svg` | `.png` | Trạng thái |
| :---: | :--- | :---: | :---: | :---: |
| 1 | `overview/usecase-overview.puml` | 21.2 KB | 101.2 KB | **PASS** |
| 2 | `detail/01-tai-khoan-va-phan-quyen.puml` | 11.9 KB | 50.2 KB | **PASS** |
| 3 | `detail/02-ban-hang-pos-va-hoa-don.puml` | 14.7 KB | 61.9 KB | **PASS** |
| 4 | `detail/03-kho-hang-nhap-xuat-fefo.puml` | 14.6 KB | 65.7 KB | **PASS** |
| 5 | `detail/04-du-bao-ai-va-canh-bao.puml` | 14.4 KB | 62.3 KB | **PASS** |
| 6 | `detail/05-iot-rfid-va-van-hanh-mobile.puml` | 15.5 KB | 61.6 KB | **PASS** |

---

## 2. Checklist kiểm tra hình dạng elip bầu tròn & chuẩn UML 2.5.1

- [x] **Elip bầu tròn, gọn, cân đối**: 100% các Use Case dài đều được chủ động ngắt thành 2 dòng có nghĩa bằng `\n`, không có elip nào bị kéo dài dẹt bất thường theo chiều ngang.
- [x] **Actor đúng chuẩn**: Chỉ sử dụng 3 vai trò thật trong CSDL (`OWNER`, `BRANCH_MANAGER`, `EMPLOYEE`) và 4 tác nhân ngoài thực tế (`Thiết bị IoT (ESP32)`, `Dịch vụ AI`, `Cổng PayOS`, `Cloudinary`), đặt ngoài System Boundary.
- [x] **Quan hệ UML chuẩn xác**:
  - `<<include>>`: `Tạo hóa đơn bán hàng POS ..> Xuất kho tự động theo lô FEFO`; `Nhập hàng theo PO và ghi nhận lô ..> Cập nhật tồn kho và công nợ NCC`.
  - `<<extend>>`: `Áp dụng mã xả cận hạn FEFO`, `Thanh toán QR qua PayOS`, `Ghi nhận công nợ phải thu` mở rộng `Tạo hóa đơn bán hàng POS`; `Đính kèm ảnh chứng từ nhập` mở rộng `Nhập hàng theo PO`; `Gửi phiếu kiểm đếm nhanh` & `Báo cáo sự cố` mở rộng `Quét Barcode tra cứu sản phẩm`.
  - `Generalization (--|>)`: `OWNER --|> Người dùng hệ thống`, `BRANCH_MANAGER --|> Người dùng hệ thống`.
  - Không lạm dụng `<<include>> Đăng nhập` vào mọi Use Case (đưa vào Tiền điều kiện trong bảng đặc tả).
- [x] **Trình bày học thuật**: Nền trắng, viền đậm rõ, nền elip xanh ngọc rất nhạt (`#F8FCFB`), 100% tiếng Việt có dấu UTF-8, ưu tiên chèn file `.svg` vào Microsoft Word để giữ sắc nét vector.
