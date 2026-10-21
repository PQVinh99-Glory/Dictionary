# Nghiên cứu camera, hậu kỳ, sàng lọc sớm và từ điển hình dạng Moris

> Tài liệu nghiên cứu/khảo sát lịch sử. Kế hoạch triển khai hiện hành: [Plan_pipeline_moris.md](../../Plan_pipeline_moris.md), thay Plan_uplevel.md từ 2026-10-21. Các câu “chưa sửa plan” bên dưới mô tả thời điểm khảo sát.


Ngày: 2026-10-21. Phạm vi: khảo sát code, nghiên cứu tài liệu chính thức, phân tích thiết kế. Không sửa code ứng dụng, không đổi camera/profile, không train, không xóa hay tạo vector, không ghi production/deploy.

## 1. Nghiệp vụ chủ dự án đã làm rõ

1. Người dùng cầm điện thoại ngang; camera mở theo landscape để khung xem hữu ích lớn hơn cho linh kiện dài/to. Giữ các điều khiển/UI hiện tại; dùng cả Android và iPhone Safari.
2. Chụp trọn vật; tracking không được chỉ bám một mảnh rồi coi là toàn bộ vật.
3. Cạnh dài nhập tay là kích thước ưu tiên; cạnh ngắn tùy chọn.
4. Số đo nhập tay chênh lệch **không quá 5% vẫn được chấp nhận**. Nhóm trong dung sai nếu đủ 10 ứng viên đạt điều kiện thì không lấy nhóm phụ; nếu thiếu top10 mới được bổ sung nhóm cứu, ghi rõ lý do và score. Không nhồi mã bất kỳ để đủ 10. Đây là quyết định mới, thay đề xuất manual10% ở báo cáo trước; code chưa đổi. Sàn mm/mẫu số phần trăm chưa chốt.
5. Nhận dạng cả lỗ kín và phần khoét hở ở mép, gồm các nhóm mẫu trong moris_hole_samples. Không giới hạn bài toán ở lỗ kín. Răng cưa hiếm, không có biến thể nghiệp vụ: chỉ cần nhận dạng tương đương mẫu; không đếm từng răng.
6. Mong muốn tương lai chỉ dùng hybrid, có thể xóa/tạo lại vector sau này. Đây chưa phải authorization cho thao tác dữ liệu trong phiên nghiên cứu.

Concept sản phẩm: tracking + length → khóa và crop trọn vật → hậu kỳ có bằng chứng → sàng lọc sớm size/ngoại quan → DINOv2 → xếp hạng Moris. Nhận dạng từng lỗ/khoét là năng lực thị giác cần bổ sung vào harness, không chỉ là thay câu trả lời.

## 2. Code hiện thực hiện tới đâu

| Stage | Quan sát trực tiếp | Chưa được chứng minh hoặc còn thiếu |
|---|---|---|
| Camera | getUserMedia yêu cầu ideal 1920×1080; video object-fit cover | Không có logic lock landscape; ideal không bảo đảm settings thực tế |
| Tracking | Phân loại màu nền/bóng/chói; chọn component theo seed hoặc lớn nhất; gộp component gần; box hiển thị làm mượt | Ổn định nhiều frame không chứng minh đã chọn đúng toàn bộ vật |
| Capture | Cắt giữa frame theo 1000:410, max width 1280 | Không dùng bbox tracking làm crop vật; không enforce lock.ready tại capture |
| Mask capture | buildSubjectMaskDataUrl tạo mask và evidence | Mask này phục vụ overlay/đếm lỗ, không truyền làm input mask cho encoder |
| Optical | Encoder tự segment lại, PCA, crop bbox + padding 6%, letterbox 224, clamp sáng p98, median, CLAHE | Hai segmentation độc lập có thể chọn khác chủ thể; padding không sửa được mask thiếu thân |
| Size | Query size truyền vào API; size gate sau ANN/hydrate | Chưa có shortlist/recall theo cạnh dài trước ANN |
| Ngoại quan | Có geometry và classifier cơ bản | Chưa có bằng chứng triển khai một kênh sàng lọc ngoại quan sớm đầy đủ; geometry/rerank phụ đang OFF |
| Hybrid | Browser variants khai báo và tính hybrid; server kiểm tra profile | Không thể suy deployment runtime chỉ từ nhãn UI hoặc .env; fallback khác profile cần audit |
| Từ điển lỗ | Menu đọc moris_hole_samples; module nhận tag từ text/camera | Search chưa tải ảnh mẫu để match từng lỗ; không có training từ các row đó |

Đường dẫn: `src/app.js:3025,3142,3537,3627,3692,3926`; `src/moris/capture-subject-lock.js`; `src/moris/moris-layer1-optical.js:1004`; `src/moris/vector/dinov2.worker.js`; `functions/_lib/moris/v5/orchestrator.js`; `functions/_lib/moris/v5/retrieval/holeFormatReference.js`.

Hai ảnh Editor được đính kèm là cùng image.png; ảnh điện thoại về kết quả sai là image copy.png đã khảo sát trước. Không coi screenshot là ảnh camera gốc hoặc request snapshot.

## 3. Camera landscape: nên làm và không thể hứa gì

getUserMedia hiện đã yêu cầu kích thước ngang, nhưng đó là cấu hình video mong muốn, khác hướng màn hình. Cần phân biệt sensor frame, viewport hiển thị, vùng crop và hướng cầm máy. [MDN constraints](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints) phân biệt rõ constraints với settings thực nhận.

ScreenOrientation.lock có mức hỗ trợ hạn chế và thường gắn với mobile/fullscreen. Không hứa tự khóa ngang hoạt động giống nhau trên Android Chrome và iPhone Safari; phải kiểm tra tính năng/lỗi runtime và nghiệm thu từng môi trường. [MDN ScreenOrientation.lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock), [W3C Screen Orientation](https://www.w3.org/TR/screen-orientation/).

Thiết kế đề xuất: giữ component camera và các điều khiển; khi mở, thử fullscreen/landscape theo quyền hỗ trợ; khi không được, nhận biết hướng cầm và hướng dẫn xoay ngang. Khi đóng thì trả trạng thái thích hợp. Không chỉ rotate CSS video; không dùng native fullscreen video nếu làm mất các control/overlay riêng.

Camera ngang giúp diện tích hiển thị và thao tác bố cục. Nó không tự đổi lens hoặc tăng góc nhìn quang học. Nếu vẫn crop mất sensor area thì ảnh vẫn thiếu vật. Tỷ lệ hiện tại 1000/410 ≈ 2.44:1 hẹp chiều cao hơn 16:9; trên frame 1920×1080, crop này giữ khoảng 787px chiều cao, tức khoảng 73% chiều cao frame. Đây là tính toán hình học minh họa, không đo settings thiết bị. Cần khảo sát bỏ crop cứng ở bước nhận diện, giữ full sensor frame và crop theo vật sau khi khóa đúng.

Mọi phép biến đổi display → sensor → tracking → crop phải dùng chung mapping; reset tracking khi đổi orientation/kích thước stream. Nếu đổi mỗi CSS, điểm chạm và bbox có thể lệch ảnh thực. Tùy chiều cao landscape, bàn phím nhập size và safe area có thể che video; cần kiểm tra bố cục hiện hữu thay vì cam kết không cần điều chỉnh responsive nào.

## 4. Vì sao nền trắng vẫn có thể chỉ bắt được một phần

Trong labelPixels, pixel tối vừa phải có thể bị phân loại thành bóng nền và bị loại; specular có thể chia thân thành nhiều component. Đây là cơ chế có khả năng gây lỗi dựa trên code, chưa phải bằng chứng nguyên nhân của từng ảnh thật. Seed trên một mảnh hoặc largest-component cũng có thể chọn đúng một vùng mà bỏ phần nối sáng. Merge gap hiện có giới hạn nên không đảm bảo nối được mọi phần thân.

Nền trắng khác màu vật không đủ chứng minh mask đúng: vật kim loại có vùng sáng gần nền, bóng, texture, đường cong và vùng mỏng. Mask của một mảnh có thể ổn định qua nhiều frame và vẫn sai. Nếu body bị cắt khỏi camera view ban đầu, thuật toán về sau không thể lấy lại pixel ngoài frame.

Đề xuất tách ba đối tượng:

- **Material mask:** phần kim loại thật, giữ cấu trúc lỗ, phục vụ đo chi tiết.
- **Object envelope/ROI:** phạm vi toàn chủ thể để khóa/crop; có thể bao vùng sáng/bóng cần kiểm tra nhưng không dùng làm mask đếm lỗ.
- **Display box:** bbox làm mượt để người dùng quan sát; không dùng tọa độ box đang trễ làm crop thật.

Crop lấy từ frame chụp gốc, revalidate mask tại frame đó, thêm padding và kiểm tra không chạm biên. Padding crop không đồng nghĩa dilate material mask: nở mask có thể bít lỗ nhỏ hoặc thay đổi miệng rãnh. Code optical đã có padding 6%; chỉ tăng padding không chữa được mất component hoặc lỗi tọa độ.

Nghiệm thu phải có nhãn trọn vật/mask thật: tỷ lệ cắt mất đầu, giữ đủ hai đầu và tất cả lỗ, vùng nền/bóng lẫn vào, IoU và chất lượng biên. Không lấy bbox đẹp hoặc stable=true làm nhãn đúng.

## 5. Hậu kỳ phải có bằng chứng và giữ topology

Code optical thực sự chạy segmentation, PCA, clamp p98, median, CLAHE trước khi tạo pseudo-RGB. Nhưng clamp nằm sau initial segmentation. Nếu phân đoạn đã mất phần thân do chói, clamp trên phần giữ lại không tự lấy lại phần đó. Clamp giảm cường độ cực sáng; không có nghĩa tái tạo được chi tiết đã cháy sáng. Không dùng generative inpainting để bịa lại lỗ phục vụ tìm kiếm.

Thiết kế nên xử lý rủi ro chói trong segmentation/ROI, rồi điều chỉnh sáng trên ảnh, kiểm tra topology trước/sau. Giữ nhánh ảnh gốc độ phân giải cao cho đếm/định dạng; nhánh riêng mới resize 224 cho DINOv2. Không ép mọi phép đếm lỗ nhỏ qua cùng raster 224. Cũng không kết luận ảnh trông mượt hơn là ảnh tốt hơn cho model.

Evidence cho từng query đề xuất: frame ID/hash, stream settings, bbox sensor/crop, padding thực tế, mask version, ảnh trước/sau và overlay mask, vùng chói, lỗ trước/sau, profile output, timing/fallback. Raw ảnh chỉ lưu nội bộ có kiểm soát; có thể dùng preview chẩn đoán tạm tại máy/admin, không tự bật lưu ảnh production hoặc thay UI vận hành. Tách trạng thái succeeded/fallback/skipped/failed; animation “đang xử lý” không chứng minh output đúng.

Hai segmentation hiện độc lập cần một owner hoặc contract chuyển mask/provenance rõ ràng. Thống nhất không có nghĩa mù quáng tin tracker: encoder phải có quyền báo mask không đủ tin cậy và yêu cầu capture lại.

## 6. Sàng lọc sớm theo concept của chủ dự án

Có thể bắt đầu truy vấn cạnh dài ngay khi người dùng nhập xong, chạy song song tracking/hậu kỳ; ngoại quan rút từ silhouette và hole facts sau khi mask đạt. Sau đó DINOv2 tạo query vector để đối chiếu với tập ứng viên và đường cứu đã quy định.

Việc tạo query embedding không phụ thuộc số candidate. Shortlist sớm không tự tiết kiệm chi phí encode query; lợi ích là giảm không gian tìm và tăng recall qua metadata. Muốn ANN thật sự bị giới hạn bởi shortlist cần RPC hỗ trợ ID/length/filter được thiết kế và benchmark, không phải chỉ gọi size gate sau ANN rồi đổi tên thành sàng lọc sớm.

Đề xuất hai mức:

1. **Nhóm ưu tiên:** length trong dung sai đã chốt + facts ngoại quan đáng tin; sau đó vector/ranker so khớp.
2. **Nhóm cứu:** candidate thiếu length, query không chắc chắn hoặc các kênh khác tìm được; giữ nhãn evidence thiếu và budget riêng.

Với dữ liệu hiện chỉ 6/545 mã có length, không thể coi toàn bộ mã còn lại không phù hợp. Đường cứu tránh làm mất target thiếu dữ liệu. Chủ dự án đã chốt: khi nhóm phù hợp trong 5% có đủ 10 ứng viên đạt chất lượng thì không lấy nhóm ngoài dung sai. Nếu thiếu mới mở rộng nhóm cứu, dedupe và giới hạn số còn thiếu, kèm note lý do và điểm. Candidate thiếu size phải ghi chưa kiểm chứng, khác với đã đo vượt 5%. Vẫn giữ quality/score threshold đã nghiệm thu; nếu không có ứng viên hợp lệ thì trả ít hơn 10, không pad rác. Cạnh ngắn thiếu không phạt.

Nếu chọn dung sai quanh query length, 180mm cho khoảng 171–189mm; đây là cách định nghĩa đề xuất để chủ dự án xác nhận. Code hiện dùng max(query,candidate) và sàn mm; cần chốt mẫu số và sàn vì chúng cho biên khác nhau, nhất là linh kiện nhỏ. Dữ liệu manual không trở thành caliper chỉ vì confidence lưu là 0.9.

Ngoại quan trước DINO gồm silhouette ratio/độ cong và lỗ/khoét quan sát được, không gán chắc chắn shape từ length hoặc lấy từ target metadata quay lại làm query label. Càng hard filter sớm càng cần đo false-exclusion, không chỉ đếm số candidate giảm đi.

## 7. moris_hole_samples hiện là gì

Bảng lưu nhãn, format_tag và khóa ảnh tham khảo; không có cơ chế khiến model tự học khi insert row. Search hiện không tải ảnh mẫu để phân loại hole crop. holeFormatReference chứa từ vựng trong code; format tags được so với identifying_features.

Hai khoảng trống đã xác nhận:

- `holeFormatsFromCounts({tron:4})` biến thành tập tag `tron`; applyHoleFormatBoost chỉ biết có định dạng tròn, không phân biệt 4 với 2 hoặc 6 lỗ.
- `morisHoleFormatsPayload` đọc counts nhưng chưa kiểm tra cờ reliable ngay trong hàm đó. Chưa có contract đủ chặt đưa độ tin cậy từng lỗ qua server. Flag boost đang OFF nên đây là điểm phải sửa trước khi bật, không khẳng định đã làm sai ranking production hiện tại.

Mẫu lỗ có thể trở thành bộ từ điển thị giác và taxonomy nghiệp vụ. Muốn dùng, phải nối perception → tra mẫu → chuẩn hóa tên → tổng hợp số lượng → đối chiếu facts. Lưu ảnh trong DB/R2 chỉ giải quyết nguồn tham chiếu.

RAG theo nghĩa nghiên cứu gốc kết hợp truy hồi kiến thức với mô hình sinh; không phải quá trình tự học trọng số hoặc tự phát hiện lỗ. [Lewis et al., RAG](https://arxiv.org/abs/2005.11401). Trong Moris hiện không cần thêm generator chỉ để gán tên từ format_tag. Có thể dùng truy hồi mẫu bằng descriptor rồi tra tên trực tiếp; lớp giải thích bằng ngôn ngữ là phần tùy chọn sau perception.

## 8. Luồng đếm và nhận dạng lỗ/khoét đề xuất

1. Xác định toàn vật trên frame có độ phân giải đủ; giữ material mask và outer contour.
2. **Lỗ kín:** tìm vùng nền bên trong biên vật và kiểm tra chất lượng biên. **Khoét hở:** phân tích miệng khoét/đoạn biên lõm, không dùng cùng phép đếm vùng kín.
3. Mỗi instance có contour/mask, crop gốc, vị trí tương đối, diện tích, closed/open, quality; tách rời phát hiện vị trí và phân loại tên.
4. Chuẩn hóa hướng/scale đủ để so hình, giữ thông tin tỷ lệ dài/rộng và phần miệng hở; không bóp mọi crop thành vuông làm mất ellipse/slot.
5. So contour/descriptor hoặc model crop với mẫu/nhãn; có unknown khi score/margin/chất lượng thấp.
6. Gán một nhãn leaf cho mỗi instance; cho phép parent aliases khi tra cứu nhưng không cộng double-count. Ví dụ bán oval có thể thuộc họ oval, vẫn chỉ là một instance.
7. Tổng hợp số lượng và độ phủ quan sát, rồi so với AST identifying_features của candidate. Không cộng số cùng lỗ qua nhiều frame hoặc hai bộ detector.

OpenCV có contour hierarchy để phân biệt biên trong/ngoài và các hàm shape descriptors/matching; đây là cơ sở của phương án hình học, không phải bằng chứng đã thành công trên ảnh Moris. [Contour hierarchy](https://docs.opencv.org/4.x/d9/d8b/tutorial_py_contours_hierarchy.html), [shape analysis](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html).

`extractEnclosedHoles` hiện flood-fill nền từ biên, nên phần khoét thông ra mép bị coi là nền ngoài; không thể đếm theo classifier hiện có chỉ bằng cách thêm một tên mới. Chủ dự án đã chốt răng cưa chỉ cần tương đương mẫu: dùng presence/unknown và mức tương tự, không count từng răng. Không áp mặc định quy tắc đếm lỗ tròn lên mọi format. Với gài móc hoặc nhóm khác, chỉ cần chi tiết hơn khi nghiệp vụ thực sự yêu cầu.

Ví dụ `4 lỗ tròn`:

- Catalogue parser → circle count=4; query phải quan sát được 4 instance tròn riêng biệt với evidence, không chỉ phát hiện tag tròn.
- Query=4 chắc chắn → match count với 4; khác số → conflict theo độ tin cậy; catalogue thiếu → unknown.
- Chỉ thấy 3 và còn một vùng chói → biết ít nhất 3, tổng chưa biết; không hard loại catalogue có 4.
- Lỗ tròn nhìn xiên có hình ellipse: ảnh chiếu không tự chứng minh nó là lỗ oval cơ khí. Cần pose/context/đa view hoặc unknown, tránh ép class.
- `1 to, 1 nhỏ` là phân loại tương đối nếu không có thước/đường kính thật; perspective có thể đổi diện tích biểu kiến. Không tự suy mm lỗ từ length của một vật cong 3D.

## 9. Fine-tune hoặc thêm model: lựa chọn theo điểm nghẽn

| Hướng | Vai trò | Đề xuất ở giai đoạn này |
|---|---|---|
| Hình học + matching mẫu | Đếm vùng, contour/shape đơn giản, tra tên | Baseline đầu tiên trên crop/mask thật; tái sử dụng thuật toán hiện có và mở nhánh khoét hở |
| Frozen DINOv2 features + classifier nhỏ/kNN | Phân loại từng crop đã xác định vị trí | Thí nghiệm khi mẫu hình học khó; cần crop ảnh thật có nhãn, unknown/negative |
| Detector/instance segmenter chuyên lỗ/khoét | Tìm vị trí và nhãn khi màu/chói làm segmentation cổ điển thất bại | Phù hợp hơn với lỗi perception nếu nhãn instance đủ; chọn model/runtime sau benchmark thiết bị |
| SAM 2 hỗ trợ tạo mask | Prompted segmentation, hỗ trợ gán nhãn và nghiên cứu tracking | Công cụ annotation/thí nghiệm; không tự biết taxonomy lỗ và không mặc định đủ nhẹ cho Safari |
| Fine-tune DINOv2 backbone | Thay biểu diễn ảnh/descriptor | Để sau khi capture, data và evaluator ổn định; có thể cần profile và index mới |
| VLM/LLM + ảnh mẫu tham chiếu | Hỗ trợ annotation/giải thích/case review | Không làm bộ đếm duy nhất hoặc ground truth cho test chính nó |

DINOv2 chính thức hỗ trợ downstream classifier trên frozen features và khuyến nghị fine-tune là bước sau cùng khi cần: [Meta model card](https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md). SAM 2 hỗ trợ segmentation có prompt cho ảnh/video và có training code: [repository chính thức](https://github.com/facebookresearch/sam2). Hai nguồn không chứng minh hiệu quả trên catalogue này.

Đánh giá của tôi: trước mắt không fine-tune Moris/DINOv2. Moris trong image path hiện là orchestrator/rules/ranker, không có một model “Moris” riêng để nạp 15 ảnh rồi fine-tune. Nếu cần model mới, ưu tiên thành phần nhận diện instance lỗ/khoét hoặc classifier crop; tách khỏi encoder SKU giúp tránh bắt buộc đổi mọi vector SKU khi cải tiến taxonomy.

15 ảnh mẫu/11 tag đủ làm ví dụ từ vựng ban đầu, chưa chứng minh đủ để train/test qua góc nghiêng, chói, biên nhỏ, nền và khoét hở. Cần nhãn trên linh kiện thật: outer mask, mỗi hole/notch instance, class, closed/open, occlusion/unknown và physical-shot/SKU. Các bản xoay/augment của cùng mẫu không thay thế scene độc lập. Không chọn số lượng mẫu tối thiểu giả định trước khi kiểm tra coverage và learning curve.

Đưa model lên web cần đo model load, RAM, warm/cold latency và operator support trên cả WASM/WebGPU. [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) cung cấp nền triển khai; không bảo đảm model bất kỳ chạy nhanh trên mọi điện thoại. Nếu server fallback, cần quyết định riêng về upload/latency/chi phí; chưa chọn hạ tầng hoặc dịch vụ mới.

## 10. Xác nhận hybrid và kế hoạch tạo lại index trong tương lai

Code browser variants hiện tính hybrid thật qua patch tokens và công thức 55/45; server kiểm tra profile trước dùng query. Health endpoint hiện trả vector_profile. Runtime proof cần nối browser module/worker version → query profile → health/server config → RPC/profile index → response trace. UI “wasm/q8” chỉ nói runtime, không xác nhận descriptor.

Một chi tiết tránh đọc sai: includeGray=true không có nghĩa luôn có hai probe. Browser hiện mặc định allowMirror=false; worker chỉ tạo probe thứ hai khi điều kiện được phép. Trạng thái vector/probe phải lấy từ output thực.

Không xóa index cũ trước khi quyết định capture/preprocess cuối cùng. Khi chủ dự án thực sự yêu cầu rebuild: freeze model/preprocess/profile, audit asset coverage, backup có thể khôi phục, dựng/kiểm chứng hybrid đầy đủ, nghiệm thu, rồi mới retire legacy theo phạm vi được duyệt. Nếu xóa sạch trước mà capture/preprocess còn đổi, có thể phải làm lại và mất baseline so sánh. Không có thao tác rebuild nào được thực hiện trong nghiên cứu này; mọi ghi vector vẫn thuộc Vector Center và quyền server.

## 11. Bằng chứng cần có trước khi gọi là hoạt động đúng

| Năng lực | Bằng chứng nghiệm thu đề xuất |
|---|---|
| Landscape | Android và iPhone Safari thật: mở/đóng, xoay máy, nhập size, safe area, mapping overlay/capture đúng |
| Lock/crop | Ground truth full-object; không cắt hai đầu, không chỉ bắt mảnh, margin và biên có đo |
| Hậu kỳ | Raw/mask/output cùng frame; giảm chói không mất lỗ/biên; ghi fail/fallback rõ |
| Size sớm | Trace ghi query length và IDs được lấy trước vector; các biên 5%/missing/invalid; false exclusion |
| Ngoại quan | Precision/recall theo facts và reliability; null không thành zero |
| Hole/notch | Instance detection precision/recall, exact count, confusion từng class, unknown và open/closed riêng |
| Hybrid | Chuỗi profile/version khớp từ browser đến RPC và index, không tái dùng vector khác không gian |
| Ranking | Same-query Top1/Recall10/MRR, candidate recall, unknown negatives và P95 thiết bị |

Đã chạy kiểm tra logic hiện hữu trong phiên: 5 files / 65 tests pass (capture subject lock, camera box, profile contract, hole format reference, hole format UI). Log `evidence/harness-capture-hole-research-tests.log`. Không chạy benchmark camera mới, không train hoặc tuyên bố recognition cải thiện. Test hiện pass không phủ các lỗ hổng nối dữ liệu đã chỉ ra.

## 12. Hướng cập nhật Plan_uplevel sau nghiên cứu

U0 bổ sung artifact/provenance từng stage; U1 landscape + full-frame tracking + capture full-object; U2 chia rõ quality và preprocess version; U3 length-first shortlist sớm với 5% theo quyết định mới; U4 tách instance detection/closed-open classification/dictionary/count matching; U5 vector + metadata priority/rescue; U6 reliability-aware ranking; U7 camera-device và perception metrics cùng ranking.

Chưa cần thêm model chỉ để gọi tên tiếng Việt. Cần sửa khoảng trống perception/đếm và bằng chứng trước; dictionary cung cấp định nghĩa và ví dụ, model hoặc thuật toán thị giác cung cấp instance quan sát, ranker nối chúng với catalogue. Policy top10/nhóm cứu đã chốt như mục 6; còn cần định nghĩa mẫu số/sàn mm và ngưỡng chất lượng bằng calibration trước implementation. Răng cưa nhận dạng tương đương, không đếm từng răng. Chưa sửa Plan_uplevel gốc.
