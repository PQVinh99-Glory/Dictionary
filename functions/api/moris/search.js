import { readMorisConfig } from "../../_lib/moris/v5/runtime/config.js";
import { createQueryContext } from "../../_lib/moris/v5/runtime/queryContext.js";
import { summarizeTrace } from "../../_lib/moris/v5/runtime/trace.js";
import { validateMorisQuery } from "../../_lib/moris/v5/schemas/query.js";
import { validateSession } from "../../_lib/moris/v5/connectors/supabase.js";
import { runMorisSearch } from "../../_lib/moris/v5/orchestrator.js";
import { classifyCatalogueIntent } from "../../_lib/moris/v5/intent/catalogueIntent.js";
import { toPublicMorisResult } from "../../_lib/moris/v5/presentation/publicResult.js";
import { MORIS_PUBLIC_MESSAGES } from "../../_lib/moris/v5/presentation/userMessage.js";
import { json, readJson } from "../../_lib/shared/http.js";

export function debugEnabled(env, session) {
  return /^(1|true|yes|on)$/i.test(
    String(env.MORIS_DEBUG_EXPOSE_INTERNAL || "")
  ) && String(session?.role_name || "").toLowerCase() === "admin";
}

function publicErrorMessage(error) {
  if (
    error?.code === "MORIS_VECTOR_DISABLED" ||
    error?.code === "MORIS_VECTOR_ENCODER_NOT_CONFIGURED" ||
    error?.code === "MORIS_VECTOR_ENCODER_FAILED" ||
    error?.code === "MORIS_VECTOR_ENCODER_TIMEOUT"
  ) {
    return "Xin lỗi anh, tìm kiếm bằng hình ảnh hiện chưa sẵn sàng. Anh thử mô tả đặc điểm giúp em nhé.";
  }

  if (error?.code === "MORIS_VECTOR_PROFILE_MISMATCH") {
    return "Xin lỗi anh, phiên bản nhận diện hình ảnh giữa trình duyệt và máy chủ chưa đồng bộ. Anh tải lại trang giúp em nhé.";
  }

  if (Number(error?.status) === 401) {
    return "Phiên đăng nhập đã hết hạn. Anh vui lòng đăng nhập lại để tiếp tục.";
  }

  return MORIS_PUBLIC_MESSAGES.temporaryError;
}

export async function onRequestPost({request,env}) {
  let queryId = crypto.randomUUID();

  try {
    const config = readMorisConfig(env);

    if (!config.enabled) {
      return json({
        ok:false,
        user_message:MORIS_PUBLIC_MESSAGES.temporaryError
      },503);
    }

    const body = await readJson(request);

    const token = String(
      body?.session_token ||
      request.headers.get("x-session-token") ||
      ""
    );

    const session = await validateSession(env, token);

    const query = validateMorisQuery(body, config);
    queryId = query.query_id;

    const intent = classifyCatalogueIntent(query);

    if (
      intent.kind === "unsupported" ||
      intent.kind === "unknown"
    ) {
      return json({
        ok:true,
        query_id:queryId,
        user_message:MORIS_PUBLIC_MESSAGES.unsupported,
        candidates:[],
        decision:"unsupported"
      });
    }

    const ctx = await createQueryContext({
      queryId:query.query_id,
      message:query.message,
      imageDataUrl:query.image_data_url,
      filters:query.filters,
      config
    });

    const result = await runMorisSearch(
      env,
      config,
      {token,query,ctx}
    );

    const allowDebug = debugEnabled(env, session);
    const publicResult = toPublicMorisResult(
      result,
      {debug:allowDebug}
    );
    if (allowDebug && publicResult.debug) {
      publicResult.debug.stage_timings = summarizeTrace(ctx);
      publicResult.debug.embedding_profile = ctx.embedding_profile;
      publicResult.debug.vector_rpc_attempts = ctx.vector_rpc_attempts;
      publicResult.debug.capture_quality = query.capture_quality;
    }

    return json({
      ...publicResult,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash || null
    });
  } catch (error) {
    console.error("Moris search failed",{
      query_id:queryId,
      code:error?.code || null,
      name:error?.name || "Error",
      message:error?.message || String(error),
      status:error?.status || 500,
      details:error?.details || null,
      stack:error?.stack || null
    });

    return json({
      ok:false,
      query_id:queryId,
      user_message:publicErrorMessage(error),
      candidates:[]
    }, Number(error?.status) === 401 ? 401 : 200);
  }
}
