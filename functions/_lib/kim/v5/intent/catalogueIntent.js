const TERMS = [
  "catalogue","catalog","mã","ma hang","mã hàng","linh kiện","con hàng",
  "id","code","part","bushing","bracket","clip","hook","ngàm","ngam",
  "lỗ","lo","hole","oval","tròn","tron","trái","trai","phải","phai",
  "left","right","lhf","rhf","màu","mau","xám","xam","đen","den",
  "hình dạng","hinh dang","đặc điểm","dac diem","vị trí","vi tri",
  "giống","giong","tương tự","tuong tu"
];

function norm(v){
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().trim();
}

export function classifyCatalogueIntent(query){
  if(query?.image_data_url || Array.isArray(query?.query_embedding)){
    return {kind:"catalogue",confidence:1,reason:"image_or_embedding"};
  }

  const raw = String(query?.message || "").trim();
  const text = norm(raw);
  if(!text) return {kind:"unsupported",confidence:1,reason:"empty"};

  if(/[a-z]*\d{5,}[a-z0-9_-]*/i.test(raw.replace(/\s+/g,""))){
    return {kind:"catalogue",confidence:.95,reason:"code_like"};
  }

  const hits = TERMS.map(norm).filter(t=>t && text.includes(t));
  if(hits.length){
    return {kind:"catalogue",confidence:Math.min(1,.55+hits.length*.12),reason:"catalogue_terms"};
  }

  return {kind:"unknown",confidence:.55,reason:"no_catalogue_signal"};
}
