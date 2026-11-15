# TÀI LIỆU GIẢI TRÌNH CÔNG THỨC & NGHIỆP VỤ: MÔ PHỎNG FEFO KẾT HỢP DỰ BÁO NHU CẦU AI (`FEFO × AI FORECAST`)

> **Phạm vi áp dụng trong mã nguồn dự án:**
> - Mô phỏng phân bổ FEFO & đánh giá điều chuyển: [`backend/src/modules/forecasts/fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts)
> - Dịch vụ cảnh báo lô cận hạn & tổng hợp dữ liệu dự báo: [`backend/src/modules/forecasts/forecasts.service.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/forecasts.service.ts)
> - Cân bằng thiếu hụt, thời điểm cung ứng & kế hoạch bổ sung hàng: [`backend/src/modules/forecasts/shortage-rule.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/shortage-rule.ts), [`backend/src/modules/forecasts/supply-timing.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/supply-timing.ts), [`backend/src/modules/forecasts/recommendation-plan.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/recommendation-plan.ts), [`backend/src/modules/forecasts/recommendations.service.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/recommendations.service.ts)
> - Kiểm soát xuất lô FEFO & chặn lô quá hạn tại POS: [`backend/src/modules/inventory/lot-stock.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/inventory/lot-stock.ts), [`backend/src/modules/invoices/invoices.service.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/invoices/invoices.service.ts)
> - Giao diện theo dõi Lô & Hạn dùng: [`web-admin/src/app/lo-han-dung/page.tsx`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/web-admin/src/app/lo-han-dung/page.tsx)
> - Bộ kiểm thử tự động đối chiếu tính tay: [`backend/src/modules/forecasts/fefo-simulation.test.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.test.ts)

---

## 1. Mục đích chức năng

Trong vận hành chuỗi cửa hàng bán lẻ tạp hóa/siêu thị mini (FreshMart), quản lý hàng hóa có hạn sử dụng đòi hỏi kết hợp hai bài toán:
1. **Nguyên tắc xuất kho FEFO (*First-Expired, First-Out* — Hết hạn trước, Xuất trước):** Khi xuất bán tại quầy POS hoặc xuất điều chuyển nội bộ, hệ thống bắt buộc trừ tồn từ các lô khả dụng (`AVAILABLE`) có ngày hết hạn sớm nhất trước, đồng thời **chặn tuyệt đối** việc xuất bán các lô đã quá hạn hoặc đang bị cách ly (`QUARANTINE`).
2. **Dự báo nhu cầu ngắn hạn bằng AI (*Demand Forecasting*):** Mô hình học máy (huấn luyện và đánh giá trên bộ dữ liệu chuẩn M5 Forecasting) dự báo tổng nhu cầu tiêu thụ của từng mặt hàng (SKU) tại từng chi nhánh trong tầm nhìn ngắn hạn $H = 14\text{ ngày}$.

Chức năng **FEFO × AI** kết hợp kết quả dự báo nhu cầu 14 ngày với danh sách tồn kho theo lô hiện có để:
- **Mô phỏng lượng hàng có thể bán kịp trước ngày hết hạn** của từng lô theo đúng thứ tự hàng đợi FEFO (không phân bổ trùng nhu cầu giữa các lô, không để phần tồn dư đã hết hạn của lô trước chiếm nhu cầu của lô sau).
- **Xác định số lượng có nguy cơ dư thừa trước hạn (`atRiskQuantity`)** đối với các lô có hạn sử dụng nằm trong tầm nhìn dự báo ($d_i \le H$).
- **Đề xuất các phương án xử lý có điều kiện dựa trên quy tắc nghiệp vụ cấu hình** (giảm giá bậc thang tham khảo, gợi ý cân nhắc chương trình mua kèm/Mua 1 tặng 1, điều chuyển nội bộ sang chi nhánh có sức mua dự báo cao hơn, hoặc khóa lô quá hạn để lập biên bản hủy).

---

## 2. Phân loại rõ 3 nhóm công thức và quy tắc trong hệ thống

Để đảm bảo tính trung thực khoa học khi bảo vệ trước Hội đồng Khóa luận, hệ thống phân biệt rõ 3 nhóm cơ sở:

| Nhóm phân loại | Nội dung thuộc nhóm | Bản chất khoa học / kỹ thuật |
| :--- | :--- | :--- |
| **Nhóm 1: Phương pháp có nguồn học thuật & tiêu chuẩn quốc tế** | - Nguyên tắc xuất kho FEFO theo thứ tự hạn dùng.<br>- Dự báo chuỗi thời gian theo tầm nhìn hữu hạn ($H = 14\text{ ngày}$) trên bộ dữ liệu M5.<br>- Ước lượng mức tồn kho an toàn (*Safety Stock*) từ phân vị thực nghiệm P95 của sai số dự báo (*Backtest Calibration*) hoặc cấu hình tạm thời khi thiếu mẫu. | Dựa trên tài liệu chuẩn của WHO, GS1, giáo trình *Forecasting: Principles and Practice* (Hyndman & Athanasopoulos) và bài toán chuẩn M5 Forecasting. |
| **Nhóm 2: Công thức suy ra từ phương trình cân bằng tồn kho (*Inventory Balance Identities*)** | - Khấu trừ nhu cầu lũy kế theo hàng đợi FEFO giữa nhiều lô liên tiếp.<br>- Công thức lượng bán kịp trước hạn ($S_i$) và lượng nguy cơ dư ($R_i$).<br>- Công thức tính tồn khả dụng vượt mức an toàn tại kho nguồn ($T_{\text{source}}$) và sức hấp thụ ròng tại kho nhận ($C_{\text{dest}}$) sau khi trừ thời gian vận chuyển và các lô FEFO cạnh tranh tại kho nhận.<br>- Công thức tính thiếu hụt ròng (`shortageQuantity`) và điểm đặt hàng trong thời gian chờ giao hàng (`leadTimeNeed`). | Là các đẳng thức/bất đẳng thức bảo toàn vật chất (không âm, không vượt tồn lô, không phân bổ trùng cầu). Hoàn toàn kiểm chứng được bằng toán sơ cấp và unit test. |
| **Nhóm 3: Quy tắc nghiệp vụ cấu hình (*Configurable Heuristic Policy Rules*)** | - Các ngưỡng phân loại mức độ ưu tiên (`CRITICAL` $\le 7$ ngày, `HIGH` $\le 14$ ngày).<br>- Bảng bậc giảm giá tham khảo ($35\%, 25\%, 15\%, 10\%$).<br>- Ngưỡng gợi ý cân nhắc chương trình Mua kèm / Mua 1 tặng 1 ($\le 10$ ngày hoặc tỷ lệ dư $\ge 45\%$).<br>- Tham số điều chuyển nội bộ: hệ số chênh lệch tốc độ cầu $\ge 1{,}4\text{ lần}$ (tối thiểu $2\text{ đv/ngày}$), thời gian vận chuyển nội bộ $L_{\text{transit}} = 2\text{ ngày}$, lượng chuyển tối thiểu $3\text{ đv}$. | Là **tham số chính sách vận hành** được khai báo tập trung tại `FEFO_POLICY_CONFIG` để quản lý cửa hàng tham khảo. **Hệ thống KHÔNG khẳng định đây là các ngưỡng tối ưu toán học và KHÔNG khẳng định mô hình AI đã học được độ co giãn giá/khuyến mãi.** |

---

## 3. Bảng tổng hợp ký hiệu, công thức, đầu vào, đầu ra và giới hạn áp dụng

### 3.1. Bảng ký hiệu và đơn vị tính

| Ký hiệu | Tên biến trong code | Ý nghĩa | Đơn vị tính |
| :---: | :--- | :--- | :---: |
| $H$ | `horizonDays` | Tầm nhìn dự báo của lượt chạy mô hình AI (mặc định $14$) | Ngày |
| $\hat{Y}_H$ | `predictedHorizonDemand` | Tổng nhu cầu dự báo của SKU tại chi nhánh trong $H$ ngày | Đơn vị SP (đv) |
| $r$ | `dailyForecastRate` | Tốc độ tiêu thụ dự báo bình quân mỗi ngày (giả định phân bổ đều trong $H$ ngày) | đv / ngày |
| $N$ | `lots.length` | Số lượng lô của cùng một SKU tại một kho (đã sắp xếp theo hạn dùng tăng dần) | Lô |
| $Q_i$ | `lotQuantity` | Số lượng tồn hiện tại của lô thứ $i$ ($i \in \{1, \dots, N\}$) | đv |
| $d_i$ | `daysRemaining` | Số ngày còn lại tính từ đầu ngày hôm nay (múi giờ `Asia/Ho_Chi_Minh`) đến ngày hết hạn của lô $i$ | Ngày |
| $w_i$ | `evaluatedDays` | Số ngày bán thực tế trong tầm nhìn dùng để đánh giá lô $i$ | Ngày |
| $D(w_i)$ | `cumulativeDemandAtWindow` | Tổng nhu cầu dự báo tích lũy từ hôm nay đến hết cửa sổ đánh giá $w_i$ | đv |
| $C_{i-1}$ | `priorConsumedDemand` | Tổng nhu cầu đã được các lô đứng trước ($1 \dots i-1$) thực sự tiêu thụ | đv |
| $D^{\text{rem}}_i$ | `remainingDemandForLot` | Nhu cầu dự báo còn lại dành cho lô $i$ sau khi trừ các lô hạn sớm hơn | đv |
| $S_i$ | `projectedSoldBeforeExpiry` | Số lượng dự kiến bán kịp trước khi lô $i$ hết hạn (trong tầm nhìn $H$) | đv |
| $R_i$ | `atRiskQuantity` | Số lượng có nguy cơ dư thừa trước hạn của lô $i$ | đv |
| $u_i$ | `unsoldRatio` | Tỷ lệ nguy cơ dư trên tổng tồn của lô $i$ | Tỷ lệ $[0, 1]$ |
| $c, p$ | `costPrice`, `sellingPrice` | Giá vốn nhập kho và giá bán lẻ niêm yết trên 1 đơn vị SKU | VNĐ / đv |
| $\delta_i$ | `suggestedDiscountPercent` | Phần trăm giảm giá tham khảo theo quy tắc bậc thang | $\%$ |
| $p^{\text{disc}}_i$ | `discountedPrice` | Đơn giá bán lẻ sau khi áp dụng mức giảm tham khảo $\delta_i$ | VNĐ / đv |
| $V^{\text{risk}}_i$ | `atRiskValue` | Giá trị vốn nhập kho của phần hàng có nguy cơ dư | VNĐ |
| $V^{\text{rec}}_i$ | `recoverableValue` | Doanh thu thu hồi ước tính (trên biên có điều kiện) nếu bán hết lượng $R_i$ ở giá giảm $p^{\text{disc}}_i$ | VNĐ |

---

### 3.2. Chi tiết từng công thức trong hệ thống

#### Công thức 1: Quy tắc mốc ngày hết hạn đồng nhất với POS (`warehouseToday`, `expired`, `daysRemaining`)
- **File cài đặt:** [`lot-stock.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/inventory/lot-stock.ts#L5-L7), [`forecasts.service.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/forecasts.service.ts#L569)
- **Biểu thức toán học:**
  $$t_{\text{today}} = \text{00:00:00 UTC của ngày hiện tại theo múi giờ Asia/Ho\_Chi\_Minh}$$
  $$d_i = \left\lceil \frac{t_{\text{expires}, i} - t_{\text{today}}}{86.400.000\text{ ms}} \right\rceil$$
  $$\text{expired}(t_{\text{expires}, i}) \iff t_{\text{expires}, i} < t_{\text{today}} \iff d_i < 0$$
- **Đầu vào:** Ngày hết hạn của lô $t_{\text{expires}, i}$ và thời điểm hiện tại.
- **Đầu ra:** Số nguyên $d_i$ (ngày) và trạng thái quá hạn boolean.
- **Quy tắc nghiệp vụ đồng nhất với POS:**
  - Khi $d_i < 0$: Lô đã quá hạn, bị chặn xuất hoàn toàn tại POS (`takeLots`) và không được phân bổ nhu cầu ($S_i = 0, R_i = Q_i$).
  - Khi $d_i = 0$ (đúng ngày hết hạn in trên bao bì): Lô vẫn được phép bán tại POS cho đến hết ngày hôm đó, tương đương $w_i = 1$ ngày bán cuối cùng.

---

#### Công thức 2: Tốc độ cầu dự báo theo ngày dưới giả định phân bổ đều (`dailyForecastRate`)
- **File cài đặt:** [`fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts#L102-L109)
- **Phân loại:** Nhóm 1 (Dự báo chuỗi thời gian) + Giả định mô phỏng phân bổ đều.
- **Biểu thức toán học:**
  $$r = \begin{cases} \dfrac{\hat{Y}_H}{\max(1, H)} & \text{nếu } \text{hasForecastRun} = \text{true} \text{ và } \text{dataQuality} \in \{\text{SUFFICIENT}, \text{SPARSE}\} \\ 0 & \text{ngược lại} \end{cases}$$
- **Đầu vào:** Tổng cầu dự báo $\hat{Y}_H$ (đv), tầm nhìn $H$ (ngày), cờ `hasForecastRun`, `dataQuality`.
- **Đầu ra:** $r \ge 0$ (đv/ngày).
- **Giả định & Giới hạn áp dụng:**
  - Do mô hình AI lưu tổng nhu cầu dự báo cho cả kỳ $H = 14\text{ ngày}$ (`predictedQuantity`), hệ thống sử dụng **giả định phân bổ đều theo ngày** ($r = \hat{Y}_H / H$) để mô phỏng tiêu thụ theo ngày.
  - Nếu SKU chưa được chạy dự báo (`NO_FORECAST_RUN`) hoặc không có lịch sử bán (`NO_SALES`), hệ thống đặt `hasValidForecast = false` và **không tự bịa số liệu dự báo** cũng như **không kết luận lô bị dư thừa giả** ($R_i = 0$).

---

#### Công thức 3: Mô phỏng phân bổ FEFO tuần tự theo lô và khấu trừ nhu cầu lũy kế (`projectedSoldBeforeExpiry`)
- **File cài đặt:** [`fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts#L196-L203)
- **Phân loại:** Nhóm 1 (FEFO) + Nhóm 2 (Cân bằng tồn kho theo thời gian).
- **Biểu thức toán học:**
  Với danh sách các lô khả dụng (`AVAILABLE` và $d_i \ge 0$) đã sắp xếp theo thứ tự hạn dùng tăng dần ($d_1 \le d_2 \le \dots \le d_N$):
  1. Cửa sổ ngày bán được đánh giá trong tầm nhìn dự báo $H$:
     $$w_i = \begin{cases} 1 & \text{nếu } d_i = 0 \\ \min(d_i, H) & \text{nếu } d_i > 0 \end{cases}$$
  2. Tổng nhu cầu dự báo tích lũy từ hiện tại đến hết ngày $w_i$:
     $$D(w_i) = \lfloor r \times w_i \rfloor$$
  3. Nhu cầu còn lại dành cho lô $i$ sau khi trừ đi tổng lượng hàng **thực sự bán được** của các lô đứng trước ($C_{i-1}$):
     $$D^{\text{rem}}_i = \max\big(0,\; D(w_i) - C_{i-1}\big)$$
  4. Lượng hàng của lô $i$ dự kiến bán kịp trước hạn (trong tầm nhìn $H$):
     $$S_i = \min\big(Q_i,\; D^{\text{rem}}_i\big)$$
  5. Cập nhật tổng nhu cầu đã tiêu thụ lũy kế cho lô tiếp theo:
     $$C_i = C_{i-1} + S_i \quad (\text{với } C_0 = 0)$$
- **Tính chất toán học bắt buộc (Invariants):**
  - Không âm và không vượt tồn lô: $0 \le S_i \le Q_i$.
  - Không phân bổ trùng nhu cầu giữa các lô: $\sum_{k=1}^{i} S_k = C_i \le D(w_i)$.
  - Không trừ nhầm phần hàng hết hạn của lô trước: Nếu lô 1 ($d_1 = 4$) có $Q_1 = 20$ nhưng trong 4 ngày đầu chỉ bán được $S_1 = 8$ (còn $12\text{ đv}$ hết hạn sau ngày thứ 4), thì từ ngày thứ 5 đến ngày thứ 10, lô 2 ($d_2 = 10$) vẫn nhận trọn vẹn nhu cầu của giai đoạn ngày $5 \dots 10$ là $D(10) - C_1 = 20 - 8 = 12\text{ đv}$.

---

#### Công thức 4: Số lượng có nguy cơ dư trước hạn (`atRiskQuantity`) và kiểm soát tầm nhìn dự báo (`beyondHorizon`)
- **File cài đặt:** [`fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts#L196-L208)
- **Phân loại:** Nhóm 2 (Cân bằng tồn kho có ràng buộc tầm nhìn dự báo).
- **Biểu thức toán học:**
  $$\text{beyondHorizon}_i \iff d_i > H$$
  $$R_i = \begin{cases} Q_i & \text{nếu } d_i < 0 \text{ hoặc } \text{status}_i \neq \text{AVAILABLE} \\ 0 & \text{nếu } \neg\text{hasValidForecast} \text{ hoặc } d_i > H \\ \max(0,\; Q_i - S_i) & \text{nếu } \text{hasValidForecast} \text{ và } 0 \le d_i \le H \end{cases}$$
  $$u_i = \begin{cases} \dfrac{R_i}{Q_i} & \text{nếu } Q_i > 0 \\ 0 & \text{nếu } Q_i = 0 \end{cases}, \qquad V^{\text{risk}}_i = R_i \times c$$
- **Giới hạn áp dụng quan trọng:**
  - Khi $d_i > H$ (ví dụ lô còn $25\text{ ngày}$ trong khi mô hình chỉ dự báo $H = 14\text{ ngày}$), hệ thống gắn cờ `allocationStatus = 'BEYOND_FORECAST_HORIZON'`, `beyondHorizon = true` và đặt $R_i = 0$. Hệ thống **tuyệt đối không ngoại suy tuyến tính** dự báo 14 ngày ra 30–90 ngày để kết luận chắc chắn lô hàng sẽ ế.

---

#### Công thức 5: Quy tắc bậc giảm giá tham khảo và gợi ý khuyến mãi có điều kiện (`suggestedDiscountPercent`, `conditionalComboSuggestion`)
- **File cài đặt:** [`fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts#L16-L33), [`fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts#L210-L231)
- **Phân loại:** **Nhóm 3 — Quy tắc nghiệp vụ cấu hình (`RULE_BASED_POLICY`)**.
- **Biểu thức quy tắc (khi $R_i > 0$ và $0 \le d_i \le H$):**
  $$\delta_i = \begin{cases} 35\% & \text{nếu } 0 \le d_i \le 7 \\ 25\% & \text{nếu } 7 < d_i \le 14 \\ 15\% & \text{nếu } 14 < d_i \le 21 \\ 10\% & \text{nếu } d_i > 21 \end{cases}$$
  $$p^{\text{disc}}_i = \text{round}\!\left(p \times \left(1 - \frac{\delta_i}{100}\right)\right), \qquad V^{\text{rec}}_i = R_i \times p^{\text{disc}}_i$$
  $$\text{conditionalComboSuggestion}_i \iff (R_i > 0) \land \big(d_i \le 10 \;\lor\; u_i \ge 0{,}45\big)$$
- **Ghi chú bắt buộc khi giải trình:**
  - Các ngưỡng $7, 10, 14, 21\text{ ngày}$, tỷ lệ dư $45\%$ và các mức giảm $15\%\text{--}35\%$ là **tham số cấu hình chính sách bán lẻ** (`FEFO_POLICY_CONFIG`), có thể điều chỉnh theo biên lợi nhuận từng ngành hàng.
  - Gợi ý Mua kèm / Mua 1 tặng 1 là **đề xuất có điều kiện dựa trên quy tắc**, **không phải** kết quả mô hình AI học được độ co giãn khuyến mãi (*price/promotion elasticity*), và hệ thống **không khẳng định** chương trình này chắc chắn làm tăng gấp đôi tốc độ bán.

---

#### Công thức 6: Đánh giá điều chuyển nội bộ xả lô cận hạn (`evaluateFefoTransferCandidate`)
- **File cài đặt:** [`fefo-simulation.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.ts#L257-L364)
- **Phân loại:** Nhóm 2 (Cân bằng tồn kho & FEFO tại kho nguồn + kho nhận) kết hợp Nhóm 3 (Tham số vận chuyển & ngưỡng tốc độ cầu).
- **Biểu thức toán học:**
  Xét việc điều chuyển một phần lô cận hạn từ kho nguồn $A$ sang kho nhận $B$:
  1. **Tồn khả dụng vượt mức an toàn tại kho nguồn $A$:**
     $$T_{\text{source}} = \max\big(0,\; \text{onHand}_A - \text{reserved}_A - Q^{\text{blocked}}_A - \text{safetyStock}_A - Q^{\text{committedOut}}_A\big)$$
     $$Q^{\text{maxFromSource}} = \min\big(R_i,\; Q_i,\; T_{\text{source}}\big)$$
  2. **Số ngày còn lại để bán tại kho nhận $B$ sau thời gian vận chuyển $L_{\text{transit}} = 2\text{ ngày}$ (trong tầm nhìn $H$):**
     $$w_{\text{dest}} = \max\big(0,\; \min(d_i, H) - L_{\text{transit}}\big)$$
  3. **Điều kiện ngưỡng tốc độ cầu tại kho nhận $B$ (tham số cấu hình):**
     Kho $B$ phải có dự báo hợp lệ (`destinationHasValidForecast = true`) và tốc độ cầu dự báo $r_B$ thỏa mãn:
     $$r_B \ge \max\big(2{,}0,\; 1{,}4 \times r_A\big)$$
  4. **Khấu trừ tồn FEFO cạnh tranh tại kho nhận $B$ (`destinationCompetingStockBeforeExpiry`):**
     Gọi $Q^{\text{comp}}_B$ là tổng lượng tồn của các lô `AVAILABLE` tại kho $B$ có hạn sử dụng **sớm hơn hoặc bằng** lô đang xét ($t_{\text{expires}, B} \le t_{\text{expires}, i}$) cộng với lượng hàng đang trên đường chuyển đến kho $B$ (`incoming` + `committedIn`). Theo nguyên tắc FEFO tại kho $B$, các lô này sẽ được ưu tiên bán trước hoặc cùng lúc với lô chuyển đến:
     - Lượng tồn cạnh tranh kho $B$ tự tiêu thụ trong $L_{\text{transit}}$ ngày chờ hàng tới:
       $$D^{\text{transit}}_B = \lfloor r_B \times L_{\text{transit}} \rfloor$$
     - Lượng tồn cạnh tranh còn lại tại kho $B$ vào ngày hàng điều chuyển tới nơi:
       $$Q^{\text{comp,rem}}_B = \max\big(0,\; Q^{\text{comp}}_B - D^{\text{transit}}_B\big)$$
     - Sức hấp thụ ròng của kho $B$ trong $w_{\text{dest}}$ ngày còn lại trước hạn:
       $$C_{\text{dest}} = \max\big(0,\; \lfloor r_B \times w_{\text{dest}} \rfloor - Q^{\text{comp,rem}}_B\big)$$
  5. **Số lượng đề xuất điều chuyển (`absorbableQuantity`):**
     $$Q_{\text{transfer}} = \min\big(Q^{\text{maxFromSource}},\; C_{\text{dest}}\big)$$
     Đề xuất hợp lệ (`eligible = true`) khi $Q_{\text{transfer}} \ge \min(R_i, 3)$.

---

#### Công thức 7: Cân bằng thiếu hụt (`assessShortage`), Thời điểm cung ứng (`supplyTiming`) và Kế hoạch bổ sung (`planReplenishment`)
- **File cài đặt:** [`shortage-rule.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/shortage-rule.ts), [`supply-timing.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/supply-timing.ts), [`recommendation-plan.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/recommendation-plan.ts)
- **Phân loại:** Nhóm 2 (Cân bằng tồn kho chuẩn trong Quản trị chuỗi cung ứng).
- **Biểu thức toán học:**
  1. **Thiếu hụt ròng trong tầm nhìn dự báo (`assessShortage`):**
     $$\text{required} = \hat{Y}_H + \text{safetyStock}$$
     $$\text{plannedSupply} = \text{available} + \text{inTransfer} + \text{incomingPurchase}$$
     $$\text{shortageQuantity} = \max(0,\; \text{required} - \text{plannedSupply})$$
  2. **Nhu cầu trong thời gian chờ giao hàng của nhà cung cấp (`supplyTiming`):**
     Với thời gian giao hàng $L_{\text{supplier}} \le H$ và tổng hàng đang về trước ngày $L_{\text{supplier}}$ là $R_{< L}$:
     $$\text{leadTimeNeed} = \max\Big(0,\; \big\lceil r \times L_{\text{supplier}} + \text{safetyStock} - \text{available} - R_{< L} \big\rceil\Big)$$
     $$\text{suggestedPacks} = \left\lceil \frac{\text{shortageQuantity}}{\text{packSize}} \right\rceil, \qquad \text{roundedPurchaseQuantity} = \text{suggestedPacks} \times \text{packSize}$$
  3. **Kế hoạch ưu tiên điều chuyển nội bộ trước khi đặt mua NCC (`planReplenishment`):**
     Sắp xếp các kho có tồn dư khả dụng giảm dần theo `surplus`, phân bổ tối đa $\min(\text{remaining}, \text{surplus}_k)$ cho từng kho, phần thiếu hụt còn lại mới đưa vào `purchaseQuantity` để đặt nhà cung cấp.

---

## 4. Căn cứ lý thuyết và nguồn tham khảo chính thức

Hệ thống sử dụng đúng phạm vi kiến thức được nêu trong 4 nguồn tài liệu chuẩn dưới đây (không tự gán ghép các quy tắc heuristic nội bộ vào nguồn học thuật):

1. **Tổ chức Y tế Thế giới (WHO) — *Warehouse and Stock Management (FEFO Principle)*:**
   - Đường dẫn: https://emanual.who.int/p17new/s09/Pages/9-3-4-Warehouse-and-Stock-Management.aspx
   - **Nội dung áp dụng:** Quy định nguyên tắc quản lý kho đối với hàng hóa có hạn sử dụng là **FEFO (*First-Expired, First-Out*)** — lô có ngày hết hạn gần nhất phải được xếp ở vị trí ưu tiên xuất trước, và các lô đã hết hạn phải được tách khỏi tồn kho khả dụng, chuyển sang khu vực cách ly chờ hủy để tuyệt đối không xuất nhầm cho người tiêu dùng.
   - **Ánh xạ vào dự án:** Hàm `takeLots()` trong [`lot-stock.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/inventory/lot-stock.ts#L20-L37) truy vấn lô theo `orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]`, chỉ lấy `status === 'AVAILABLE' && !expired(expiresAt)`, và ném lỗi `409 LOT_STOCK_UNAVAILABLE` ngay tại tầng giao dịch `Serializable` của Backend nếu không đủ lô còn hạn.

2. **Tổ chức Mã số Mã vạch Quốc tế (GS1) — *2D in Retail Systems Playbook*:**
   - Đường dẫn: https://ref.gs1.org/sme-guidance/2d-retail-systems-playbook/
   - **Nội dung áp dụng:** Hướng dẫn hệ thống POS và quản lý tồn kho bán lẻ sử dụng thông tin mã định danh sản phẩm (GTIN/SKU), số lô (*Batch/Lot Number*) và ngày hết hạn (*Expiry Date*) để: (a) ngăn chặn việc bán sản phẩm đã quá hạn tại quầy thu ngân (POS), và (b) hỗ trợ chương trình giảm giá hàng cận hạn (*markdown/wastage reduction*) và luân chuyển tồn kho chính xác theo lô.
   - **Ánh xạ vào dự án:** Quầy POS kiểm tra hạn dùng theo lô trước khi hoàn tất hóa đơn (`invoices.service.ts`), đồng thời phân hệ Lô & Hạn dùng (`lo-han-dung/page.tsx`) theo dõi từng mã lô kèm ngày hết hạn để cảnh báo sớm.

3. **Cuộc thi & Bộ dữ liệu chuẩn M5 Forecasting — *Accuracy (Walmart Retail Sales Dataset)*:**
   - Đường dẫn: https://www.kaggle.com/c/m5-forecasting-accuracy/data
   - **Nội dung áp dụng:** Cung cấp chuỗi thời gian doanh số bán lẻ theo ngày phân cấp theo Cửa hàng (*Store*) và Mặt hàng (*Item/SKU*) thuộc các nhóm ngành hàng thực phẩm (`FOODS`), tiêu dùng gia đình (`HOUSEHOLD`), v.v. Đây là dữ liệu lịch sử dùng để huấn luyện và kiểm định mô hình dự báo nhu cầu ngắn hạn trong dự án.
   - **Giới hạn trung thực:** Bộ dữ liệu M5 chỉ dùng cho bài toán **dự báo nhu cầu số lượng bán (*Demand Forecasting*)**; bộ dữ liệu M5 **không có** thông tin hạn sử dụng theo lô và **không dùng** để huấn luyện mô hình tối ưu hóa khuyến mãi BOGO. Phần phân bổ lô FEFO và quy tắc gợi ý xử lý được thực hiện bởi tầng thuật toán cân bằng tồn kho và quy tắc cấu hình tại Backend SQL Server.

4. **Rob J. Hyndman & George Athanasopoulos — *Forecasting: Principles and Practice (FPP2), The Forecaster's Toolbox*:**
   - Đường dẫn: https://otexts.robjhyndman.com/fpp2/toolbox.html
   - **Nội dung áp dụng:** Nguyên lý đánh giá dự báo trong một tầm nhìn dự báo xác định (*Forecast Horizon* $H$), phân tách dữ liệu huấn luyện/kiểm định theo thời gian (*Time-series cross-validation / backtesting*), và độ bất định của dự báo tăng lên khi vượt ra ngoài tầm nhìn đã kiểm định.
   - **Ánh xạ vào dự án:** Hệ thống cố định tầm nhìn đánh giá $H = 14\text{ ngày}$, ước lượng tồn an toàn từ phân vị P95 của sai số backtest (`BACKTEST_P95`), và **không ngoại suy kết luận dư thừa cho các lô có $d_i > H$** (`BEYOND_FORECAST_HORIZON`).

---

## 5. Ví dụ số tính tay cụ thể (Đối chiếu trùng khớp 100% với Unit Test)

Tất cả 7 ví dụ tính tay dưới đây đã được mã hóa thành các ca kiểm thử tự động trong [`backend/src/modules/forecasts/fefo-simulation.test.ts`](file:///c:/Users/duong/Hoc/DATN/ProjectDATN/backend/src/modules/forecasts/fefo-simulation.test.ts).

### Ví dụ 1: Đánh giá 1 lô cận hạn trong tầm nhìn 14 ngày
- **Đầu vào:**
  - Dự báo 14 ngày của SKU tại kho: $\hat{Y}_{14} = 28\text{ đv}$, $H = 14\text{ ngày}$, `dataQuality = 'SUFFICIENT'`.
  - Lô `LOT-001`: tồn $Q_1 = 15\text{ đv}$, trạng thái `AVAILABLE`, còn $d_1 = 5\text{ ngày}$ hết hạn, giá vốn $c = 25.000\text{ đ}$, giá bán lẻ $p = 40.000\text{ đ}$.
- **Các bước tính tay:**
  1. Tốc độ tiêu thụ dự báo bình quân ngày:
     $$r = \frac{28}{14} = 2{,}0\text{ đv/ngày}$$
  2. Vì $0 < d_1 = 5 \le 14$, cửa sổ đánh giá là $w_1 = 5\text{ ngày}$ (`beyondHorizon = false`).
  3. Tổng nhu cầu dự báo trong 5 ngày tới:
     $$D(5) = \lfloor 2{,}0 \times 5 \rfloor = 10\text{ đv}$$
  4. Không có lô nào hết hạn sớm hơn ($C_0 = 0$), nên lượng dự kiến bán kịp trước hạn là:
     $$S_1 = \min(15,\; 10 - 0) = 10\text{ đv}$$
  5. Số lượng có nguy cơ dư trước hạn:
     $$R_1 = \max(0,\; 15 - 10) = 5\text{ đv}$$
  6. Tỷ lệ nguy cơ dư và giá trị vốn có nguy cơ dư:
     $$u_1 = \frac{5}{15} \approx 0{,}3333\;(33{,}33\%), \qquad V^{\text{risk}}_1 = 5 \times 25.000 = 125.000\text{ đ}$$
  7. Quy tắc bậc giảm giá tham khảo (do $d_1 = 5 \le 7$):
     $$\delta_1 = 35\%, \qquad p^{\text{disc}}_1 = \text{round}(40.000 \times 0{,}65) = 26.000\text{ đ}, \qquad V^{\text{rec}}_1 = 5 \times 26.000 = 130.000\text{ đ}$$
  8. Quy tắc gợi ý cân nhắc khuyến mãi có điều kiện: vì $d_1 = 5 \le 10$ nên `conditionalComboSuggestion = true`, `riskLevel = 'CRITICAL'`.

---

### Ví dụ 2: Phân bổ FEFO cho 2 lô liên tiếp (Chứng minh không tính trùng cầu và không trừ nhầm phần hết hạn của lô trước)
- **Đầu vào:**
  - Cùng SKU có $\hat{Y}_{14} = 28\text{ đv}$, $H = 14\text{ ngày} \implies r = 2{,}0\text{ đv/ngày}$.
  - **Lô 1 (`LOT-EARLY`):** $Q_1 = 20\text{ đv}$, hết hạn sau $d_1 = 4\text{ ngày}$.
  - **Lô 2 (`LOT-LATER`):** $Q_2 = 15\text{ đv}$, hết hạn sau $d_2 = 10\text{ ngày}$.
- **Các bước tính tay:**
  - **Xét Lô 1 ($d_1 = 4\text{ ngày}$):**
    - Tổng cầu trong 4 ngày đầu: $D(4) = \lfloor 2{,}0 \times 4 \rfloor = 8\text{ đv}$.
    - Lượng bán dự kiến của Lô 1: $S_1 = \min(20,\; 8 - 0) = 8\text{ đv}$.
    - Lượng nguy cơ dư của Lô 1: $R_1 = \max(0,\; 20 - 8) = 12\text{ đv}$.
    - **Điểm mấu chốt:** Lượng cầu thực tế mà Lô 1 đã tiêu thụ là $C_1 = S_1 = 8\text{ đv}$ (chứ **không phải** $Q_1 = 20\text{ đv}$, vì 12 đv dư của Lô 1 sẽ hết hạn sau ngày thứ 4 và bị chặn bán tại POS từ ngày thứ 5).
  - **Xét Lô 2 ($d_2 = 10\text{ ngày}$):**
    - Tổng cầu tích lũy trong 10 ngày: $D(10) = \lfloor 2{,}0 \times 10 \rfloor = 20\text{ đv}$.
    - Nhu cầu còn lại cho Lô 2 (chính là nhu cầu của các ngày $5 \dots 10$):
      $$D^{\text{rem}}_2 = \max(0,\; D(10) - C_1) = 20 - 8 = 12\text{ đv}$$
    - Lượng bán dự kiến của Lô 2: $S_2 = \min(15,\; 12) = 12\text{ đv}$.
    - Lượng nguy cơ dư của Lô 2: $R_2 = \max(0,\; 15 - 12) = 3\text{ đv}$.
  - **Kiểm tra bảo toàn tổng cầu:** $S_1 + S_2 = 8 + 12 = 20\text{ đv} = D(10)$ (không tính trùng bất kỳ đơn vị cầu nào giữa Lô 1 và Lô 2).

---

### Ví dụ 3: Đồng nhất mốc hết hạn với POS ($d_i = 0$ so với $d_i = -1$)
- **Đầu vào:** Dự báo $\hat{Y}_{14} = 42\text{ đv} \implies r = 3{,}0\text{ đv/ngày}$.
  - Lô A (`LOT-EXP`): $Q_A = 10\text{ đv}$, $d_A = -1\text{ ngày}$ (quá hạn 1 ngày).
  - Lô B (`LOT-TODAY`): $Q_B = 5\text{ đv}$, $d_B = 0\text{ ngày}$ (hết hạn vào cuối ngày hôm nay).
- **Tính tay:**
  - Lô A ($d_A = -1 < 0$): Bị khóa theo quy tắc POS $\implies S_A = 0$, $R_A = 10\text{ đv}$, `allocationStatus = 'EXPIRED_OR_QUARANTINED'`, không tiêu thụ cầu ($C_1 = 0$).
  - Lô B ($d_B = 0$): Còn bán được tại POS đến hết ngày hôm nay ($w_B = 1\text{ ngày}$) $\implies D(1) = 3\text{ đv}$, $S_B = \min(5, 3) = 3\text{ đv}$, $R_B = 5 - 3 = 2\text{ đv}$.

---

### Ví dụ 4: Kiểm soát giới hạn tầm nhìn dự báo ($d_i = 25 > H = 14$)
- **Đầu vào:** Dự báo $\hat{Y}_{14} = 14\text{ đv} \implies r = 1{,}0\text{ đv/ngày}$, $H = 14\text{ ngày}$. Lô `LOT-FAR` có $Q = 40\text{ đv}$, còn $d = 25\text{ ngày}$.
- **Tính tay:**
  - Vì $d = 25 > 14$, hệ thống chỉ mô phỏng trong cửa sổ $w = \min(25, 14) = 14\text{ ngày}$ đầu tiên: $S = \min(40, 14) = 14\text{ đv}$.
  - Do $11\text{ ngày}$ còn lại (từ ngày 15 đến ngày 25) nằm ngoài tầm nhìn dự báo 14 ngày, hệ thống đặt `beyondHorizon = true`, `allocationStatus = 'BEYOND_FORECAST_HORIZON'` và $R = 0$ (không báo động giả).

---

### Ví dụ 5: Đánh giá điều chuyển nội bộ có trừ tồn an toàn kho nguồn, 2 ngày vận chuyển và tồn FEFO cạnh tranh tại kho nhận
- **Đầu vào:**
  - **Kho nguồn A:** Lô đang xét có $Q_i = 20\text{ đv}$, nguy cơ dư $R_i = 12\text{ đv}$, còn $d_i = 9\text{ ngày}$ ($H = 14$), tốc độ cầu dự báo $r_A = 1{,}0\text{ đv/ngày}$.
  - Tồn kho tổng của SKU tại Kho A: `onHand` $= 30$, `reserved` $= 2$, `blocked` $= 0$, `safetyStock` $= 10$, `committedOut` $= 3$.
  - **Kho nhận B:** Có dự báo hợp lệ với tốc độ cầu $r_B = 3{,}0\text{ đv/ngày}$. Hiện tại Kho B đang có các lô FEFO có hạn dùng sớm hơn hoặc bằng lô đang xét với tổng lượng $Q^{\text{comp}}_B = 16\text{ đv}$. Thời gian vận chuyển $L_{\text{transit}} = 2\text{ ngày}$.
- **Các bước tính tay:**
  1. Lượng tồn vượt mức an toàn có thể rút khỏi Kho nguồn A:
     $$T_{\text{source}} = \max(0,\; 30 - 2 - 0 - 10 - 3) = 15\text{ đv}$$
     $$Q^{\text{maxFromSource}} = \min(R_i = 12,\; Q_i = 20,\; T_{\text{source}} = 15) = 12\text{ đv}$$
  2. Kiểm tra ngưỡng tốc độ cầu tại Kho nhận B:
     $$\min\text{Rate} = \max(2{,}0,\; 1{,}4 \times 1{,}0) = 2{,}0\text{ đv/ngày} \le r_B = 3{,}0\text{ đv/ngày}\;(\text{Đạt})$$
  3. Số ngày bán còn lại tại Kho B sau $2\text{ ngày}$ vận chuyển:
     $$w_{\text{dest}} = \min(9, 14) - 2 = 7\text{ ngày}$$
  4. Trong $2\text{ ngày}$ chờ hàng chuyển tới, Kho B tự bán được một phần tồn FEFO cạnh tranh của chính nó:
     $$D^{\text{transit}}_B = \lfloor 3{,}0 \times 2 \rfloor = 6\text{ đv} \implies Q^{\text{comp,rem}}_B = \max(0,\; 16 - 6) = 10\text{ đv}$$
  5. Sức hấp thụ ròng của Kho B trong 7 ngày sau khi hàng tới (sau khi đã ưu tiên bán hết $10\text{ đv}$ tồn FEFO cạnh tranh còn lại tại Kho B):
     $$C_{\text{dest}} = \max(0,\; \lfloor 3{,}0 \times 7 \rfloor - 10) = 21 - 10 = 11\text{ đv}$$
  6. Số lượng đề xuất điều chuyển:
     $$Q_{\text{transfer}} = \min\big(Q^{\text{maxFromSource}} = 12,\; C_{\text{dest}} = 11\big) = 11\text{ đv}$$

---

## 6. Giả định mô phỏng và các giới hạn hiện tại

1. **Giả định phân bổ đều nhu cầu trong tầm nhìn 14 ngày:**
   - Do bảng `Forecast` lưu tổng sản lượng dự báo 14 ngày (`predictedQuantity`), mô phỏng FEFO chia đều $r = \hat{Y}_{14} / 14$ cho từng ngày. Trong thực tế bán lẻ, sức mua cuối tuần có thể cao hơn ngày thường; tuy nhiên trong tầm nhìn ngắn 1–2 tuần, giả định phân bổ đều giúp công thức đơn giản, minh bạch và dễ kiểm chứng.
2. **Không ngoại suy ngoài tầm nhìn dự báo ($H = 14\text{ ngày}$):**
   - Đối với các lô có hạn sử dụng còn trên 14 ngày ($d_i > 14$), hệ thống chỉ hiển thị lượng dự kiến tiêu thụ trong 14 ngày đầu và gắn nhãn `BEYOND_FORECAST_HORIZON`, không kết luận số lượng dư thừa trước hạn.
3. **Chưa có mô hình học máy đo lường độ co giãn giá/khuyến mãi (*Price/Promotion Elasticity*):**
   - Bộ dữ liệu M5 và dữ liệu giao dịch nội bộ hiện tại chưa có lịch sử thực nghiệm A/B testing cho các chương trình giảm giá xả hàng cận hạn hoặc Mua 1 tặng 1. Do đó, các mức giảm giá ($15\%\text{--}35\%$) và gợi ý Mua kèm/Mua 1 tặng 1 được thiết kế dưới dạng **quy tắc chính sách cấu hình (`FEFO_POLICY_CONFIG`)**, không tự động nhân đôi nhu cầu dự báo.
4. **Ánh xạ dữ liệu M5 sang SKU vận hành:**
   - Chỉ những SKU đã có bản ghi dự báo hợp lệ trong `ForecastRun` với `dataQuality` là `SUFFICIENT` hoặc `SPARSE` mới được tính toán nguy cơ dư; các SKU mới tạo chưa có lịch sử bán (`NO_SALES`) hoặc chưa chạy dự báo (`NO_FORECAST_RUN`) được tách riêng trạng thái để không sinh cảnh báo giả.

---

## 7. Câu hỏi Hội đồng có thể hỏi & Câu trả lời ngắn gọn khi bảo vệ

### Câu hỏi 1: *"AI trong chức năng Lô & Hạn dùng thực chất làm gì? Có phải AI tự quyết định Mua 1 tặng 1 hay giảm giá 35% không?"*
> **Trả lời:**
> Thưa Hội đồng, không ạ. Em tách bạch rất rõ 2 phần trong kiến trúc:
> 1. **Phần AI (Machine Learning trên dữ liệu M5):** Chỉ làm nhiệm vụ **dự báo tổng nhu cầu tiêu thụ trong 14 ngày tới** (`predictedQuantity`) của từng SKU tại từng chi nhánh.
> 2. **Phần Cân bằng tồn kho FEFO & Quy tắc nghiệp vụ (`fefo-simulation.ts`):** Lấy nhu cầu dự báo đó phân bổ tuần tự cho các lô theo thứ tự hạn dùng tăng dần để tìm ra lượng có nguy cơ không bán kịp trước hạn (`atRiskQuantity`). Khi phát hiện `atRiskQuantity > 0`, các đề xuất như giảm giá 15%–35%, cân nhắc Mua 1 tặng 1 hoặc điều chuyển nội bộ là **quy tắc chính sách vận hành có cấu hình (`FEFO_POLICY_CONFIG`)**, không phải kết quả do mô hình AI tự học độ co giãn khuyến mãi.

### Câu hỏi 2: *"Nếu một sản phẩm có 2 lô cùng tồn kho (Lô 1 còn 4 ngày, Lô 2 còn 10 ngày), hệ thống tránh việc tính trùng nhu cầu dự báo cho cả 2 lô như thế nào?"*
> **Trả lời:**
> Thưa Hội đồng, hệ thống sắp xếp các lô theo `expiresAt` tăng dần và duy trì biến lũy kế `consumedDemandSoFar` ($C_{i-1}$).
> Ví dụ sức mua dự báo là $2\text{ đv/ngày}$, Lô 1 (còn 4 ngày, tồn 20 đv) chỉ bán tối đa được $S_1 = 8\text{ đv}$ trong 4 ngày đầu (còn 12 đv của Lô 1 sẽ hết hạn sau ngày thứ 4). Khi xét tiếp Lô 2 (còn 10 ngày), tổng cầu 10 ngày là $20\text{ đv}$, hệ thống trừ đi đúng $C_1 = 8\text{ đv}$ mà Lô 1 đã thực sự bán, nên Lô 2 nhận phần cầu của ngày 5 đến ngày 10 là $20 - 8 = 12\text{ đv}$. Nhờ đó vừa không bao giờ tính trùng nhu cầu, vừa không bị lỗi lấy 12 đv đã hết hạn của Lô 1 trừ lẹm vào sức mua của Lô 2.

### Câu hỏi 3: *"Mô hình AI chỉ dự báo 14 ngày, vậy với các lô còn hạn 30 ngày hay 60 ngày thì hệ thống tính `atRiskQuantity` thế nào?"*
> **Trả lời:**
> Thưa Hội đồng, theo nguyên lý dự báo chuỗi thời gian (Hyndman FPP2), hệ thống **không ngoại suy** tốc độ bán của 14 ngày ra 30 hay 60 ngày để kết luận chắc chắn lô hàng sẽ bị dư. Với mọi lô có `daysRemaining > horizonDays` (14 ngày), hệ thống gắn trạng thái `BEYOND_FORECAST_HORIZON` (`beyondHorizon = true`) và đặt `atRiskQuantity = 0`, chỉ hiển thị lượng dự kiến tiêu thụ trong 14 ngày đầu để theo dõi định kỳ.

### Câu hỏi 4: *"Khi đề xuất điều chuyển lô cận hạn sang chi nhánh khác, hệ thống có tính đến việc chi nhánh nhận cũng đang có sẵn các lô cận hạn của chính họ không?"*
> **Trả lời:**
> Dạ có ạ. Trong hàm `evaluateFefoTransferCandidate`, hệ thống truy vấn toàn bộ các lô `AVAILABLE` tại kho nhận có ngày hết hạn sớm hơn hoặc bằng lô đang xét (`destinationCompetingStockBeforeExpiry`), cộng với lượng hàng đang chuyển đến kho nhận. Sau khi trừ đi thời gian vận chuyển nội bộ (`transitDays = 2` ngày), kho nhận phải ưu tiên bán hết lượng tồn FEFO cạnh tranh của chính họ trước, phần sức cầu còn dư ra (`netDestinationCapacity`) mới được dùng để tính số lượng đề xuất điều chuyển. Đồng thời tại kho nguồn, hệ thống cũng giữ lại đủ `safetyStock`, `reserved` và các phiếu xuất đang chờ.

### Câu hỏi 5: *"Làm sao đảm bảo nhân viên thu ngân tại POS không cố tình hoặc vô tình bán lô đã hết hạn?"*
> **Trả lời:**
> Thưa Hội đồng, việc chặn bán lô hết hạn được thực thi cứng ở tầng Backend Database Transaction (`isolationLevel: 'Serializable'`) trong hàm `takeLots` (`lot-stock.ts`), không phụ thuộc vào giao diện. Khi tạo hóa đơn POS, `takeLots` chỉ lọc các lô có `status === 'AVAILABLE'` và `!expired(expiresAt)` (tức `expiresAt >= warehouseToday()`). Nếu tổng tồn của các lô còn hạn nhỏ hơn số lượng khách mua, Backend lập tức rollback giao dịch và trả về lỗi `409 LOT_STOCK_UNAVAILABLE`.

---

## 8. Kết quả kiểm thử thực tế (Unit Test, Integration Test & Typecheck)

Toàn bộ công thức và các trường hợp biên đã được kiểm thử tự động bằng `Vitest` và kiểm tra kiểu tĩnh `TypeScript` (`tsc --noEmit`):

```text
RUN  v5.0.0 C:/Users/duong/Hoc/DATN/ProjectDATN/backend

 ✓ src/modules/forecasts/supply-timing.test.ts (4 tests) 5ms
 ✓ src/modules/forecasts/recommendation-plan.test.ts (1 test) 16ms
 ✓ src/modules/forecasts/fefo-simulation.test.ts (8 tests) 28ms
   ✓ Ví dụ tính tay 1: Mô phỏng 1 lô cận hạn trong tầm nhìn 14 ngày (FEFO × Forecast)
   ✓ Ví dụ tính tay 2: Phân bổ FEFO nhiều lô liên tiếp — không tính trùng nhu cầu và không trừ nhầm phần đã hết hạn của lô trước
   ✓ Ví dụ tính tay 3: Đồng nhất mốc hết hạn với POS (daysRemaining = 0 còn bán được trong ngày; daysRemaining < 0 bị khóa)
   ✓ Ví dụ tính tay 4: Giới hạn tầm nhìn dự báo (Horizon = 14 ngày) — không ngoại suy để kết luận dư thừa cho lô còn 25 ngày
   ✓ Ví dụ tính tay 5: SKU chưa có dự báo hoặc NO_SALES — không tạo dự báo giả và không báo dư thừa giả
   ✓ Ví dụ tính tay 6: Đánh giá điều chuyển nội bộ — xét tồn an toàn kho nguồn, 2 ngày vận chuyển và tồn FEFO cạnh tranh tại kho nhận
   ✓ Ví dụ tính tay 7: Công thức cân bằng tồn kho thiếu hụt (assessShortage), cung ứng (supplyTiming) và kế hoạch nhập/chuyển (planReplenishment)
   ✓ Kiểm thử tích hợp logic xuất lô POS (takeLots): chặn xuất lô quá hạn/cách ly và trừ tồn đúng thứ tự FEFO

 Test Files  3 passed (3)
      Tests  13 passed (13)
```
