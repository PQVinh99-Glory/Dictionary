# P02 camera landscape/lifecycle — local verification

Ngày 2026-10-21. Owner xác nhận production đang rebuild hybrid, cho tiếp P02. Các thay đổi P02 chỉ ở browser camera và test, không đọc/ghi vector, DB, auth, deploy.

Code hiện dùng kích thước sensor thực (`videoWidth/videoHeight`) cho preview, tap, tracking và capture; camera landscape thử `screen.orientation.lock` khi được hỗ trợ, fallback hiển thị hướng dẫn xoay máy. Mới bổ sung request ID để camera đóng/đổi trong lúc `getUserMedia`, `video.play` hoặc fullscreen còn pending không bật lại stream cũ; track trả muộn được stop. Tracker reset khi tạo stream mới. Orientation lấy từ API thiết bị trước viewport nên bàn phím không giả thành xoay máy. Overlay chừa safe area của điện thoại.

Kiểm thử: `npx vitest run tests/moris-camera-lifecycle.test.js` 7/7 pass, gồm stream trả muộn sau đóng, chờ video play trước ready, fullscreen trả muộn, orientation lock từ chối, permission denial, keyboard resize và xoay thật. `npm test`: 65 files/629 tests pass. `npx --no-install tsc --noEmit`: exit 0. `npm run build`: 47 files. `git diff --check`: pass.

Giới hạn: unit/mock không chứng minh UX trên Android Chrome và iPhone Safari thật. Owner sẽ nghiệm thu trên production: mở/đóng nhanh, từ chối/cấp lại quyền, xoay portrait→landscape, đổi camera, nhập size làm bật bàn phím, safe area/notch, quay app về background rồi mở lại; xác minh vật và điểm chạm trùng tracking/capture trên cùng frame. Chưa đánh dấu P02 phase complete/GO.
