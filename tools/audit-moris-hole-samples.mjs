#!/usr/bin/env node
// Read-only audit of Simple/ hole-sample images (chủ dự án 2026-10-19).
// Checks: (1) text dictionary (holeFormatReference) tags each sample filename;
// (2) geometry classifier (capture-subject-lock) on raw sample pixels.
// Output: JSON summary to stdout. No network, no writes.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { decodePng } from './png-decode.mjs';
import { analyzeFrame } from '../src/moris/capture-subject-lock.js';
import { inferFormatTagsFromText } from '../functions/_lib/moris/v5/retrieval/holeFormatReference.js';

const dir = resolve(import.meta.dirname, '..', 'Simple');
const EXPECTED = [
  [/^lỗ tròn/i, 'tron', 'circle'],
  [/^lỗ vuông/i, 'vuong', 'square'],
  [/^lỗ bán oval/i, 'ban_oval', null],
  [/^lỗ oval cong/i, 'oval_cong', 'oval'],
  [/^lỗ oval/i, 'oval', 'oval'],
  [/^lỗ dài/i, 'dai', 'slot'],
  [/^lỗ chữ nhật/i, 'chu_nhat', null],
  [/^lỗ chữ l/i, 'chu_l', null],
  [/^lỗ tam giác/i, 'tam_giac', null],
  [/^lỗ răng cưa/i, 'rang_cua', null],
  [/^lỗ gài móc/i, 'gai_moc', null],
];

const files = readdirSync(dir).filter(f => /\.png$/i.test(f)).sort();
const rows = [];
let textOk = 0, textTotal = 0, binOk = 0, binTotal = 0;

for (const file of files) {
  const name = basename(file, '.png');
  const exp = EXPECTED.find(([re]) => re.test(name));
  const { data, width, height } = decodePng(readFileSync(resolve(dir, file)));

  const textTags = exp ? inferFormatTagsFromText(name) : [];
  const textPass = !!exp && textTags.includes(exp[1]);
  if (exp) { textTotal++; if (textPass) textOk++; }

  let analysis = null;
  try {
    const frame = analyzeFrame({ data, width, height, extractHoles: true });
    analysis = {
      subjectPixels: frame.stats?.partPixels ?? frame.selected?.area ?? null,
      holes: frame.holes ? frame.holes.counts : null,
      shapes: frame.holes ? frame.holes.holes.map(h => ({ shape: h.shape, area: h.area, metrics: h.metrics })).slice(0, 6) : null,
    };
  } catch (e) {
    analysis = { error: String(e?.message || e).slice(0, 120) };
  }

  let binNote = '(no bin defined)';
  if (exp && exp[2] && analysis?.holes) {
    binTotal++;
    const got = analysis.holes[exp[2]] || 0;
    const pass = got > 0;
    if (pass) binOk++;
    binNote = pass ? 'PASS' : `MISS (expected ≥1 ${exp[2]}, got ${got})`;
  }

  rows.push({
    file, width, height, expected_tag: exp ? exp[1] : '?', expected_bin: exp ? exp[2] : null,
    text_tags: textTags, text_pass: textPass, geometry: analysis, bin_note: binNote,
  });
}

console.log(JSON.stringify({
  files: files.length,
  text_dictionary: { pass: textOk, total: textTotal },
  geometry_bins: { pass: binOk, total: binTotal },
  rows,
}, null, 2));
