# 03 — Vector storage sidecar

## Không nhét vector vào metadata gốc

Tạo sidecar:

```text
catalogue_image_vectors
```

Metadata gốc vẫn giữ nguyên.

## Đề xuất record

```text
id
record_id
asset_type
object_key
view_variant
embedding_model
embedding_model_version
preprocess_version
embedding_profile
embedding halfvec(384)
foreground_status
quality_score
is_active
created_at
updated_at
```

## Dung lượng

`halfvec(384)` lưu 384 giá trị float16.

Phần dữ liệu số thực thô:

```text
384 * 2 bytes
= 768 bytes / vector
```

1.000 vector:

```text
~768,000 bytes
~0.73 MiB raw numeric payload
```

Chưa tính:
- row overhead;
- HNSW index;
- metadata columns.

Nếu 2 vector / ảnh:

```text
~1.46 MiB raw numeric payload / 1000 ảnh
```

Vì vậy với quy mô 1.000–10.000 ảnh, vector 384 chiều không phải vấn đề quá lớn nếu thiết kế sidecar đúng.

## Index

Khuyến nghị:

```text
HNSW cosine
```

## Reindex

Khi model đổi:

Không overwrite vector cũ ngay.

```text
v1 active
v2 building
v2 benchmark
switch active
retire v1
```
