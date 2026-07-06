function headers(config) {
  const h = {
    "content-type":"application/json",
    "authorization":`Bearer ${config.openrouterApiKey}`,
    "x-title":config.appName
  };
  if (config.httpReferer) h["http-referer"] = config.httpReferer;
  return h;
}

export function extractText(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(x => typeof x === "string" ? x : (x?.text || "")).join("");
  }
  return "";
}

function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function parseJsonText(text) {
  const cleaned = stripCodeFence(text);
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error("Model không trả JSON hợp lệ.");
}

export async function callOpenRouter(config, {
  model,
  messages,
  temperature=0.1,
  maxTokens=1200,
  responseFormat=null
}) {
  if (!config.openrouterApiKey) throw new Error("Thiếu OPENROUTER_API_KEY.");

  const body = {
    model,
    messages,
    temperature,
    max_tokens:maxTokens
  };
  if (responseFormat) body.response_format = responseFormat;

  const controller = new AbortController();
  const timeoutMs = Number(config.openrouterTimeoutMs || 30000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:"POST",
      headers:headers(config),
      body:JSON.stringify(body),
      signal:controller.signal
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      const error = new Error(`OpenRouter quá thời gian chờ sau ${timeoutMs} ms.`);
      error.status = 504;
      throw error;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `OpenRouter lỗi HTTP ${res.status}.`;
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function callJsonModel(config, {
  model,
  messages,
  schemaName,
  schema,
  temperature=0.1,
  maxTokens=1200
}) {
  const responseFormat = {
    type:"json_schema",
    json_schema:{
      name:schemaName,
      strict:true,
      schema
    }
  };

  try {
    const completion = await callOpenRouter(config, {
      model, messages, temperature, maxTokens, responseFormat
    });
    return parseJsonText(extractText(completion));
  } catch (e) {
    // Một số free provider có thể từ chối response_format dù model hỗ trợ JSON tốt.
    if (![400,404,422].includes(Number(e?.status))) throw e;
    const fallbackMessages = [
      ...messages,
      {
        role:"user",
        content:"Return ONLY one valid JSON object matching the requested schema. No markdown, no code fence."
      }
    ];
    const completion = await callOpenRouter(config, {
      model, messages:fallbackMessages, temperature, maxTokens
    });
    return parseJsonText(extractText(completion));
  }
}
