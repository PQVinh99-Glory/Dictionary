# DENIS_DEPLOY_CLOUDFLARE.md

## 1. Mục tiêu

Denis V1 là AI assistant chạy trên dữ liệu catalogue thật:

```text
Current Dictionary UI
  -> /api/denis/chat
  -> Denis Harness
     -> Supabase RPC hiện tại
     -> R2 binding khi cần candidate image
     -> OpenRouter 3-model router
```

Không đổi:
- metadata;
- RPC;
- RLS;
- save order;
- R2 upload;
- Worker cũ;
- object key.

## 2. Ba model mặc định

```text
Planner / Language:
google/gemma-4-26b-a4b-it:free

Vision / Eyes:
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free

Judge / Second opinion:
google/gemma-4-31b-it:free
```

Tất cả đều override được bằng Environment Variables.

## 3. Copy source vào GitHub repo

Cấu trúc:

```text
Dictionary/
├── index.html
└── functions/
    ├── _lib/
    │   └── denis/
    │       ├── config.js
    │       ├── harness.js
    │       ├── openrouter.js
    │       ├── prompts.js
    │       └── supabase.js
    └── api/
        ├── denis/
        │   ├── chat.js
        │   └── health.js
        └── media/
            └── [[path]].js
```

Giữ nguyên `functions/api/upload*` đang chạy của anh.

## 4. Cloudflare Pages Variables and Secrets

Project:

```text
dictionary-dnw
```

Thêm Secret:

```text
OPENROUTER_API_KEY
```

Thêm Variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY

DENIS_MODEL_PLANNER
DENIS_MODEL_VISION
DENIS_MODEL_JUDGE
DENIS_JUDGE_ENABLED
DENIS_MAX_CANDIDATES
DENIS_VERIFY_TOP_K
DENIS_MAX_SCAN_ROWS
OPENROUTER_APP_NAME
OPENROUTER_HTTP_REFERER
```

Chỉ 3 biến bắt buộc cho Denis:
- OPENROUTER_API_KEY
- SUPABASE_URL
- SUPABASE_ANON_KEY

Model variables có default sẵn.

## 5. R2 Binding

Giữ binding hiện có:

```text
CATALOGUE_BUCKET
```

Denis dùng binding này chỉ để lấy tối đa Top-K candidate images cho Vision verification.
Không scan 1000 ảnh.

## 6. Redeploy

Sau khi thêm Secret/Variables:
- tạo deployment mới;
- chờ Pages deploy hoàn tất.

## 7. Test Health

Mở:

```text
https://dictionary-dnw.pages.dev/api/denis/health
```

Kỳ vọng:

```json
{
  "ok": true,
  "service": "denis-catalogue-ai",
  "status": "configured",
  "models": {
    "planner": "...",
    "vision": "...",
    "judge": "..."
  }
}
```

## 8. Test UI

1. Mở `/`.
2. Đăng nhập.
3. Ctrl+F5.
4. Nút Denis xuất hiện góc phải dưới.
5. Hỏi:

```text
Tìm mã 7150050001
```

Exact lookup có thể trả lời không cần model.

6. Hỏi:

```text
Tìm các bushing màu xám, nếu metadata thiếu màu thì đừng loại ngay.
```

7. Đính kèm ảnh và hỏi:

```text
Tìm linh kiện giống ảnh này, ưu tiên màu xám, không có flange.
```

## 9. Luồng model

### Exact
```text
Text
-> deterministic exact retrieval
-> 0 AI nếu khớp chính xác
```

### Complex text
```text
Text
-> Gemma 4 26B planner
-> RPC retrieval
-> deterministic rerank
-> Gemma 4 26B evidence answer
```

### Image
```text
Image
-> Nemotron Omni independent observation
-> metadata retrieval
-> Top 12 deterministic rerank
-> Top 4 Nemotron Vision verification
-> ambiguity?
   -> Gemma 4 31B judge
-> Gemma 4 26B final answer
```

## 10. V1 safety boundary

Denis V1 là READ-ONLY.

Denis không:
- sửa metadata;
- xóa mã;
- upload asset;
- gọi save RPC;
- tự tạo DB field.

Sau khi eval ổn mới thêm write tools có confirmation.
