import { foregroundDecision } from "./foregroundGate.js";

function assertImageDataUrl(dataUrl, maxChars) {
  const s = String(dataUrl || "");
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(s)) {
    const e = new Error("Ảnh phải là JPEG, PNG hoặc WebP data URL.");
    e.status = 400;
    throw e;
  }

  if (s.length > maxChars) {
    const e = new Error("Ảnh query quá lớn.");
    e.status = 413;
    throw e;
  }

  return s;
}

export async function canonicalizeImage(env, config, imageDataUrl, hints={}) {
  const original = assertImageDataUrl(
    imageDataUrl,
    config.limits.maxImageDataUrlChars
  );

  const decision = foregroundDecision(hints);

  if (!config.endpoints.foreground || decision.action === "skip_removal") {
    return {
      originalImage:original,
      canonicalImage:original,
      foregroundStatus:decision.action === "skip_removal" ? "skipped_simple" : "not_configured",
      qualityScore:Number(hints.qualityScore ?? 0.75),
      warnings:config.endpoints.foreground ? [] : ["KIM_FOREGROUND_ENDPOINT chưa cấu hình; dùng ảnh gốc."]
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(config.endpoints.foreground, {
      method:"POST",
      signal:controller.signal,
      headers:{
        "content-type":"application/json",
        ...(env.KIM_FOREGROUND_BEARER_TOKEN
          ? {"authorization":`Bearer ${env.KIM_FOREGROUND_BEARER_TOKEN}`}
          : {})
      },
      body:JSON.stringify({
        image_data_url:original,
        preprocess_version:config.vector.preprocessVersion
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.image_data_url) {
      return {
        originalImage:original,
        canonicalImage:original,
        foregroundStatus:"failed_fallback",
        qualityScore:Number(hints.qualityScore ?? 0.65),
        warnings:[data?.error || `Foreground endpoint HTTP ${res.status}; fallback ảnh gốc.`]
      };
    }

    return {
      originalImage:original,
      canonicalImage:assertImageDataUrl(data.image_data_url, config.limits.maxImageDataUrlChars),
      foregroundStatus:"processed",
      qualityScore:Number(data.quality_score ?? hints.qualityScore ?? 0.8),
      warnings:[]
    };
  } catch (error) {
    return {
      originalImage:original,
      canonicalImage:original,
      foregroundStatus:"failed_fallback",
      qualityScore:Number(hints.qualityScore ?? 0.6),
      warnings:[`Foreground lỗi: ${error?.message || error}; fallback ảnh gốc.`]
    };
  } finally {
    clearTimeout(timer);
  }
}
