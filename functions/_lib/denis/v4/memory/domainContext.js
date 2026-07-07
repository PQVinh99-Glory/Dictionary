export const DOMAIN_CONTEXT = {
  app_name: "Catalogue Linh Kiện",
  fields: [
    "id",
    "code",
    "part_id",
    "identifying_features",
    "confusing_note",
    "usage_side",
    "view_mode",
    "is_symmetric"
  ],
  asset_types: ["thumb", "front", "back", "detail", "compare"],
  semantics: {
    identifying_features: "Mô tả nhận dạng do người dùng xác nhận.",
    confusing_note: "Ghi chú chống nhầm giữa các mã gần giống.",
    usage_side: "left/right/both/unknown; không được suy luận bằng mirror.",
    is_symmetric: "Đối xứng; không tự động xóa mọi rủi ro orientation."
  }
};
