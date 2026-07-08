# 05 — Agent roles

## Agent A — Gemini Visual Compatibility Resolver

Model configurable:

```text
DENIS_GEMINI_MODEL
```

Tên UI mới:

```text
Thư ký Kim
```

Nhiệm vụ:
- chỉ xem Top 8–10;
- không search toàn DB;
- so query image với candidates;
- xử lý góc chụp;
- xử lý ánh sáng;
- xử lý che khuất;
- phân biệt silhouette;
- hole placement;
- left/right risk;
- phân tích contradictions.

Input:
- query image;
- canonical crop;
- candidate images;
- vector scores;
- metadata;
- structural evidence.

Output:
- rankings;
- matched;
- conflicts;
- unknown;
- reason;
- ambiguity.

## Agent B — Gemma Critic/Judge

Chỉ chạy có điều kiện.

Nhiệm vụ:
- không rerun retrieval;
- không nhìn toàn database;
- không thêm ID mới;
- kiểm tra Gemini có overconfidence không;
- kiểm tra conflict;
- quyết định accept / ambiguous / abstain.

## Vì sao không cần 3 agent mặc định

Vector retrieval đã thay vai trò của "planner".

Do đó:

```text
Vector engine = retrieval planner
Gemini = resolver
Gemma = critic
```

Đơn giản hơn và tiết kiệm quota.
