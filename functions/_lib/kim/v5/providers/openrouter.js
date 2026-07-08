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

  throw new Error("OpenRouter trả JSON không hợp lệ.");
}

export async function callOpenRouterJson(env, {
  model,
  messages,
  schema,
  schemaName="kim_response",
  timeoutMs=30000,
  temperature=0.2,
  maxTokens=2500
}) {
  const key = String(env.OPENROUTER_API_KEY || "");
  if (!key) {
    const e = new Error("Thiếu OPENROUTER_API_KEY.");
    e.status = 503;
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:"POST",
      signal:controller.signal,
      headers:{
        "content-type":"application/json",
        "authorization":`Bearer ${key}`,
        ...(env.OPENROUTER_SITE_URL
          ? {"http-referer":String(env.OPENROUTER_SITE_URL)}
          : {}),
        ...(env.OPENROUTER_APP_NAME
          ? {"x-title":String(env.OPENROUTER_APP_NAME)}
          : {})
      },
      body:JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens:maxTokens,
        provider:{require_parameters:true},
        response_format:{
          type:"json_schema",
          json_schema:{
            name:schemaName,
            strict:true,
            schema
          }
        }
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const e = new Error(
        data?.error?.message ||
        `OpenRouter HTTP ${res.status}`
      );
      e.status = res.status;
      e.details = data?.error || null;
      throw e;
    }

    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) {
      const e = new Error("OpenRouter response rỗng.");
      e.status = 502;
      throw e;
    }

    return parseJson(text);
  } catch (error) {
    if (error?.name === "AbortError") {
      const e = new Error(`OpenRouter timeout sau ${timeoutMs} ms.`);
      e.status = 504;
      throw e;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
