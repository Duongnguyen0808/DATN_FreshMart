# Quy cách nhập, lô/hạn dùng và thời gian cung ứng

## Sử dụng

1. Mở **Hàng hóa → Lô & hạn dùng** (`/lo-han-dung`). Chọn sản phẩm, khai báo đơn vị nhập, số đơn vị tồn/bán trong một đơn vị nhập và số ngày giao hàng dự kiến.
2. Khi nhập hàng, chọn đơn vị hiện có hoặc quy cách nhập. Ví dụ sản phẩm có đơn vị tồn là Hộp, quy cách Thùng = 24 Hộp: đặt 2 Thùng, giá 240.000/Thùng sẽ tạo PO 48 Hộp, giá 10.000/Hộp. PO lưu quy cách tại thời điểm tạo, không thay đổi theo cấu hình mới.
3. Nhận PO: ghi mã lô và hạn sử dụng thực tế. Nhận từng lần để tách các lô/hạn khác nhau trên cùng dòng PO. Hàng đã hết hạn được đưa vào cách ly.
4. Với tồn cũ, dùng **Phân loại tồn cũ theo lô** sau khi kiểm tra thực tế. Không tự sinh hạn dùng giả. Khi bắt đầu quản lý lô tại SKU/kho, số tồn chưa phân loại bị chặn bán cho đến khi xác minh.
5. Bán hàng và xuất điều chuyển lấy lô còn dùng được có hạn gần nhất (FEFO). Không dùng lô cách ly, hết hạn hoặc tồn cũ chưa xác minh. Hạn in trên bao bì được hiểu là còn dùng đến hết ngày đó theo múi giờ Việt Nam.
6. Hàng hỏng: cách ly → lập phiếu tiêu hủy → người có quyền duyệt → xử lý hàng thực tế → xác nhận hoàn tất kèm số biên bản/đường dẫn bằng chứng. Chỉ bước hoàn tất giảm tổng tồn và ghi giao dịch DISPOSAL. Xác nhận lặp bị từ chối.
7. Trả nhà cung cấp dùng phiếu trả hiện có, chọn đúng lô gắn với dòng PO gốc. Xử lý công nợ theo nghiệp vụ trả NCC, không qua phiếu tiêu hủy.

## Ranh giới và dữ liệu

- Đơn vị `Product.unit` vẫn là đơn vị tồn/bán chuẩn hiện tại. Không tự chuyển các tồn cũ đang tính theo thùng sang chiếc/hộp. Sản phẩm có tồn/lịch sử không đổi đơn vị chuẩn qua màn hình sửa sản phẩm.
- Quy cách nhập mới nằm ở `purchaseUnit`, `purchasePackSize`; không diễn giải lại trường quy đổi cũ. Giá chia ra đơn vị chuẩn phải biểu diễn được với hai chữ số thập phân, nếu không API từ chối để tránh sai tổng tiền.
- Quản lý lô được kích hoạt khi nhận lô đầu tiên hoặc phân loại tồn cũ; hàng chưa kích hoạt vẫn dùng luồng hiện tại. Với thực phẩm cần quản lý hạn, nhân viên phải khai báo ngày thực tế; hệ thống chưa tự bắt buộc theo danh mục.
- Cách ly là trạng thái nghiệp vụ/vị trí được hướng dẫn. Nhân viên vẫn phải mang hàng ra khu cách ly vật lý. Tổng tồn còn bao gồm hàng cách ly; tồn khả dụng loại trừ chúng.
- Hàng khách trả vào kho có quản lý lô được cách ly chờ xác minh. Chưa có thao tác giải phóng cách ly lên kệ trong phiên bản này.
- Nhận điều chuyển có lô hiện yêu cầu đủ số đã xuất để giữ đúng phân bổ lô. Chênh lệch theo từng lô chưa có giao diện xử lý; API từ chối nhận sai số thay vì đoán lô bị thiếu. Luồng chênh lệch hàng chưa quản lý lô được giữ nguyên.
- Kiểm kho SKU đã có lô phải dùng Kiểm đếm lô; không điều chỉnh tổng tồn độc lập với các lô.
- Lịch sử lô hiển thị 20 biến động gần nhất, danh sách lô tối đa 1.000 dòng. Bản ghi đầy đủ vẫn lưu trong DB.
- Quyền dùng lại: `inventory.read` xem, `stocktakes.create` cách ly/lập phiếu, `stocktakes.approve` phân loại/kiểm đếm/duyệt/hoàn tất, `products.manage` cấu hình quy cách. Phạm vi kho theo chi nhánh và người thao tác được lưu audit.

## Dự báo và ngày đặt hàng

- `leadTimeDays` là số ngày cung ứng kế hoạch do người dùng nhập, không phải kết quả AI tự suy ra. Bỏ trống thì giao diện báo chưa có cơ sở kết luận thời điểm đặt.
- AI cung cấp tổng nhu cầu dự báo. Phân tích thời điểm giả định tiêu thụ đều từng ngày, sử dụng tồn khả dụng, tồn an toàn và lịch PO còn mở để cảnh báo ngày có thể thiếu hàng.
- PO quá hạn chưa được coi là hàng đã về. Hàng đang chuyển chưa có lịch về không được dùng để bảo đảm tránh thiếu trước ngày giao.
- Lead time dài hơn khoảng dự báo sẽ báo thiếu phạm vi dự báo; không ngoại suy âm thầm.
- Quy đổi số cần mua lên nguyên kiện là gợi ý. Người dùng vẫn duyệt số lượng, không tự tạo PO hay tăng tồn.

## Kiểm chứng

- Migration: `backend/prisma/migrations/20261021100000_lots_procurement/migration.sql`.
- Build: `npm run build`.
- Kiểm thử module: chạy tại `backend`: `$env:RUN_LOT_DB_TEST='1'; ..\node_modules\.bin\vitest.cmd run src/modules`.
- Test DB tạo dữ liệu biệt lập trong transaction và luôn rollback: quy đổi PO/nhận hàng, FEFO, hủy bán, khách trả, chuyển lô, duyệt/hoàn tất tiêu hủy, chống lặp và phạm vi quyền. Không sửa số tồn thật để tạo demo.
