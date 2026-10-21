/**
 * moris-layer1-optical.ts
 * ============================================================================
 * MORIS 3-LAYER COMPUTER VISION HARNESS — LAYER 1: OPTICAL NORMALIZATION
 *
 * 100% Offline Web Worker & Node.js Compatible (Pure TypedArray & Buffer Math).
 * Zero DOM Canvas dependencies. Zero external WASM or OpenCV dependencies.
 *
 * Key Algorithms Implemented:
 * 1. Border-seeded BFS Flood Fill for Foreground Segmentation & Internal Hole Isolation.
 * 2. Andrew's Monotone Chain Convex Hull & Shoelace Area for Exact Solidity.
 * 3. 2D Central Spatial Moments (mu20, mu02, mu11) PCA Canonical Horizontal Alignment.
 * 4. Deterministic 180-Degree Disambiguation (Foreground Centroid vs. Detail Centroid).
 * 5. CIE 1976 L* (D65) Luminance + 98th Percentile Specular Clamping + 3x3 Median.
 * 6. Contrast Limited Adaptive Histogram Equalization (CLAHE, 8x8 tiles, clipLimit=2.5).
 * 7. 3x3 Scharr Structural Gradient Magnitude (sqrt(Gx^2 + Gy^2)).
 * 8. Two-Pass Chamfer (3, 4) Distance Transform on Foreground Body.
 * 9. Standard ImageNet Normalization to Float32Array [1, 3, 224, 224].
 * ============================================================================
 */
/**
 * 1D Log-Area Otsu / K-Means variance minimization to classify holes into Big and Small.
 */
export function classifyHoleSizes1D(holeAreas) {
    const N = holeAreas.length;
    if (N === 0) {
        return { totalHoles: 0, bigHoles: 0, smallHoles: 0, splitArea: 0 };
    }
    const sorted = [...holeAreas].sort((a, b) => b - a);
    if (N === 1 || sorted[0] / Math.max(1, sorted[N - 1]) < 1.45) {
        return { totalHoles: N, bigHoles: N, smallHoles: 0, splitArea: sorted[0] };
    }
    const logA = sorted.map(a => Math.log(Math.max(1, a)));
    let bestK = 1;
    let maxBetweenVar = -1;
    for (let k = 1; k < N; k++) {
        const w1 = k / N;
        const w2 = (N - k) / N;
        let sum1 = 0;
        for (let i = 0; i < k; i++)
            sum1 += logA[i];
        const mu1 = sum1 / k;
        let sum2 = 0;
        for (let i = k; i < N; i++)
            sum2 += logA[i];
        const mu2 = sum2 / (N - k);
        const betweenVar = w1 * w2 * Math.pow(mu1 - mu2, 2);
        if (betweenVar > maxBetweenVar) {
            maxBetweenVar = betweenVar;
            bestK = k;
        }
    }
    const splitArea = Math.sqrt(sorted[bestK - 1] * sorted[bestK]);
    return {
        totalHoles: N,
        bigHoles: bestK,
        smallHoles: N - bestK,
        splitArea
    };
}
// ---------------------------------------------------------------------------
// 1. BOUNDARY & CONVEX HULL (Andrew's Monotone Chain Algorithm)
// ---------------------------------------------------------------------------
function crossProduct(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
/**
 * Computes exact Convex Hull of a 2D point cloud in O(N log N) time.
 */
export function computeConvexHull(points) {
    const n = points.length;
    if (n <= 2)
        return [...points];
    const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const lower = [];
    for (let i = 0; i < n; i++) {
        while (lower.length >= 2 &&
            crossProduct(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
            lower.pop();
        }
        lower.push(sorted[i]);
    }
    const upper = [];
    for (let i = n - 1; i >= 0; i--) {
        while (upper.length >= 2 &&
            crossProduct(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
            upper.pop();
        }
        upper.push(sorted[i]);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}
/**
 * Computes polygon area using the Shoelace formula.
 */
export function computePolygonArea(vertices) {
    const n = vertices.length;
    if (n < 3)
        return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        sum += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
    }
    return Math.abs(sum) * 0.5;
}
/**
 * Extracts perimeter boundary points from a binary mask for fast convex hull computation.
 */
function extractPerimeterPoints(mask, width, height) {
    const points = [];
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        let firstX = -1;
        let lastX = -1;
        for (let x = 0; x < width; x++) {
            if (mask[rowOffset + x] === 1) {
                if (firstX === -1)
                    firstX = x;
                lastX = x;
            }
        }
        if (firstX !== -1) {
            points.push({ x: firstX, y });
            if (lastX !== firstX) {
                points.push({ x: lastX, y });
            }
        }
    }
    return points;
}
/**
 * Extracts foreground mask and enclosed punched holes using border-seeded flood fill.
 * Dual-Mode: R2 transparent/black-matte cutouts vs. Live camera bright-background photos.
 */
export function segmentForegroundAndHoles(rgba, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
        width * height > 16_000_000 || rgba.length !== width * height * 4) {
        throw new Error("Invalid image dimensions or RGBA length.");
    }
    const total = width * height;
    // 1. Estimate background and mode from outer border samples
    const borderThickness = Math.max(2, Math.floor(Math.min(width, height) * 0.04));
    let transparentBorderCount = 0;
    let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
    let totalBorderSamples = 0;
    for (let y = 0; y < height; y++) {
        const isYBorder = y < borderThickness || y >= height - borderThickness;
        for (let x = 0; x < width; x++) {
            const isXBorder = x < borderThickness || x >= width - borderThickness;
            if (isYBorder || isXBorder) {
                totalBorderSamples++;
                const idx = (y * width + x) * 4;
                const a = rgba[idx + 3];
                if (a < 36) {
                    transparentBorderCount++;
                }
                else {
                    bgR += rgba[idx];
                    bgG += rgba[idx + 1];
                    bgB += rgba[idx + 2];
                    bgCount++;
                }
            }
        }
    }
    const isTransparentCutout = transparentBorderCount > totalBorderSamples * 0.35 || transparentBorderCount > 20;
    let bgLuma = 0;
    let bgSpread = 0;
    if (bgCount > 0) {
        bgR /= bgCount;
        bgG /= bgCount;
        bgB /= bgCount;
        bgLuma = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
        let spreadSum = 0;
        for (let y = 0; y < height; y += 2) {
            const isYBorder = y < borderThickness || y >= height - borderThickness;
            for (let x = 0; x < width; x += 2) {
                const isXBorder = x < borderThickness || x >= width - borderThickness;
                if (isYBorder || isXBorder) {
                    const idx = (y * width + x) * 4;
                    if (rgba[idx + 3] >= 36) {
                        spreadSum += Math.hypot(rgba[idx] - bgR, rgba[idx + 1] - bgG, rgba[idx + 2] - bgB);
                    }
                }
            }
        }
        bgSpread = spreadSum / Math.max(1, bgCount / 4);
    }
    const isBlackMatteCutout = !isTransparentCutout && bgLuma < 8 && bgSpread < 5;
    const isCutoutMode = isTransparentCutout || isBlackMatteCutout;
    const segmentationMode = isTransparentCutout ? "cutout_alpha" : isBlackMatteCutout ? "cutout_black" : "live_camera";
    // 2. Initial pixel classification: metal foreground candidate vs. background
    const initialMask = new Uint8Array(total);
    let rawPartPixels = 0;
    let metalLumaSum = 0;
    if (isCutoutMode) {
        for (let i = 0; i < total; i++) {
            const idx = i * 4;
            const a = rgba[idx + 3];
            if (isTransparentCutout) {
                if (a >= 36) {
                    initialMask[i] = 1;
                    rawPartPixels++;
                    metalLumaSum += 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
                }
                else {
                    initialMask[i] = 0;
                }
            }
            else {
                const luma = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
                if (luma >= 10 && a >= 36) {
                    initialMask[i] = 1;
                    rawPartPixels++;
                    metalLumaSum += luma;
                }
                else {
                    initialMask[i] = 0;
                }
            }
        }
    }
    else {
        const threshold = Math.max(24, Math.min(80, 24 + bgSpread * 1.35));
        for (let i = 0; i < total; i++) {
            const idx = i * 4;
            const a = rgba[idx + 3];
            if (a < 36) {
                initialMask[i] = 0;
                continue;
            }
            const r = rgba[idx];
            const g = rgba[idx + 1];
            const b = rgba[idx + 2];
            const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            const isMetal = dist > threshold && luma < Math.max(160, bgLuma - 15);
            if (isMetal) {
                initialMask[i] = 1;
                rawPartPixels++;
                metalLumaSum += luma;
            }
            else {
                initialMask[i] = 0;
            }
        }
    }
    // Never interpret a blank/failed segmentation as a full-frame part.
    const flags = [];
    if (rawPartPixels < total * 0.015)
        flags.push("insufficient_foreground");
    if (rawPartPixels > total * 0.90)
        flags.push("foreground_fills_frame");
    if (!isCutoutMode && bgSpread > 30)
        flags.push("background_nonuniform");
    let clipped = 0;
    let boundaryForeground = 0;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (initialMask[i]) {
                if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
                    boundaryForeground++;
                if (Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) >= 250)
                    clipped++;
            }
        }
    if (boundaryForeground)
        flags.push("subject_touches_edge");
    if (rawPartPixels && clipped / rawPartPixels > 0.1)
        flags.push("foreground_highlights_clipped");
    // Catalogue alpha cutouts are generated from complete parts and tightly cropped.
    // Border contact alone does not invalidate closed cavities visible in this view.
    // Camera/JPEG masks keep the strict border gate for full-object capture.
    const nonBlockingAlphaEdge = isTransparentCutout && flags.every(flag => flag === "subject_touches_edge");
    const maskQuality = {
        version: "mask_quality_v1", reliable: flags.length === 0 || nonBlockingAlphaEdge, flags,
        foregroundFraction: rawPartPixels / total, borderSpread: bgSpread
    };
    const avgMetalLuma = rawPartPixels > 0 ? metalLumaSum / rawPartPixels : 100;
    // 3. Connected Components Flood-Fill from Borders to identify OUTER BACKGROUND
    // Label 0: unvisited background / internal cavity
    // Label 1: verified outer background
    // Label 2: foreground metal
    const labels = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        if (initialMask[i] === 1) {
            labels[i] = 2; // Foreground metal
        }
    }
    const queue = new Int32Array(total);
    let qHead = 0;
    let qTail = 0;
    // Seed 4 outer borders
    for (let x = 0; x < width; x++) {
        if (labels[x] === 0) {
            labels[x] = 1;
            queue[qTail++] = x;
        }
        const bottomIdx = (height - 1) * width + x;
        if (labels[bottomIdx] === 0) {
            labels[bottomIdx] = 1;
            queue[qTail++] = bottomIdx;
        }
    }
    for (let y = 1; y < height - 1; y++) {
        const leftIdx = y * width;
        if (labels[leftIdx] === 0) {
            labels[leftIdx] = 1;
            queue[qTail++] = leftIdx;
        }
        const rightIdx = y * width + (width - 1);
        if (labels[rightIdx] === 0) {
            labels[rightIdx] = 1;
            queue[qTail++] = rightIdx;
        }
    }
    // BFS flood-fill outer background
    while (qHead < qTail) {
        const idx = queue[qHead++];
        const cx = idx % width;
        const cy = (idx / width) | 0;
        if (cx > 0) {
            const n = idx - 1;
            if (labels[n] === 0) {
                labels[n] = 1;
                queue[qTail++] = n;
            }
        }
        if (cx < width - 1) {
            const n = idx + 1;
            if (labels[n] === 0) {
                labels[n] = 1;
                queue[qTail++] = n;
            }
        }
        if (cy > 0) {
            const n = idx - width;
            if (labels[n] === 0) {
                labels[n] = 1;
                queue[qTail++] = n;
            }
        }
        if (cy < height - 1) {
            const n = idx + width;
            if (labels[n] === 0) {
                labels[n] = 1;
                queue[qTail++] = n;
            }
        }
    }
    // Bounding box of metal body
    let minX = width, minY = height, maxX = -1, maxY = -1;
    let fgArea = 0;
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            if (labels[rowOffset + x] === 2) {
                fgArea++;
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
                if (y < minY)
                    minY = y;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (fgArea === 0 || maxX < minX || maxY < minY) {
        minX = 0;
        minY = 0;
        maxX = width - 1;
        maxY = height - 1;
        // Keep foregroundArea=0: unknown mask is not a full-frame object.
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspectRatio = Number((bw / Math.max(1, bh)).toFixed(4));
    // Compute Convex Hull and Solidity
    const perimPoints = extractPerimeterPoints(initialMask, width, height);
    const hullPoints = computeConvexHull(perimPoints);
    const hullArea = computePolygonArea(hullPoints);
    const solidity = Number((fgArea / Math.max(fgArea, hullArea)).toFixed(4));
    // 4. Identify enclosed internal cavities (labels[idx] === 0)
    // Lowered threshold: 0.04% of foreground area (fgArea * 0.0004) to preserve small locating holes
    const minHoleArea = Math.max(8, Math.round(fgArea * 0.0004));
    // Transparent catalogue cutouts encode a hole as an enclosed alpha cavity.
    // A large slot may have more area than the surrounding metal; its topology,
    // not a foreground-area cap, distinguishes it from an open edge notch.
    const maxHoleArea = isTransparentCutout ? total : Math.round(fgArea * 0.45);
    const holeMasks = new Uint8Array(total);
    const visitedHole = new Uint8Array(total);
    const holes = [];
    const hQueue = new Int32Array(total);
    for (let y = minY; y <= maxY; y++) {
        const rowOffset = y * width;
        for (let x = minX; x <= maxX; x++) {
            const idx = rowOffset + x;
            if (labels[idx] === 0 && visitedHole[idx] === 0) {
                let hHead = 0;
                let hTail = 0;
                let hArea = 0;
                let sumX = 0;
                let sumY = 0;
                let cavityLumaSum = 0;
                let transparentCavityCount = 0;
                visitedHole[idx] = 1;
                hQueue[hTail++] = idx;
                while (hHead < hTail) {
                    const cur = hQueue[hHead++];
                    const hx = cur % width;
                    const hy = (cur / width) | 0;
                    const curIdx = cur * 4;
                    hArea++;
                    sumX += hx;
                    sumY += hy;
                    cavityLumaSum += 0.299 * rgba[curIdx] + 0.587 * rgba[curIdx + 1] + 0.114 * rgba[curIdx + 2];
                    if (rgba[curIdx + 3] < 36)
                        transparentCavityCount++;
                    if (hx > minX) {
                        const n = cur - 1;
                        if (labels[n] === 0 && visitedHole[n] === 0) {
                            visitedHole[n] = 1;
                            hQueue[hTail++] = n;
                        }
                    }
                    if (hx < maxX) {
                        const n = cur + 1;
                        if (labels[n] === 0 && visitedHole[n] === 0) {
                            visitedHole[n] = 1;
                            hQueue[hTail++] = n;
                        }
                    }
                    if (hy > minY) {
                        const n = cur - width;
                        if (labels[n] === 0 && visitedHole[n] === 0) {
                            visitedHole[n] = 1;
                            hQueue[hTail++] = n;
                        }
                    }
                    if (hy < maxY) {
                        const n = cur + width;
                        if (labels[n] === 0 && visitedHole[n] === 0) {
                            visitedHole[n] = 1;
                            hQueue[hTail++] = n;
                        }
                    }
                }
                const meanCavityLuma = cavityLumaSum / Math.max(1, hArea);
                let isTrueHole = false;
                if (isTransparentCutout) {
                    isTrueHole = transparentCavityCount >= hArea * 0.35;
                }
                else if (isBlackMatteCutout) {
                    isTrueHole = meanCavityLuma < 8;
                }
                else {
                    isTrueHole = meanCavityLuma >= bgLuma * 0.55 || meanCavityLuma >= avgMetalLuma * 1.35;
                }
                if (isTrueHole && hArea >= minHoleArea && hArea <= maxHoleArea) {
                    const cx = sumX / hArea;
                    const cy = sumY / hArea;
                    for (let k = 0; k < hTail; k++) {
                        holeMasks[hQueue[k]] = 1;
                    }
                    const u = Number(((cx - (minX + bw / 2)) / bw).toFixed(4));
                    const v = Number(((cy - (minY + bh / 2)) / bh).toFixed(4));
                    const relArea = Number(Math.sqrt(hArea / fgArea).toFixed(4));
                    holes.push({ x: cx, y: cy, area: hArea, u, v, relArea });
                }
            }
        }
    }
    // Final fgMask: 1 = metal body, 0 = outer background & internal holes
    const fgMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        if (labels[i] === 2 && holeMasks[i] === 0) {
            fgMask[i] = 1;
        }
        else {
            fgMask[i] = 0;
        }
    }
    return {
        fgMask,
        holeMasks,
        foregroundArea: fgArea,
        solidity,
        aspectRatio,
        holes,
        bbox: { minX, minY, maxX, maxY, width: bw, height: bh },
        diagnostics: { segmentationMode, maskQuality }
    };
}
// ---------------------------------------------------------------------------
// 3. CANONICAL POSE ALIGNMENT (PCA + Crop + 180-Degree Disambiguation)
// ---------------------------------------------------------------------------
/**
 * Computes principal component orientation angle theta via 2D central spatial moments.
 */
export function computePcaAngle(mask, width, height) {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            if (mask[rowOffset + x] === 1) {
                sumX += x;
                sumY += y;
                count++;
            }
        }
    }
    if (count < 20) {
        return { theta: 0, cx: width / 2, cy: height / 2 };
    }
    const cx = sumX / count;
    const cy = sumY / count;
    let mu20 = 0;
    let mu02 = 0;
    let mu11 = 0;
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        const dy = y - cy;
        for (let x = 0; x < width; x++) {
            if (mask[rowOffset + x] === 1) {
                const dx = x - cx;
                mu20 += dx * dx;
                mu02 += dy * dy;
                mu11 += dx * dy;
            }
        }
    }
    const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    return { theta, cx, cy };
}
/**
 * Pure TypedArray affine bilinear rotation of RGBA buffer and binary mask.
 */
function rotateBufferAndMask(srcRgba, srcMask, w, h, cx, cy, angleRad) {
    // Bounding dimension to prevent corner clipping
    const diag = Math.ceil(Math.hypot(w, h));
    const outW = diag;
    const outH = diag;
    const dstRgba = new Uint8ClampedArray(outW * outH * 4);
    const dstMask = new Uint8Array(outW * outH);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const outCx = outW / 2;
    const outCy = outH / 2;
    for (let y = 0; y < outH; y++) {
        const dy = y - outCy;
        const rowOffsetDst = y * outW;
        for (let x = 0; x < outW; x++) {
            const dx = x - outCx;
            // Inverse map from rotated destination (x, y) back to source (srcX, srcY)
            const srcX = cx + dx * cosA + dy * sinA;
            const srcY = cy - dx * sinA + dy * cosA;
            const dstIdx = (rowOffsetDst + x) * 4;
            if (srcX >= 0 && srcX < w - 1 && srcY >= 0 && srcY < h - 1) {
                const x0 = Math.floor(srcX);
                const y0 = Math.floor(srcY);
                const x1 = x0 + 1;
                const y1 = y0 + 1;
                const fx = srcX - x0;
                const fy = srcY - y0;
                const w00 = (1 - fx) * (1 - fy);
                const w10 = fx * (1 - fy);
                const w01 = (1 - fx) * fy;
                const w11 = fx * fy;
                const i00 = (y0 * w + x0) * 4;
                const i10 = (y0 * w + x1) * 4;
                const i01 = (y1 * w + x0) * 4;
                const i11 = (y1 * w + x1) * 4;
                dstRgba[dstIdx] = Math.round(srcRgba[i00] * w00 + srcRgba[i10] * w10 + srcRgba[i01] * w01 + srcRgba[i11] * w11);
                dstRgba[dstIdx + 1] = Math.round(srcRgba[i00 + 1] * w00 + srcRgba[i10 + 1] * w10 + srcRgba[i01 + 1] * w01 + srcRgba[i11 + 1] * w11);
                dstRgba[dstIdx + 2] = Math.round(srcRgba[i00 + 2] * w00 + srcRgba[i10 + 2] * w10 + srcRgba[i01 + 2] * w01 + srcRgba[i11 + 2] * w11);
                dstRgba[dstIdx + 3] = Math.round(srcRgba[i00 + 3] * w00 + srcRgba[i10 + 3] * w10 + srcRgba[i01 + 3] * w01 + srcRgba[i11 + 3] * w11);
                // Mask nearest-neighbor / threshold
                const m00 = srcMask[y0 * w + x0];
                const m10 = srcMask[y0 * w + x1];
                const m01 = srcMask[y1 * w + x0];
                const m11 = srcMask[y1 * w + x1];
                const mVal = m00 * w00 + m10 * w10 + m01 * w01 + m11 * w11;
                dstMask[rowOffsetDst + x] = mVal >= 0.5 ? 1 : 0;
            }
            else {
                dstRgba[dstIdx + 3] = 0;
                dstMask[rowOffsetDst + x] = 0;
            }
        }
    }
    return { dstRgba, dstMask, outW, outH };
}
/**
 * Resizes a cropped rectangular region of RGBA buffer and binary mask to 224x224.
 */
function cropAndResize224(srcRgba, srcMask, srcW, srcH, cropX, cropY, cropW, cropH) {
    const targetW = 224;
    const targetH = 224;
    const rgba224 = new Uint8ClampedArray(targetW * targetH * 4);
    const mask224 = new Uint8Array(targetW * targetH);
    // Uniform scaling plus letterbox preserves long-part proportions.
    const scaleX = Math.max(cropW / targetW, cropH / targetH);
    const scaleY = scaleX;
    const offsetX = (targetW - cropW / scaleX) / 2;
    const offsetY = (targetH - cropH / scaleY) / 2;
    for (let y = 0; y < targetH; y++) {
        const srcY = cropY + (y - offsetY) * scaleY;
        if (y < offsetY || srcY >= cropY + cropH)
            continue;
        const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(srcY)));
        const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
        const fy = srcY - y0;
        for (let x = 0; x < targetW; x++) {
            const srcX = cropX + (x - offsetX) * scaleX;
            if (x < offsetX || srcX >= cropX + cropW)
                continue;
            const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(srcX)));
            const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
            const fx = srcX - x0;
            const w00 = (1 - fx) * (1 - fy);
            const w10 = fx * (1 - fy);
            const w01 = (1 - fx) * fy;
            const w11 = fx * fy;
            const i00 = (y0 * srcW + x0) * 4;
            const i10 = (y0 * srcW + x1) * 4;
            const i01 = (y1 * srcW + x0) * 4;
            const i11 = (y1 * srcW + x1) * 4;
            const dstIdx = (y * targetW + x) * 4;
            rgba224[dstIdx] = Math.round(srcRgba[i00] * w00 + srcRgba[i10] * w10 + srcRgba[i01] * w01 + srcRgba[i11] * w11);
            rgba224[dstIdx + 1] = Math.round(srcRgba[i00 + 1] * w00 + srcRgba[i10 + 1] * w10 + srcRgba[i01 + 1] * w01 + srcRgba[i11 + 1] * w11);
            rgba224[dstIdx + 2] = Math.round(srcRgba[i00 + 2] * w00 + srcRgba[i10 + 2] * w10 + srcRgba[i01 + 2] * w01 + srcRgba[i11 + 2] * w11);
            rgba224[dstIdx + 3] = Math.round(srcRgba[i00 + 3] * w00 + srcRgba[i10 + 3] * w10 + srcRgba[i01 + 3] * w01 + srcRgba[i11 + 3] * w11);
            const m00 = srcMask[y0 * srcW + x0];
            const m10 = srcMask[y0 * srcW + x1];
            const m01 = srcMask[y1 * srcW + x0];
            const m11 = srcMask[y1 * srcW + x1];
            const mVal = m00 * w00 + m10 * w10 + m01 * w01 + m11 * w11;
            mask224[y * targetW + x] = mVal >= 0.5 ? 1 : 0;
        }
    }
    return { rgba224, mask224 };
}
// ---------------------------------------------------------------------------
// 4. COLOR CONVERSION (CIE LAB L*) & CLAHE
// ---------------------------------------------------------------------------
/**
 * Converts sRGB pixel [0..255] to CIE 1976 L* Luminance [0..100].
 */
export function rgbToCieLuminance(r, g, b) {
    let rLin = r / 255;
    let gLin = g / 255;
    let bLin = b / 255;
    rLin = rLin <= 0.04045 ? rLin / 12.92 : Math.pow((rLin + 0.055) / 1.055, 2.4);
    gLin = gLin <= 0.04045 ? gLin / 12.92 : Math.pow((gLin + 0.055) / 1.055, 2.4);
    bLin = bLin <= 0.04045 ? bLin / 12.92 : Math.pow((bLin + 0.055) / 1.055, 2.4);
    // Standard D65 Illuminant Y component
    const y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
    const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
    return Math.max(0, Math.min(100, 116 * fy - 16));
}
/**
 * 3x3 Median Filter on 224x224 single-channel array.
 */
function applyMedianFilter3x3(src, mask, size = 224) {
    const dst = new Float32Array(size * size);
    const neighbors = new Float32Array(9);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = y * size + x;
            if (mask[idx] === 0) {
                dst[idx] = 0;
                continue;
            }
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= size)
                    continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= size)
                        continue;
                    neighbors[count++] = src[ny * size + nx];
                }
            }
            // Insertion sort for up to 9 values
            for (let i = 1; i < count; i++) {
                const val = neighbors[i];
                let j = i - 1;
                while (j >= 0 && neighbors[j] > val) {
                    neighbors[j + 1] = neighbors[j];
                    j--;
                }
                neighbors[j + 1] = val;
            }
            dst[idx] = neighbors[count >> 1];
        }
    }
    return dst;
}
/**
 * Contrast Limited Adaptive Histogram Equalization (CLAHE).
 * 8x8 tiles on 224x224 image, clipLimit = 2.5.
 */
export function applyClahe(luminance, mask, width = 224, height = 224, tilesX = 8, tilesY = 8, clipLimit = 2.5) {
    const total = width * height;
    const dst = new Float32Array(total);
    const tileW = width / tilesX; // 28
    const tileH = height / tilesY; // 28
    // Build CDF for each of the 8x8 tiles (256 bins)
    const cdfs = new Float32Array(tilesX * tilesY * 256);
    for (let ty = 0; ty < tilesY; ty++) {
        const yStart = Math.floor(ty * tileH);
        const yEnd = Math.floor((ty + 1) * tileH);
        for (let tx = 0; tx < tilesX; tx++) {
            const xStart = Math.floor(tx * tileW);
            const xEnd = Math.floor((tx + 1) * tileW);
            const tileIdx = (ty * tilesX + tx) * 256;
            const hist = new Int32Array(256);
            let count = 0;
            for (let y = yStart; y < yEnd; y++) {
                const row = y * width;
                for (let x = xStart; x < xEnd; x++) {
                    const idx = row + x;
                    if (mask[idx] === 1) {
                        const bin = Math.max(0, Math.min(255, Math.floor(luminance[idx] * 255)));
                        hist[bin]++;
                        count++;
                    }
                }
            }
            if (count === 0) {
                // Identity mapping for empty tile
                for (let b = 0; b < 256; b++)
                    cdfs[tileIdx + b] = b / 255;
                continue;
            }
            // Clip histogram
            const clipValue = Math.max(1, Math.floor(clipLimit * (count / 256)));
            let excess = 0;
            for (let b = 0; b < 256; b++) {
                if (hist[b] > clipValue) {
                    excess += hist[b] - clipValue;
                    hist[b] = clipValue;
                }
            }
            const bonus = excess / 256;
            let cumSum = 0;
            for (let b = 0; b < 256; b++) {
                cumSum += hist[b] + bonus;
                cdfs[tileIdx + b] = Math.min(1.0, cumSum / count);
            }
        }
    }
    // Bilinear interpolation between tile CDFs for every pixel
    for (let y = 0; y < height; y++) {
        const normY = y / tileH - 0.5;
        const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(normY)));
        const ty1 = Math.max(0, Math.min(tilesY - 1, ty0 + 1));
        const fy = normY - Math.floor(normY);
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (mask[idx] === 0) {
                dst[idx] = 0;
                continue;
            }
            const normX = x / tileW - 0.5;
            const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(normX)));
            const tx1 = Math.max(0, Math.min(tilesX - 1, tx0 + 1));
            const fx = normX - Math.floor(normX);
            const bin = Math.max(0, Math.min(255, Math.floor(luminance[idx] * 255)));
            const c00 = cdfs[(ty0 * tilesX + tx0) * 256 + bin];
            const c10 = cdfs[(ty0 * tilesX + tx1) * 256 + bin];
            const c01 = cdfs[(ty1 * tilesX + tx0) * 256 + bin];
            const c11 = cdfs[(ty1 * tilesX + tx1) * 256 + bin];
            const val = c00 * (1 - fx) * (1 - fy) +
                c10 * fx * (1 - fy) +
                c01 * (1 - fx) * fy +
                c11 * fx * fy;
            dst[idx] = Math.max(0, Math.min(1.0, val));
        }
    }
    return dst;
}
// ---------------------------------------------------------------------------
// 5. 3x3 SCHARR STRUCTURAL GRADIENT
// ---------------------------------------------------------------------------
/**
 * Computes 3x3 Scharr gradient magnitude sqrt(Gx^2 + Gy^2) normalized to [0, 1].
 */
export function computeScharrGradient(src, mask, size = 224) {
    const gradient = new Float32Array(size * size);
    let maxGrad = 1e-6;
    for (let y = 1; y < size - 1; y++) {
        const rowPrev = (y - 1) * size;
        const rowCur = y * size;
        const rowNext = (y + 1) * size;
        for (let x = 1; x < size - 1; x++) {
            const idx = rowCur + x;
            if (mask[idx] === 0)
                continue;
            const p00 = src[rowPrev + x - 1];
            const p01 = src[rowPrev + x];
            const p02 = src[rowPrev + x + 1];
            const p10 = src[rowCur + x - 1];
            const p12 = src[rowCur + x + 1];
            const p20 = src[rowNext + x - 1];
            const p21 = src[rowNext + x];
            const p22 = src[rowNext + x + 1];
            // Scharr X: [-3, 0, 3; -10, 0, 10; -3, 0, 3] / 32
            const gx = (-3 * p00 + 3 * p02 - 10 * p10 + 10 * p12 - 3 * p20 + 3 * p22) / 32;
            // Scharr Y: [-3, -10, -3; 0, 0, 0; 3, 10, 3] / 32
            const gy = (-3 * p00 - 10 * p01 - 3 * p02 + 3 * p20 + 10 * p21 + 3 * p22) / 32;
            const mag = Math.hypot(gx, gy);
            gradient[idx] = mag;
            if (mag > maxGrad)
                maxGrad = mag;
        }
    }
    // Normalize gradient to [0, 1]
    for (let i = 0; i < size * size; i++) {
        if (mask[i] === 1) {
            gradient[i] = Math.min(1.0, gradient[i] / maxGrad);
        }
        else {
            gradient[i] = 0;
        }
    }
    return gradient;
}
// ---------------------------------------------------------------------------
// 6. TWO-PASS CHAMFER (3, 4) DISTANCE TRANSFORM
// ---------------------------------------------------------------------------
/**
 * Computes exact Two-Pass Chamfer (3, 4) Distance Transform on binary mask.
 * Distance from every metal pixel to the nearest outer background or hole boundary.
 */
export function computeChamferDistanceTransform(mask, width = 224, height = 224) {
    const total = width * height;
    const dist = new Int32Array(total);
    const INF = 1000000;
    // Initialize: boundary/holes (mask === 0) have distance 0, foreground has INF
    for (let i = 0; i < total; i++) {
        dist[i] = mask[i] === 0 ? 0 : INF;
    }
    // Pass 1: Forward (top-left to bottom-right)
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            const idx = rowOffset + x;
            if (dist[idx] === 0)
                continue;
            let d = dist[idx];
            if (x > 0)
                d = Math.min(d, dist[idx - 1] + 3);
            if (y > 0) {
                d = Math.min(d, dist[idx - width] + 3);
                if (x > 0)
                    d = Math.min(d, dist[idx - width - 1] + 4);
                if (x < width - 1)
                    d = Math.min(d, dist[idx - width + 1] + 4);
            }
            dist[idx] = d;
        }
    }
    // Pass 2: Backward (bottom-right to top-left)
    let maxD = 0;
    for (let y = height - 1; y >= 0; y--) {
        const rowOffset = y * width;
        for (let x = width - 1; x >= 0; x--) {
            const idx = rowOffset + x;
            if (dist[idx] === 0)
                continue;
            let d = dist[idx];
            if (x < width - 1)
                d = Math.min(d, dist[idx + 1] + 3);
            if (y < height - 1) {
                d = Math.min(d, dist[idx + width] + 3);
                if (x > 0)
                    d = Math.min(d, dist[idx + width - 1] + 4);
                if (x < width - 1)
                    d = Math.min(d, dist[idx + width + 1] + 4);
            }
            dist[idx] = d;
            if (d > maxD)
                maxD = d;
        }
    }
    // Normalize distance to [0, 1]
    const normalized = new Float32Array(total);
    const normFactor = maxD > 0 ? maxD : 1;
    for (let i = 0; i < total; i++) {
        if (mask[i] === 1) {
            normalized[i] = Math.min(1.0, dist[i] / normFactor);
        }
        else {
            normalized[i] = 0;
        }
    }
    return normalized;
}
// ---------------------------------------------------------------------------
// 7. OUTER CONTOUR TRACER (Radial Sweep Algorithm)
// ---------------------------------------------------------------------------
/**
 * Traces the outer perimeter boundary contour in clockwise order on a 224x224 mask.
 */
export function traceOuterContour(mask, size = 224) {
    // Find topmost-leftmost foreground pixel
    let startX = -1;
    let startY = -1;
    for (let y = 0; y < size; y++) {
        const row = y * size;
        for (let x = 0; x < size; x++) {
            if (mask[row + x] === 1) {
                startX = x;
                startY = y;
                break;
            }
        }
        if (startX !== -1)
            break;
    }
    if (startX === -1)
        return [];
    // Moore-Neighbor 8-connected clockwise offsets starting from West (dx = -1, dy = 0)
    const dx8 = [-1, -1, 0, 1, 1, 1, 0, -1];
    const dy8 = [0, -1, -1, -1, 0, 1, 1, 1];
    const contour = [{ x: startX, y: startY }];
    let cx = startX;
    let cy = startY;
    let dir = 7; // backtrack direction
    const maxSteps = size * size;
    let step = 0;
    while (step++ < maxSteps) {
        let foundNext = false;
        // Clockwise search
        const startScan = (dir + 5) % 8; // (backtrack + 1)
        for (let i = 0; i < 8; i++) {
            const scanDir = (startScan + i) % 8;
            const nx = cx + dx8[scanDir];
            const ny = cy + dy8[scanDir];
            if (nx >= 0 && nx < size && ny >= 0 && ny < size && mask[ny * size + nx] === 1) {
                cx = nx;
                cy = ny;
                dir = scanDir;
                contour.push({ x: cx, y: cy });
                foundNext = true;
                break;
            }
        }
        if (!foundNext)
            break;
        if (cx === startX && cy === startY && contour.length > 2) {
            break;
        }
    }
    return contour;
}
// ---------------------------------------------------------------------------
// 8. 3-CHANNEL STRUCTURAL PSEUDO-RGB TENSOR GENERATOR
// ---------------------------------------------------------------------------
/**
 * Constructs the standard ImageNet-normalized [1, 3, 224, 224] tensor:
 * Channel 0: CLAHE Luminance
 * Channel 1: Scharr Structural Gradient
 * Channel 2: Chamfer Distance Transform
 */
export function buildStructuralPseudoRGBTensor(ch0, // CLAHE [0..1]
ch1, // Scharr [0..1]
ch2 // Chamfer [0..1]
) {
    const size = 224 * 224;
    const tensor = new Float32Array(3 * size);
    // ImageNet standard mean & std
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const ch0Offset = 0;
    const ch1Offset = size;
    const ch2Offset = 2 * size;
    for (let i = 0; i < size; i++) {
        tensor[ch0Offset + i] = (ch0[i] - mean[0]) / std[0];
        tensor[ch1Offset + i] = (ch1[i] - mean[1]) / std[1];
        tensor[ch2Offset + i] = (ch2[i] - mean[2]) / std[2];
    }
    return tensor;
}
// ---------------------------------------------------------------------------
// 9. COMPLETE LAYER 1 PIPELINE EXECUTION
// ---------------------------------------------------------------------------
/**
 * Executes full Layer 1 Optical Normalization pipeline according to MORIS_UPGRADE_PLAN.md:
 * 1. Background segmentation and internal hole extraction.
 * 2. Andrew's Monotone Chain Convex Hull for exact Solidity.
 * 3. PCA 2D moments horizontal alignment (-theta).
 * 4. Crop tightly with 6% padding and bilinear resize to 224x224.
 * 5. Deterministic 180-degree flip disambiguation (x_detail - x_fg >= 0 && y_detail - y_fg >= 0).
 * 6. CIE L* + Specular clamping (98th percentile) + 3x3 median + CLAHE (8x8, clipLimit=2.5).
 * 7. 3x3 Scharr gradient magnitude.
 * 8. Two-pass Chamfer (3, 4) distance transform.
 * 9. Standard ImageNet-normalized pseudo-RGB tensor [1, 3, 224, 224].
 */
export function processLayer1Optical(rawRgba, rawWidth, rawHeight) {
    // Step 1: Initial Segmentation & Hole Identification
    const seg = segmentForegroundAndHoles(rawRgba, rawWidth, rawHeight);
    if (!seg.foregroundArea)
        throw new Error("Không xác định được vật thể; vui lòng chụp lại ảnh rõ hơn.");
    // Step 2: PCA Major Axis Angle
    const pca = computePcaAngle(seg.fgMask, rawWidth, rawHeight);
    const angleDeg = Number(((pca.theta * 180) / Math.PI).toFixed(2));
    // Step 3: Rotate raw image and mask by -pca.theta to horizontal pose
    const rotated = rotateBufferAndMask(rawRgba, seg.fgMask, rawWidth, rawHeight, pca.cx, pca.cy, pca.theta);
    // Step 4: Find tight rotated bounding box
    let rMinX = rotated.outW, rMinY = rotated.outH, rMaxX = -1, rMaxY = -1;
    let rCount = 0;
    for (let y = 0; y < rotated.outH; y++) {
        const row = y * rotated.outW;
        for (let x = 0; x < rotated.outW; x++) {
            if (rotated.dstMask[row + x] === 1) {
                rCount++;
                if (x < rMinX)
                    rMinX = x;
                if (x > rMaxX)
                    rMaxX = x;
                if (y < rMinY)
                    rMinY = y;
                if (y > rMaxY)
                    rMaxY = y;
            }
        }
    }
    if (rCount === 0 || rMaxX < rMinX || rMaxY < rMinY) {
        rMinX = 0;
        rMinY = 0;
        rMaxX = rotated.outW - 1;
        rMaxY = rotated.outH - 1;
    }
    const rbw = rMaxX - rMinX + 1;
    const rbh = rMaxY - rMinY + 1;
    const orientedAspectRatio = Number((Math.max(rbw, rbh) / Math.max(1, Math.min(rbw, rbh))).toFixed(4));
    // Apply 6% padding margin
    const padX = Math.round(rbw * 0.06);
    const padY = Math.round(rbh * 0.06);
    const cropX = Math.max(0, rMinX - padX);
    const cropY = Math.max(0, rMinY - padY);
    const cropW = Math.min(rotated.outW - cropX, rbw + 2 * padX);
    const cropH = Math.min(rotated.outH - cropY, rbh + 2 * padY);
    // Step 5: Crop and Bilinear Resize to 224x224
    let { rgba224, mask224 } = cropAndResize224(rotated.dstRgba, rotated.dstMask, rotated.outW, rotated.outH, cropX, cropY, cropW, cropH);
    // Step 6: 180-Degree Flip Fix
    // Foreground centroid
    let fgSumX = 0, fgSumY = 0, fgN = 0;
    for (let y = 0; y < 224; y++) {
        const row = y * 224;
        for (let x = 0; x < 224; x++) {
            if (mask224[row + x] === 1) {
                fgSumX += x;
                fgSumY += y;
                fgN++;
            }
        }
    }
    const xFg = fgN > 0 ? fgSumX / fgN : 112;
    const yFg = fgN > 0 ? fgSumY / fgN : 112;
    // Detail centroid: luminance contrast + hole presence
    let detailSumX = 0, detailSumY = 0, detailWeight = 0;
    for (let y = 0; y < 224; y++) {
        const row = y * 224;
        for (let x = 0; x < 224; x++) {
            const idx = row + x;
            const rgbaIdx = idx * 4;
            const luma = 0.299 * rgba224[rgbaIdx] + 0.587 * rgba224[rgbaIdx + 1] + 0.114 * rgba224[rgbaIdx + 2];
            // Cavities and punched holes or high-contrast stamps have strong deviations
            const w = mask224[idx] === 0 ? 1.0 : (255 - luma) / 255;
            detailSumX += x * w;
            detailSumY += y * w;
            detailWeight += w;
        }
    }
    const xDetail = detailWeight > 0 ? detailSumX / detailWeight : 112;
    const yDetail = detailWeight > 0 ? detailSumY / detailWeight : 112;
    const dx = xDetail - xFg;
    const dy = yDetail - yFg;
    let flipH = false;
    let flipV = false;
    // Enforce deterministic orientation: true 2D in-plane 180-degree rotation (flipH AND flipV together)
    // NEVER perform a single-axis mirror reflection
    if (dx < -0.05 || (Math.abs(dx) <= 0.05 && dy < -0.05)) {
        flipH = true;
        flipV = true;
    }
    if (flipH || flipV) {
        const flippedRgba = new Uint8ClampedArray(224 * 224 * 4);
        const flippedMask = new Uint8Array(224 * 224);
        for (let y = 0; y < 224; y++) {
            const srcY = flipV ? 223 - y : y;
            for (let x = 0; x < 224; x++) {
                const srcX = flipH ? 223 - x : x;
                const dstIdx = (y * 224 + x) * 4;
                const srcIdx = (srcY * 224 + srcX) * 4;
                flippedRgba[dstIdx] = rgba224[srcIdx];
                flippedRgba[dstIdx + 1] = rgba224[srcIdx + 1];
                flippedRgba[dstIdx + 2] = rgba224[srcIdx + 2];
                flippedRgba[dstIdx + 3] = rgba224[srcIdx + 3];
                flippedMask[y * 224 + x] = mask224[srcY * 224 + srcX];
            }
        }
        rgba224 = flippedRgba;
        mask224 = flippedMask;
    }
    // Step 7: Channel 0: CIE L* + 98th Percentile Specular Clamping + 3x3 Median + CLAHE
    const rawLuma = new Float32Array(224 * 224);
    const fgLumaValues = [];
    for (let y = 0; y < 224; y++) {
        for (let x = 0; x < 224; x++) {
            const idx = y * 224 + x;
            if (mask224[idx] === 1) {
                const rgbaIdx = idx * 4;
                const L = rgbToCieLuminance(rgba224[rgbaIdx], rgba224[rgbaIdx + 1], rgba224[rgbaIdx + 2]);
                rawLuma[idx] = L;
                fgLumaValues.push(L);
            }
        }
    }
    // 98th percentile specular threshold
    let p98 = 100;
    if (fgLumaValues.length > 50) {
        fgLumaValues.sort((a, b) => a - b);
        p98 = fgLumaValues[Math.floor(fgLumaValues.length * 0.98)];
    }
    // Clamp specular glare and normalize to [0, 1]
    const clampedLuma = new Float32Array(224 * 224);
    for (let i = 0; i < 224 * 224; i++) {
        if (mask224[i] === 1) {
            clampedLuma[i] = Math.min(rawLuma[i], p98) / 100;
        }
    }
    // 3x3 Median filter
    const medianLuma = applyMedianFilter3x3(clampedLuma, mask224, 224);
    // CLAHE (8x8 tiles, clipLimit = 2.5)
    const claheLuminance = applyClahe(medianLuma, mask224, 224, 224, 8, 8, 2.5);
    // Step 8: Channel 1: 3x3 Scharr Structural Gradient
    const scharrEdgeMap = computeScharrGradient(claheLuminance, mask224, 224);
    // Step 9: Channel 2: Two-Pass Chamfer Distance Transform
    const chamferDistMap = computeChamferDistanceTransform(mask224, 224, 224);
    // Step 10: Standard ImageNet-normalized [1, 3, 224, 224] tensor
    const pseudoRgbTensor = buildStructuralPseudoRGBTensor(claheLuminance, scharrEdgeMap, chamferDistMap);
    // Step 11: Outer Contour Tracing for Elliptic Fourier Descriptors
    const outerContour = traceOuterContour(mask224, 224);
    // Step 12 (BUG 3 Fix): Compute true oriented aspect ratio, solidity, and hole features
    // strictly from the PCA-rotated and 180-degree disambiguated canonical mask224
    let cMinX = 224, cMinY = 224, cMaxX = -1, cMaxY = -1;
    let canonicalFgArea = 0;
    for (let y = 0; y < 224; y++) {
        const row = y * 224;
        for (let x = 0; x < 224; x++) {
            if (mask224[row + x] === 1) {
                canonicalFgArea++;
                if (x < cMinX)
                    cMinX = x;
                if (x > cMaxX)
                    cMaxX = x;
                if (y < cMinY)
                    cMinY = y;
                if (y > cMaxY)
                    cMaxY = y;
            }
        }
    }
    if (canonicalFgArea === 0 || cMaxX < cMinX || cMaxY < cMinY) {
        cMinX = 0;
        cMinY = 0;
        cMaxX = 223;
        cMaxY = 223;
        canonicalFgArea = 224 * 224;
    }
    const cW = cMaxX - cMinX + 1;
    const cH = cMaxY - cMinY + 1;
    const canonicalAspectRatio = Number((cW / Math.max(1, cH)).toFixed(4));
    const canonicalPerim = extractPerimeterPoints(mask224, 224, 224);
    const canonicalHull = computeConvexHull(canonicalPerim);
    const canonicalHullArea = computePolygonArea(canonicalHull);
    const canonicalSolidity = Number((canonicalFgArea / Math.max(canonicalFgArea, canonicalHullArea)).toFixed(4));
    // Extract canonical holes on mask224 via border flood-fill
    const cLabels = new Uint8Array(224 * 224);
    for (let i = 0; i < 224 * 224; i++) {
        if (mask224[i] === 1)
            cLabels[i] = 2; // Metal body
    }
    const cQueue = new Int32Array(224 * 224);
    let cqHead = 0, cqTail = 0;
    for (let x = 0; x < 224; x++) {
        if (cLabels[x] === 0) {
            cLabels[x] = 1;
            cQueue[cqTail++] = x;
        }
        const bIdx = 223 * 224 + x;
        if (cLabels[bIdx] === 0) {
            cLabels[bIdx] = 1;
            cQueue[cqTail++] = bIdx;
        }
    }
    for (let y = 1; y < 223; y++) {
        const lIdx = y * 224;
        if (cLabels[lIdx] === 0) {
            cLabels[lIdx] = 1;
            cQueue[cqTail++] = lIdx;
        }
        const rIdx = y * 224 + 223;
        if (cLabels[rIdx] === 0) {
            cLabels[rIdx] = 1;
            cQueue[cqTail++] = rIdx;
        }
    }
    while (cqHead < cqTail) {
        const idx = cQueue[cqHead++];
        const cx = idx % 224;
        const cy = (idx / 224) | 0;
        if (cx > 0) {
            const n = idx - 1;
            if (cLabels[n] === 0) {
                cLabels[n] = 1;
                cQueue[cqTail++] = n;
            }
        }
        if (cx < 223) {
            const n = idx + 1;
            if (cLabels[n] === 0) {
                cLabels[n] = 1;
                cQueue[cqTail++] = n;
            }
        }
        if (cy > 0) {
            const n = idx - 224;
            if (cLabels[n] === 0) {
                cLabels[n] = 1;
                cQueue[cqTail++] = n;
            }
        }
        if (cy < 223) {
            const n = idx + 224;
            if (cLabels[n] === 0) {
                cLabels[n] = 1;
                cQueue[cqTail++] = n;
            }
        }
    }
    const minCanonicalHoleArea = Math.max(2, Math.round(canonicalFgArea * 0.0004));
    const maxCanonicalHoleArea = seg.diagnostics.segmentationMode === "cutout_alpha"
        ? 224 * 224
        : Math.round(canonicalFgArea * 0.45);
    const visitedCanonicalHole = new Uint8Array(224 * 224);
    const canonicalHoles = [];
    const chQueue = new Int32Array(224 * 224);
    for (let y = cMinY; y <= cMaxY; y++) {
        const rowOffset = y * 224;
        for (let x = cMinX; x <= cMaxX; x++) {
            const idx = rowOffset + x;
            if (cLabels[idx] === 0 && visitedCanonicalHole[idx] === 0) {
                let chHead = 0, chTail = 0;
                let hArea = 0, sumX = 0, sumY = 0;
                visitedCanonicalHole[idx] = 1;
                chQueue[chTail++] = idx;
                while (chHead < chTail) {
                    const cur = chQueue[chHead++];
                    const hx = cur % 224;
                    const hy = (cur / 224) | 0;
                    hArea++;
                    sumX += hx;
                    sumY += hy;
                    if (hx > cMinX) {
                        const n = cur - 1;
                        if (cLabels[n] === 0 && visitedCanonicalHole[n] === 0) {
                            visitedCanonicalHole[n] = 1;
                            chQueue[chTail++] = n;
                        }
                    }
                    if (hx < cMaxX) {
                        const n = cur + 1;
                        if (cLabels[n] === 0 && visitedCanonicalHole[n] === 0) {
                            visitedCanonicalHole[n] = 1;
                            chQueue[chTail++] = n;
                        }
                    }
                    if (hy > cMinY) {
                        const n = cur - 224;
                        if (cLabels[n] === 0 && visitedCanonicalHole[n] === 0) {
                            visitedCanonicalHole[n] = 1;
                            chQueue[chTail++] = n;
                        }
                    }
                    if (hy < cMaxY) {
                        const n = cur + 224;
                        if (cLabels[n] === 0 && visitedCanonicalHole[n] === 0) {
                            visitedCanonicalHole[n] = 1;
                            chQueue[chTail++] = n;
                        }
                    }
                }
                if (hArea >= minCanonicalHoleArea && hArea <= maxCanonicalHoleArea) {
                    const cx = sumX / hArea;
                    const cy = sumY / hArea;
                    const u = Number(((cx - (cMinX + cW / 2)) / cW).toFixed(4));
                    const v = Number(((cy - (cMinY + cH / 2)) / cH).toFixed(4));
                    const normX = Number(((cx - cMinX) / cW).toFixed(4));
                    const normY = Number(((cy - cMinY) / cH).toFixed(4));
                    const relArea = Number(Math.sqrt(hArea / canonicalFgArea).toFixed(4));
                    const approxRadius = Math.sqrt(hArea / Math.PI);
                    const normRadius = Number((approxRadius / Math.max(cW, cH)).toFixed(4));
                    canonicalHoles.push({
                        x: normX,
                        y: normY,
                        u,
                        v,
                        area: hArea,
                        radius: normRadius,
                        relArea,
                        pixelArea: hArea,
                        isBig: true,
                        is_big: true
                    });
                }
            }
        }
    }
    const holeSizes = classifyHoleSizes1D(canonicalHoles.map(h => h.area ?? 0));
    for (const h of canonicalHoles) {
        const isBig = (h.area ?? 0) >= holeSizes.splitArea;
        h.isBig = isBig;
        h.is_big = isBig;
    }
    canonicalHoles.sort((a, b) => (a.x ?? a.u) - (b.x ?? b.u));
    return {
        fgMask: mask224,
        canonicalRgba: rgba224,
        aspectRatio: orientedAspectRatio,
        solidity: canonicalSolidity,
        holeCount: canonicalHoles.length,
        bigHoleCount: holeSizes.bigHoles,
        smallHoleCount: holeSizes.smallHoles,
        holeFeatures: canonicalHoles,
        pseudoRgbTensor,
        scharrEdgeMap,
        chamferDistMap,
        claheLuminance,
        outerContour,
        diagnostics: {
            pcaAngleDeg: angleDeg,
            flipH,
            flipV,
            rawForegroundArea: canonicalFgArea,
            convexHullArea: Math.round(canonicalFgArea / Math.max(0.01, canonicalSolidity)),
            segmentationMode: seg.diagnostics.segmentationMode,
            maskQuality: seg.diagnostics.maskQuality
        }
    };
}
