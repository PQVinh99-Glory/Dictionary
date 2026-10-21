# Hướng phát triển Moris sau đánh giá Plan_uplevel

> Tài liệu nghiên cứu/khảo sát lịch sử. Kế hoạch triển khai hiện hành: [Plan_pipeline_moris.md](../../Plan_pipeline_moris.md), thay Plan_uplevel.md từ 2026-10-21. Các câu “chưa sửa plan” bên dưới mô tả thời điểm khảo sát.


Ngày: 2026-10-21. Đây là đề xuất kiến trúc sau khảo sát, chưa triển khai hay thay cấu hình production.

## 1. Khuyến nghị

**Tiếp tục với hybrid hiện có làm baseline kỹ thuật, phát triển harness độc lập profile; ưu tiên candidate recall theo cạnh dài và feature facts. Giữ CLS làm đối chứng đánh giá, chưa quay lại legacy CLS và chưa chạy hai profile online mặc định.**

Lý do chọn baseline hybrid là tính liên tục của implementation, độ phủ hiện có và khả năng tiếp tục thử nghiệm đặc trưng chi tiết. Chưa có A/B công bằng chứng minh hybrid chính xác hơn CLS trên camera. Không coi hybrid 55/45 là lựa chọn vĩnh viễn hoặc điều kiện bắt buộc của harness.

## 2. Nghiệp vụ đã chốt

- Bắt buộc chụp trọn vật; không phát triển chế độ partial_allowed trong đợt này.
- **Cạnh dài là kích thước chính**, đủ để recall và rerank khi có query length hợp lệ.
- Cạnh ngắn tùy chọn, chỉ hỗ trợ khi hai bên có dữ liệu và phép đo đáng tin; thiếu cạnh ngắn không phải thiếu điều kiện tìm kiếm, không phạt hoặc bắt nhập.
- Không chờ dữ liệu dài × rộng đầy đủ mới triển khai size channel. Coverage cần theo cạnh dài; 0 mã có cả hai cạnh không phải blocker nghiệp vụ.
- Ưu tiên cạnh dài không đồng nghĩa xác nhận mọi mã cùng chiều dài là cùng linh kiện. Hình ảnh và đặc điểm lỗ vẫn cần để phân biệt.
- Dung sai hiện có 10%/3mm manual và 5%/2mm verified chưa được chủ dự án thay đổi. Đề xuất giữ để đo baseline trước.

Trước đây báo cáo gọi thiếu width là match_partial theo enum code. Đây chỉ là tình trạng có một cạnh trong schema cũ; về nghiệp vụ, **match theo cạnh dài là một phép tìm hợp lệ đầy đủ**, không phải kết quả kém tin cậy chỉ vì không có width. Đề xuất giữ riêng trạng thái length và width trong evidence khi triển khai, thay vì dùng một nhãn partial gây hiểu nhầm.

## 3. CLS và hybrid trong chính codebase

Nguồn: `src/moris/vector/dinov2.worker.js`, `src/moris/moris-layer2-embedding.js`, `src/moris/vector/browserDinov2.js`, `functions/_lib/moris/v5/vector/{profiles,encoder,search}.js`.

| Tiêu chí | CLS/legacy hiện có | Hybrid hiện có |
|---|---|---|
| Backbone | DINOv2-small ef1fb10 | Cùng backbone |
| Descriptor | CLS 384 chiều, L2 | L2(0.55 × masked signed GeM + 0.45 × edge-weighted patch pooling), 384 chiều |
| Pipeline hiện có | Profile cls_l2_v1 / kim_canon_v2 | hybrid_gem3_edge_55_45_pseudorgb_u8_v1 / kim_canon_v3_letterbox |
| Input path cần lưu ý | Nhánh worker embed dùng extractor(image) và tensorToClsVector; không gọi optical layer tại nhánh này | Optical/PCA/letterbox; pseudo-RGB gồm luminance CLAHE, Scharr và chamfer |
| Tích hợp mặc định trong code | Nhánh tương thích cũ; .env local hiện vẫn chọn legacy | Browser variants và config server mặc định dùng hybrid |
| Coverage live phiên trước | 534/545 record, 1.069 active vector | 544/545 record, 1.103 active vector |
| Target 3448000001 | Không có vector | Front/thumb active, self-query rank 1 |
| Điểm thuận lợi về thiết kế | Descriptor đơn giản, không phụ thuộc trực tiếp mask/edge weighting nếu giữ raw path | Pooling tập trung foreground và chi tiết cạnh, hợp giả thuyết phân biệt linh kiện tương tự |
| Rủi ro về thiết kế | Descriptor toàn cục có thể không phân biệt đủ chi tiết nhỏ; cần kiểm chứng | Mask sai/chói ảnh hưởng cả input và pooling; edge có thể ưu tiên phản quang; trọng số 55/45 cần đo |

Các nhận định rủi ro ở hai cột là suy luận từ code, không phải số đo CLS vs hybrid. DINOv2 chính thức cung cấp cả class token và patch tokens; không có khuyến cáo chính thức nào xác nhận công thức hybrid riêng của dự án là tối ưu. Nguồn: [Meta DINOv2 model card](https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md).

Hai descriptor cùng 384 chiều nhưng không chung hợp đồng cosine. Không đổi nhãn hybrid thành CLS, không dùng cùng query vector để tìm index khác profile. Muốn fallback CLS phải có query embedding được tạo đúng pipeline CLS; nếu không có, trả trạng thái degraded/fallback nghiệp vụ theo policy, không đổi profile âm thầm.

Hybrid này không trộn CLS với patch. Nó trộn hai kiểu pooling từ patch tokens. Pooling không giữ nguyên bản đồ vị trí từng patch, nên không thay được kiểm tra vị trí lỗ. Tên canon_rgb_v2 cũng không đồng nghĩa tensor vào model là ảnh RGB tự nhiên: worker đang ghép ba kênh pseudo-RGB. Chưa có phép đo riêng tách ảnh hưởng pseudo-RGB khỏi ảnh hưởng pooling.

CLS và patch có thể được lấy từ cùng output token đầy đủ trên cùng input nếu runtime hỗ trợ. Điều đó tạo cơ hội so sánh pooling với ít inference lặp hơn trong thí nghiệm, nhưng CLS trên input canonical/pseudo-RGB sẽ là hợp đồng khác legacy hiện có; không tự gán vào cls_l2_v1/kim_canon_v2 hoặc ghi index production.

## 4. Bằng chứng nào đã có, bằng chứng nào chưa có

M22 là báo cáo lịch sử ngày 2026-10-16, không chạy lại trong phiên này:

| Split, cấu hình | Top-1 | Recall@10 | Profile |
|---|---:|---:|---|
| Development global | 58/93 = 62.37% | 78/93 = 83.87% | Hybrid |
| Development +holes | 54/93 = 58.06% | 75/93 = 80.65% | Hybrid |
| Holdout global | 20/31 = 64.52% | 29/31 = 93.55% | Hybrid |

Trong `evaluation/moris-v6/ablation.js`, global nghĩa là không thêm geometric rerank. Nó **không có nghĩa CLS**. Vì vậy bảng này chứng minh bật geometry từng làm giảm kết quả development trong thí nghiệm đó, không chứng minh hybrid thắng CLS. M22 vẫn NO-GO; holdout đã dùng, không dùng lại làm tập unseen cho thuật toán mới.

Log legacy phase-a chỉ có 6 ảnh, pipeline/thời điểm/nhãn khác; không so tỷ lệ đó với M22 để tuyên bố thắng thua. Nguồn gốc tạo mọi vector legacy trong DB chưa được audit hết, không suy từ một nhánh worker rằng toàn bộ lịch sử index đã dùng đúng nhánh đó.

Thiếu raw camera/request của phiên lỗi nên chưa tái lập chính xác 3448000001. Self-query rank 1 chỉ xác nhận đúng-profile retrieval của bản ghi ở phép đo đó. Dữ liệu live và hash screenshot đã lưu trong báo cáo feasibility mục 9.

## 5. Kiến trúc đề xuất

```text
Capture: trọn vật, quality tại frame chụp
  -> Adapter đúng model/version/preprocess/profile
  -> Candidate union có giới hạn
       1. Hybrid ANN
       2. Cạnh dài tương thích khi query có length hợp lệ
       3. Feature-compatible khi query facts đáng tin
  -> Hydrate theo ID + evidence theo field
  -> Ranker duy nhất: ảnh + cạnh dài + lỗ/feature + cạnh ngắn bổ trợ
  -> Suggestions / needs_review / no_match
  -> Telemetry theo stage và nguồn candidate
```

Không đặt hard size filter trước ANN trên toàn catalogue khi coverage thấp. Cạnh dài là kênh độc lập để cứu ứng viên, đồng thời là tín hiệu chính trong nhóm size; chưa chọn trọng số toàn cục trước ablation. Không phải mọi request đều có length: thiếu query length thì vector/feature vẫn chạy.

Với 3448000001 và query dài 180mm, size channel có thể đưa target vào union ngay cả khi ANN bỏ sót. SELECT live đã trả target là mã duy nhất tương thích trong 6 mã có length. Tính duy nhất này chỉ đúng trong dữ liệu size hiện có, không chứng minh toàn bộ 545 mã chỉ có một mã dài 180mm, và không tự bảo đảm top-1.

Policy evidence đề xuất:

| Tình huống | Hành vi |
|---|---|
| Có length hai bên, phù hợp | Eligible cho length channel, evidence match và rerank đã hiệu chỉnh |
| Thiếu width một hoặc hai bên | Length vẫn hoạt động bình thường; width unknown, không phạt |
| Thiếu candidate length | Giữ candidate từ ảnh/feature, size unknown |
| Thiếu query length | Không chạy size channel; không suy mm từ ảnh không có thẻ chuẩn |
| Length manual lệch | Bounded conflict/rerank; không hard reject mặc định |
| Length verified lệch | Hard reject chỉ theo policy được duyệt và phép đo false-exclusion |
| Có width nhưng xung đột | Evidence phụ, yêu cầu đối chiếu; không tự thành veto lấn át length |
| Một kênh lỗi | Kênh khác tiếp tục trong timeout budget |

Đề xuất width không làm veto cần được thể hiện trong tiêu chí nghiệm thu; chưa sửa behavior code hiện tại. Candidate từ size/feature có thể thiếu vector score: phải giữ unknown, không gán số giả, và có chính sách chấm điểm/so sánh nguồn trước khi bật union. Không để signal đơn lẻ match=1 tự thắng mọi candidate khác.

## 6. Điều chỉnh Plan_uplevel để triển khai tốt hơn

| Phase | Điều chỉnh đề xuất |
|---|---|
| U0 | Thêm audit profile browser/server/index và fallback; ghi target ở mỗi stage; baseline cùng config. Đây là ưu tiên cao nhất vì profile mismatch có thể loại target tuyệt đối. |
| U1 | Bỏ partial_allowed. Gate full-subject phải tác động nút chụp và frame capture thật, chốt policy upload; không chỉ hiển thị ready. |
| U2 | Tách quality/capture crop khỏi thay canonicalizer. Tái sử dụng crop sẵn; không đổi pixel algorithm chung mà giữ version cũ. Thí nghiệm preprocess riêng sau baseline. |
| U3 | Chuyển thành length-first recall + evidence. Không phụ thuộc width coverage, không chờ full catalogue. Query theo length có giới hạn, đo covered/uncovered riêng. |
| U4 | Tái sử dụng parser; facts và reliability theo field; missing khác zero; không suy tổng lỗ khi vùng lỗ không đáng tin. |
| U5 | Thiết kế source ranks/limits, missing vector score, dedupe, timeout và keyed hydrate; bỏ early return trước khi các kênh hợp lệ được thử. |
| U6 | Ưu tiên length và feature evidence có kiểm chứng; width phụ. Hiệu chỉnh unknown neutral, tránh double-count, không bật geometry hàng loạt. |
| U7 | So sánh same-query, profile parity, holdout mới; đo unknown false accept, false exclusion và mobile P95. Production shadow/canary cần authorization riêng. |

Thứ tự gợi ý: U0 → U1 và U3/U4 quan sát → U5 union → U6 calibration → U7 nghiệm thu. U2 thay đổi descriptor/preprocess là nhánh thí nghiệm độc lập, tránh thay nhiều biến đồng thời. Mọi code behavior chỉ bắt đầu khi phạm vi được xác nhận theo kế hoạch.

## 7. Cách quyết định CLS hay hybrid bằng dữ liệu

Thí nghiệm đầu tiên nên so sánh **hai pipeline đúng profile** trên cùng query camera và cùng tập SKU reference có coverage cân bằng: CLS legacy hiện hữu vs hybrid hiện hữu. Báo hai kết quả: chung SKU để so chất lượng và toàn catalogue để thấy coverage. Giữ filters, candidate budget và ranking rules tương đương; hiệu chỉnh threshold trên dev theo từng profile, không mặc định cosine 0.55 mang cùng ý nghĩa.

Đây là so sánh end-to-end, chưa tách ảnh hưởng pooling với preprocessing. Nếu cần hiểu nguyên nhân, bước sau giữ input/backbone cố định để so CLS với GeM/edge pooling trong sandbox offline; descriptor khác phải có profile/version riêng trước mọi index write được duyệt.

Chưa cần dual-profile online: thêm union hai index sẽ tăng vận hành, latency và calibration trước khi biết recall bổ sung. Chỉ đưa CLS thành kênh recall bổ sung nếu ablation chứng minh lợi ích độc lập; không cộng trực tiếp cosine khác profile. Không chạy lại full inference catalogue hoặc lập chỉ mục ngoài Trung tâm Vector AI/authorization.

Metric quyết định: Top-1, Recall@10, candidate recall, độ giữ target khi length-only, false-exclusion, nhóm có/không length, ảnh chói/nền/góc chụp, chi phí inference và P95 trên thiết bị. Unknown negatives cần nhãn để đo abstain/false accept. Dữ liệu ảnh camera/manifest hiện thiếu nên chưa thực hiện được A/B này; không đưa tỷ lệ cải thiện dự đoán.

## 8. Kết luận quyết định ở thời điểm này

- **Nên tiếp tục hybrid hiện hữu cho đợt uplevel**, giữ model và descriptor cố định để xác định tác dụng của harness.
- **CLS vẫn phù hợp làm baseline khoa học và ứng viên recall tương lai**, chưa có bằng chứng buộc phải bỏ CLS hoặc khẳng định hybrid luôn tốt hơn.
- **Tiền đề dài hạn là contract đúng profile + length-first recall + evidence reliable + evaluation**, không phải tên hybrid.
- Không cần width đầy đủ để bắt đầu hoặc nghiệm thu tìm kiếm theo length.
- Không sửa .env, profile production, vector, migration hay deploy trong khảo sát này. `Plan_uplevel.md` gốc chưa thay; tài liệu này ghi rõ các chỉnh sửa được đề xuất và quyết định nghiệp vụ mới.

Bổ sung nghiệp vụ mới nhất 2026-10-21: chủ dự án chốt camera landscape khi cầm ngang (Android+iPhone Safari), nhận dạng cả lỗ kín và khoét hở, số đo nhập tay lệch<=5% được chấp nhận. Mức manual10% trong các phần trước là lịch sử/code hiện hành, không còn là đề xuất nghiệp vụ mới. Xem [nghiên cứu chi tiết](HARNESS_CAPTURE_HOLE_RESEARCH.md); chưa thay code hoặc authorization rebuild.
