/**
 * capture-subject-lock.js
 * ============================================================================
 * MORIS M27 — SUBJECT LOCKING & MASK PURITY (S1, query-side only)
 *
 * Pure TypedArray math, zero DOM dependencies, Web Worker / Node compatible.
 * Algorithms (pipeline_moris.md §10.1):
 *  1. Tap-to-lock seed + single connected component selection (largest closed contour).
 *  2. Background shadow classifier ("background x darkening factor", hue preserved).
 *  3. Specular classifier (bright, low chroma, surrounded by part body).
 *  4. Multi-frame mask voting (per-pixel majority across 3-5 frames).
 *  5. Readiness gate: 5 conditions before allowing search capture.
 *  6. Hole-shape evidence (circle/square/oval) from radial profile DFT (k=2, k=4)
 *     when the mask is reliable (pipeline_moris.md §11.5 / B13).
 *
 * This module NEVER touches canonicalization or embeddings (S1 constraint).
 * ============================================================================
 */

export const SUBJECT_LOCK_VERSION = 'subject_lock_v1';

export const DEFAULT_SUBJECT_LOCK_THRESHOLDS = {
  borderFrac: 0.04,
  regionThresholdMin: 24,
  regionThresholdMax: 80,
  shadowLumaRatioMin: 0.45,
  shadowLumaRatioMax: 0.95,
  shadowDeltaLuma: 18,
  shadowMaxDistAbs: 180,
  specularMinLuma: 190,
  specularChromaMax: 70,
  marginFrac: 0.10,
  minCoverage: 0.02,
  maxCoverage: 0.90,
  specularRatioMax: 0.18,
  sharpnessMin: 8,
  stableFrames: 3,
  otherComponentFrac: 0.08,
  otherComponentMinPx: 200,
  // Nối mảnh vỡ của cùng một vật (chói/lóa tách thân thành nhiều component):
  // hai component có khe hở bbox <= gap (px, theo minDim) được gom về một chủ thể.
  mergeGapFrac: 0.04,
  mergeGapMinPx: 3,
  mergeGapMaxPx: 14,
  holeMinArea: 8,
  holeMinAreaFrac: 0.0004,
  holeClassifyMinArea: 12,
  holeFillMin: 0.4,
  shapeBins: 48,
  circleMaxA2: 0.055,
  circleMaxA4: 0.055,
  circleMaxRadiusCV: 0.10,
  circleMaxFill: 0.92,
  squareMinA4: 0.06,
  squareMaxA4: 0.55,
  squareMaxRadiusCV: 0.50,
  // Lỗ dài (slot/stadium — mẫu "Lỗ dài", 2026-10-19): dài theo trục chính, thân
  // gần song song nên fill cao hơn ellipse (ellipse ~0.70-0.85 sau closing),
  // A4 không trội như chữ nhật.
  slotMinAspect: 1.7,
  slotMinFill: 0.88,
  slotMaxA4Ratio: 1.25,
  slotMaxRadiusCV: 0.45,
  ovalMinA2: 0.08,
  ovalMaxA2: 0.55,
  ovalMaxRadiusCV: 0.40
};

const N8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1]
];

function validateImage(data, width, height) {
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 2 || height < 2 || width * height > 16_000_000 ||
      data.length !== width * height * 4) {
    throw new Error('Invalid RGBA image buffer.');
  }
}

export function luma709(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function toGray(data, width, height) {
  validateImage(data, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const idx = i * 4;
    out[i] = Math.round(luma709(data[idx], data[idx + 1], data[idx + 2]));
  }
  return out;
}

/** Estimate background color from the outer border ring (alpha-aware). */
export function estimateBackground(data, width, height, options = {}) {
  validateImage(data, width, height);
  const borderFrac = Number(options.borderFrac) || DEFAULT_SUBJECT_LOCK_THRESHOLDS.borderFrac;
  const borderThickness = Math.max(2, Math.floor(Math.min(width, height) * borderFrac));

  let r = 0, g = 0, b = 0, count = 0, transparent = 0, total = 0;
  for (let y = 0; y < height; y++) {
    const isYBorder = y < borderThickness || y >= height - borderThickness;
    for (let x = 0; x < width; x++) {
      const isXBorder = x < borderThickness || x >= width - borderThickness;
      if (!isYBorder && !isXBorder) continue;
      total++;
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 36) { transparent++; continue; }
      r += data[idx]; g += data[idx + 1]; b += data[idx + 2];
      count++;
    }
  }

  if (!count) return { r: 240, g: 240, b: 240, luma: 240, spread: 0, transparentRatio: 1 };
  r /= count; g /= count; b /= count;

  let spreadSum = 0, spreadCount = 0;
  for (let y = 0; y < height; y += 2) {
    const isYBorder = y < borderThickness || y >= height - borderThickness;
    for (let x = 0; x < width; x += 2) {
      const isXBorder = x < borderThickness || x >= width - borderThickness;
      if (!isYBorder && !isXBorder) continue;
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 36) continue;
      spreadSum += Math.hypot(data[idx] - r, data[idx + 1] - g, data[idx + 2] - b);
      spreadCount++;
    }
  }

  return {
    r, g, b,
    luma: luma709(r, g, b),
    spread: spreadCount ? spreadSum / spreadCount : 0,
    transparentRatio: total ? transparent / total : 0
  };
}

/**
 * Pixel classification pass.
 * labels: 0 = background, 1 = part candidate, 2 = background shadow,
 *         3 = specular candidate (pre-pass, validated by neighborhood after).
 */
export function labelPixels(data, width, height, background, options = {}) {
  validateImage(data, width, height);
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };
  const total = width * height;
  const labels = new Uint8Array(total);

  const regionThreshold = Math.max(
    t.regionThresholdMin,
    Math.min(t.regionThresholdMax, 24 + background.spread * 1.35)
  );
  const shadowMaxDist = Math.min(t.shadowMaxDistAbs, Math.max(130, regionThreshold * 2.2));
  const bgLuma = background.luma || 240;

  let partPixels = 0;
  let shadowPixels = 0;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    if (data[idx + 3] < 36) continue;

    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const dist = Math.hypot(r - background.r, g - background.g, b - background.b);
    const luma = luma709(r, g, b);
    const lumaRatio = bgLuma > 0 ? luma / bgLuma : 1;

    const isShadow = dist > regionThreshold * 0.35 && dist <= shadowMaxDist &&
      lumaRatio >= t.shadowLumaRatioMin && lumaRatio <= t.shadowLumaRatioMax &&
      luma <= bgLuma - t.shadowDeltaLuma;

    if (dist > regionThreshold && luma < Math.max(160, bgLuma - 15)) {
      if (isShadow) {
        labels[i] = 2;
        shadowPixels++;
      } else {
        labels[i] = 1;
        partPixels++;
      }
      continue;
    }

    if (isShadow) {
      labels[i] = 2;
      shadowPixels++;
    }
  }

  // Specular pass: bright enclosed regions touching the part body.
  // A glare streak inside the body must become part of the mask (NOT a hole);
  // open background stays background; punched holes keep the background color
  // (<= bgLuma + margin) and are never treated as glare.
  let specularPixels = 0;
  if (partPixels > 0) {
    const effectiveMinLuma = Math.max(t.specularMinLuma, Math.min(background.luma + 6, 250));
    const bright = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (labels[i] !== 0) continue;
      const idx = i * 4;
      if (data[idx + 3] < 36) continue;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const luma = luma709(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (luma >= effectiveMinLuma && chroma <= t.specularChromaMax) bright[i] = 1;
    }

    const outsideBright = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0, tail = 0;
    const pushOutside = (x, y) => {
      const i = y * width + x;
      if (!bright[i] || outsideBright[i]) return;
      outsideBright[i] = 1;
      queue[tail++] = i;
    };
    for (let x = 0; x < width; x++) { pushOutside(x, 0); pushOutside(x, height - 1); }
    for (let y = 0; y < height; y++) { pushOutside(0, y); pushOutside(width - 1, y); }
    while (head < tail) {
      const i = queue[head++];
      const x = i % width, y = (i - x) / width;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        pushOutside(nx, ny);
      }
    }

    const seen = new Uint8Array(total);
    for (let start = 0; start < total; start++) {
      if (!bright[start] || outsideBright[start] || seen[start]) continue;
      let h = 0, q2 = 0;
      queue[q2++] = start;
      seen[start] = 1;
      const component = [];
      let touchesPart = false;
      while (h < q2) {
        const i = queue[h++];
        component.push(i);
        const x = i % width, y = (i - x) / width;
        for (let k = 0; k < 8; k++) {
          const nx = x + N8[k][0], ny = y + N8[k][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (labels[ni] === 1) touchesPart = true;
          if (bright[ni] && !outsideBright[ni] && !seen[ni]) {
            seen[ni] = 1;
            queue[q2++] = ni;
          }
        }
      }
      if (touchesPart) {
        for (const i of component) labels[i] = 3;
        specularPixels += component.length;
      }
    }
  }

  return { labels, regionThreshold, shadowMaxDist, partPixels, shadowPixels, specularPixels };
}

/** 4-connected component labeling of non-zero pixels. */
export function labelComponents(mask, width, height) {
  const total = width * height;
  const componentIds = new Int32Array(total).fill(-1);
  const components = [];
  const queue = new Int32Array(total);

  for (let start = 0; start < total; start++) {
    if (mask[start] === 0 || componentIds[start] !== -1) continue;
    const id = components.length;
    let head = 0, tail = 0;
    queue[tail++] = start;
    componentIds[start] = id;

    let size = 0, sumX = 0, sumY = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1, touchesBorder = false;

    while (head < tail) {
      const i = queue[head++];
      const x = i % width, y = (i - x) / width;
      size++; sumX += x; sumY += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 0 || componentIds[ni] !== -1) continue;
        componentIds[ni] = id;
        queue[tail++] = ni;
      }
    }

    components.push({
      id, size, touchesBorder,
      x0, y0, x1, y1,
      cx: sumX / size, cy: sumY / size
    });
  }

  return { componentIds, components };
}

/** Khe hở Chebyshev giữa 2 bbox (0 = chồng/chạm nhau). */
function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(b.x0 - a.x1, a.x0 - b.x1) - 1);
  const dy = Math.max(0, Math.max(b.y0 - a.y1, a.y0 - b.y1) - 1);
  return Math.max(dx, dy);
}

/** Gom các component có khe hở <= gapPx thành cụm (union-find), trả cụm + bbox hợp nhất. */
function clusterComponents(components, gapPx) {
  const parent = components.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      if (bboxGap(components[i], components[j]) <= gapPx) union(i, j);
    }
  }
  const byRoot = new Map();
  components.forEach((c, i) => {
    const root = find(i);
    let cluster = byRoot.get(root);
    if (!cluster) {
      cluster = {
        ids: [], size: 0, touchesBorder: false,
        x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1
      };
      byRoot.set(root, cluster);
    }
    cluster.ids.push(c.id);
    cluster.size += c.size;
    cluster.x0 = Math.min(cluster.x0, c.x0);
    cluster.y0 = Math.min(cluster.y0, c.y0);
    cluster.x1 = Math.max(cluster.x1, c.x1);
    cluster.y1 = Math.max(cluster.y1, c.y1);
    cluster.touchesBorder = cluster.touchesBorder || c.touchesBorder;
  });
  return [...byRoot.values()];
}

/**
 * Select the subject cluster: seed tap wins, otherwise the largest cluster.
 * Các component bị tách bởi chói/lóa nhưng gần nhau được nối lại thành một
 * chủ thể trọn vẹn (M27 — fix "tracking bám một phần thân").
 * Returns the binary mask (0/1) and purity stats used by readiness + evidence.
 */
export function selectSubject(mask, width, height, seed, options = {}) {
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };
  const { componentIds, components } = labelComponents(mask, width, height);

  const minDim = Math.min(width, height);
  const gapPx = Math.max(
    t.mergeGapMinPx,
    Math.min(t.mergeGapMaxPx, Math.round(minDim * t.mergeGapFrac))
  );
  const clusters = clusterComponents(components, gapPx);

  let selected = null;
  if (seed && Number.isFinite(seed.x) && Number.isFinite(seed.y)) {
    const sx = Math.max(0, Math.min(width - 1, Math.floor(seed.x)));
    const sy = Math.max(0, Math.min(height - 1, Math.floor(seed.y)));
    const id = componentIds[sy * width + sx];
    if (id >= 0) selected = clusters.find((cluster) => cluster.ids.includes(id)) || null;
  }
  if (!selected) {
    for (const cluster of clusters) {
      if (!selected || cluster.size > selected.size) selected = cluster;
    }
  }

  const out = new Uint8Array(width * height);
  if (!selected) {
    return {
      mask: out,
      selected: null,
      components,
      stats: {
        partPixels: 0, coverage: 0, marginFrac: 0, touchesBorder: false,
        bbox: null, otherComponents: [], componentCount: components.length
      }
    };
  }

  const selectedIds = new Set(selected.ids);
  for (let i = 0; i < out.length; i++) {
    if (componentIds[i] >= 0 && selectedIds.has(componentIds[i])) out[i] = 1;
  }

  const marginPx = Math.min(selected.x0, selected.y0, width - 1 - selected.x1, height - 1 - selected.y1);
  const otherComponents = components
    .filter(c => !selectedIds.has(c.id) &&
      c.size >= t.otherComponentMinPx &&
      c.size >= selected.size * t.otherComponentFrac)
    .map(c => ({ id: c.id, size: c.size, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }));

  const selectedSubject = {
    id: selected.ids[0],
    ids: selected.ids,
    merged: selected.ids.length > 1,
    size: selected.size,
    touchesBorder: selected.touchesBorder,
    x0: selected.x0,
    y0: selected.y0,
    x1: selected.x1,
    y1: selected.y1
  };

  return {
    mask: out,
    selected: selectedSubject,
    components,
    stats: {
      partPixels: selected.size,
      coverage: selected.size / (width * height),
      marginFrac: marginPx / minDim,
      touchesBorder: selected.touchesBorder,
      bbox: { x0: selected.x0, y0: selected.y0, x1: selected.x1, y1: selected.y1 },
      otherComponents,
      componentCount: components.length,
      mergedComponents: selected.ids.length
    }
  };
}

/** ROI của frame chụp thật; bbox là pixel inclusive từ mask cuối, không dùng box EMA trên UI. */
export function paddedSubjectRoi(bbox, width, height, paddingFraction = 0.08) {
  if (!bbox || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const { x0, y0, x1, y1 } = bbox;
  if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 >= width || y1 >= height || x1 < x0 || y1 < y0) return null;
  const pad = Math.max(6, Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) * paddingFraction));
  const left = Math.max(0, Math.floor(x0 - pad));
  const top = Math.max(0, Math.floor(y0 - pad));
  const right = Math.min(width, Math.ceil(x1 + 1 + pad));
  const bottom = Math.min(height, Math.ceil(y1 + 1 + pad));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Grayscale-style morphology on a binary mask: 'dilate' grows, 'erode' shrinks (8-neighborhood). */
function morphMask(mask, width, height, mode) {
  const total = width * height;
  const out = new Uint8Array(total);
  const want = mode === 'erode' ? 0 : 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mode === 'dilate') {
        if (mask[i]) { out[i] = 1; continue; }
      } else if (!mask[i]) {
        continue;
      }
      let pick = false;
      for (let k = 0; k < 8 && !pick; k++) {
        const nx = x + N8[k][0];
        const ny = y + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === want) pick = true;
      }
      out[i] = pick ? want : 1 - want;
    }
  }
  return out;
}

/** Morphological closing: fills hairline gaps/speckle in the subject mask without moving edges. */
export function closeMask(mask, width, height, iterations = 1) {
  if (!mask || mask.length !== width * height) return new Uint8Array(width * height);
  const rounds = Math.max(0, Math.floor(Number(iterations) || 0));
  let current = mask;
  for (let round = 0; round < rounds; round++) {
    current = morphMask(morphMask(current, width, height, 'dilate'), width, height, 'erode');
  }
  return current;
}

/** Enclosed background regions inside the subject = candidate holes. */
export function extractEnclosedHoles(mask, width, height, options = {}) {
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };
  const total = width * height;
  let maskPixels = 0;
  for (let i = 0; i < total; i++) if (mask[i]) maskPixels++;
  const effectiveMinArea = Math.max(
    t.holeMinArea,
    Math.round(maskPixels * Math.max(0, Number(t.holeMinAreaFrac) || 0))
  );
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;

  const push = (x, y) => {
    const i = y * width + x;
    if (mask[i] === 1 || outside[i] === 1) return;
    outside[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width, y = (i - x) / width;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      push(nx, ny);
    }
  }

  const seen = new Uint8Array(total);
  const holes = [];
  for (let start = 0; start < total; start++) {
    if (mask[start] === 1 || outside[start] === 1 || seen[start] === 1) continue;
    let h = 0, q2 = 0;
    queue[q2++] = start;
    seen[start] = 1;
    const pixels = [];
    let x0 = width, y0 = height, x1 = -1, y1 = -1, sumX = 0, sumY = 0;

    while (h < q2) {
      const i = queue[h++];
      pixels.push(i);
      const x = i % width, y = (i - x) / width;
      sumX += x; sumY += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 1 || outside[ni] === 1 || seen[ni] === 1) continue;
        seen[ni] = 1;
        queue[q2++] = ni;
      }
    }

    if (pixels.length < effectiveMinArea) continue;
    const hole = {
      area: pixels.length,
      cx: sumX / pixels.length,
      cy: sumY / pixels.length,
      x0, y0, x1, y1,
      width: x1 - x0 + 1,
      height: y1 - y0 + 1,
      pixels
    };
    holes.push(hole);
  }

  return holes;
}

/**
 * Hole-shape evidence via radial profile DFT.
 * circle -> flat profile; square (any rotation) -> strong k=4 magnitude;
 * oval (any rotation) -> strong k=2 magnitude.
 */
export function classifyHoleShape(hole, width, options = {}) {
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };
  const area = hole?.area || 0;
  if (!hole?.pixels?.length || !Number.isInteger(width) || width < 1 ||
      !(hole.cx >= 0) || !(hole.cy >= 0)) {
    return { shape: 'unknown', reason: 'invalid_hole' };
  }
  if (area < t.holeClassifyMinArea) {
    return { shape: 'unknown', reason: 'too_small', area };
  }

  let bw = Number(hole.width) || 0;
  let bh = Number(hole.height) || 0;
  if (!bw || !bh) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const px of hole.pixels) {
      const x = px % width;
      const y = (px - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    bw = x1 - x0 + 1;
    bh = y1 - y0 + 1;
  }
  const fill = bw > 0 && bh > 0 ? area / (bw * bh) : 0;
  if (bw < 3 || bh < 3 || fill < t.holeFillMin) {
    return { shape: 'unknown', reason: 'irregular', area, fill: Number(fill.toFixed(4)) };
  }

  const bins = t.shapeBins;
  const sumR = new Float64Array(bins);
  const cntR = new Int32Array(bins);

  for (const px of hole.pixels) {
    const x = px % width;
    const y = (px - x) / width;
    const dx = x - hole.cx;
    const dy = y - hole.cy;
    const r = Math.hypot(dx, dy);
    let angle = Math.atan2(dy, dx);
    let bin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * bins);
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    sumR[bin] += r;
    cntR[bin]++;
  }

  const radii = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    radii[b] = cntR[b] ? sumR[b] / cntR[b] : -1;
  }

  let filled = 0;
  for (let b = 0; b < bins; b++) if (radii[b] >= 0) filled++;
  if (filled < Math.min(8, bins)) {
    return { shape: 'unknown', reason: 'sparse_profile', area };
  }

  const interp = new Float64Array(radii);
  for (let pass = 0; pass < bins; pass++) {
    for (let b = 0; b < bins; b++) {
      if (interp[b] >= 0) continue;
      const prev = interp[(b - 1 + bins) % bins];
      const next = interp[(b + 1) % bins];
      if (prev >= 0 && next >= 0) interp[b] = (prev + next) / 2;
    }
  }
  for (let b = 0; b < bins; b++) if (interp[b] < 0) interp[b] = 0;

  const smooth = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    smooth[b] = (interp[(b - 1 + bins) % bins] + interp[b] + interp[(b + 1) % bins]) / 3;
  }

  let mean = 0;
  for (let b = 0; b < bins; b++) mean += smooth[b];
  mean /= bins;
  if (!(mean > 0)) return { shape: 'unknown', reason: 'degenerate', area };

  let variance = 0;
  for (let b = 0; b < bins; b++) {
    const d = smooth[b] - mean;
    variance += d * d;
  }
  const radiusCV = Math.sqrt(variance / bins) / mean;

  const dftMagnitude = (k) => {
    let re = 0, im = 0;
    for (let b = 0; b < bins; b++) {
      const theta = ((b + 0.5) / bins) * 2 * Math.PI;
      const v = smooth[b] / mean;
      re += v * Math.cos(k * theta);
      im -= v * Math.sin(k * theta);
    }
    return (2 * Math.hypot(re, im)) / bins;
  };

  const A2 = dftMagnitude(2);
  const A4 = dftMagnitude(4);
  const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

  const metrics = { area, fill: Number(fill.toFixed(4)), aspect: Number(aspect.toFixed(3)), radiusCV: Number(radiusCV.toFixed(4)), A2: Number(A2.toFixed(4)), A4: Number(A4.toFixed(4)) };

  if (A4 >= t.squareMinA4 && A4 >= A2 * 1.2 && A4 <= t.squareMaxA4 && radiusCV <= t.squareMaxRadiusCV) {
    const margin = Math.min((A4 - t.squareMinA4) / t.squareMinA4, (A4 - A2 * 1.2) / Math.max(1e-6, A4));
    return { shape: 'square', confidence: Number(Math.max(0, Math.min(1, margin)).toFixed(3)), ...metrics };
  }
  if (aspect >= t.slotMinAspect && fill >= t.slotMinFill && A4 <= A2 * t.slotMaxA4Ratio && radiusCV <= t.slotMaxRadiusCV) {
    const margin = Math.min(
      (aspect - t.slotMinAspect) / t.slotMinAspect,
      (fill - t.slotMinFill) / Math.max(1e-6, t.slotMinFill)
    );
    return { shape: 'slot', confidence: Number(Math.max(0, Math.min(1, margin)).toFixed(3)), ...metrics };
  }
  if (A2 >= t.ovalMinA2 && A2 >= A4 * 1.3 && A2 <= t.ovalMaxA2 && radiusCV <= t.ovalMaxRadiusCV) {
    const margin = Math.min((A2 - t.ovalMinA2) / t.ovalMinA2, (A2 - A4 * 1.3) / Math.max(1e-6, A2));
    return { shape: 'oval', confidence: Number(Math.max(0, Math.min(1, margin)).toFixed(3)), ...metrics };
  }
  if (A2 < t.circleMaxA2 && A4 < t.circleMaxA4 && radiusCV <= t.circleMaxRadiusCV && fill <= t.circleMaxFill) {
    const margin = Math.min(
      (t.circleMaxA2 - A2) / t.circleMaxA2,
      (t.circleMaxA4 - A4) / t.circleMaxA4,
      (t.circleMaxRadiusCV - radiusCV) / t.circleMaxRadiusCV
    );
    return { shape: 'circle', confidence: Number(Math.max(0, Math.min(1, margin)).toFixed(3)), ...metrics };
  }

  return { shape: 'unknown', confidence: 0, ...metrics };
}

/** Classify all holes + summarize counts (B13 hole-shape evidence). */
export function analyzeHoles(mask, width, height, options = {}) {
  const holes = extractEnclosedHoles(mask, width, height, options);
  const classified = holes.map(hole => {
    const shape = classifyHoleShape(hole, width, options);
    return {
      area: hole.area,
      cx: Number(hole.cx.toFixed(1)),
      cy: Number(hole.cy.toFixed(1)),
      x0: hole.x0, y0: hole.y0, x1: hole.x1, y1: hole.y1,
      shape: shape.shape,
      confidence: shape.confidence || 0,
      metrics: shape.reason ? { reason: shape.reason } : {
        radiusCV: shape.radiusCV, A2: shape.A2, A4: shape.A4
      }
    };
  });

  const counts = { circle: 0, square: 0, oval: 0, slot: 0, unknown: 0 };
  for (const h of classified) counts[h.shape] = (counts[h.shape] || 0) + 1;

  return { holes: classified, counts, total: classified.length };
}

/** Per-pixel majority vote across frames (median mask). */
export function voteMasks(masks, width, height, options = {}) {
  const list = (masks || []).filter(m => m && m.length === width * height);
  if (!list.length) {
    return { mask: new Uint8Array(width * height), agreement: 0, stable: false, frames: 0 };
  }
  const n = list.length;
  const need = Math.max(1, Math.ceil(n * (Number(options.minFrac) || 0.5)));
  const total = width * height;
  const votes = new Uint8Array(total);
  for (const m of list) {
    for (let i = 0; i < total; i++) {
      if (m[i]) votes[i]++;
    }
  }
  const mask = new Uint8Array(total);
  let agreementSum = 0;
  for (let i = 0; i < total; i++) {
    if (votes[i] >= need) mask[i] = 1;
    const v = votes[i];
    agreementSum += v >= n || v === 0 ? 1 : Math.max(v, n - v) / n;
  }
  const agreement = agreementSum / total;
  return { mask, agreement: Number(agreement.toFixed(4)), stable: agreement >= 0.85, frames: n };
}

/** Laplacian variance sharpness on interior pixels. */
export function laplacianVariance(gray, width, height) {
  if (!gray || gray.length !== width * height || width < 4 || height < 4) return 0;
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/**
 * Readiness gate — 5 conditions (pipeline_moris.md §10.1).
 * state: { marginFrac, touchesBorder, coverage, otherComponents, selectedSize,
 *          specularRatio, stableCount, sharpness }
 */
export function computeReadiness(state, options = {}) {
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };
  const s = state || {};
  const guidance = [];

  const inFrame = !s.touchesBorder &&
    Number.isFinite(s.marginFrac) && s.marginFrac >= t.marginFrac &&
    Number.isFinite(s.coverage) && s.coverage >= t.minCoverage && s.coverage <= t.maxCoverage;
  if (!inFrame) {
    if (s.touchesBorder) guidance.push('Linh kiện đang chạm mép khung — lùi máy hoặc thu nhỏ vật để thấy trọn (chừa lề ≥ 10%).');
    else if (Number.isFinite(s.coverage) && s.coverage < t.minCoverage) guidance.push('Chưa thấy rõ linh kiện — đưa vật vào giữa khung.');
    else if (Number.isFinite(s.coverage) && s.coverage > t.maxCoverage) guidance.push('Linh kiện chiếm quá nhiều khung — lùi máy ra một chút.');
    else guidance.push('Lùi máy để linh kiện nằm trọn trong khung (lề ≥ 10%).');
  }

  const others = Array.isArray(s.otherComponents) ? s.otherComponents : [];
  const singleSubject = others.length === 0;
  if (!singleSubject) guidance.push('Có vật thể khác trong khung — chỉ để một linh kiện trên nền trơn.');

  const stable = Number.isFinite(s.stableCount) && s.stableCount >= t.stableFrames;
  if (!stable) guidance.push('Giữ máy ổn định thêm vài khung hình để khóa chủ thể.');

  const lowSpecular = Number.isFinite(s.specularRatio) && s.specularRatio <= t.specularRatioMax;
  if (!lowSpecular) guidance.push('Đang chói nhiều — nghiêng nhẹ linh kiện hoặc đổi hướng đèn.');

  const sharp = Number.isFinite(s.sharpness) && s.sharpness >= t.sharpnessMin;
  if (!sharp) guidance.push('Ảnh chưa nét — giữ máy chắc hơn hoặc chạm để lấy nét lại.');

  const checks = { inFrame, singleSubject, stable, lowSpecular, sharp };
  const ready = inFrame && singleSubject && stable && lowSpecular && sharp;

  return { ready, checks, guidance };
}

/** Ảnh tải lên chỉ có một frame: dùng bốn quality checks, không bịa nhãn ổn định đa khung. */
export function assessStillSubject(analysis, sharpness, options = {}) {
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };
  const live = computeReadiness({
    ...(analysis?.stats || {}),
    stableCount: t.stableFrames,
    sharpness
  }, options);
  const { stable: _unused, ...checks } = live.checks;
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    guidance: live.guidance,
    temporal_stability: 'not_applicable_static'
  };
}

/**
 * One-shot frame analysis: background -> labels -> seed component -> mask stats.
 * extractHoles=true adds hole-shape evidence (capture time only).
 */
export function analyzeFrame(input, options = {}) {
  const { data, width, height, seed = null, extractHoles = false } = input || {};
  validateImage(data, width, height);
  const t = { ...DEFAULT_SUBJECT_LOCK_THRESHOLDS, ...options };

  const background = estimateBackground(data, width, height, t);
  const pixelPass = labelPixels(data, width, height, background, t);

  const candidate = new Uint8Array(width * height);
  let specularInCandidate = 0;
  for (let i = 0; i < candidate.length; i++) {
    const label = pixelPass.labels[i];
    if (label === 1) candidate[i] = 1;
    else if (label === 3) { candidate[i] = 1; specularInCandidate++; }
  }

  const selection = selectSubject(candidate, width, height, seed, t);
  let specularPixelsInMask = 0;
  if (selection.mask) {
    for (let i = 0; i < selection.mask.length; i++) {
      if (selection.mask[i] === 1 && pixelPass.labels[i] === 3) specularPixelsInMask++;
    }
  }
  const specularRatio = selection.stats.partPixels > 0
    ? specularPixelsInMask / selection.stats.partPixels
    : 0;

  const result = {
    version: SUBJECT_LOCK_VERSION,
    background,
    regionThreshold: pixelPass.regionThreshold,
    labels: pixelPass.labels,
    mask: selection.mask,
    selected: selection.selected,
    components: selection.components,
    stats: {
      ...selection.stats,
      shadowPixels: pixelPass.shadowPixels,
      specularPixels: specularPixelsInMask,
      specularRatio: Number(specularRatio.toFixed(4))
    },
    holes: null
  };

  if (result.mask) {
    result.mask = closeMask(result.mask, width, height, 1);
  }

  if (extractHoles) {
    result.holes = analyzeHoles(result.mask, width, height, t);
  }

  return result;
}

/** Utility: IoU between two binary masks (same dims). */
export function maskIoU(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ? 1 : 0;
    const bv = b[i] ? 1 : 0;
    if (av || bv) union++;
    if (av && bv) inter++;
  }
  return union ? inter / union : 1;
}

/** Utility: nearest-neighbor mask rescale (for overlay rendering at other sizes). */
export function scaleMaskNN(mask, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH);
  if (!mask || !srcW || !srcH) return out;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = mask[sy * srcW + sx] ? 1 : 0;
    }
  }
  return out;
}

/** Utility: render binary mask to white RGBA (alpha = mask) for canvas overlay. */
export function maskToRgba(mask, width, height, color = { r: 255, g: 255, b: 255 }) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    if (mask[i]) {
      out[idx] = color.r; out[idx + 1] = color.g; out[idx + 2] = color.b; out[idx + 3] = 255;
    }
  }
  return out;
}
