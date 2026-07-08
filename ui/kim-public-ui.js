export const KIM_WELCOME =
  "Chào anh, em là Thư ký Kim. Em có thể giúp gì cho anh?";

export function kimMessageFromApi(payload){
  return String(
    payload?.user_message ||
    "Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé."
  );
}

export function kimCandidatesFromApi(payload){
  return Array.isArray(payload?.candidates)
    ? payload.candidates.slice(0,5)
    : [];
}

// Production UI never renders:
// debug.mode, debug.ai_calls, debug.warnings,
// provider names, provider timeouts, provider payloads.
