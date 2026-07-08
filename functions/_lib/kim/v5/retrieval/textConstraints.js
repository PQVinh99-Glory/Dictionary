const STOPWORDS = new Set([
  "tim","giup","anh","em","cho","minh","toi","ma","nao","con","hang",
  "linh","kien","co","cua","nay","nhung","cac","mot","nhieu","duoc",
  "thuoc","dang","day","do","voi","va","theo","can","muon","xin",
  "hay","loai","cai","nhin","hinh","dang","dac","diem"
]);

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text, patterns) {
  for (const [value, re] of patterns) {
    if (re.test(text)) return value;
  }
  return null;
}

export function parseTextConstraints(message) {
  const text = norm(message);

  const holeMatch = text.match(/(?:^|\s)(\d+)\s*(?:lo|hole|holes)(?:\s|$)/i);
  const holeCount = holeMatch ? Number(holeMatch[1]) : null;

  const shape = firstMatch(text, [
    ["oval", /\b(?:oval|bau duc|ellipse|elliptical)\b/i],
    ["round", /\b(?:tron|round|circular)\b/i],
    ["rectangular", /\b(?:chu nhat|rectangular|rectangle)\b/i],
    ["square", /\b(?:vuong|square)\b/i],
    ["l_shape", /\b(?:chu l|l shape|l-shaped)\b/i],
    ["u_shape", /\b(?:chu u|u shape|u-shaped)\b/i]
  ]);

  const side = firstMatch(text, [
    ["left", /\b(?:ben trai|trai|left|lhf)\b/i],
    ["right", /\b(?:ben phai|phai|right|rhf)\b/i],
    ["both", /\b(?:ca hai|hai ben|both)\b/i]
  ]);

  const color = firstMatch(text, [
    ["gray", /\b(?:xam|ghi|gray|grey)\b/i],
    ["black", /\b(?:den|black)\b/i],
    ["white", /\b(?:trang|white)\b/i],
    ["green", /\b(?:xanh la|green)\b/i],
    ["blue", /\b(?:xanh duong|blue)\b/i],
    ["red", /\b(?:do|red)\b/i],
    ["yellow", /\b(?:vang|yellow)\b/i]
  ]);

  const terms = [...new Set(
    text.split(/\s+/)
      .filter(Boolean)
      .filter(x => x.length >= 2)
      .filter(x => !STOPWORDS.has(x))
      .filter(x => !/^\d+$/.test(x))
      .filter(x => !["lo","hole","holes"].includes(x))
  )];

  return {
    raw:String(message || ""),
    normalized:text,
    hole_count:holeCount,
    shape,
    side,
    color,
    terms
  };
}

export function buildSearchAnchors(constraints) {
  const anchors = [];

  if (constraints.hole_count != null) {
    anchors.push(`${constraints.hole_count} lỗ`);
    anchors.push(`${constraints.hole_count} lo`);
  }

  if (constraints.shape === "oval") anchors.push("oval");
  if (constraints.shape === "round") anchors.push("tròn");
  if (constraints.shape === "rectangular") anchors.push("chữ nhật");
  if (constraints.shape === "square") anchors.push("vuông");

  if (constraints.side === "left") anchors.push("trái");
  if (constraints.side === "right") anchors.push("phải");

  if (constraints.color === "gray") anchors.push("xám");
  if (constraints.color === "black") anchors.push("đen");
  if (constraints.color === "white") anchors.push("trắng");

  anchors.push(...constraints.terms.slice(0, 4));

  return [...new Set(anchors.filter(Boolean))].slice(0, 6);
}

export function normalizedText(value) {
  return norm(value);
}
