import { describe, it, expect } from "vitest";
import { extractBorderStats, extractPartMask } from "../src/moris/geometry/partMask.js";

describe("Moris Part Mask Extraction Engine", () => {
  it("nhận diện chính xác nền xám và tính độ sáng luma", () => {
    const W = 100, H = 50;
    const data = new Uint8ClampedArray(W * H * 4);
    // Điền toàn bộ nền xám RGB(80, 80, 80) như trong image copy.png
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 80;
      data[i * 4 + 1] = 80;
      data[i * 4 + 2] = 80;
      data[i * 4 + 3] = 255;
    }

    const bg = extractBorderStats(data, W, H);
    expect(bg.r).toBeCloseTo(80, 0);
    expect(bg.g).toBeCloseTo(80, 0);
    expect(bg.b).toBeCloseTo(80, 0);
    expect(bg.luma).toBeCloseTo(80, 0);
  });

  it("phân lập chính xác linh kiện tối màu và BỎ QUA nền xung quanh + BỎ QUA lỗ rỗng", () => {
    const W = 100, H = 50;
    const data = new Uint8ClampedArray(W * H * 4);

    // 1. Nền xám RGB(80, 80, 80)
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 80;
      data[i * 4 + 1] = 80;
      data[i * 4 + 2] = 80;
      data[i * 4 + 3] = 255;
    }

    // 2. Linh kiện cơ khí kim loại tối màu RGB(20, 20, 20) từ x=20..80, y=15..35
    for (let y = 15; y <= 35; y++) {
      for (let x = 20; x <= 80; x++) {
        const idx = (y * W + x) * 4;
        data[idx] = 20;
        data[idx + 1] = 20;
        data[idx + 2] = 20;
        data[idx + 3] = 255;
      }
    }

    // 3. Lỗ rỗng (hole 1) tại x=30..36, y=22..28 hiển thị màu nền RGB(80, 80, 80)
    for (let y = 22; y <= 28; y++) {
      for (let x = 30; x <= 36; x++) {
        const idx = (y * W + x) * 4;
        data[idx] = 80;
        data[idx + 1] = 80;
        data[idx + 2] = 80;
        data[idx + 3] = 255;
      }
    }

    // 4. Lỗ rỗng (hole 2) tại x=65..71, y=22..28 hiển thị màu nền RGB(80, 80, 80)
    for (let y = 22; y <= 28; y++) {
      for (let x = 65; x <= 71; x++) {
        const idx = (y * W + x) * 4;
        data[idx] = 80;
        data[idx + 1] = 80;
        data[idx + 2] = 80;
        data[idx + 3] = 255;
      }
    }

    const { mask, partPixels } = extractPartMask(data, W, H);

    // Điểm trên nền ngoài (ví dụ x=5, y=5) PHẢI LÀ 0 (bỏ qua nền)
    expect(mask[5 * W + 5]).toBe(0);
    expect(mask[2 * W + 50]).toBe(0);

    // Điểm trên thân linh kiện kim loại tối (ví dụ x=50, y=25) PHẢI LÀ 255 (quét tia sáng)
    expect(mask[25 * W + 50]).toBe(255);
    expect(mask[20 * W + 25]).toBe(255);

    // Điểm TRONG LỖ RỖNG (hole 1: x=33, y=25) PHẢI LÀ 0 (tia sáng laser bỏ qua lỗ)
    expect(mask[25 * W + 33]).toBe(0);

    // Điểm TRONG LỖ RỖNG (hole 2: x=68, y=25) PHẢI LÀ 0 (tia sáng laser bỏ qua lỗ)
    expect(mask[25 * W + 68]).toBe(0);

    // Tổng số pixel của linh kiện phải dương và không bằng toàn bộ ảnh
    expect(partPixels).toBeGreaterThan(500);
    expect(partPixels).toBeLessThan(W * H);
  });

  it("fallback an toàn khi ảnh chụp đồng màu hoàn toàn", () => {
    const W = 50, H = 50;
    const data = new Uint8ClampedArray(W * H * 4);
    // Khung màu đồng nhất (ví dụ tay che đen kịt camera)
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 10;
      data[i * 4 + 1] = 10;
      data[i * 4 + 2] = 10;
      data[i * 4 + 3] = 255;
    }

    const { mask, partPixels } = extractPartMask(data, W, H);
    // Phải fallback fill 255 để hiệu ứng quét laser vẫn chạy không bị crash
    expect(partPixels).toBe(W * H);
    expect(mask[0]).toBe(255);
  });
});
