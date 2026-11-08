# Kịch bản demo nhập kho bằng ESP32-CAM

## Tình huống trình bày

“Nhà cung cấp giao một kiện 24 lon nước. Nhân viên kho lập tem kiện từ đơn mua hàng. ESP32-CAM đọc tem để hệ thống tìm đúng kiện; nhân viên đối chiếu rồi xác nhận. Hệ thống lưu phiếu nhận, cộng tồn kho, tạo lô hàng và cập nhật tiến độ đơn mua. Quét lại không cộng tồn lần hai.”

QR xác định **kiện**, không phải chỉ mã đơn mua hay mã sản phẩm. Camera không tự đếm hàng, không nhận diện bao bì bằng AI. Hoạt cảnh 3D minh họa vận hành, không điều khiển xe nâng thật.

## Chuẩn bị

- Web, backend và PostgreSQL chạy được; tài khoản có quyền nhận đơn mua hàng và xem tồn kho.
- Có sản phẩm, nhà cung cấp và kho đang hoạt động; ghi lại tồn ban đầu là **N**.
- ESP32-CAM đã nạp firmware theo [hướng dẫn](../iot/esp32-cam/README.md), cùng mạng backend; `deviceId` là `FRESHMART-CAMERA-IN-01`. UUID kho và token phải đúng cấu hình.
- Không dùng `localhost` làm địa chỉ backend trên ESP32-CAM. Theo dõi Serial Monitor và kiểm tra đồng bộ thời gian.

## Trình diễn từ đầu đến cuối

| Bước | Thao tác | Kết quả cần thấy |
|---|---|---|
| 1 | Mua hàng → tạo đơn mua: chọn nhà cung cấp, kho, sản phẩm và số lượng 24 | Đơn chờ nhận, còn phải nhận 24; tồn vẫn N |
| 2 | Quản lý kho → Mô hình kho 3D → Kiện hàng & tem QR; chọn đúng kho | Có dòng đơn vừa tạo trong sản phẩm cần nhận |
| 3 | Chọn dòng đơn, số lượng 24 và hạn sử dụng đúng hàng thực tế | Tạo được kiện READY; tồn vẫn N |
| 4 | Tạo mã kiện, tải/in tem QR | Tem có mã kiện riêng |
| 5 | Về 3D → Chạy demo → chọn kiện đã tạo → Bắt đầu xe vào kho | Xe đến, dỡ pallet, xe nâng mang kiện tới trạm camera |
| 6 | Đợi bước ESP32-CAM quét QR rồi đưa tem trước thiết bị | Popup đúng sản phẩm, lượng 24, kho và đơn mua; tồn vẫn N |
| 7 | Đối chiếu hàng, bấm Xác nhận nhập kho một lần | Báo đã lưu phiếu và cập nhật tồn; đóng popup |
| 8 | Đợi xe nâng cất hàng | Timeline Hoàn tất 5/5 bước |
| 9 | Xem Phiếu nhập, Tồn kho, Lô & hạn dùng và đơn mua | Một phiếu nhận; tồn N+24; lô tăng 24; kiện đã nhận; đơn hoàn thành nếu đã nhận đủ |
| 10 | Đưa lại tem đó trước camera | Không tạo phiếu thứ hai, tồn vẫn N+24; lịch sử đánh dấu đã nhận trước đó |

Chỉ chọn “không có hạn sử dụng” nếu sản phẩm thực sự không có hạn. Nếu sản phẩm cần nhận trống: kiểm tra đúng kho, đơn còn lượng chưa nhận và lượng đó chưa được giữ trong kiện READY khác.

## Tình huống ngoại lệ

- Mã chưa đăng ký: báo chưa đăng ký, không cộng tồn.
- Sai thiết bị hoặc kho: backend chặn, không tạo phiếu.
- Gửi lại cùng `eventId`: trả lại sự kiện cũ, không tạo sự kiện thứ hai.
- Quét lại kiện đã nhận bằng lượt mới: không cộng tồn lần nữa.
- Chưa xác nhận: quét đúng cũng chưa thay đổi tồn.
- Thiết bị mất kết nối: demo dừng chờ; không giả lập lượt quét rồi tuyên bố thiết bị đã hoạt động.

## Phạm vi kiểm thử

- `npm.cmd test -w backend`: bộ kiểm thử nghiệp vụ; các bộ tích hợp chưa bật được ghi rõ là bỏ qua.
- `npm.cmd run test:workflows -w backend`: PostgreSQL riêng `smart_store_workflows_test`, tạo đơn mua và kiện, kiểm tra sự kiện, xác nhận, tồn/lô, trạng thái đơn và chống trùng. Dữ liệu ca kiểm thử được rollback. Có thêm ca điều chuyển và nghiệp vụ lô.
- Trong `web-admin`, đặt `REVIEW_BASE_URL` trỏ tới web rồi chạy `node scripts/verify-esp-receiving.cjs`: trình duyệt thực chạy tạo QR, mô hình, popup và hoàn tất 5/5. API được giả lập; đây không phải lượt trình duyệt kết nối PostgreSQL thật.
- Ảnh: `web-admin/artifacts/camera-review/esp-scene-waiting.png` và `esp-scene-complete.png`.
- Chưa kiểm chứng cảm biến, khả năng đọc QR, Wi-Fi và firmware trên board thật. Cần chạy lại bước 6–10 bằng ESP32-CAM trước buổi trình diễn.

Chuyển kho 3D là mô phỏng, không đổi tồn; chuyển thật dùng Phiếu điều chuyển. Trang 3D không dùng webcam trình duyệt để nhận hàng.

Endpoint thiết bị là `POST /api/v1/iot/events`; endpoint webcam cũ `/iot/camera-scans` trả 410. Kiện webcam còn READY có thể hủy ở trang tem rồi tạo lại cho ESP32-CAM. Giữ nguyên chứng từ của kiện đã nhận. Kết nối realtime của web không chứng minh thiết bị online; hiện chưa có heartbeat. Hướng phát triển tiếp: heartbeat/RSSI, đèn hoặc còi phản hồi, hàng đợi mất mạng, ảnh bằng chứng và cấu hình nhiều thiết bị; các mục này chưa triển khai.

## Kết quả chạy ngày 30/10/2026

| Kiểm tra | Kết quả |
|---|---|
| Backend thường | 42 đạt; 86 bỏ qua vì không bật các bộ tích hợp tương ứng |
| PostgreSQL riêng | 3 ca đạt, gồm nhập RFID, nhập camera và nghiệp vụ lô hàng |
| Camera trên PostgreSQL | Mã chưa đăng ký, sai kho/thiết bị, gửi lại cùng eventId, chờ xác nhận, nhận đúng một lần, tồn/lô 24, đơn hoàn thành: đạt |
| Trình duyệt | Tạo QR → chạy xe → trạm camera → đối chiếu → xác nhận → cất hàng → hoàn tất 5/5: đạt; API giả lập |
| Giao diện đăng ký kiện | Không tràn ngang ở 1440, 768 và 390 px |
| TypeScript web và backend | Đạt |
| Board ESP32-CAM thật | Chưa kiểm thử |

Đã sửa lỗi bỏ qua đoạn xe nâng mang pallet tới trạm camera: trước đó xe chờ quét ngay tại xe tải rồi nhảy vị trí khi cất hàng. Nay xe chạy tới khu quét trước khi vào trạng thái chờ. Đã chạy lại toàn bộ kịch bản giao diện sau sửa.

Lần chạy giao diện trong lúc sửa mã bị Fast Refresh đưa trang về trạng thái ban đầu; lần chạy lại khi mã ổn định đạt. Có cảnh báo thư viện Three.js/pg về API sắp bỏ, nhưng không ghi nhận lỗi JavaScript trong lượt kiểm thử đạt. Không sửa dữ liệu kinh doanh chính.
