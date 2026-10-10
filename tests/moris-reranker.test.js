import { describe, it, expect } from "vitest";
import {
  computeHoleSimilarity,
  computeAspectRatioSimilarity,
  scoreCandidateGeometry,
  rerankCandidatesByGeometry
} from "../src/moris/retrieval/geometricReranker.js";

describe("Moris Layer 3 — Geometric Re-Ranking Engine", () => {
  it("so khớp số lượng lỗ: 0 lỗ vs 0 lỗ -> điểm 1.0", () => {
    const s = computeHoleSimilarity({ hole_count: 0 }, { hole_count: 0 });
    expect(s).toBe(1.0);
  });

  it("so khớp số lượng lỗ: lệch 1 lỗ -> 0.5, lệch 2 lỗ trở lên -> 0.0", () => {
    expect(computeHoleSimilarity({ hole_count: 2 }, { hole_count: 3 })).toBe(0.5);
    expect(computeHoleSimilarity({ hole_count: 2 }, { hole_count: 4 })).toBe(0.0);
    expect(computeHoleSimilarity({ hole_count: 1 }, { hole_count: 4 })).toBe(0.0);
  });

  it("bất biến khi lật mặt sau (Mirror Invariant): nhận diện chính xác 100% tọa độ đảo gương", () => {
    // Query có 2 lỗ lệch sang bên trái: x = 0.2 và x = 0.4
    const query = {
      hole_count: 2,
      hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }]
    };

    // DB chụp từ mặt trước nên lỗ nằm lệch sang phải: x = 0.6 và x = 0.8 (đối xứng gương của 0.4 và 0.2)
    const dbCandidate = {
      hole_count: 2,
      hole_centroids: [{ x: 0.6, y: 0.5 }, { x: 0.8, y: 0.5 }]
    };

    const s = computeHoleSimilarity(query, dbCandidate);
    // Nhờ tính năng Mirror Invariant (1 - x), điểm tương đồng phải xấp xỉ 1.0!
    expect(s).toBeCloseTo(1.0, 2);
  });

  it("tái xếp hạng: linh kiện khớp đúng số lỗ phải vượt lên Top 1 dù vector DINOv2 hơi thấp hơn một chút", () => {
    const queryGeometry = {
      hole_count: 3,
      aspect_ratio: 2.0,
      hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }]
    };

    const candidates = [
      {
        id: "candidate-A",
        code: "PART-4-HOLES",
        vector_similarity: 0.95, // DINOv2 đánh giá rất cao vì phôi cùng hình dạng
        hole_count: 4, // Nhưng thực tế có 4 lỗ (sai khác cấu trúc)
        aspect_ratio: 2.0,
        hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.8, y: 0.5 }]
      },
      {
        id: "candidate-B",
        code: "PART-3-HOLES-EXACT",
        vector_similarity: 0.91, // DINOv2 hơi thấp hơn một chút do ánh sáng
        hole_count: 3, // Khớp chính xác 3 lỗ!
        aspect_ratio: 2.0,
        hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }]
      }
    ];

    const reranked = rerankCandidatesByGeometry(candidates, queryGeometry);

    // Candidate B (khớp đúng 3 lỗ) bắt buộc phải vươn lên Top 1!
    expect(reranked[0].id).toBe("candidate-B");
    expect(reranked[0].code).toBe("PART-3-HOLES-EXACT");
    expect(reranked[0].geometric_score).toBeGreaterThan(reranked[1].geometric_score);

    // Candidate A bị cảnh báo khác số lỗ
    expect(reranked[1].geometric_warning).toContain("khác số lỗ");
  });

  it("tỷ lệ khung hình: giống tỷ lệ cho điểm 1.0, lệch tỷ lệ giảm điểm", () => {
    expect(computeAspectRatioSimilarity(2.0, 2.0)).toBe(1.0);
    expect(computeAspectRatioSimilarity(2.0, 1.0)).toBe(0.5);
  });
});
