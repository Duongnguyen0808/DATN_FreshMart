# FreshMart · IoT xác thực nhân viên và giám sát cửa kho

## Kiểm tra nhanh trên máy demo

Chạy `node iot/check-hardware.mjs` từ thư mục gốc. Lệnh chỉ đọc cấu hình, PostgreSQL, cổng COM và trạng thái backend; nó không quét thay thiết bị. Nếu lệnh báo chưa có thiết bị/cửa, vào **Quản lý kho → Mô hình kho 3D**, chọn kho và luồng **Nhân viên vào kho hợp lệ**, rồi mở **Thiết lập thiết bị, cửa và thẻ nhân viên**. Mã trong giao diện phải trùng `DEVICE_ID` và `DOOR_ID` ở `iot/esp32-rc522/config.local.h`. UID thẻ lấy từ Serial Monitor sau lần quét đầu, rồi gán cho nhân viên có quyền vào kho. Giữ cùng UUID kho ở hai file cấu hình ESP32.

Trước khi trình diễn bằng phần cứng: kết nối board qua USB để có cổng COM, nạp cả hai sketch bằng Arduino IDE/Arduino CLI, chạy backend, đặt board và máy backend cùng mạng Wi-Fi. Xác nhận lần lượt heartbeat `REAL IOT`, quét QR kiện và xác nhận phiếu nhập, quét thẻ nhân viên, mở/đóng Reed Switch; cuối cùng kiểm tra nhật ký và cảnh báo trên mô hình 3D. Nếu chưa thấy cổng COM hoặc chưa nạp firmware, chỉ có thể kiểm tra phần mềm và chạy mô phỏng.

## Chuẩn bị

1. `npm run db:migrate -w backend` để tạo các bảng `warehouse_access_*` và `warehouse_security_alerts`.
2. Trong `backend/.env`, đặt `IOT_INGEST_TOKEN` (32+ ký tự). Có thể chỉnh `ACCESS_WINDOW_SECONDS`, `MAX_DOOR_OPEN_SECONDS`, `WAREHOUSE_OPEN_HOUR`, `WAREHOUSE_CLOSE_HOUR` theo `backend/.env.example`; giờ kho dùng múi giờ Việt Nam.
3. Mở **Quản lý kho → Mô hình kho 3D**, chọn kho rồi chọn luồng **Nhân viên vào kho hợp lệ**. Mở mục **Thiết lập thiết bị, cửa và thẻ nhân viên** ngay dưới mô hình; tạo mã thiết bị, cửa và gán UID thẻ cho nhân viên có quyền xem kho. Ghi lại UUID kho và các mã thiết bị/cửa. Các đường dẫn RFID/giám sát cũ chuyển về mô hình 3D; endpoint nhận RFID kiện cũ trả HTTP 410.
4. Cắm RC522 và reed switch theo `iot/esp32-rc522/README.md`, điền `iot/esp32-rc522/config.local.h`, nạp sketch. PC chạy backend và ESP32 phải cùng mạng có thể truy cập được nhau.

## Trình diễn

- **Hợp lệ:** quét thẻ nhân viên → `ACCESS_GRANTED`; trong 10 giây tách nam châm → `DOOR_OPEN` và `AUTHORIZED_ACCESS`. Trang giám sát và mô hình 3D hiển thị cửa mở. Đưa nam châm lại → `DOOR_CLOSED`.
- **Trái phép:** không quét thẻ, tách nam châm → `UNAUTHORIZED_ACCESS` và cảnh báo đỏ. Đóng cửa rồi bấm **Đã xử lý** sau khi xem xét.
- **Mở quá lâu:** quét thẻ, mở cửa và giữ quá 30 giây → `DOOR_OPEN_TOO_LONG`; đóng cửa thì cảnh báo mở lâu được giải quyết tự động.
- **Không có phần cứng:** khi không có heartbeat từ ESP32 trong 60 giây, chọn luồng ở phía trên mô hình rồi bấm **Chạy demo**. Nút đi qua cùng service backend, lưu `source=SIMULATION`; sự kiện thật lưu `source=IOT_DEVICE`. Cửa mở quá lâu ở chế độ mô phỏng cảnh báo sau 10 giây. Có heartbeat thiết bị thì mô phỏng bị khóa và mô hình chờ lượt quét/cửa vật lý.

Trang giám sát đọc dữ liệu lưu trong PostgreSQL và nhận cập nhật qua Socket.IO, đồng thời tải lại mỗi 5 giây nếu socket mất kết nối. ESP32 gửi heartbeat mỗi 25 giây để trạng thái `REAL IOT` không hết hạn khi không ai quét thẻ. Mô hình kho 3D cũng đọc cùng trạng thái từ backend. Nhập hàng bằng QR/ESP32-CAM, phiếu nhận và tồn kho không bị thay đổi bởi module này.

## API

- Thiết bị: `POST /api/v1/iot/access/rfid`, `POST /api/v1/iot/door/event`, `POST /api/v1/iot/access/heartbeat` với header `x-iot-device-token`.
- Nhân viên có quyền `inventory.read`: `GET /api/v1/iot/access/monitor?warehouseId=<uuid>`.
- Người có quyền `warehouses.manage`: `POST /api/v1/iot/access/devices`, `/doors`, `/cards`, `/simulate`, `/alerts/:id/resolve`.

ESP32 chỉ giám sát và báo sự kiện, không điều khiển khóa cửa. Firmware hiện không lưu hàng đợi đầy đủ khi mất Wi-Fi; sau khi kết nối lại nó gửi trạng thái cửa hiện tại. Cần Wi-Fi ổn định cho buổi demo phần cứng.
