function parseText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map(p => p?.text || "")
    ?.join("") || "";
}

function parseJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i,"")
    .replace(/\s*```$/,"")
    .trim();

  try { return JSON.parse(cleaned); } catch (_) {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start,end+1));
  }

  throw new Error("Gemini trả JSON không hợp lệ.");
}

export function dataUrlPart(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/i);

  if (!m) throw new Error("Ảnh Gemini phải là JPEG, PNG hoặc WebP data URL.");

  return {
    inlineData:{
      mimeType:m[1],
      data:m[2]
    }
  };
}

export async function callGeminiJson(env, {
  model,
  systemInstruction,
  parts,
  schema,
  timeoutMs=60000,
  temperature=1.0,
  maxOutputTokens=4096
}) {
  const apiKey = String(env.GEMINI_API_KEY || "");
  if (!apiKey) throw new Error("Thiếu GEMINI_API_KEY.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const res = await fetch(endpoint, {
      method:"POST",
      signal:controller.signal,
      headers:{
        "content-type":"application/json",
        "x-goog-api-key":apiKey
      },
      body:JSON.stringify({
        systemInstruction:{
          parts:[{text:String(systemInstruction || "")}]
        },
        contents:[
          {
            role:"user",
            parts
          }
        ],
        generationConfig: {
  temperature: 0.1,
  responseMimeType: "application/json",
  responseSchema: visualSchema
}
          }
        }
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const detail = data?.error?.message
        || data?.error?.status
        || `Gemini HTTP ${res.status}`;
      const e = new Error(detail);
      e.status = res.status;
      e.provider = "gemini";
      e.provider_payload = data?.error || null;
      throw e;
    }

    const text = parseText(data);

    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason || "unknown";
      const e = new Error(`Gemini trả response rỗng. finishReason=${finishReason}`);
      e.status = 502;
      e.provider = "gemini";
      throw e;
    }

    return parseJson(text);
  } catch (e) {
    if (e?.name === "AbortError") {
      const err = new Error(`Gemini timeout sau ${timeoutMs} ms.`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
