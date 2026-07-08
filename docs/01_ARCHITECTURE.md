# 01 — Kiến trúc Thư ký Kim V5

## Tổng thể

```text
USER
│
├─ text
└─ image
    │
    ▼
[Query Gateway]
    │
    ├─ Exact code/ID?
    │    └─ yes -> 0 AI -> result
    │
    ├─ Text-only strong metadata?
    │    └─ yes -> 0 AI -> result
    │
    └─ Has image
         │
         ▼
[L0 Image Intake]
  - EXIF/orientation normalization
  - resize
  - image hash
  - quality score
         │
         ▼
[L1 Foreground Pipeline]
  - background complexity gate
  - background removal only when useful
  - main object mask
  - bounding box
  - padding
  - canonical crop
         │
         ▼
[L2 Multi-view Canonicalization]
  - original crop
  - masked crop
  - optional grayscale/contrast-normalized crop
         │
         ▼
[L3 Visual Encoder]
  - same model/version for query and library
  - DINOv2 ViT-S
  - normalized 384D vector
         │
         ▼
[L4 Vector Retrieval]
  - pgvector halfvec(384)
  - HNSW cosine
  - Top 30
         │
         ▼
[L5 Deterministic Fusion]
  - vector similarity
  - masked similarity
  - metadata similarity
  - hole/shape constraints
  - orientation guards
  - confusion notes
  -> Top 8–12
         │
         ▼
[Ambiguity Gate]
  ├─ clear -> Top 5
  └─ hard
      │
      ▼
[Agent A — Gemini Visual Compatibility Resolver]
  - query image
  - candidate images
  - metadata
  - vector scores
  - structural evidence
      │
      ▼
[Judge Gate]
  ├─ confidence gap sufficient -> Top 5
  └─ ambiguous/conflict
      │
      ▼
[Agent B — Gemma Critic/Judge]
      │
      ▼
[Top 5 Apply Guard]
      │
      ▼
Catalogue UI filters to Top 5
```

## Vì sao tốt hơn V4 cũ

V4 cũ:

```text
ảnh
-> AI signature
-> metadata
-> AI resolver
```

Điểm yếu:
- nếu AI signature lỗi thì toàn pipeline gãy;
- metadata có thể bias candidate pool;
- cùng prompt dễ sinh cùng Top 5;
- image retrieval chưa phải nearest-neighbor thật.

V5:

```text
ảnh
-> embedding
-> nearest neighbors
-> AI chỉ rerank
```

Vector search chịu trách nhiệm "tìm gần".
AI chịu trách nhiệm "giải thích và phân xử".

## Hai vector hay một vector?

Khuyến nghị:

### Giai đoạn đầu

```text
1 vector chính / asset
= canonical foreground crop
```

### Khi dữ liệu khó hơn

```text
2 vector / asset
1. original-crop vector
2. masked-crop vector
```

Không nên tạo quá nhiều vector ngay.

## Fusion score đề xuất

Bản đầu:

```text
final_score =
  0.65 * vector_similarity
+ 0.15 * metadata_score
+ 0.10 * structural_score
+ 0.10 * masked_vector_similarity
```

Nếu chưa lưu masked vector:

```text
final_score =
  0.75 * vector_similarity
+ 0.15 * metadata_score
+ 0.10 * structural_score
```

Các trọng số phải được hiệu chỉnh bằng bộ test thật của anh.
