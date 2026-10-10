/**
 * Trích xuất mặt nạ (mask) cho linh kiện tối màu trên nền sáng/trung tính.
 * Bỏ qua toàn bộ nền xung quanh và các lỗ rỗng (holes) bên trong linh kiện.
 * Pure JS — zero dependencies, chạy an toàn trên iOS Safari & Android Chrome.
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Lấy mẫu thống kê màu viền (background borders) từ 4 cạnh ngoài của ảnh.
 */
export function extractBorderStats(data, w, h) {
  const borderThickness = Math.max(2, Math.floor(Math.min(w, h) * 0.04));
  let r = 0, g = 0, b = 0, n = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < borderThickness || y >= h - borderThickness || x < borderThickness || x >= w - borderThickness) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 20) continue; // bỏ qua pixel trong suốt
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        n++;
      }
    }
  }

  if (!n) {
    return { r: 240, g: 240, b: 240, luma: 240, spread: 0 };
  }

  r /= n;
  g /= n;
  b /= n;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;

  let spread = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (y < borderThickness || y >= h - borderThickness || x < borderThickness || x >= w - borderThickness) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 20) continue;
        spread += Math.hypot(data[idx] - r, data[idx + 1] - g, data[idx + 2] - b);
      }
    }
  }
  spread /= Math.max(1, n / 4);

  return { r, g, b, luma, spread };
}

/**
 * Tạo binary mask Uint8Array(w * h)
 * - 255: Thân linh kiện tối màu
 * - 0: Nền xung quanh và các lỗ tròn/lỗ rỗng bên trong linh kiện
 */
export function extractPartMask(data, w, h) {
  const bg = extractBorderStats(data, w, h);
  const mask = new Uint8Array(w * h);

  // Ngưỡng phân tách khoảng cách màu Euclid
  const threshold = clamp(24 + bg.spread * 1.35, 26, 78);
  let partPixels = 0;

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const a = data[idx + 3];

    // Nếu ảnh có sẵn alpha channel trong suốt (PNG)
    if (a < 36) {
      mask[i] = 0;
      continue;
    }

    const pr = data[idx];
    const pg = data[idx + 1];
    const pb = data[idx + 2];

    const dist = Math.hypot(pr - bg.r, pg - bg.g, pb - bg.b);
    const luma = 0.299 * pr + 0.587 * pg + 0.114 * pb;

    // Điều kiện linh kiện tối màu:
    // 1. Khoảng cách màu khác nền > threshold
    // 2. Độ sáng luma thấp hơn nền hoặc thuộc dải kim loại tối
    // (Các lỗ rỗng bên trong có màu giống nền -> dist <= threshold -> mask = 0)
    const isDarkPart = (dist > threshold) && (luma < Math.max(160, bg.luma - 15));

    if (isDarkPart) {
      mask[i] = 255;
      partPixels++;
    } else {
      mask[i] = 0;
    }
  }

  // Dự phòng an toàn: nếu ảnh quá mờ hoặc người dùng che kín camera (< 2% diện tích)
  // mở rộng toàn khung để hiệu ứng quét laser không bị biến mất hoàn toàn
  if (partPixels < w * h * 0.02) {
    mask.fill(255);
    partPixels = w * h;
  }

  return { mask, partPixels, bg, threshold };
}
