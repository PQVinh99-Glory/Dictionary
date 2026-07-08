# Thư ký Kim V5.4 — Retrieval Recovery

## Vấn đề sửa

### Text search

Cũ:

```text
"Tìm mã có 4 lỗ"
-> nguyên câu vào app_search_catalogue
-> 0 rows
```

Mới:

```text
parse constraints
-> hole_count=4
-> search anchors "4 lỗ", "4 lo"
-> fallback scan only when retrieval weak
-> strict deterministic filtering
-> Top 5
```

Hỗ trợ:
- số lỗ
- oval / tròn / chữ nhật / vuông
- trái / phải / cả hai
- màu cơ bản
- keyword metadata

### Image search

Không giả vờ vector đã hoạt động.

Image search cần một trong:

```text
query_embedding từ client
```

hoặc:

```text
KIM_EMBEDDING_ENDPOINT
```

Health mới báo rõ readiness.

## Replace on GitHub

```text
functions/_lib/kim/v5/retrieval/textConstraints.js   ADD
functions/_lib/kim/v5/retrieval/metadataFilter.js    REPLACE
functions/_lib/kim/v5/orchestrator.js                REPLACE
functions/_lib/kim/v5/vector/encoder.js              REPLACE
functions/api/kim/search.js                          REPLACE
functions/api/kim/health.js                          REPLACE
```

## Test order

1. `/api/kim/health`
2. `Tìm mã có 4 lỗ`
3. `tìm giúp anh mã nào có hình oval`
4. exact code
5. image query

Image test chỉ kỳ vọng chạy khi `vector.ready=true`.
