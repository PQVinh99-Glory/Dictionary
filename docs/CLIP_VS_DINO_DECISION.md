# CLIP hay DINOv2?

## Kết luận

Không khuyên dùng CLIP-only cho catalogue linh kiện công nghiệp có khác biệt rất nhỏ.

## CLIP

Phù hợp:
- semantic similarity
- image-text
- query kiểu "bushing màu xám"
- zero-shot concept matching

Rủi ro:
- cùng family / cùng màu / cùng silhouette tổng quát
- chỉ khác 1 lỗ, 1 ngàm, vị trí lỗ

có thể vẫn gần nhau trong semantic space.

## DINOv2

Phù hợp hơn để benchmark làm primary visual encoder cho exact-ish image retrieval.

## Khuyến nghị V5.2

### Bản đơn giản

```text
remove.bg
  -> canonical crop
  -> DINOv2-S 384D
  -> HNSW Top 30
  -> Gemini
  -> Gemma
```

### Bản nâng cao sau benchmark

```text
shape_vector: DINOv2-S 384D
semantic_vector: CLIP 512D
```

Không bật dual-vector ngay nếu Recall@30 của single encoder đã đủ tốt.

## Quy tắc vàng

Agent chỉ rerank candidate đã retrieval.
Nếu SKU đúng không nằm Top-K, Gemini/Gemma không thể cứu ổn định.
