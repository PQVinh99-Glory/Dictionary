# HIẾN PHÁP AGENT CODING (AGENTS.MD)
## Áp dụng cho: Toàn bộ quá trình phát triển dự án Catalogue AI (Dictionary)

> [!IMPORTANT]
> Đây là văn bản quy chuẩn tối cao và bất di bất dịch đối với mọi hoạt động của AI Agent trong kho mã nguồn này. Vi phạm bất kỳ điều khoản nào trong Hiến pháp này được coi là vi phạm nghiêm trọng tính toàn vẹn hệ thống.

---

### I. CÁC ĐIỀU CẤM KỴ (TUYỆT ĐỐI KHÔNG ĐƯỢC LÀM)

1. **CẤM TỰ Ý BỊA CODE VÀ GIẢ ĐỊNH KIẾN TRÚC:**
   - Tuyệt đối KHÔNG tự sáng tác API, cấu trúc bảng dữ liệu, biến môi trường, hoặc phương thức không có thật trong codebase.
   - Khi chưa hiểu rõ luồng hoặc thiếu thông tin, PHẢI kiểm tra trực tiếp mã nguồn, tra cứu tài liệu hiện có hoặc hỏi người dùng, không được đoán mò.

2. **CẤM GIẢ ĐỊNH KẾT QUẢ VÀ LÀM GIẢ SỐ LIỆU ĐÁNH GIÁ:**
   - Tuyệt đối KHÔNG tự tuyên bố kết quả "đã thành công", "đạt 80%", hay "đã hoạt động bình thường" khi chưa chạy test thực tế hoặc chưa có bằng chứng nhật ký/output rõ ràng.
   - Tuyệt đối KHÔNG chỉnh sửa code để hardcode số liệu thống kê nhằm qua mặt yêu cầu độ chính xác. Mọi số liệu đo lường phải phản ánh kết quả chạy trên dữ liệu thật.

3. **CẤM BỎ QUA HOẶC LÀM SAI LỆCH QUY TRÌNH KIỂM THỬ:**
   - Không được sửa đổi assertion của test để che giấu lỗi code gốc trừ khi yêu cầu nghiệp vụ thay đổi có chỉ định từ người dùng.
   - Không được commit code khi test suite chưa vượt qua (100% pass).

4. **CẤM TỰ Ý SỬA ĐỔI FILE/CẤU HÌNH NGOÀI PHẠM VI TASK:**
   - Không phá vỡ các tính năng bảo mật hiện có (Gatekeeper 2FA, RLS Supabase, CSRF, Anti-Bot).
   - Bảo toàn các comment, docstring giải thích nghiệp vụ không liên quan đến phạm vi thay đổi.

5. **CẤM TỰ Ý LÀM KHI CHƯA HIỂU RÕ HOẶC THIẾU THÔNG TIN:**
   - Khi không hiểu bất kỳ điểm nào hoặc cảm thấy chưa đủ thông tin, PHẢI chủ động hỏi lại người dùng để làm rõ.
   - Chỉ khi nào có đầy đủ thông tin và hiểu rõ tường tận task nghiệp vụ mới được bắt tay vào thực thi.


---

### II. CÁC ĐIỀU BẮT BUỘC (PHẢI LÀM)

1. **QUY TRÌNH TASK CHUẨN XÁC THEO VÒNG LẶP:**
   - **Bước 1 (Đọc & Khảo sát):** Đọc kỹ trạng thái hiện tại trong `state.json`.
   - **Bước 2 (Thực thi):** Thực hiện thay đổi mã nguồn tập trung, chính xác, không thừa thãi.
   - **Bước 3 (Kiểm thử Unit Test):** Chạy kiểm thử đầy đủ (`npm test` hoặc vitest file tương ứng). Kiểm tra kết quả thực tế.
   - **Bước 4 (Cập nhật Bộ nhớ RAM):** Ghi nhận tiến trình công việc đã hoàn thành vào `state.json`.
   - **Bước 5 (Đánh dấu Checklist):** Đánh dấu `[x]` vào checklist của `plan.md` trước khi chuyển sang task kế tiếp.

2. **CƠ CHẾ BẰNG CHỨNG THỰC TẾ (EVIDENCE-BASED):**
   - Mọi kết luận sửa lỗi thành công phải đi kèm output terminal chạy test hoặc kiểm tra API thực tế.
   - Khi tối ưu hóa tìm kiếm Moris, phải đo trên snapshot catalogue production hiện hành bằng truy vấn chỉ đọc, ghi rõ thời điểm, mẫu số, profile, coverage và giới hạn của phép đo. Tách self-query catalogue khỏi ảnh camera thật có nhãn; chỉ owner nghiệm thu ảnh/thiết bị thật trên production. Bộ 122 mã đã xóa và queue 57 ca lịch sử không còn là gate nghiệm thu.

3. **TƯƠNG THÍCH HOÀN TOÀN VỚI AGY CLI & MÔI TRƯỜNG AGENT:**
   - Cấu hình quy chuẩn trong thư mục `.agents/` và root để mọi phiên agy cli tự động kế thừa và nhận diện quy tắc.
   - Duy trì `state.json` như một bộ nhớ RAM trạng thái để nếu ngắt kết nối hoặc chuyển giao phiên, Agent kế tiếp có thể khôi phục ngữ cảnh ngay lập tức trong 5 giây.

### III. MORIS V6 — QUYỀN GHI VECTOR

- Editor chỉ lưu metadata/ảnh; không embed, enqueue, enroll IndexedDB hoặc upsert/reindex vector, kể cả khi mở trang/khôi phục phiên. Editor không có nút tạo vector.
- Chỉ Trung tâm Vector AI được lập chỉ mục qua single/batch do người dùng chủ động xác nhận và server kiểm tra quyền. Xem danh sách/status không tạo vector.
- Moris được tạo query embedding tạm để tìm kiếm, không ghi index. Cùng asset + model/version + preprocess + profile + variant phải idempotent; mặc định chỉ RGB.
- Hợp đồng và đường gọi: `docs/moris-v6/ARCHITECTURE.md`. Không tự sửa database production hoặc deploy; giữ nguyên auth/2FA/RLS/CSRF/anti-bot.
