# ESP32-CAM đọc QR kiện FreshMart

Dành cho AI Thinker ESP32-CAM có PSRAM, đã dùng với OV3660 trong dự án. Mặc định camera gửi JPEG thật qua Wi-Fi; backend giải mã QR bằng ZXing và tạo sự kiện IoT. Hình xem trước giúp canh mã, không thay thế lượt đọc QR từ ảnh.

## Nạp và chạy

- Arduino ESP32 core, ArduinoJson 7. Bộ đọc QR đã nằm trong `src/qr-reader`, không cần thêm ZIP.
- Cấu hình Wi-Fi 2.4 GHz, API_URL dùng IP LAN của máy backend, token và UUID kho trong `config.local.h`. Không đưa token/mật khẩu vào Git.
- Dùng task VS Code để biên dịch/nạp; chỉ cần nạp lại khi thay firmware hoặc cấu hình. Sau đó cấp nguồn là ESP tự chạy, không cần mở Arduino IDE hoặc Serial Monitor.
- Serial 115200, DTR/RTS off. Chờ `Camera ready`, dùng IP in trong log. `/snapshot` là ảnh xem trước, cổng 81 `/stream` là luồng hình; web tự quản lý kết nối. Khi đọc được QR, log `Camera QR HTTP` có thời gian giải mã và toàn bộ yêu cầu ảnh.
- `SERVER_QR_DECODING=1` (mặc định): gửi JPEG tới `/api/v1/iot/camera-frames` bằng token thiết bị; không cần dịch vụ Python riêng. Backend dùng `sharp` và `@zxing/library`. Chỉ tạo sự kiện khi đã giải mã QR FreshMart từ chính ảnh gửi lên.
- `SERVER_QR_DECODING=0`: chế độ dự phòng giải mã quirc ngay trên ESP; cần nạp lại khi đổi chế độ.

## Demo nhập hàng

1. Mở Mô hình kho 3D, chọn Nhập hàng và Chạy demo.
2. Trong popup chọn chi nhánh/kho và kiện từ đơn mua hàng. QR đã được tạo từ đơn mua hàng.
3. Bấm Bắt đầu xe vào kho. Web đăng ký phiên demo có quyền nhận hàng, gắn đúng kiện, thiết bị và kho, hiệu lực 15 phút. Một người khác đang giữ camera sẽ được báo bận.
4. Bước 3 hiện QR. Kết nối IP camera, hướng camera vào mã, giữ đủ bốn góc và viền trắng rõ nét. ESP tự giải mã, không cần bấm chụp.
5. ESP gửi ảnh JPEG kèm định danh thiết bị, kho vật lý, mã sự kiện và timestamp. Backend xác thực token, giải mã QR từ ảnh rồi tìm phiên demo khớp đúng mã để xác định kho. Ngoài phiên hợp lệ, vẫn dùng WAREHOUSE_ID cấu hình vật lý; không tự suy ra kho từ QR. API không nhận mã kiện do trình duyệt điền thay cho ảnh.
6. Backend lưu sự kiện và trả kết quả. Web nhận realtime, có polling dự phòng mỗi giây. Sai kho hoặc sự kiện bị chặn phải hiện lý do thay vì chờ vô hạn.
7. Nhân viên đối chiếu số lượng/hạn dùng và xác nhận mới lập phiếu nhập, cộng tồn và chạy tiếp mô hình. Quét lặp không tự cộng tồn. Backend gộp các lượt đọc lặp trong 1,5 giây theo mã, thiết bị và phiên; mã khác vẫn được xử lý ngay.

## Phân biệt lỗi

- `FreshMart QR detected`: đã giải mã thành công. Kiểm tra tiếp `Backend scan result`, không tiếp tục chỉnh độ nét nếu backend báo sai kho.
- `BLOCKED`: xem lý do backend; không bỏ kiểm tra kho để nhận hàng sai nơi. Với firmware mới, bắt đầu lại demo để tạo phiên đúng kiện/kho.
- `NO_AP_FOUND`: ESP không tìm thấy Wi-Fi đã cấu hình; xem lại bộ phát 2.4 GHz và cấu hình mạng.
- Có hình nhưng không có kết quả backend: kiểm tra API_URL, máy backend và cổng 4000 trong LAN.
- Bộ đọc backend thử vùng giữa, toàn khung và ảnh đảo màu; ảnh VGA giữ nguyên độ phân giải. Không bắt buộc giữ mã 10 giây. `/status` trả `decoder=BACKEND_ZXING`, số khung ảnh đã xử lý, thời gian giải mã và POST; các số này không thay thế phép đo từ lúc đưa QR vào đến khi popup nhận kết quả. Độ nét, chuyển động và mạng vẫn ảnh hưởng tốc độ nhận.
- Lỗi khởi tạo/giao tiếp cảm biến: kiểm tra nguồn và cáp camera khi đã tắt nguồn. Việc xem trước thành công không đồng nghĩa toàn bộ luồng nhập kho đã được xác nhận.

Nguồn thư viện: ESP32QRCodeReader (alvarowolfx), quirc v1.2 (dlbeer); xem ghi chú/giấy phép trong src/qr-reader.
