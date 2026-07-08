# Thư ký Kim V5 — Hybrid Vector + Vision Harness

## Mục tiêu

Nâng toàn bộ Denis thành **Thư ký Kim** và thay tư duy search ảnh:

```text
Ảnh query
  -> tiền xử lý / foreground
  -> canonical crop
  -> visual embedding
  -> vector search Top-K
  -> deterministic fusion
  -> Gemini rerank ca khó
  -> Gemma critic khi mơ hồ
  -> Top 5
  -> lọc trực tiếp catalogue UI
```

## Tư tưởng cốt lõi

- Không dùng LLM để làm việc mà thuật toán chuyên dụng làm tốt hơn.
- Không dùng Gemini để xóa nền.
- Vector retrieval là lớp tìm kiếm chính cho ảnh.
- Metadata vẫn giữ vai trò rất mạnh với query text.
- Gemini chỉ xử lý candidate khó sau retrieval.
- Gemma chỉ phản biện khi kết quả mơ hồ.
- Không đổi metadata hiện tại.
- Không đổi R2 upload/media hiện tại.
- Vector nằm ở bảng sidecar riêng.
- Không trộn embedding khác model/preprocess version.

## Agent mặc định

```text
Agent A — Gemini Visual Compatibility Resolver
Agent B — Gemma Critic/Judge (conditional)
```

Đây là cấu hình 2-agent. Không cần 3 agent mặc định.

## Model vector đề xuất

Primary:

```text
DINOv2 ViT-S
384 dimensions
```

Lý do:
- vector nhỏ;
- tập trung visual features;
- phù hợp image similarity hơn việc để LLM tự tìm từ toàn thư viện;
- không cần vector DB quá lớn.

## Gói này gồm

- Kiến trúc chi tiết
- Migration plan
- SQL sidecar vector schema
- HNSW RPC search
- Harness contracts
- Prompt contracts
- Mobile/iOS strategy
- Codex implementation prompt
- Source scaffold cho Kim V5
