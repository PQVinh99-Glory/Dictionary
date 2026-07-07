function parseText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || "")
    ?.join("") || "";
}

function parseJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Fallback below.
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  throw new Error("Gemini trả JSON không hợp lệ.");
}

export function dataUrlPart(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/i
  );

  if (!match) {
    throw new Error(
      "Ảnh Gemini phải là JPEG, PNG hoặc WebP data URL."
    );
  }

  return {
    inlineData: {
      mimeType: match[1],
      data: match[2]
    }
  };
}

export async function callGeminiJson(env, {
  model,
  systemInstruction,
  parts,
  schema,
  timeoutMs = 60000,
  temperature = 1.0,
  maxOutputTokens = 4096
}) {
  const apiKey = String(env.GEMINI_API_KEY || "");

  if (!apiKey) {
    throw new Error("Thiếu GEMINI_API_KEY.");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent`;

    const payload = {
      systemInstruction: {
        parts: [
          {
            text: String(systemInstruction || "")
          }
        ]
      },

      contents: [
        {
          role: "user",
          parts: Array.isArray(parts) ? parts : []
        }
      ],

      generationConfig: {
        temperature,
        maxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: schema
      }
    };

    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const detail =
        data?.error?.message ||
        data?.error?.status ||
        `Gemini HTTP ${res.status}`;

      const error = new Error(detail);
      error.status = res.status;
      error.provider = "gemini";
      error.provider_payload = data?.error || null;
      throw error;
    }

    const text = parseText(data);

    if (!text) {
      const finishReason =
        data?.candidates?.[0]?.finishReason || "unknown";

      const error = new Error(
        `Gemini trả response rỗng. finishReason=${finishReason}`
      );
      error.status = 502;
      error.provider = "gemini";
      throw error;
    }

    return parseJson(text);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Gemini timeout sau ${timeoutMs} ms.`
      );
      timeoutError.status = 504;
      timeoutError.provider = "gemini";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
