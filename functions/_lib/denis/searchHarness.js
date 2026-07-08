import { getDenisConfig } from "./config.js";
import { validateSession, searchCatalogue, scanCatalogue } from "./supabase.js";
import { callJsonModel } from "./openrouter.js";
import { DENIS_IDENTITY, OBSERVATION_SCHEMA, VERIFY_SCHEMA } from "./prompts.js";

function norm(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))];
}

function rowText(row) {
  return norm([
    row.code,
    row.part_id,
    row.identifying_features,
    row.confusing_note,
    row.usage_side,
    row.view_mode
  ].join(" "));
}

function visibleFeatureTerms(obs) {
  return unique([
    obs?.object_family,
    ...(obs?.dominant_colors || []),
    ...(obs?.geometry || []),
    ...(obs?.visible_features || []),
    ...(obs?.orientation_cues || []),
    ...(obs?.search_terms || [])
  ]).filter(Boolean);
}

function extractVietnameseHints(message) {
  const n = norm(message);
  const hints = [];
  const map = [
    ["bushing", ["bushing","bac lot","bac","cao su","rubber"]],
    ["mau xam", ["xam","gray","grey"]],
    ["mau den", ["den","black"]],
    ["mau trang", ["trang","white"]],
    ["lo", ["lo","hole","holes"]],
    ["flange", ["flange","vien","gờ","go"]],
    ["ngam", ["ngam","clip","hook"]],
    ["oval", ["oval","bau duc"]],
    ["tron", ["tron","round"]]
  ];
  for (const [label, keys] of map) {
    if (keys.some(k => n.includes(norm(k)))) hints.push(label);
  }
  return hints;
}

function scoreRow(row, message, observation) {
  const text = rowText(row);
  const code = norm(row.code);
  const partId = norm(row.part_id);
  const raw = norm(message);
  let score = 0;
  const matched = [];
  const unknown = [];
  const conflicts = [];

  const terms = unique([
    ...extractVietnameseHints(message),
    ...visibleFeatureTerms(observation),
    ...String(message || '').split(/[\s,;:()]+/).filter(x => x.length >= 3)
  ]).map(norm).filter(x => x.length >= 2);

  for (const term of terms) {
    if (!term) continue;
    if (code === term || partId === term) {
      score += 80; matched.push(`khớp mã/ID: ${term}`);
    } else if (text.includes(term)) {
      score += 16; matched.push(`metadata có: ${term}`);
    } else {
      unknown.push(`chưa thấy trong metadata: ${term}`);
    }
  }

  if (raw && text.includes(raw)) {
    score += 35;
    matched.push("khớp cụm mô tả");
  }

  // Hole count cues. Conservative: only reward if text contains same count.
  const holeMentions = [...String(message || '').matchAll(/(\d+)\s*(lỗ|lo|hole|holes)/gi)].map(m => m[1]);
  for (const count of holeMentions) {
    if (new RegExp(`\\b${count}\\b`).test(text) && /(lo|lỗ|hole|holes)/.test(text)) {
      score += 25; matched.push(`khớp số lỗ: ${count}`);
    } else {
      unknown.push(`số lỗ ${count} chưa xác nhận trong metadata`);
    }
  }

  // Prefer records with useful identifying text.
  if (String(row.identifying_features || '').trim()) score += 4;
  if (String(row.confusing_note || '').trim()) score += 3;

  return {score, matched:unique(matched).slice(0,8), unknown:unique(unknown).slice(0,6), conflicts};
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row?.id ?? `${row?.code}|${row?.part_id}`);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

async function observeQueryImage(config, message, imageDataUrl) {
  return await callJsonModel(config, {
    model:config.visionModel,
    messages:[
      {role:"system", content:DENIS_IDENTITY},
      {
        role:"user",
        content:[
          {
            type:"text",
            text:`Analyze this query image for industrial component retrieval.
Focus on: object family, dominant color, approximate hole count if visible, holes/slots/notches, flange/rim, rubber/plastic/metal look, orientation cues, shape silhouette, and distinctive features.
Do not infer absolute size without scale.
User note: ${message}`
          },
          {type:"image_url", image_url:{url:imageDataUrl}}
        ]
      }
    ],
    schemaName:"denis_query_image_observation",
    schema:OBSERVATION_SCHEMA,
    temperature:0.05,
    maxTokens:1000
  });
}

async function retrieve(env, token, message, observation, config) {
  const terms = unique([
    ...extractVietnameseHints(message),
    ...visibleFeatureTerms(observation),
    String(message || '').slice(0,120)
  ]).slice(0,8);

  const pages = [];
  for (const q of terms.length ? terms : [""]) {
    try {
      const rows = await searchCatalogue(env, token, {
        search:q,
        usageSide:"all",
        viewMode:"all",
        limit:40,
        offset:0
      });
      pages.push(...rows);
    } catch (_) {}
  }

  // If retrieval is too narrow, scan bounded catalogue metadata.
  if (pages.length < 12) {
    try {
      const scan = await scanCatalogue(env, token, {
        search:"",
        usageSide:"all",
        viewMode:"all",
        maxRows:config.maxScanRows
      });
      pages.push(...scan);
    } catch (_) {}
  }

  return dedupeRows(pages);
}

function publicCandidate(row, scored, verification) {
  const v = verification?.get(String(row.id));
  const score = Number(v?.match_score ?? Math.max(0, Math.min(1, scored.score / 100)));
  return {
    id:row.id,
    code:row.code,
    part_id:row.part_id,
    usage_side:row.usage_side,
    view_mode:row.view_mode,
    is_symmetric:!!row.is_symmetric,
    identifying_features:row.identifying_features,
    confusing_note:row.confusing_note,
    thumb_path:row.thumb_path,
    front_path:row.front_path,
    fallback_path:row.fallback_path,
    thumb_provider:row.thumb_provider,
    front_provider:row.front_provider,
    fallback_provider:row.fallback_provider,
    score,
    match_reason:v?.reason || scored.matched.join(", ") || "được chọn bởi metadata + đặc điểm ảnh",
    matched:v?.matched || scored.matched,
    unknown:v?.unknown || scored.unknown,
    conflicts:v?.conflicts || scored.conflicts
  };
}

function r2Path(row) {
  return row?.thumb_path || row?.front_path || row?.fallback_path || "";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i=0; i<bytes.length; i+=chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
  }
  return btoa(binary);
}

async function r2ImageDataUrl(env, path, maxBytes=900_000) {
  if (!env.CATALOGUE_BUCKET || !path) return null;
  const object = await env.CATALOGUE_BUCKET.get(String(path).replace(/^\/+/, ""));
  if (!object) return null;
  if (Number(object.size || 0) > maxBytes) return null;
  const buffer = await new Response(object.body).arrayBuffer();
  const contentType = object.httpMetadata?.contentType || "image/webp";
  return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
}

async function verifyTop(env, config, message, imageDataUrl, ranked) {
  const top = ranked.slice(0, Math.min(5, config.verifyTopK || 4));
  if (!imageDataUrl || !top.length) return null;

  const candidatePayload = top.map(({row, scored}) => ({
    candidate_id:String(row.id),
    code:row.code,
    part_id:row.part_id,
    usage_side:row.usage_side,
    identifying_features:row.identifying_features,
    confusing_note:row.confusing_note,
    retrieval_matched:scored.matched,
    retrieval_unknown:scored.unknown
  }));

  const content = [
    {type:"text", text:`${DENIS_IDENTITY}

Task: rank the candidates against the QUERY IMAGE.
Focus on visible structure: hole count, slots, shape silhouette, flange/rim, color, material look, edges, and distinctive features.
Do not reject a candidate only because metadata is missing a visible feature.
Return conservative Top matches.

User request: ${message}

Candidate metadata:
${JSON.stringify(candidatePayload)}`},
    {type:"text", text:"QUERY IMAGE:"},
    {type:"image_url", image_url:{url:imageDataUrl}}
  ];

  for (const {row} of top) {
    const img = await r2ImageDataUrl(env, r2Path(row)).catch(() => null);
    content.push({type:"text", text:`CANDIDATE ${String(row.id)} — ${row.code || ""}`});
    if (img) content.push({type:"image_url", image_url:{url:img}});
  }

  try {
    return await callJsonModel(config, {
      model:config.visionModel,
      messages:[
        {role:"system", content:DENIS_IDENTITY},
        {role:"user", content}
      ],
      schemaName:"denis_top5_verify",
      schema:VERIFY_SCHEMA,
      temperature:0.05,
      maxTokens:1400
    });
  } catch (e) {
    return {
      rankings:[],
      ambiguous:true,
      summary:`Vision verification provider lỗi: ${e?.message || "unknown"}`
    };
  }
}

export async function runDenisSearch(env, {token, message="", imageDataUrl=null, topK=5}) {
  const config = getDenisConfig(env);
  const session = await validateSession(env, token);
  if (!session.ok) {
    const error = new Error(session.message);
    error.status = session.status;
    throw error;
  }

  let observation = null;
  const evidence = [];
  const warnings = [];

  if (imageDataUrl) {
    try {
      observation = await observeQueryImage(config, message, imageDataUrl);
      const terms = visibleFeatureTerms(observation);
      evidence.push(`Vision quan sát: ${terms.slice(0,8).join(", ") || "có ảnh query"}`);
      if (observation.uncertainties?.length) warnings.push(...observation.uncertainties.slice(0,3));
    } catch (e) {
      warnings.push(`Vision observation lỗi: ${e?.message || "provider error"}`);
    }
  }

  const rows = await retrieve(env, token, message, observation, config);
  const ranked = rows
    .map(row => ({row, scored:scoreRow(row, message, observation)}))
    .filter(x => x.scored.score > 0 || rows.length <= 30)
    .sort((a,b) => b.scored.score - a.scored.score)
    .slice(0, Math.max(12, topK * 3));

  const verification = imageDataUrl ? await verifyTop(env, config, message, imageDataUrl, ranked) : null;
  const vMap = new Map((verification?.rankings || []).map(v => [String(v.candidate_id), v]));

  const final = [...ranked]
    .sort((a,b) => {
      const av = vMap.get(String(a.row.id))?.match_score;
      const bv = vMap.get(String(b.row.id))?.match_score;
      if (av !== undefined || bv !== undefined) return Number(bv ?? -1) - Number(av ?? -1);
      return b.scored.score - a.scored.score;
    })
    .slice(0, topK)
    .map(x => publicCandidate(x.row, x.scored, vMap));

  const summary = final.length
    ? `Denis đã lọc Top ${final.length} dựa trên ${imageDataUrl ? "ảnh query + " : ""}metadata. Kết quả đã được áp dụng trực tiếp lên giao diện catalogue.`
    : "Denis chưa tìm được ứng viên đủ tốt trong catalogue.";

  if (verification?.summary) evidence.push(`Vision verify: ${verification.summary}`);
  if (verification?.ambiguous) warnings.push("Kết quả có thể còn mơ hồ; nên mở từng candidate để đối chiếu ảnh chi tiết.");

  return {
    answer:summary,
    summary,
    observation,
    evidence:unique(evidence).slice(0,8),
    warnings:unique(warnings).slice(0,8),
    candidates:final,
    debug:{
      retrieved:rows.length,
      ranked:ranked.length,
      vision_observation:!!observation,
      vision_verification:!!verification,
      top_k:topK
    }
  };
}
