const STOPWORDS = new Set([
  "anh","em","giup","tim","loc","cho","con","hang","linh","kien",
  "image","photo","hinh","anh","nay","phan","tich","giong","search",
  "find","please","the","and","voi","cua","trong","tren","duoi",
  "nhung","cac","co","mot","nhieu","duoc","thuoc","dang","day","do"
]);

const COLORS = {
  gray:["xam","gray","grey"],
  black:["den","black"],
  white:["trang","white"],
  red:["do","red"],
  blue:["xanh duong","blue"],
  green:["xanh la","green"],
  yellow:["vang","yellow"],
  brown:["nau","brown"],
  beige:["beige","kem","cream"]
};

function norm(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/g,"d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

export function normalizeText(value) {
  return norm(value);
}

export function extractTextConstraints(message) {
  const raw = String(message || "");
  const n = norm(raw);

  const terms = raw
    .split(/[\s,;:()\/]+/)
    .map(norm)
    .filter(x => x.length >= 3 && !STOPWORDS.has(x));

  const colors = [];
  for (const [canonical, aliases] of Object.entries(COLORS)) {
    if (aliases.some(a => n.includes(norm(a)))) colors.push(canonical);
  }

  const holeMatches = [...raw.matchAll(/(\d+)\s*(?:lỗ|lo|hole|holes)/gi)];
  const holeCount = holeMatches.length ? Number(holeMatches[0][1]) : -1;

  const exactTokens = raw.match(/[A-Za-z0-9][A-Za-z0-9._-]{3,}/g) || [];

  const usageSide =
    /\b(left|ben trai|trai)\b/.test(n) ? "left" :
    /\b(right|ben phai|phai)\b/.test(n) ? "right" :
    /\b(both|ca hai|hai ben)\b/.test(n) ? "both" :
    "all";

  return {
    normalized:n,
    terms:[...new Set(terms)].slice(0,12),
    colors:[...new Set(colors)],
    hole_count:Number.isFinite(holeCount) ? holeCount : -1,
    exact_tokens:[...new Set(exactTokens)].sort((a,b)=>b.length-a.length).slice(0,6),
    usage_side:usageSide,
    strong_constraint_count:
      (colors.length ? 1 : 0) +
      (holeCount >= 0 ? 1 : 0) +
      (terms.length >= 2 ? 1 : 0) +
      (usageSide !== "all" ? 1 : 0)
  };
}
