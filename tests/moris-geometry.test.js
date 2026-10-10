import { describe, it, expect, vi } from "vitest";
import { computeOrientationPCA } from "../src/moris/geometry/pcaAligner.js";
import { extractHoleTopology } from "../src/moris/geometry/holeTopology.js";
import { dataUrlToBlob, imageSourceToBlob } from "../src/moris/vector/imageCanonicalizer.js";

describe("Moris Geometry Engine (Pure JS, 0MB WASM, Zero-Crash)", () => {
  describe("PCA Orientation Aligner", () => {
    it("nhận diện chính xác thanh nằm ngang (góc ~0 độ)", () => {
      const W = 200, H = 200;
      const mask = new Uint8Array(W * H);
      // Vẽ thanh ngang từ x=40..160, y=90..110
      for (let y = 90; y <= 110; y++) {
        for (let x = 40; x <= 160; x++) {
          mask[y * W + x] = 255;
        }
      }

      const res = computeOrientationPCA(mask, W, H);
      expect(res.valid).toBe(true);
      expect(Math.abs(res.angleDeg)).toBeLessThan(1.0); // Góc gần 0
      expect(res.centroid.x).toBeCloseTo(100, 0);
      expect(res.centroid.y).toBeCloseTo(100, 0);
    });

    it("nhận diện chính xác thanh thẳng đứng (góc ~90 độ)", () => {
      const W = 200, H = 200;
      const mask = new Uint8Array(W * H);
      // Vẽ thanh dọc từ x=90..110, y=40..160
      for (let y = 40; y <= 160; y++) {
        for (let x = 90; x <= 110; x++) {
          mask[y * W + x] = 255;
        }
      }

      const res = computeOrientationPCA(mask, W, H);
      expect(res.valid).toBe(true);
      expect(Math.abs(Math.abs(res.angleDeg) - 90)).toBeLessThan(1.0); // Góc gần 90 độ
    });

    it("nhận diện chính xác thanh nghiêng 45 độ", () => {
      const W = 200, H = 200;
      const mask = new Uint8Array(W * H);
      // Vẽ dải nghiêng x=y
      for (let i = 40; i <= 160; i++) {
        for (let d = -4; d <= 4; d++) {
          const x = i + d;
          const y = i;
          if (x >= 0 && x < W && y >= 0 && y < H) {
            mask[y * W + x] = 255;
          }
        }
      }

      const res = computeOrientationPCA(mask, W, H);
      expect(res.valid).toBe(true);
      expect(res.angleDeg).toBeCloseTo(45, 0);
    });

    it("xử lý an toàn khi mask rỗng hoặc quá ít pixel", () => {
      const W = 100, H = 100;
      const mask = new Uint8Array(W * H);
      const res = computeOrientationPCA(mask, W, H);
      expect(res.valid).toBe(false);
      expect(res.angleDeg).toBe(0);
    });
  });

  describe("Hole Topology Extractor", () => {
    it("tấm kim loại đặc (không có lỗ): trả về hole_count = 0 và aspect_ratio chuẩn", () => {
      const W = 160, H = 100;
      const mask = new Uint8Array(W * H);
      // Tấm kim loại 120 x 60 từ (20, 20) -> (139, 79)
      for (let y = 20; y < 80; y++) {
        for (let x = 20; x < 140; x++) {
          mask[y * W + x] = 255;
        }
      }

      const res = extractHoleTopology(mask, W, H);
      expect(res.hole_count).toBe(0);
      expect(res.aspect_ratio).toBeCloseTo(120 / 60, 2);
      expect(res.hole_centroids).toEqual([]);
      expect(res.object_bbox.width).toBe(120);
      expect(res.object_bbox.height).toBe(60);
    });

    it("tấm kim loại có 1 lỗ tròn ở tâm: phát hiện đúng 1 lỗ và tọa độ ~ (0.5, 0.5)", () => {
      const W = 200, H = 200;
      const mask = new Uint8Array(W * H);
      // Tấm kim loại 100 x 100 từ x=50..149, y=50..149
      for (let y = 50; y < 150; y++) {
        for (let x = 50; x < 150; x++) {
          // Lỗ tròn bán kính 10 tại tâm (100, 100)
          const dist = Math.hypot(x - 100, y - 100);
          if (dist > 10) {
            mask[y * W + x] = 255;
          }
        }
      }

      const res = extractHoleTopology(mask, W, H);
      expect(res.hole_count).toBe(1);
      expect(res.hole_centroids.length).toBe(1);
      const hole = res.hole_centroids[0];
      expect(hole.x).toBeCloseTo(0.5, 1);
      expect(hole.y).toBeCloseTo(0.5, 1);
      expect(hole.radius).toBeGreaterThan(0.05);
    });

    it("tấm kim loại có 3 lỗ dập: phát hiện đúng 3 lỗ sắp xếp tăng dần theo X", () => {
      const W = 300, H = 100;
      const mask = new Uint8Array(W * H);
      // Tấm kim loại từ x=10..289, y=20..79 (rộng 280, cao 60)
      for (let y = 20; y < 80; y++) {
        for (let x = 10; x < 290; x++) {
          mask[y * W + x] = 255;
        }
      }

      // Đục 3 lỗ tại x=60, x=150, x=240, cùng y=50
      const centers = [60, 150, 240];
      for (const cx of centers) {
        for (let y = 42; y <= 58; y++) {
          for (let x = cx - 8; x <= cx + 8; x++) {
            mask[y * W + x] = 0;
          }
        }
      }

      const res = extractHoleTopology(mask, W, H);
      expect(res.hole_count).toBe(3);
      expect(res.hole_centroids.length).toBe(3);
      // Kiểm tra tọa độ X tăng dần
      expect(res.hole_centroids[0].x).toBeLessThan(res.hole_centroids[1].x);
      expect(res.hole_centroids[1].x).toBeLessThan(res.hole_centroids[2].x);
    });

    it("lọc bỏ nhiễu pixel nhỏ (< minHoleArea)", () => {
      const W = 100, H = 100;
      const mask = new Uint8Array(W * H);
      // Tấm kim loại
      for (let y = 20; y < 80; y++) {
        for (let x = 20; x < 80; x++) {
          mask[y * W + x] = 255;
        }
      }
      // Tạo đốm nhiễu 2 pixel
      mask[50 * W + 50] = 0;
      mask[50 * W + 51] = 0;

      const res = extractHoleTopology(mask, W, H, { minHoleArea: 8 });
      expect(res.hole_count).toBe(0); // Đốm nhiễu 2px bị loại bỏ
    });

    it("vết khuyết / rãnh chữ U ở mép ngoài KHÔNG bị đếm nhầm thành lỗ bên trong", () => {
      const W = 100, H = 100;
      const mask = new Uint8Array(W * H);
      // Tấm kim loại từ x=20..80, y=20..80
      for (let y = 20; y < 80; y++) {
        for (let x = 20; x < 80; x++) {
          mask[y * W + x] = 255;
        }
      }
      // Khuyết rãnh ở mép trên (y=20..35, x=45..55) nối thông ra nền ngoài
      for (let y = 20; y <= 35; y++) {
        for (let x = 45; x <= 55; x++) {
          mask[y * W + x] = 0;
        }
      }

      const res = extractHoleTopology(mask, W, H);
      expect(res.hole_count).toBe(0); // Rãnh hở mép ngoài không phải lỗ dập kín
    });
  });

  describe("Image Canonicalizer Data URL & Blob Decoder", () => {
    it("dataUrlToBlob: phân giải chính xác chuỗi base64 thành Blob mà KHÔNG gọi fetch", async () => {
      // 1x1 transparent PNG: iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
      const sampleDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      
      const blob = dataUrlToBlob(sampleDataUrl);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/png");
      expect(blob.size).toBeGreaterThan(0);
    });

    it("imageSourceToBlob: xử lý an toàn nguồn data URL mà không chạm Service Worker / fetch", async () => {
      const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
      
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const blob = await imageSourceToBlob(sampleDataUrl);
      
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/jpeg");
      // Phải giải mã đồng bộ trực tiếp bằng atob / Uint8Array, TUYỆT ĐỐI không gọi fetch
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("imageSourceToBlob: ném lỗi nếu nguồn rỗng", async () => {
      await expect(imageSourceToBlob("")).rejects.toThrow("Thiếu nguồn ảnh");
    });
  });
});
