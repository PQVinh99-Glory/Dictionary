import { describe, it, expect } from 'vitest';
import {
  SUBJECT_LOCK_VERSION,
  DEFAULT_SUBJECT_LOCK_THRESHOLDS,
  estimateBackground,
  labelPixels,
  labelComponents,
  selectSubject,
  paddedSubjectRoi,
  extractEnclosedHoles,
  classifyHoleShape,
  analyzeHoles,
  voteMasks,
  laplacianVariance,
  computeReadiness,
  assessStillSubject,
  analyzeFrame,
  maskIoU,
  scaleMaskNN,
  maskToRgba,
  toGray,
  closeMask
} from '../src/moris/capture-subject-lock.js';

const BG = [242, 242, 242];
const PART = [70, 70, 70];

describe('P03 crop đúng bbox frame cuối', () => {
  it('giữ cả hai đầu vật dài, thêm lề rồi clamp đúng frame', () => {
    const bbox = { x0: 40, y0: 42, x1: 359, y1: 57 };
    const roi = paddedSubjectRoi(bbox, 400, 100);
    expect(roi).toEqual({ x: 14, y: 16, width: 372, height: 68 });
    expect(roi.x).toBeLessThan(bbox.x0);
    expect(roi.x + roi.width).toBeGreaterThan(bbox.x1);
  });

  it('không dựng crop giả khi bbox/frame không hợp lệ', () => {
    expect(paddedSubjectRoi(null, 400, 100)).toBeNull();
    expect(paddedSubjectRoi({x0:0,y0:0,x1:400,y1:4},400,100)).toBeNull();
    expect(paddedSubjectRoi({x0:2,y0:2,x1:1,y1:3},400,100)).toBeNull();
  });
});

describe('P03 upload still-image gate', () => {
  const stats = {
    partPixels: 6000, touchesBorder:false, marginFrac:.15, coverage:.18,
    otherComponents:[], specularRatio:.03
  };
  it('chỉ duyệt ảnh tĩnh đủ frame/ít chói/nét, không gán temporal stability giả', () => {
    const verdict = assessStillSubject({ stats }, 12);
    expect(verdict.ready).toBe(true);
    expect(verdict.checks).not.toHaveProperty('stable');
    expect(verdict.temporal_stability).toBe('not_applicable_static');
  });
  it('chặn ảnh chạm viền, nhiều vật hoặc chói mạnh', () => {
    expect(assessStillSubject({ stats:{...stats,touchesBorder:true} },12).ready).toBe(false);
    expect(assessStillSubject({ stats:{...stats,otherComponents:[{id:2}]} },12).ready).toBe(false);
    expect(assessStillSubject({ stats:{...stats,specularRatio:.3} },12).ready).toBe(false);
  });
});

function makeBuffer(w, h, color = BG) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    data[idx] = color[0];
    data[idx + 1] = color[1];
    data[idx + 2] = color[2];
    data[idx + 3] = 255;
  }
  return data;
}

function fillRect(data, w, h, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const idx = (y * w + x) * 4;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
    }
  }
}

function fillEllipse(data, w, h, cx, cy, rx, ry, color) {
  for (let y = Math.max(0, Math.ceil(cy - ry)); y <= Math.min(h - 1, Math.floor(cy + ry)); y++) {
    for (let x = Math.max(0, Math.ceil(cx - rx)); x <= Math.min(w - 1, Math.floor(cx + rx)); x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1.0) {
        const idx = (y * w + x) * 4;
        data[idx] = color[0];
        data[idx + 1] = color[1];
        data[idx + 2] = color[2];
      }
    }
  }
}

function fillPolygon(data, w, h, points, color) {
  let minY = h - 1, maxY = 0, minX = w - 1, maxX = 0;
  for (const [px, py] of points) {
    minY = Math.min(minY, Math.floor(py));
    maxY = Math.max(maxY, Math.ceil(py));
    minX = Math.min(minX, Math.floor(px));
    maxX = Math.max(maxX, Math.ceil(px));
  }
  for (let y = Math.max(0, minY); y <= Math.min(h - 1, maxY); y++) {
    for (let x = Math.max(0, minX); x <= Math.min(w - 1, maxX); x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) {
        const idx = (y * w + x) * 4;
        data[idx] = color[0];
        data[idx + 1] = color[1];
        data[idx + 2] = color[2];
      }
    }
  }
}

function rotatedSquarePoints(cx, cy, side, angleRad) {
  const half = side / 2;
  const pts = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return pts.map(([x, y]) => {
    const rx = x * Math.cos(angleRad) - y * Math.sin(angleRad);
    const ry = x * Math.sin(angleRad) + y * Math.cos(angleRad);
    return [cx + rx, cy + ry];
  });
}

function groundTruthMask(w, h, drawFn) {
  const mask = new Uint8Array(w * h);
  const helper = {
    fillRect: (x0, y0, x1, y1, v = 1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * w + x] = v;
    },
    fillEllipse: (cx, cy, rx, ry, v = 1) => {
      for (let y = Math.max(0, Math.ceil(cy - ry)); y <= Math.min(h - 1, Math.floor(cy + ry)); y++) {
        for (let x = Math.max(0, Math.ceil(cx - rx)); x <= Math.min(w - 1, Math.floor(cx + rx)); x++) {
          const nx = (x - cx) / rx, ny = (y - cy) / ry;
          if (nx * nx + ny * ny <= 1.0) mask[y * w + x] = v;
        }
      }
    },
    fillPolygon: (points, v = 1) => {
      let minY = h - 1, maxY = 0, minX = w - 1, maxX = 0;
      for (const [px, py] of points) {
        minY = Math.min(minY, Math.floor(py)); maxY = Math.max(maxY, Math.ceil(py));
        minX = Math.min(minX, Math.floor(px)); maxX = Math.max(maxX, Math.ceil(px));
      }
      for (let y = Math.max(0, minY); y <= Math.min(h - 1, maxY); y++) {
        for (let x = Math.max(0, minX); x <= Math.min(w - 1, maxX); x++) {
          let inside = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i];
            const [xj, yj] = points[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) mask[y * w + x] = v;
        }
      }
    }
  };
  drawFn(helper);
  return mask;
}

function baseScene(w = 320, h = 140) {
  const data = makeBuffer(w, h);
  fillRect(data, w, h, 40, 30, 280, 110, PART);
  return data;
}

describe('capture-subject-lock — mask purity (M27)', () => {
  it('mask IoU ≥ 0.95 trên scene sạch + bóng đổ bị loại khỏi mask', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    fillEllipse(data, w, h, 300, 80, 16, 45, [174, 174, 174]);
    fillEllipse(data, w, h, 100, 70, 12, 12, BG);
    fillRect(data, w, h, 189, 59, 211, 81, BG);
    fillEllipse(data, w, h, 252, 70, 14, 9, BG);

    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 } });

    const gt = groundTruthMask(w, h, g => {
      g.fillRect(40, 30, 280, 110);
      g.fillEllipse(100, 70, 12, 12, 0);
      g.fillRect(189, 59, 211, 81, 0);
      g.fillEllipse(252, 70, 14, 9, 0);
    });
    const iou = maskIoU(result.mask, gt);
    expect(iou).toBeGreaterThanOrEqual(0.95);

    const shadowRegion = groundTruthMask(w, h, g => g.fillEllipse(300, 80, 16, 45));
    let shadowContamination = 0;
    for (let i = 0; i < shadowRegion.length; i++) {
      if (shadowRegion[i] && result.mask[i]) shadowContamination++;
    }
    expect(shadowContamination).toBe(0);
  });

  it('chói trong thân không tạo lỗ giả; streak được tính vào mask', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    fillRect(data, w, h, 150, 55, 190, 85, [252, 252, 252]);

    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 }, extractHoles: true });

    expect(result.holes.total).toBe(0);
    expect(result.stats.specularPixels).toBeGreaterThan(200);
    expect(result.stats.specularRatio).toBeGreaterThan(0.01);
    expect(result.stats.specularRatio).toBeLessThanOrEqual(DEFAULT_SUBJECT_LOCK_THRESHOLDS.specularRatioMax);
    for (let y = 55; y <= 85; y++) {
      for (let x = 150; x <= 190; x++) {
        expect(result.mask[y * w + x]).toBe(1);
      }
    }
  });

  it('phân loại hình dạng lỗ tròn/vuông/oval đúng trên scene tổng hợp', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    fillEllipse(data, w, h, 100, 70, 12, 12, BG);
    fillRect(data, w, h, 189, 59, 211, 81, BG);
    fillEllipse(data, w, h, 252, 70, 16, 9, BG);

    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 }, extractHoles: true });
    const holes = result.holes.holes.slice().sort((a, b) => a.cx - b.cx);
    expect(holes.length).toBe(3);
    expect(holes[0].shape).toBe('circle');
    expect(holes[1].shape).toBe('square');
    expect(holes[2].shape).toBe('oval');
    expect(result.holes.counts.circle).toBe(1);
    expect(result.holes.counts.square).toBe(1);
    expect(result.holes.counts.oval).toBe(1);
  });

  it('bất biến xoay: lỗ vuông xoay 30° vẫn là square, oval xoay 40° vẫn là oval', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    fillPolygon(data, w, h, rotatedSquarePoints(120, 70, 22, (30 * Math.PI) / 180), BG);
    const pts = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const ex = 18 * Math.cos(rad), ey = 8 * Math.sin(rad);
      const rot = (40 * Math.PI) / 180;
      pts.push([220 + ex * Math.cos(rot) - ey * Math.sin(rot), 70 + ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    fillPolygon(data, w, h, pts, BG);

    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 }, extractHoles: true });
    const holes = result.holes.holes.slice().sort((a, b) => a.cx - b.cx);
    expect(holes.length).toBe(2);
    expect(holes[0].shape).toBe('square');
    expect(holes[1].shape).toBe('oval');
  });

  it('lỗ quá nhỏ (< minArea) không đủ bằng chứng → bỏ qua', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    fillRect(data, w, h, 100, 68, 101, 70, BG);
    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 }, extractHoles: true });
    expect(result.holes.total).toBe(0);
  });

  it('seed chọn đúng component khi có hai vật', () => {
    const w = 320, h = 140;
    const data = makeBuffer(w, h);
    fillRect(data, w, h, 20, 30, 120, 110, [60, 60, 60]);
    fillRect(data, w, h, 200, 30, 300, 110, [90, 90, 90]);

    const noSeed = analyzeFrame({ data, width: w, height: h });
    expect(noSeed.selected.x0).toBe(20);
    expect(noSeed.selected.merged).toBe(false);

    const seeded = analyzeFrame({ data, width: w, height: h, seed: { x: 250, y: 70 } });
    expect(seeded.selected.x0).toBe(200);
    expect(seeded.stats.otherComponents.length).toBe(1);
    expect(seeded.stats.otherComponents[0].x0).toBe(20);
  });

  it('nối mảnh vỡ: vật bị chói tách bởi dải nền hẹp vẫn bắt trọn (component merge)', () => {
    const w = 320, h = 140;
    const data = makeBuffer(w, h);
    fillRect(data, w, h, 20, 30, 120, 110, [60, 60, 60]);
    fillRect(data, w, h, 125, 30, 260, 110, [60, 60, 60]);

    const res = analyzeFrame({ data, width: w, height: h });
    expect(res.selected.merged).toBe(true);
    expect(res.selected.x0).toBe(20);
    expect(res.selected.x1).toBe(260);
    expect(res.stats.bbox.x0).toBe(20);
    expect(res.stats.bbox.x1).toBe(260);
    expect(res.mask[70 * w + 40]).toBe(1);
    expect(res.mask[70 * w + 200]).toBe(1);
    expect(res.stats.mergedComponents).toBe(2);
  });

  it('không nối hai vật ở xa nhau dù cùng khung (khe hở lớn hơn ngưỡng merge)', () => {
    const w = 320, h = 140;
    const data = makeBuffer(w, h);
    fillRect(data, w, h, 20, 30, 120, 110, [60, 60, 60]);
    fillRect(data, w, h, 200, 30, 300, 110, [60, 60, 60]);

    const res = analyzeFrame({ data, width: w, height: h });
    expect(res.selected.merged).toBe(false);
    expect(res.stats.otherComponents.length).toBe(1);
  });
});

describe('capture-subject-lock — voting & readiness (M27)', () => {
  it('voting 3 khung loại vật nhấp nháy, giữ mask nền ổn định', () => {
    const w = 100, h = 60;
    const base = new Uint8Array(w * h);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 80; x++) base[y * w + x] = 1;

    const noisy = new Uint8Array(base);
    for (let y = 5; y < 15; y++) for (let x = 85; x < 95; x++) noisy[y * w + x] = 1;

    const voted = voteMasks([base, noisy, base], w, h);
    expect(voted.frames).toBe(3);
    expect(voted.stable).toBe(true);
    expect(maskIoU(voted.mask, base)).toBe(1);
    expect(voted.mask[10 * w + 90]).toBe(0);
  });

  it('readiness: vật chạm biên → chưa sẵn sàng và hướng dẫn lùi máy', () => {
    const w = 320, h = 140;
    const data = makeBuffer(w, h);
    fillRect(data, w, h, 0, 30, 240, 110, PART);
    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 50, y: 70 } });
    expect(result.stats.touchesBorder).toBe(true);

    const readiness = computeReadiness({
      ...result.stats,
      stableCount: 5,
      sharpness: 50
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.inFrame).toBe(false);
    expect(readiness.guidance.join(' ')).toContain('lùi máy');
  });

  it('readiness: đủ 5 điều kiện → ready, không còn hướng dẫn', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 } });
    const gray = toGray(data, w, h);
    const sharpness = laplacianVariance(gray, w, h);
    expect(sharpness).toBeGreaterThan(DEFAULT_SUBJECT_LOCK_THRESHOLDS.sharpnessMin);

    const readiness = computeReadiness({
      ...result.stats,
      stableCount: 3,
      sharpness
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.guidance).toEqual([]);
  });

  it('readiness: chói cao và ảnh mờ → guidance tương ứng', () => {
    const readiness = computeReadiness({
      marginFrac: 0.2,
      touchesBorder: false,
      coverage: 0.4,
      otherComponents: [],
      specularRatio: 0.4,
      stableCount: 5,
      sharpness: 2
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.lowSpecular).toBe(false);
    expect(readiness.checks.sharp).toBe(false);
    expect(readiness.guidance.join(' ')).toContain('chói');
    expect(readiness.guidance.join(' ')).toContain('nét');
  });

  it('laplacianVariance phân biệt ảnh nét với ảnh phẳng', () => {
    const w = 80, h = 60;
    const flat = new Uint8Array(w * h).fill(128);
    expect(laplacianVariance(flat, w, h)).toBe(0);

    const edges = new Uint8Array(w * h).fill(200);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 40; x++) edges[y * w + x] = 60;
    expect(laplacianVariance(edges, w, h)).toBeGreaterThan(100);
  });
});

describe('capture-subject-lock — utilities & guardrails', () => {
  it('maskIoU/scaleMaskNN/maskToRgba hoạt động đúng', () => {
    const w = 10, h = 10;
    const a = new Uint8Array(w * h);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) a[y * w + x] = 1;
    expect(maskIoU(a, a)).toBe(1);

    const b = new Uint8Array(a);
    b[0] = 1;
    expect(maskIoU(a, b)).toBeLessThan(1);

    const half = scaleMaskNN(a, w, h, 5, 5);
    expect(maskIoU(scaleMaskNN(half, 5, 5, w, h), a)).toBeGreaterThan(0.7);

    const rgba = maskToRgba(a, w, h);
    expect(rgba[(5 * w + 5) * 4 + 3]).toBe(255);
    expect(rgba[(0 * w + 0) * 4 + 3]).toBe(0);
  });

  it('estimateBackground + labelPixels giữ hợp đồng nhãn cơ bản', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    const bg = estimateBackground(data, w, h);
    expect(Math.round(bg.r)).toBe(BG[0]);
    const pass = labelPixels(data, w, h, bg);
    expect(pass.labels[70 * w + 60]).toBe(1);
    expect(pass.labels[5 * w + 5]).toBe(0);
  });

  it('labelComponents tách đúng 2 thành phần', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h);
    mask[1 * w + 1] = 1;
    mask[5 * w + 5] = 1;
    mask[5 * w + 6] = 1;
    const { components } = labelComponents(mask, w, h);
    expect(components.length).toBe(2);
    const sizes = components.map(c => c.size).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('extractEnclosedHoles chỉ lấy lỗ kín, bỏ vùng nở ra biên', () => {
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) mask[y * w + x] = 0;
    for (let x = 0; x < 10; x++) mask[19 * w + x] = 0;
    const holes = extractEnclosedHoles(mask, w, h);
    expect(holes.length).toBe(1);
    expect(holes[0].area).toBe(25);
    expect(holes[0].x0).toBe(5);
  });

  it('eval tổng hợp: mean IoU ≥ 0.90 và hole-shape accuracy ≥ 0.85 trên bộ scene gán nhãn', () => {
    const w = 320, h = 140;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const scenes = [
      { holeSpec: [['circle', 100, 70, 10], ['square', 210, 70, 22], ['oval', 258, 70, 15, 8]] },
      { holeSpec: [['circle', 90, 55, 9], ['circle', 150, 85, 13], ['square', 230, 70, 18]] },
      { holeSpec: [['oval', 120, 70, 17, 8], ['oval', 220, 70, 12, 7]] },
      { holeSpec: [['square', 110, 70, 24], ['circle', 250, 70, 14]] }
    ];

    let iouSum = 0, iouCount = 0, shapeHits = 0, shapeTotal = 0;

    scenes.forEach((scene, sIdx) => {
      const data = makeBuffer(w, h);
      const px = 40 + Math.round(rnd() * 10);
      const py = 30 + Math.round(rnd() * 5);
      const pw = 240 - Math.round(rnd() * 20);
      const ph = 80 - Math.round(rnd() * 10);
      fillRect(data, w, h, px, py, px + pw, py + ph, [70 + sIdx * 8, 70 + sIdx * 8, 74 + sIdx * 8]);
      fillEllipse(data, w, h, px + pw + 14, py + Math.round(ph / 2), 10, 30, [186, 184, 188]);

      const holes = [];
      for (const spec of scene.holeSpec) {
        const [shape, cx, cy, a, b] = spec;
        if (shape === 'circle') {
          fillEllipse(data, w, h, cx, cy, a, a, BG);
          holes.push({ shape, cx, cy, a });
        } else if (shape === 'oval') {
          fillEllipse(data, w, h, cx, cy, a, b || 8, BG);
          holes.push({ shape, cx, cy, a, b });
        } else {
          fillRect(data, w, h, cx - a / 2, cy - a / 2, cx + a / 2, cy + a / 2, BG);
          holes.push({ shape, cx, cy, a });
        }
      }

      const result = analyzeFrame({ data, width: w, height: h, seed: { x: px + 5, y: py + 5 }, extractHoles: true });

      const gt = groundTruthMask(w, h, g => {
        g.fillRect(px, py, px + pw, py + ph);
        for (const hole of holes) {
          if (hole.shape === 'oval') g.fillEllipse(hole.cx, hole.cy, hole.a, hole.b, 0);
          else if (hole.shape === 'circle') g.fillEllipse(hole.cx, hole.cy, hole.a, hole.a, 0);
          else g.fillRect(hole.cx - hole.a / 2, hole.cy - hole.a / 2, hole.cx + hole.a / 2, hole.cy + hole.a / 2, 0);
        }
      });

      iouSum += maskIoU(result.mask, gt);
      iouCount++;

      const found = result.holes.holes.slice().sort((a, b) => a.cx - b.cx);
      const expected = holes.slice().sort((a, b) => a.cx - b.cx);
      expect(found.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        shapeTotal++;
        if (found[i].shape === expected[i].shape) shapeHits++;
      }
    });

    const meanIoU = iouSum / iouCount;
    const shapeAccuracy = shapeHits / shapeTotal;
    console.info(`[M27 eval] mean mask IoU = ${meanIoU.toFixed(4)}; hole-shape accuracy = ${(shapeAccuracy * 100).toFixed(1)}% (${shapeHits}/${shapeTotal})`);
    expect(meanIoU).toBeGreaterThanOrEqual(0.90);
    expect(shapeAccuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('closeMask lấp khe hở 1px nhưng giữ lỗ thật và khe rộng', () => {
    const w = 60, h = 60;
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = 0; y < h; y++) mask[y * w + 20] = 0;
    for (let y = 0; y < h; y++) mask[y * w + 40] = 0;
    for (let y = 0; y < h; y++) mask[y * w + 41] = 0;
    for (let y = 0; y < h; y++) mask[y * w + 50] = 0;
    for (let y = 0; y < h; y++) mask[y * w + 51] = 0;
    for (let y = 0; y < h; y++) mask[y * w + 52] = 0;
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) mask[y * w + x] = 0;

    const closed = closeMask(mask, w, h, 1);
    expect(closed[30 * w + 20]).toBe(1);
    expect(closed[30 * w + 40]).toBe(1);
    expect(closed[30 * w + 41]).toBe(1);
    expect(closed[30 * w + 51]).toBe(0);
    expect(closed[7 * w + 7]).toBe(0);

    const twice = closeMask(mask, w, h, 2);
    expect(twice[30 * w + 51]).toBe(0);
    expect(twice[7 * w + 7]).toBe(0);
  });

  it('extractEnclosedHoles áp ngưỡng diện tích tương đối theo kích thước chủ thể', () => {
    const w = 400, h = 400;
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = 20; y < 26; y++) for (let x = 20; x < 26; x++) mask[y * w + x] = 0;
    for (let y = 200; y < 300; y++) for (let x = 200; x < 300; x++) mask[y * w + x] = 0;
    const defaultHoles = extractEnclosedHoles(mask, w, h);
    expect(defaultHoles.length).toBe(1);
    expect(defaultHoles[0].area).toBe(10000);
    const looseHoles = extractEnclosedHoles(mask, w, h, { holeMinAreaFrac: 0 });
    expect(looseHoles.length).toBe(2);
  });

  it('classifyHoleShape: vùng răng cưa/thin sliver → unknown, không đoán bừa', () => {
    const w = 80;
    const lPixels = [];
    for (let y = 30; y <= 50; y++) for (let x = 36; x <= 44; x++) lPixels.push(y * w + x);
    for (let y = 46; y <= 50; y++) for (let x = 20; x <= 35; x++) lPixels.push(y * w + x);
    const lShape = classifyHoleShape({ area: lPixels.length, cx: 36, cy: 42, pixels: lPixels }, w);
    expect(lShape.shape).toBe('unknown');

    const sliverPixels = [];
    for (let x = 10; x < 70; x++) sliverPixels.push(20 * w + x);
    const sliver = classifyHoleShape({ area: sliverPixels.length, cx: 40, cy: 20, pixels: sliverPixels }, w);
    expect(sliver.shape).toBe('unknown');
  });

  it('analyzeFrame: khe nứt 1px trong thân không tạo lỗ giả sau closing', () => {
    const w = 320, h = 140;
    const data = baseScene(w, h);
    for (let y = 40; y < 100; y++) {
      const x = 200;
      const i = (y * w + x) * 4;
      data[i] = BG[0]; data[i + 1] = BG[1]; data[i + 2] = BG[2];
    }
    const result = analyzeFrame({ data, width: w, height: h, seed: { x: 60, y: 40 }, extractHoles: true });
    expect(result.holes.total).toBe(0);
    expect(result.mask[70 * w + 200]).toBe(1);
  });

  it('version + ngưỡng mặc định ổn định', () => {
    expect(SUBJECT_LOCK_VERSION).toBe('subject_lock_v1');
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.marginFrac).toBe(0.10);
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.stableFrames).toBe(3);
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.specularRatioMax).toBe(0.18);
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.mergeGapFrac).toBe(0.04);
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.mergeGapMaxPx).toBe(14);
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.slotMinAspect).toBe(1.7);
    expect(DEFAULT_SUBJECT_LOCK_THRESHOLDS.slotMinFill).toBe(0.88);
  });
});

describe('capture-subject-lock — lỗ dài/slot (từ điển mẫu lỗ, 2026-10-19)', () => {
  const W = 100;

  function stadiumPixels() {
    const px = [];
    for (let y = 30; y <= 49; y++) {
      for (let x = 20; x <= 59; x++) {
        const inRect = x >= 30 && x <= 50;
        const dL = Math.hypot(x - 30, y - 39.5);
        const dR = Math.hypot(x - 50, y - 39.5);
        if (inRect || dL <= 10 || dR <= 10) px.push(y * W + x);
      }
    }
    return px;
  }

  it('classifyHoleShape: stadium dài → slot; ellipse 2:1 → oval; đĩa tròn → circle', () => {
    const stadium = stadiumPixels();
    const s = classifyHoleShape({ area: stadium.length, cx: 40, cy: 39.5, pixels: stadium }, W);
    expect(s.shape).toBe('slot');
    expect(s.aspect).toBeGreaterThanOrEqual(1.7);
    expect(s.confidence).toBeGreaterThanOrEqual(0);

    const ellipse = [];
    for (let y = 20; y <= 59; y++) {
      for (let x = 20; x <= 59; x++) {
        if (((x - 40) / 20) ** 2 + ((y - 40) / 10) ** 2 <= 1) ellipse.push(y * W + x);
      }
    }
    const e = classifyHoleShape({ area: ellipse.length, cx: 40, cy: 40, pixels: ellipse }, W);
    expect(e.shape).toBe('oval');

    const disc = [];
    for (let y = 25; y <= 54; y++) {
      for (let x = 25; x <= 54; x++) {
        if (Math.hypot(x - 40, y - 40) <= 15) disc.push(y * W + x);
      }
    }
    const c = classifyHoleShape({ area: disc.length, cx: 40, cy: 40, pixels: disc }, W);
    expect(c.shape).toBe('circle');

    const square = [];
    for (let y = 30; y <= 59; y++) {
      for (let x = 30; x <= 59; x++) square.push(y * W + x);
    }
    const q = classifyHoleShape({ area: square.length, cx: 44.5, cy: 44.5, pixels: square }, W);
    expect(q.shape).toBe('square');
  });

  it('analyzeHoles đếm slot riêng vào counts.slot', () => {
    const w = 200, h = 200;
    const mask = new Uint8Array(w * h).fill(1);
    const stadium = [];
    for (let y = 90; y <= 109; y++) {
      for (let x = 60; x <= 119; x++) {
        const inRect = x >= 70 && x <= 110;
        const dL = Math.hypot(x - 70, y - 99.5);
        const dR = Math.hypot(x - 110, y - 99.5);
        if (inRect || dL <= 10 || dR <= 10) {
          stadium.push(y * w + x);
          mask[y * w + x] = 0;
        }
      }
    }
    const analysis = analyzeHoles(mask, w, h);
    expect(analysis.total).toBe(1);
    expect(analysis.counts.slot).toBe(1);
    expect(analysis.counts.circle + analysis.counts.square + analysis.counts.oval + analysis.counts.unknown).toBe(0);
  });
});
