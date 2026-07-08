import {
  parseTextConstraints,
  normalizedText
} from "./textConstraints.js";

function rowText(row) {
  return normalizedText([
    row?.code,
    row?.part_id,
    row?.identifying_features,
    row?.confusing_note,
    row?.usage_side,
    row?.view_mode
  ].filter(Boolean).join(" "));
}

function candidateHoleCount(text) {
  const patterns = [
    /(?:^|\s)(\d+)\s*(?:lo|hole|holes)(?:\s|$)/i,
    /(?:^|\s)(\d+)\s*(?:holes?)(?:\s|$)/i
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }

  return null;
}

function shapeMatched(shape, text) {
  if (!shape) return null;

  const map = {
    oval:/\b(?:oval|bau duc|ellipse|elliptical)\b/i,
    round:/\b(?:tron|round|circular)\b/i,
    rectangular:/\b(?:chu nhat|rectangular|rectangle)\b/i,
    square:/\b(?:vuong|square)\b/i,
    l_shape:/\b(?:chu l|l shape|l-shaped)\b/i,
    u_shape:/\b(?:chu u|u shape|u-shaped)\b/i
  };

  return !!map[shape]?.test(text);
}

function sideMatched(side, text) {
  if (!side) return null;

  if (side === "left") return /\b(?:trai|left|lhf)\b/i.test(text);
  if (side === "right") return /\b(?:phai|right|rhf)\b/i.test(text);
  if (side === "both") return /\b(?:ca hai|hai ben|both)\b/i.test(text);

  return null;
}

function colorMatched(color, text) {
  if (!color) return null;

  const map = {
    gray:/\b(?:xam|ghi|gray|grey)\b/i,
    black:/\b(?:den|black)\b/i,
    white:/\b(?:trang|white)\b/i,
    green:/\b(?:xanh la|green)\b/i,
    blue:/\b(?:xanh duong|blue)\b/i,
    red:/\b(?:do|red)\b/i,
    yellow:/\b(?:vang|yellow)\b/i
  };

  return !!map[color]?.test(text);
}

export function evaluateConstraints(row, messageOrConstraints) {
  const c = typeof messageOrConstraints === "string"
    ? parseTextConstraints(messageOrConstraints)
    : messageOrConstraints;

  const text = rowText(row);
  const evidence = [];
  const conflicts = [];

  if (c.hole_count != null) {
    const actual = candidateHoleCount(text);

    if (actual == null) {
      // Unknown is not conflict.
    } else if (actual === c.hole_count) {
      evidence.push(`hole_count:${actual}`);
    } else {
      conflicts.push(`hole_count:${actual}`);
    }
  }

  const shape = shapeMatched(c.shape, text);
  if (shape === true) evidence.push(`shape:${c.shape}`);
  if (shape === false) conflicts.push(`shape:${c.shape}`);

  const side = sideMatched(c.side, text);
  if (side === true) evidence.push(`side:${c.side}`);
  if (side === false) conflicts.push(`side:${c.side}`);

  const color = colorMatched(c.color, text);
  if (color === true) evidence.push(`color:${c.color}`);
  if (color === false) conflicts.push(`color:${c.color}`);

  const termMatches = c.terms.filter(t => text.includes(t));
  evidence.push(...termMatches.map(t => `term:${t}`));

  return {
    constraints:c,
    evidence,
    conflicts,
    text
  };
}

export function scoreMetadata(row, message) {
  const c = parseTextConstraints(message);
  const ev = evaluateConstraints(row, c);

  let score = 0;

  if (c.hole_count != null) {
    if (ev.evidence.some(x => x.startsWith("hole_count:"))) score += 0.55;
    if (ev.conflicts.some(x => x.startsWith("hole_count:"))) score -= 0.75;
  }

  if (c.shape) {
    if (ev.evidence.includes(`shape:${c.shape}`)) score += 0.50;
    if (ev.conflicts.includes(`shape:${c.shape}`)) score -= 0.60;
  }

  if (c.side) {
    if (ev.evidence.includes(`side:${c.side}`)) score += 0.30;
    if (ev.conflicts.includes(`side:${c.side}`)) score -= 0.40;
  }

  if (c.color) {
    if (ev.evidence.includes(`color:${c.color}`)) score += 0.25;
    if (ev.conflicts.includes(`color:${c.color}`)) score -= 0.25;
  }

  if (c.terms.length) {
    const matched = c.terms.filter(t => ev.text.includes(t)).length;
    score += 0.35 * (matched / c.terms.length);
  }

  return Math.max(0, Math.min(1, score));
}

export function rankMetadata(rows, message) {
  return (rows || [])
    .map(row => ({
      ...row,
      metadata_score:scoreMetadata(row, message)
    }))
    .sort((a,b) => b.metadata_score - a.metadata_score);
}

export function strictConstraintMatches(rows, message) {
  const c = parseTextConstraints(message);

  const hasStrongConstraint =
    c.hole_count != null ||
    !!c.shape ||
    !!c.side ||
    !!c.color;

  if (!hasStrongConstraint) return [];

  return (rows || [])
    .map(row => ({
      ...row,
      _constraint:evaluateConstraints(row, c),
      metadata_score:scoreMetadata(row, message)
    }))
    .filter(row => row._constraint.conflicts.length === 0)
    .filter(row => {
      const c = row._constraint.constraints;

      if (
        c.hole_count != null &&
        !row._constraint.evidence.some(x => x.startsWith("hole_count:"))
      ) return false;

      if (
        c.shape &&
        !row._constraint.evidence.includes(`shape:${c.shape}`)
      ) return false;

      return true;
    })
    .sort((a,b) => b.metadata_score - a.metadata_score);
}

export function strongTextResult(rows, message) {
  const strict = strictConstraintMatches(rows, message);

  if (strict.length) {
    return {
      sufficient:strict.length <= 5,
      rows:strict.slice(0, 20),
      source:"strict_constraints"
    };
  }

  const ranked = rankMetadata(rows, message);
  const strong = ranked.filter(x => x.metadata_score >= 0.45);

  return {
    sufficient:strong.length > 0 && strong.length <= 5,
    rows:(strong.length ? strong : ranked).slice(0, 20),
    source:"metadata_rank"
  };
}
