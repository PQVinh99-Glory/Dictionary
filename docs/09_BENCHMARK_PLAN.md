# 09 — Benchmark plan

Không triển khai production chỉ vì kiến trúc nghe hợp lý.

## Tạo ground-truth set

Ít nhất:

```text
50–100 query ảnh
```

Bao gồm:
- nền sạch;
- nền phức tạp;
- ánh sáng tối;
- ánh sáng gắt;
- nghiêng 15/30/45 độ;
- zoom gần;
- crop lệch;
- có thước;
- có tay;
- linh kiện cùng family;
- left/right;
- các mã dễ nhầm.

## Metrics

### Retrieval

```text
Recall@5
Recall@10
Recall@30
MRR
```

Mục tiêu đầu:

```text
Recall@30 >= 0.95
```

Nếu mã đúng không nằm Top 30, Gemini không cứu được.

### Rerank

```text
Top1 accuracy
Top5 accuracy
ambiguity rate
abstain quality
```

## A/B profiles

Test:
- original crop
- foreground crop
- DINOv2 CLS
- DINOv2 mean pooling
- one vector
- dual vector

Không đổi nhiều biến cùng lúc.

## Production gate

Chỉ bật:

```text
KIM_VECTOR_SEARCH_ENABLED=true
```

sau khi benchmark đạt ngưỡng.
