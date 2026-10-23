import { inspectVectorItems } from "../../_lib/moris/v5/vector/assetStatus.js";
import {
  rpc,
  validateSession
} from "../../_lib/moris/v5/connectors/supabase.js";

import {
  json,
  errorResponse
} from "../../_lib/shared/http.js";

const LIST_RPC_ATTEMPTS = 2;

function isTransient(error) {
  const status = Number(error?.status || 0);
  return error?.name === "TypeError" || status === 429 || status >= 500;
}

async function listPage(env, token, { search, limit, offset }) {
  let lastError;
  for (let attempt = 0; attempt < LIST_RPC_ATTEMPTS; attempt += 1) {
    try {
      const result = await rpc(env, "app_list_catalogue_vector_items", {
        p_session_token: token,
        p_search: search,
        p_limit: limit,
        p_offset: offset
      });
      if (!result || !Array.isArray(result.items)) {
        const invalid = new Error("RPC danh sách vector trả dữ liệu không hợp lệ.");
        invalid.status = 503;
        throw invalid;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === LIST_RPC_ATTEMPTS - 1) throw error;
    }
  }
  throw lastError;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(url.searchParams.get("session_token") || bearer || "").trim();
    const requestedLimit = Number(url.searchParams.get("limit") || 20);
    const requestedOffset = Number(url.searchParams.get("offset") || 0);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 20))
      : 20;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0;
    const search = String(url.searchParams.get("search") || "").trim();

    await validateSession(env, token);

    // Một RPC gom items + assets + vector status, tránh fallback N+1 vượt giới hạn
    // CPU/subrequest của Cloudflare Pages Functions.
    const result = await listPage(env, token, { search, limit, offset });

    return json({
      ok: true,
      items: await inspectVectorItems(env, result.items),
      count: result.items.length,
      offset,
      has_more: result.items.length === limit
    });
  } catch (error) {
    if (isTransient(error)) {
      console.warn("vector-items: danh sách tạm thời không khả dụng:", error?.message || error);
      return json({
        ok: false,
        error: "Không tải được danh sách vector do máy chủ dữ liệu tạm thời không khả dụng. Vui lòng thử lại sau."
      }, 503);
    }
    return errorResponse(error);
  }
}
