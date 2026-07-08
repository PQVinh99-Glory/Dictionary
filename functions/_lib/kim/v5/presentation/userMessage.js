function clean(v){ return String(v ?? "").trim(); }
function codeOf(c){ return clean(c?.code || c?.part_id || c?.id || c?.record_id); }
function idOf(c){ return clean(c?.part_id || ""); }

function listCandidates(rows, limit=5){
  return (rows || []).slice(0,limit).map((c,i)=>{
    const code = codeOf(c) || "Không rõ mã";
    const id = idOf(c);
    return `${i+1}. ${code}${id && id !== code ? ` — ID: ${id}` : ""}`;
  });
}

export const KIM_PUBLIC_MESSAGES = Object.freeze({
  welcome:"Chào anh, em là Thư ký Kim. Em có thể giúp gì cho anh?",
  noMatch:"Xin lỗi anh, em không tìm thấy kết quả phù hợp với yêu cầu này trong catalogue.",
  unsupported:"Xin lỗi anh, yêu cầu này em chưa được học. Anh giúp em hỏi nội dung liên quan đến catalogue nhé!",
  temporaryError:"Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé."
});

export function buildKimUserMessage(result){
  const rows = Array.isArray(result?.candidates) ? result.candidates : [];
  const mode = clean(result?.mode).toUpperCase();
  const decision = clean(result?.decision).toLowerCase();

  if(mode === "KIM_UNSUPPORTED") return KIM_PUBLIC_MESSAGES.unsupported;

  if(mode.includes("NO_MATCH") || mode === "KIM_NO_MATCH" ||
     (!rows.length && decision !== "ambiguous")){
    return KIM_PUBLIC_MESSAGES.noMatch;
  }

  if(rows.length){
    return `Em tìm thấy ${rows.length} mã phù hợp:\n${listCandidates(rows).join("\n")}`;
  }

  if(decision === "ambiguous"){
    return "Em tìm thấy vài mã khá giống nhau nhưng chưa đủ chắc chắn để kết luận. Anh giúp em bổ sung thêm ảnh hoặc đặc điểm nhận dạng nhé.";
  }

  return KIM_PUBLIC_MESSAGES.noMatch;
}
