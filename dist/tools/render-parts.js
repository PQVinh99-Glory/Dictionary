// Render nội dung có định dạng (in đậm, xuống dòng) MÀ KHÔNG dùng innerHTML.
// Mọi giá trị đều đi qua textContent => không thể bị XSS từ dữ liệu server.
//
// Tách thành module riêng để unit-test được (trước đây lỗi
// `const [text, opts] = {br:true}` ném ".for is not iterable" làm sập
// toàn bộ phần "Coverage Supabase" khi bấm Làm mới trạng thái).
//
// parts nhận 3 dạng phần tử:
//   "text" / 123        -> text thuần
//   { br:true }         -> xuống dòng
//   [text, opts]        -> text kèm bold/class (opts: {bold, br, class})
export function renderParts(el, parts) {
  if (!el || !Array.isArray(parts)) return;
  el.textContent = "";
  for (const part of parts) {
    if (part === null || part === undefined) continue;

    if (!Array.isArray(part) && typeof part === "object") {
      if (part.br) { el.appendChild(document.createElement("br")); continue; }
      const spanObj = document.createElement("span");
      spanObj.textContent = String(part.text ?? "");
      if (part.class) spanObj.className = part.class;
      el.appendChild(spanObj);
      continue;
    }

    const [text, opts = {}] = Array.isArray(part) ? part : [part, {}];
    if (opts.br) { el.appendChild(document.createElement("br")); continue; }
    const span = document.createElement("span");
    span.textContent = String(text ?? "");
    if (opts.bold) span.style.fontWeight = "700";
    if (opts.class) span.className = opts.class;
    el.appendChild(span);
  }
}
