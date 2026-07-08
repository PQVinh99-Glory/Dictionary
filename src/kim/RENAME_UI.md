# Rename UI — Denis -> Thư ký Kim

Replace user-facing labels only.

## Header

Old:

```text
Denis
Catalogue Intelligence Assistant
```

New:

```text
Thư ký Kim
Trợ lý tra cứu linh kiện
```

## Welcome

```text
Chào anh, em là Thư ký Kim.
Anh có thể mô tả đặc điểm hoặc gửi ảnh con hàng.
Em sẽ ưu tiên lọc nhanh bằng dữ liệu và dấu vân tay hình ảnh;
chỉ khi nhiều ứng viên quá giống nhau em mới dùng AI để phân tích sâu.
```

## Status text

```text
Đang tách vật thể chính...
Đang tạo dấu vân tay hình ảnh...
Đang tìm ứng viên gần nhất...
Đang đối chiếu đặc điểm...
Đang phân tích các mã khó...
Đang duyệt Top 5...
```

## Do not expose internal labels

Do not show:
- Agent A
- Agent B
- Gemini
- Gemma
- Vector DB

Normal user sees only:
- Thư ký Kim
- progress
- Top 5
- confidence/evidence
