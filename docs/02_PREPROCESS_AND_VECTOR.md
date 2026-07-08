# 02 — Tiền xử lý và vector

## Không nên luôn luôn xóa nền

Xóa nền bắt buộc có thể làm mất:
- mép mỏng;
- lỗ nhỏ;
- ngàm;
- chi tiết tối;
- bóng đổ hữu ích.

Vì vậy dùng gate:

```text
background_complexity < threshold
  -> không remove background

background_complexity >= threshold
  -> foreground extraction
```

## Canonicalization

Input:

```text
ảnh camera / ảnh upload
```

Output:

```text
canonical_224
```

Quy trình:

1. đọc EXIF orientation;
2. resize cạnh dài <= 1280;
3. xác định foreground;
4. lấy bounding box vật thể chính;
5. thêm padding 8–12%;
6. đặt vật thể vào canvas vuông;
7. nền trung tính;
8. resize về model input;
9. normalize đúng processor của model.

## Foreground strategy

### Primary

Dedicated background-removal / segmentation model.

Không dùng Gemini cho bước này.

### Fallback

Nếu segmentation fail:
- dùng original crop;
- đánh dấu `foreground_status=failed`;
- vẫn tạo vector;
- giảm confidence.

## Vector model

Khuyến nghị ban đầu:

```text
DINOv2 ViT-S
embedding_dim = 384
```

Lưu ý:
- query và library phải dùng cùng model;
- cùng pooling;
- cùng normalize;
- cùng preprocess version.

## Pooling

Không thay pooling tùy ý.

Chọn một contract duy nhất, ví dụ:

```text
CLS token
-> L2 normalize
```

Sau khi benchmark nội bộ, có thể thử:
- CLS;
- mean patch pooling;
- masked mean pooling.

Nhưng mỗi cách là một `embedding_profile` khác nhau.

## Version keys

Bắt buộc lưu:

```text
embedding_model
embedding_model_version
preprocess_version
embedding_profile
```

Ví dụ:

```text
embedding_model = dinov2_vits14
embedding_model_version = 1
preprocess_version = kim_fg_v1
embedding_profile = cls_l2_v1
```

Không bao giờ search chéo profile khác nhau.
