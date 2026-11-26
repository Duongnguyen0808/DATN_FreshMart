# Báo cáo kiểm tra chất lượng UML Activity Diagram và Render

- **Công cụ kiểm tra & render**: PlantUML `v1.2025.2` (OpenJDK 25 + Graphviz `dot 2.44.1`, UTF-8).
- **Chuẩn áp dụng**: UML 2.5.1 (PlantUML New Activity Diagram Syntax).
- **Thư mục đầu ra**: `docs/uml/activity/` (`source/`, `svg/`, `png/`).

---

## 1. Kết quả kiểm tra cú pháp và xuất file

| STT | Tên sơ đồ | File `.puml` | Render `.svg` | Render `.png` | Trạng thái |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | Đăng nhập, cấp phát phiên và phân quyền | `01-dang-nhap-va-phan-quyen.puml` | 19.7 KB | 96.9 KB | **PASS** |
| 2 | Bán hàng POS, xuất kho FEFO và thanh toán | `02-ban-hang-pos-va-xuat-kho-fefo.puml` | 33.5 KB | 163.1 KB | **PASS** |
| 3 | Nhập hàng theo PO và quản lý lô hạn dùng | `03-nhap-hang-theo-lo-va-cap-nhat-ton-kho.puml` | 31.6 KB | 162.7 KB | **PASS** |
| 4 | Dự báo nhu cầu AI và cảnh báo thiếu hàng | `04-du-bao-ai-va-canh-bao-thieu-hang.puml` | 23.2 KB | 123.3 KB | **PASS** |
| 5 | Kiểm soát cửa kho IoT RFID và Socket.IO | `05-kiem-soat-cua-kho-iot-rfid.puml` | 19.9 KB | 104.4 KB | **PASS** |
| 6 | Kiểm đếm nhanh Mobile và Phê duyệt Web Admin | `06-kiem-dem-nhanh-mobile-va-phe-duyet.puml` | 24.7 KB | 143.9 KB | **PASS** |

---

## 2. Checklist kiểm tra chuẩn UML 2.5.1

- [x] Có điểm bắt đầu (`start`) hợp lệ duy nhất cho mỗi sơ đồ.
- [x] Các Action Node dùng cấu trúc *động từ + đối tượng*, bám sát mã nguồn thực tế.
- [x] Control Flow đúng thứ tự thực thi tuần tự (`await`) trong code.
- [x] Decision Node có guard condition rõ ràng (`[Hợp lệ]`, `[Không hợp lệ]`, `[Đủ tồn kho]`, `[Không đủ tồn]`, `[Trùng lặp]`, `[Mới]`,...).
- [x] Merge hợp nhất đúng các nhánh lựa chọn thay thế.
- [x] Không lạm dụng Fork/Join cho các lời gọi `await` tuần tự (chỉ ghi chú tải ảnh song song `Promise.all` ở bước upload Cloudinary).
- [x] Vòng lặp (`repeat ... repeat while`) có điều kiện tiếp tục và thoát rõ ràng (lặp SKU trong hóa đơn POS và lặp dòng nhận hàng trong PO).
- [x] Activity Final (`stop`) đặt đúng ở cuối các luồng hoàn tất và các nhánh kết thúc sớm do lỗi nghiệp vụ.
- [x] Swimlane phân chia đúng trách nhiệm thực tế giữa Người dùng, Giao diện Web/Mobile, Backend/API, Cơ sở dữ liệu, Dịch vụ AI, Thiết bị IoT, Dịch vụ bên ngoài.
- [x] Không thiếu nhánh lỗi quan trọng và không tự bịa HTTP status code ngoài code thực tế.
- [x] 100% tiếng Việt có dấu, render UTF-8 không lỗi font.
- [x] Nền trắng, nét đen rõ, bố cục dọc tối ưu để chèn trực tiếp vào khổ A4 Microsoft Word (khuyến nghị dùng file `.svg` để giữ sắc nét vector).
