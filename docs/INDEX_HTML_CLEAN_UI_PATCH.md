# index.html — Clean UI Patch

Current production UI should be simplified.

## Header

Replace:

```text
Denis
Catalogue Intelligence Assistant
```

with:

```text
Thư ký Kim
Trợ lý tra cứu linh kiện
```

## Remove public model pills

Do not show:

```text
Filter
Analyst
Resolver
```

## Welcome

Use exactly:

```text
Chào anh, em là Thư ký Kim. Em có thể giúp gì cho anh?
```

## Do not show internals

Never render in production chat:

```text
Mode:
AI calls:
Gemini
Gemma
OpenRouter
Provider returned error
timeout
candidate_pool_hash
deterministic filter
strong deterministic filter
```

## Message binding

Old:

```js
text = payload.summary || payload.error || ...
```

New:

```js
text = payload.user_message
```

Candidates:

```js
candidates = (payload.candidates || []).slice(0,5)
```

Warnings in production chat:

```js
warnings = []
```

## Public error

```text
Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé.
```

## No match

```text
Xin lỗi anh, em không tìm thấy kết quả phù hợp với yêu cầu này trong catalogue.
```

## Unsupported

```text
Xin lỗi anh, yêu cầu này em chưa được học. Anh giúp em hỏi nội dung liên quan đến catalogue nhé!
```

## Found

```text
Em tìm thấy 3 mã phù hợp:
1. 3430410301
2. 3405040101
3. 3464340001
```

Candidate cards stay below.
