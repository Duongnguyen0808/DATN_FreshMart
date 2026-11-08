# IOT WAREHOUSE ACCESS & DOOR MONITORING
## Hệ thống IoT xác thực nhân viên và giám sát truy cập cửa kho

## 1. Mục tiêu

Tích hợp IoT vào hệ thống quản trị chuỗi cửa hàng FreshMart theo hướng:

- RFID dùng để xác thực nhân viên ra/vào khu vực kho.
- Reed Switch dùng để theo dõi trạng thái cửa kho thực tế.
- ESP32 làm thiết bị IoT trung tâm, đọc RFID và trạng thái cửa rồi gửi dữ liệu qua Wi-Fi về Backend.
- Backend kiểm tra tính hợp lệ của truy cập, lưu lịch sử và phát cảnh báo.
- Digital Twin 3D phản ánh trạng thái cửa kho và sự kiện truy cập theo thời gian thực.

Không dùng RFID để nhận diện sản phẩm hoặc kiện hàng.

Phần nhập hàng vẫn dùng:

QR kiện hàng -> Webcam/Scanner -> Backend -> Goods Receipt -> Inventory -> Digital Twin.

---

## 2. Phần cứng sử dụng

### Đã có

- ESP32 NodeMCU-32S.
- RC522 RFID 13.56 MHz.
- Thẻ RFID nhân viên.
- Breadboard.
- Dây Dupont.
- Cáp USB.

### Mua thêm

- 1 Reed Switch cảm biến cửa từ.
- 1 nam châm đi kèm Reed Switch.

Có thể dùng thêm LED hoặc buzzer sau này nếu muốn cảnh báo trực tiếp tại cửa kho, nhưng không bắt buộc.

---

## 3. Chức năng chính

### 3.1. Xác thực nhân viên bằng thẻ RFID

Mỗi nhân viên kho được gán một thẻ RFID riêng.

Ví dụ:

```text
UID: D0 0C 33 0C
Employee: NV001
Name: Nguyễn Văn A
Warehouse: WH01
Status: ACTIVE
```

Khi nhân viên đưa thẻ RFID lại gần RC522:

```text
Thẻ RFID
-> RC522
-> ESP32 đọc UID
-> ESP32 gửi UID qua Wi-Fi
-> Backend
-> kiểm tra nhân viên
```

Nếu thẻ hợp lệ:

```text
ACCESS_GRANTED
```

Nếu thẻ không tồn tại, bị khóa hoặc nhân viên không có quyền vào kho:

```text
ACCESS_DENIED
```

---

## 4. Giám sát cửa kho bằng Reed Switch

Reed Switch có 2 trạng thái:

```text
Nam châm ở gần cảm biến
-> DOOR_CLOSED
```

```text
Nam châm tách khỏi cảm biến
-> DOOR_OPEN
```

ESP32 liên tục đọc trạng thái Reed Switch.

Khi cửa thay đổi trạng thái:

```text
Reed Switch
-> ESP32
-> Wi-Fi
-> Backend
-> lưu sự kiện
-> gửi realtime tới Digital Twin
```

---

## 5. Logic kết hợp RFID + cửa kho

Đây là phần quan trọng nhất.

### Trường hợp 1: Truy cập hợp lệ

```text
Nhân viên quét thẻ RFID
-> ACCESS_GRANTED

Trong khoảng thời gian cho phép, ví dụ 10 giây:
-> cửa được mở

Backend kiểm tra:
Có xác thực hợp lệ trước khi cửa mở

Kết quả:
AUTHORIZED_ACCESS
```

Ví dụ:

```text
14:05:10
NV001 quét thẻ

14:05:12
Door OPEN

Result:
AUTHORIZED_ACCESS
```

### Trường hợp 2: Cửa mở nhưng không có xác thực RFID

```text
Door OPEN
+
Không có ACCESS_GRANTED gần thời điểm đó

-> UNAUTHORIZED_ACCESS
-> tạo cảnh báo bảo mật
```

### Trường hợp 3: Cửa mở quá lâu

Ví dụ cấu hình:

```text
MAX_DOOR_OPEN_TIME = 30 giây
```

Nếu:

```text
Door OPEN > 30 giây
```

thì Backend tạo:

```text
DOOR_OPEN_TOO_LONG
```

### Trường hợp 4: Mở cửa ngoài giờ

Ví dụ:

```text
Warehouse active time:
07:00 - 22:00
```

Nếu cửa mở ngoài khung giờ, Backend tạo:

```text
AFTER_HOURS_ACCESS
```

---

## 6. Luồng tổng thể

```text
THẺ RFID NHÂN VIÊN
        |
        v
      RC522
        |
        v
      ESP32
        ^
        |
 Reed Switch cửa kho
        |
        v
      ESP32
        |
        | Wi-Fi
        v
FreshMart Backend
        |
        +----------------------+
        |                      |
        v                      v
 PostgreSQL               Realtime Event
        |                      |
        v                      v
Access/Event Log          Digital Twin 3D
                               |
                               v
                    Door / Alert / Employee
```

---

## 7. Backend API đề xuất

### 7.1. RFID authentication event

```http
POST /api/iot/access/rfid
```

Request:

```json
{
  "deviceId": "ESP32-WH01",
  "warehouseId": "WH01",
  "uid": "D00C330C",
  "timestamp": "2026-10-31T14:05:10+07:00"
}
```

### 7.2. Door state event

```http
POST /api/iot/door/event
```

Request:

```json
{
  "deviceId": "ESP32-WH01",
  "warehouseId": "WH01",
  "doorId": "DOOR-WH01-01",
  "state": "OPEN",
  "timestamp": "2026-10-31T14:05:12+07:00"
}
```

---

## 8. Event type đề xuất

```text
RFID_SCAN
ACCESS_GRANTED
ACCESS_DENIED
DOOR_OPEN
DOOR_CLOSED
AUTHORIZED_ACCESS
UNAUTHORIZED_ACCESS
DOOR_OPEN_TOO_LONG
AFTER_HOURS_ACCESS
```

Mỗi event cần có tối thiểu:

```text
eventId
deviceId
warehouseId
doorId
employeeId
eventType
timestamp
source
metadata
processed
```

---

## 9. Database đề xuất

### Bảng IoTDevice

```text
id
deviceCode
deviceName
warehouseId
type
status
lastSeenAt
createdAt
updatedAt
```

### Bảng RFIDCard

```text
id
uid
employeeId
status
assignedAt
revokedAt
```

### Bảng WarehouseDoor

```text
id
doorCode
warehouseId
name
state
lastStateChangedAt
```

### Bảng IoTEvent

```text
id
eventId
deviceId
warehouseId
doorId
employeeId
eventType
timestamp
payload
processed
createdAt
```

### Bảng SecurityAlert

```text
id
warehouseId
doorId
employeeId
type
severity
message
status
createdAt
resolvedAt
```

Các loại alert:

```text
UNAUTHORIZED_ACCESS
DOOR_OPEN_TOO_LONG
AFTER_HOURS_ACCESS
INVALID_RFID
```

---

## 10. Realtime

Backend nên dùng Socket.IO hoặc WebSocket.

```text
ESP32
-> REST API
-> Backend xử lý event
-> Database
-> Socket.IO
-> React Admin
-> Digital Twin 3D
```

---

## 11. Digital Twin 3D

### Cửa đóng

```text
Door: CLOSED
Status: NORMAL
```

### RFID hợp lệ

```text
ACCESS GRANTED
Employee: Nguyễn Văn A
Warehouse: WH01
```

### Cửa mở hợp lệ

```text
RFID ACCESS_GRANTED
+
DOOR OPEN
-> AUTHORIZED_ACCESS
```

Digital Twin:
- mở cửa kho 3D;
- trạng thái Door = OPEN;
- không báo đỏ.

### Mở cửa trái phép

```text
DOOR OPEN
+
không có RFID hợp lệ
-> UNAUTHORIZED_ACCESS
```

Digital Twin:
- cửa mở;
- highlight cảnh báo;
- Security Alert;
- camera 3D focus về cửa kho.

### Cửa mở quá lâu

```text
Door OPEN > 30s
-> WARNING
```

### Đóng cửa

```text
DOOR CLOSED
```

Digital Twin đóng cửa 3D và trở về trạng thái bình thường nếu không còn alert.

---

## 12. Dashboard IoT kho

Màn hình:

```text
Warehouse IoT Monitoring
```

Hiển thị:

```text
Warehouse: WH01

ESP32-WH01:
ONLINE

Door:
CLOSED

Last RFID Access:
NV001 - Nguyễn Văn A
14:05:10

Last Door Event:
CLOSED
14:05:25

Active Alerts:
0
```

Event History:

```text
Time       Event                 Employee
14:05:10   ACCESS_GRANTED        NV001
14:05:12   DOOR_OPEN             NV001
14:05:25   DOOR_CLOSED           NV001
```

---

## 13. Demo với giảng viên

### Demo 1 - Truy cập hợp lệ

```text
1. Đưa thẻ RFID nhân viên lại RC522.
2. ESP32 gửi UID lên Backend.
3. Web hiển thị ACCESS GRANTED.
4. Tách nam châm khỏi Reed Switch.
5. ESP32 gửi DOOR_OPEN.
6. Backend xác định AUTHORIZED_ACCESS.
7. Digital Twin mở cửa kho 3D.
```

### Demo 2 - Truy cập trái phép

```text
1. Không quét RFID.
2. Tách Reed Switch.
3. Backend nhận DOOR_OPEN.
4. Không có xác thực trước đó.
5. Tạo UNAUTHORIZED_ACCESS.
6. Digital Twin hiển thị SECURITY ALERT.
```

### Demo 3 - Cửa mở quá lâu

```text
1. Quét thẻ hợp lệ.
2. Mở Reed Switch.
3. Giữ cửa mở vượt thời gian cấu hình.
4. Backend tạo DOOR_OPEN_TOO_LONG.
5. Web và Digital Twin hiển thị cảnh báo.
6. Đưa nam châm lại để đóng cửa.
```

---

## 14. Quan hệ với phần QR nhập kho

### QR / Webcam

```text
QR kiện hàng
-> Webcam / Scanner
-> Backend
-> xác định PO / Transfer
-> Goods Receipt
-> Inventory
```

### RFID + ESP32

```text
Thẻ RFID nhân viên
-> RC522
-> ESP32
-> Backend
-> Access Control
```

### Reed Switch

```text
Door Sensor
-> ESP32
-> Backend
-> Digital Twin
```

Không dùng RFID để nhận diện hàng hóa.

---

## 15. Yêu cầu quan trọng cho Codex

1. Không thay đổi luồng GoodsReceipt / InventoryTransaction / StockTransfer hiện có nếu không cần.
2. IoT là module riêng, không ghi inventory trực tiếp.
3. ESP32 chỉ gửi event vật lý.
4. Backend chịu trách nhiệm xác thực, rule và ghi database.
5. Digital Twin chỉ nhận dữ liệu realtime từ Backend.
6. Frontend/Digital Twin không ghi trực tiếp PostgreSQL.
7. Mỗi IoT event phải có `eventId` chống xử lý trùng.
8. RFID scan lặp không được tạo nhiều access event.
9. Door OPEN/CLOSED cần debounce.
10. Lưu audit log đầy đủ.
11. Có cấu hình:
    - ACCESS_WINDOW_SECONDS
    - MAX_DOOR_OPEN_SECONDS
12. Digital Twin phải có Simulation Mode nếu phần cứng offline.
13. Nếu ESP32 online thì ưu tiên dữ liệu thật.
14. UI phân biệt rõ:
    - REAL IOT
    - SIMULATION

---

## 16. Simulation Mode

Nếu không có phần cứng, giữ các nút:

```text
Simulate RFID Access
Simulate Door Open
Simulate Door Close
Simulate Unauthorized Access
```

Event thật:

```text
Source = IOT_DEVICE
```

Event mô phỏng:

```text
Source = SIMULATION
```

Cả hai phải đi chung backend event flow.

---

## 17. Kiến trúc cuối cùng

```text
RFID Employee Card
        |
        v
      RC522
        |
        +----------+
                   |
                   v
                 ESP32
                   ^
                   |
        +----------+
        |
 Reed Switch Door Sensor

                 ESP32
                   |
                  Wi-Fi
                   |
                   v
          FreshMart Backend
                   |
        +----------+----------+
        |                     |
        v                     v
   PostgreSQL             Socket.IO
        |                     |
        v                     v
 IoT / Access Log       React Admin
                              |
                              v
                       Digital Twin 3D
```

---

## 18. Tên chức năng dùng trong báo cáo

**HỆ THỐNG IOT XÁC THỰC NHÂN VIÊN VÀ GIÁM SÁT TRUY CẬP CỬA KHO**

English:

**IoT Warehouse Access & Door Monitoring System**

Mô tả ngắn:

> Hệ thống sử dụng ESP32 kết hợp đầu đọc RFID RC522 để xác thực nhân viên ra vào khu vực kho và cảm biến cửa Reed Switch để theo dõi trạng thái mở/đóng cửa. Các sự kiện vật lý được truyền qua Wi-Fi về Backend, nơi hệ thống kiểm tra quyền truy cập, phát hiện hành vi bất thường, lưu nhật ký và đồng bộ trạng thái theo thời gian thực lên Digital Twin 3D.

---

## 19. Kết quả cuối cùng phải đạt

```text
Quét thẻ nhân viên
-> Web nhận đúng nhân viên
-> ACCESS_GRANTED

Mở cửa vật lý
-> Digital Twin mở cửa 3D

Đóng cửa vật lý
-> Digital Twin đóng cửa 3D

Mở cửa không quét thẻ
-> SECURITY ALERT

Cửa mở quá lâu
-> WARNING

Toàn bộ event
-> lưu PostgreSQL
-> xem lịch sử trên Web
```

Đây là chức năng IoT chính được chốt cho đề tài FreshMart.
