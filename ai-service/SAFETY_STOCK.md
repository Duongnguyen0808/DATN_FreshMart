# Tồn an toàn từ sai số dự báo

## Phạm vi

- `app/safety_stock.py` dùng chung cho dữ liệu M5 và FreshMart.
- M5 chỉ kiểm chứng phương pháp. Không sao chép giá trị M5 vào SKU FreshMart.
- Backend gửi tối đa 366 ngày doanh số thuần theo chi nhánh/SKU; ngày chưa có bán được điền 0. Khi đánh giá đủ lịch sử, bỏ phần 0 trước lần bán đầu tiên để không coi padding là bằng chứng.
- Kỳ bảo vệ là kỳ dự báo người dùng chọn 7/14/30 ngày. Đây chưa phải mô hình tối ưu theo thời gian giao nhà cung cấp.

## Kiểm tra cuốn chiếu và công thức

Với tối đa 12 kỳ liên tiếp, không chồng lấn, mỗi kỳ dài bằng kỳ dự báo:

1. Chỉ gửi phần lịch sử trước kỳ đó cho pipeline dự báo hiện tại, bao gồm chọn mô hình bằng validation trước kỳ đó.
2. Mỗi SKU cần ít nhất 56 ngày kể từ lần bán đầu và 7 ngày có bán trong 28 ngày trước mốc dự báo.
3. Sai số kỳ = tổng thực tế − tổng dự báo (đơn vị bán hàng của SKU).
4. Khi có ít nhất 8 kỳ hợp lệ, lấy phân vị thực nghiệm 95% bằng nearest-rank, làm tròn lên và chặn dưới tại 0.

8 kỳ là ngưỡng tối thiểu của prototype, không phải bảo đảm thống kê. Với 8–12 mẫu, nearest-rank P95 bằng sai số lớn nhất; cần nhiều dữ liệu và đánh giá ngoài mẫu hơn để chứng minh mức phục vụ 95%. Chuỗi bán hàng bị giới hạn bởi hết hàng có thể đánh giá thấp nhu cầu.

Nếu chưa đủ, trả `TEMPORARY_CONFIG`, quantity=null; backend dùng tổng safetyStock đã cấu hình tại kho. UI ghi rõ tạm thời, số kỳ đạt/tối thiểu và căn cứ. Giá trị cấu hình không được giới thiệu là do AI tính.

## Tích hợp nghiệp vụ

`DemandForecast.safetyStockAtRun` lưu mức sử dụng; `safetyStockEvidence` lưu nguồn, số mẫu, kỳ, mục tiêu, lý do và cấu hình gốc. Không cập nhật Inventory.safetyStock hoặc số tồn thực tế.

Cảnh báo và đề xuất đích sử dụng cùng snapshot dự phòng. Kho nguồn khi đề xuất/duyệt chuyển phải giữ mức kho cấu hình và phần dự phòng AI vượt cấu hình (nếu có), cùng nhu cầu dự báo. Các lần dự báo cũ chưa có bằng chứng tiếp tục dùng cấu hình và UI yêu cầu cập nhật.

## Chạy lại kiểm chứng

Từ thư mục ai-service:

```powershell
.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider
.venv/Scripts/python.exe evaluate_safety_stock.py
```

Kết quả: `data/output/safety_stock_evaluation.json`. Bài thử lấy 3 chuỗi M5, các kỳ 7/14/30 ngày, giữ riêng kỳ cuối để đánh giá sau calibration. Đây là bài thử nhỏ tái lập được, chưa phải nghiên cứu đầy đủ hoặc chứng minh đạt mục tiêu 95%.
