import { normalizeText } from "./textConstraints.js";

const COLOR_WORDS = {
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

function rowText(row) {
  return normalizeText([
    row.code,
    row.part_id,
    row.identifying_features,
    row.confusing_note,
    row.usage_side,
    row.view_mode
  ].join(" "));
}

function explicitHoleCounts(text) {
  return [...String(text || "").matchAll(/(\d+)\s*(?:lo|hole|holes)/gi)]
    .map(m => Number(m[1]))
    .filter(Number.isFinite);
}

function signatureTerms(signature) {
  if (!signature) return [];

  return [
    signature.object_family,
    ...(signature.dominant_colors || []),
    ...(signature.hole_layout || []),
    ...(signature.material_appearance || []),
    ...(signature.silhouette || []),
    ...(signature.mounting_features || []),
    ...(signature.distinctive_features || [])
  ].map(normalizeText).filter(x => x.length >= 3);
}

export function scoreMetadata(row, constraints, signature=null) {
  const text = rowText(row);
  let score = 0;
  const matched = [];
  const unknown = [];
  const conflicts = [];

  for (const token of constraints.exact_tokens || []) {
    const t = normalizeText(token);
    if (normalizeText(row.code) === t) {
      score += 120; matched.push("exact code");
    } else if (normalizeText(row.part_id) === t) {
      score += 110; matched.push("exact part_id");
    } else if (text.includes(t)) {
      score += 35; matched.push(`token:${token}`);
    }
  }

  for (const term of constraints.terms || []) {
    const t = normalizeText(term);
    if (!t) continue;
    if (text.includes(t)) {
      score += 12; matched.push(`metadata:${term}`);
    }
  }

  for (const term of signatureTerms(signature)) {
    if (text.includes(term)) {
      score += 10; matched.push(`visual-term:${term}`);
    }
  }

  const requestedHoleCount =
    Number.isFinite(signature?.hole_count) && signature.hole_count >= 0
      ? signature.hole_count
      : constraints.hole_count;

  if (Number.isFinite(requestedHoleCount) && requestedHoleCount >= 0) {
    const counts = explicitHoleCounts(text);

    if (counts.includes(requestedHoleCount)) {
      score += 32;
      matched.push(`${requestedHoleCount} holes`);
    } else if (counts.length) {
      score -= 28;
      conflicts.push(`hole count metadata=${counts.join("/")} vs query=${requestedHoleCount}`);
    } else {
      unknown.push(`hole count ${requestedHoleCount}`);
    }
  }

  for (const color of constraints.colors || []) {
    const aliases = COLOR_WORDS[color] || [color];
    const hasRequested = aliases.some(a => text.includes(normalizeText(a)));

    if (hasRequested) {
      score += 10;
      matched.push(`color:${color}`);
    } else {
      const otherExplicit = Object.entries(COLOR_WORDS)
        .filter(([c]) => c !== color)
        .some(([,als]) => als.some(a => text.includes(normalizeText(a))));

      if (otherExplicit) {
        score -= 10;
        conflicts.push(`color conflict:${color}`);
      } else {
        unknown.push(`color:${color}`);
      }
    }
  }

  if (constraints.usage_side && constraints.usage_side !== "all") {
    const side = normalizeText(row.usage_side);
    if (side === constraints.usage_side || side === "both") {
      score += 18;
      matched.push(`side:${constraints.usage_side}`);
    } else if (side && side !== "unknown") {
      score -= 25;
      conflicts.push(`side:${side}`);
    } else {
      unknown.push(`side:${constraints.usage_side}`);
    }
  }

  if (signature?.object_family) {
    const fam = normalizeText(signature.object_family);
    if (fam && text.includes(fam)) {
      score += 22;
      matched.push(`family:${signature.object_family}`);
    }
  }

  if (String(row.identifying_features || "").trim()) score += 3;
  if (String(row.confusing_note || "").trim()) score += 2;

  return {
    score,
    matched:[...new Set(matched)].slice(0,10),
    unknown:[...new Set(unknown)].slice(0,8),
    conflicts:[...new Set(conflicts)].slice(0,8)
  };
}

export function rankMetadata(rows, constraints, signature=null) {
  return (rows || [])
    .map(row => ({row, meta:scoreMetadata(row,constraints,signature)}))
    .sort((a,b) => b.meta.score - a.meta.score);
}
