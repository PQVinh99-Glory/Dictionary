# 07 — Migration plan

## Phase 0 — Freeze V4

Không sửa thêm V4 image pipeline.

Giữ:
- text filter đang chạy;
- upload R2;
- media proxy;
- Supabase RPC hiện tại.

## Phase 1 — Sidecar vectors

Thêm:
- pgvector extension;
- `catalogue_image_vectors`;
- HNSW index;
- vector RPC.

Không đổi metadata.

## Phase 2 — Reindex library

Với từng asset:
1. lấy ảnh R2;
2. preprocess;
3. foreground;
4. canonical crop;
5. embedding;
6. upsert vector.

Bắt đầu bằng:
- front;
- thumb fallback.

Không vector hóa mọi detail ngay.

## Phase 3 — Query vector

UI:
- upload ảnh;
- local preprocess;
- local embedding;
- call vector RPC;
- show raw Top 10 debug.

Chưa gọi Gemini/Gemma.

## Phase 4 — Score fusion

Thêm:
- metadata;
- structural constraints;
- orientation;
- confusion note.

## Phase 5 — Gemini resolver

Chỉ Top 8–10.

## Phase 6 — Gemma critic

Chỉ ambiguity.

## Phase 7 — Rename UI

```text
Denis
-> Thư ký Kim
```

Đổi:
- title;
- welcome;
- status;
- debug labels;
- endpoint namespace tùy chọn.

## Rollback

V4 text filter vẫn giữ.

V5 image search là additive feature flag:

```text
KIM_VECTOR_SEARCH_ENABLED=true
```
