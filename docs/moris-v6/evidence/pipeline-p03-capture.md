# P03 capture/upload — local verification

2026-10-21. Scope: client capture, still upload gate và schema provenance; không sửa pixel canonicalizer/index hay production DB. `paddedSubjectRoi` lấy bbox vật thể từ mask của **frame cuối**, thêm lề 8%, clamp vào frame; query crop được gửi cho cả browser encoder và Moris search. Preview quét vẫn giữ full frame cùng mask để overlay không lệch. ROI không lấy từ khung EMA chỉ dùng vẽ UI.

Upload từ cả ô Moris và modal Camera được chuẩn hóa ảnh rồi kiểm tra subject bằng bốn điều kiện tĩnh: nằm trong frame/chừa lề, một chủ thể, ít chói, đủ nét. Ảnh tĩnh không được gắn nhãn ổn định đa khung. Không qua gate thì không embed/search; camera khởi động lại nếu upload trong modal bị từ chối. `moris.captureEvidence` cũ bị xóa khi chọn ảnh mới, và hole count chỉ truyền khi capture evidence `reliable=true`.

`capture_quality` gồm source kind, kích thước frame, crop ROI, gate status và trạng thái temporal; server validate biên ROI/kiểu dữ liệu. Đây là **client-supplied diagnostics**, không phải ground truth và không tham gia ranking. Chỉ debug admin được xem metadata này.

Validation: focused capture/size/hole/query 48/48 test pass; camera crop integration 2/2 pass. Full `npm test`: 66 files/636 tests pass. `npx --no-install tsc --noEmit` exit 0; `npm run build` 47 files; `git diff --check` pass.

Pending owner production test: mask completeness/IoU, false-ready/false-reject của vật dài/mỏng/uốn/chói; upload ảnh thật nền khác nhau; chụp trên Android Chrome/iPhone Safari; kiểm crop không cắt đầu/chi tiết. Các test local chưa chứng minh accuracy camera thật.
