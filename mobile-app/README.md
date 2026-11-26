# FreshMart Ops — Ứng Dụng Di Động Cho Nhân Viên Kho & Cửa Hàng

Ứng dụng di động hỗ trợ giám sát từ xa, nhận cảnh báo FEFO × AI và tra cứu sản phẩm nhanh tại cửa hàng bằng camera iPhone.

---

## 1. Công nghệ sử dụng
- **React Native 0.88** & **Expo SDK 58** (Expo Router).
- **TypeScript** với kiểu dữ liệu chặt chẽ.
- **Expo Camera** (`expo-camera`): Quét mã vạch EAN-13, QR, Code-128.
- **Expo Audio & Haptics** (`expo-audio`, `expo-haptics`): Âm thanh tiếng "tít" và rung phản hồi khi quét thành công.
- **Expo SecureStore** (`expo-secure-store`): Lưu trữ an toàn JWT Token và thông tin phiên làm việc.
- **TanStack Query (React Query)**: Quản lý trạng thái và tự động polling dữ liệu thời gian thực.
- **Design System**: Đồng bộ 100% với Web Admin (Màu chủ đạo `#0d7a73`, nền `#f6f9f8`, bo góc thẻ 16px).

---

## 2. Cài đặt và chạy trên máy tính Windows

### Bước 1: Cài đặt thư viện
```bash
cd mobile-app
npm install
```

### Bước 2: Chạy ứng dụng qua Expo
```bash
npx expo start --tunnel
```
*(Cờ `--tunnel` giúp Expo tạo đường hầm kết nối trực tiếp từ Windows sang iPhone mà không lo vấn đề khác lớp mạng Wi-Fi).*

Màn hình terminal sẽ hiển thị **1 mã QR**.

---

## 3. Chạy thử trên iPhone (Không cần MacBook)

1. Cầm iPhone lên, mở **App Store**, tìm kiếm và tải ứng dụng miễn phí **Expo Go**.
2. Mở ứng dụng **Camera của iPhone** (hoặc mở Expo Go bấm *Scan QR Code*).
3. Quét mã QR đang hiển thị trên màn hình máy tính Windows.
4. Ứng dụng **FreshMart Ops** sẽ tự động nạp và mở trên iPhone.
5. Cấp quyền truy cập Camera khi ứng dụng yêu cầu.

---

## 4. Kết nối Backend Hosting & Cấu hình API

- **Mặc định**: Ứng dụng đã được cấu hình trỏ trực tiếp đến máy chủ backend hosting:
  `https://freshmart-iot.store/api/v1`
- **Tùy chỉnh linh hoạt**: Nếu bạn muốn chạy backend localhost trên máy tính Windows khi demo offline:
  1. Trên màn hình Đăng nhập hoặc tab *Cá nhân*, bấm vào nút **Cấu hình máy chủ**.
  2. Đổi URL thành địa chỉ IP mạng nội bộ của bạn (ví dụ: `http://192.168.1.15:4000/api/v1`) hoặc link Cloudflare Tunnel.
  3. Bấm **Lưu kết nối**.

---

## 5. Tài khoản mẫu để Demo
- **Chủ doanh nghiệp / Quản lý toàn quyền**:
  - Email: `admin@gmail.com`
  - Mật khẩu: `123456aA@`
- **Nhân viên kho**:
  - Email: `kho1@gmail.com`
  - Mật khẩu: `123456aA@`

---

## 6. Cấu hình EAS Build & Hướng dẫn đưa lên TestFlight

File cấu hình `eas.json` đã được tạo sẵn trong thư mục dự án.

### Các bước chuẩn bị đưa lên TestFlight (khi có nhu cầu phát hành):
1. Cài đặt EAS CLI: `npm install -g eas-cli`
2. Đăng nhập tài khoản Expo: `eas login`
3. Cấu hình dự án: `eas build:configure`
4. Chạy build iOS trên đám mây Expo (không cần máy Mac):
   ```bash
   eas build --platform ios --profile production
   ```
5. Đưa lên App Store Connect / TestFlight:
   ```bash
   eas submit --platform ios
   ```

### ⚠️ Yêu cầu về tài khoản Apple Developer:
- Để phát hành lên TestFlight hoặc App Store, Apple **bắt buộc phải có tài khoản Apple Developer Program** ($99/năm).
- **Trong phạm vi ĐATN**: Việc chạy trực tiếp qua **Expo Go** trên iPhone là giải pháp tối ưu nhất, **hoàn toàn miễn phí 100%** và đầy đủ tính năng quét camera, âm thanh, rung, giám sát IoT.

---

## 7. Các giới hạn & Lưu ý
- **Camera Scanner**: Trình giả lập (Simulator) trên máy tính không có camera thật, bắt buộc phải test trên điện thoại thật (iPhone) để quét mã vạch.
- **Push Notification trên Expo Go**: Nhận thông báo qua Expo Push Token. Khi cần đẩy thông báo APNs native độc lập không qua Expo Go, cần có tài khoản Apple Developer để tạo Provisioning Profile.
