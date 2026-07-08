function parseText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map(p => p?.text || "")
    ?.join("") || "";
}

function parseJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i,"")
    .replace(/\s*```$/i,"")
    .trim();

  try { return JSON.parse(cleaned); } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start,end+1));
  }

  throw new Error("Gemini trả JSON không hợp lệ.");
}

export function geminiImagePart(dataUrl) {
  const m = String(dataUrl || "").match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/i
  );

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
  const key = String(env.GEMINI_API_KEY || "");
  if (!key) {
    const e = new Error("Thiếu GEMINI_API_KEY.");
    e.status = 503;
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent`;

    const res = await fetch(endpoint, {
      method:"POST",
      signal:controller.signal,
      headers:{
        "content-type":"application/json",
        "x-goog-api-key":key
      },
      body:JSON.stringify({
        systemInstruction:{
          parts:[{text:String(systemInstruction || "")}]
        },
        contents:[{
          role:"user",
          parts:Array.isArray(parts) ? parts : []
        }],
        generationConfig:{
          temperature,
          maxOutputTokens,
          responseMimeType:"application/json",
          responseJsonSchema:schema
        }
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const e = new Error(
        data?.error?.message ||
        data?.error?.status ||
        `Gemini HTTP ${res.status}`
      );
      e.status = res.status;
      e.details = data?.error || null;
      throw e;
    }

    const text = parseText(data);
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason || "unknown";
      const e = new Error(`Gemini response rỗng. finishReason=${reason}`);
      e.status = 502;
      throw e;
    }

    return parseJson(text);
  } catch (error) {
    if (error?.name === "AbortError") {
      const e = new Error(`Gemini timeout sau ${timeoutMs} ms.`);
      e.status = 504;
      throw e;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
