function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(x => typeof x === "string" ? x : (x?.text || "")).join("");
  }
  return "";
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

  throw new Error("OpenRouter model trả JSON không hợp lệ.");
}

export async function callOpenRouterJson(env, {
  model,
  messages,
  schema,
  schemaName="denis_schema",
  timeoutMs=30000,
  temperature=0.05,
  maxTokens=2500
}) {
  const apiKey = String(env.OPENROUTER_API_KEY || "");
  if (!apiKey) throw new Error("Thiếu OPENROUTER_API_KEY.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:"POST",
      signal:controller.signal,
      headers:{
        "content-type":"application/json",
        "authorization":`Bearer ${apiKey}`,
        "x-title":"Denis Catalogue AI"
      },
      body:JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens:maxTokens,
        structured_outputs:true,
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
      const errorType = data?.error?.type
        || data?.error?.metadata?.error_type
        || data?.error_type
        || "unknown";
      const message = data?.error?.message
        || data?.message
        || `OpenRouter HTTP ${res.status}`;

      const e = new Error(`${message} [type=${errorType}]`);
      e.status = res.status;
      e.provider = "openrouter";
      e.error_type = errorType;
      e.provider_payload = data?.error || data || null;
      throw e;
    }

    const text = extractText(data);

    if (!text) {
      const finishReason = data?.choices?.[0]?.finish_reason || "unknown";
      const e = new Error(`OpenRouter trả response rỗng. finish_reason=${finishReason}`);
      e.status = 502;
      e.provider = "openrouter";
      throw e;
    }

    return parseJson(text);
  } catch (e) {
    if (e?.name === "AbortError") {
      const err = new Error(`OpenRouter timeout sau ${timeoutMs} ms.`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
