import { createQueryContext, hashCandidatePool, trace, publicTrace } from "./runtime/queryContext.js";
import { readBudget, consume } from "./runtime/budget.js";
import { validateSession, retrieveByQueries, scanCatalogue } from "./connectors/supabase.js";
import { readModels } from "./providers/models.js";
import { extractTextConstraints } from "./skills/textConstraints.js";
import { rankMetadata } from "./skills/metadataRanker.js";
import { gateBeforeVision, gateAfterSignature, isResolverAmbiguous } from "./skills/ambiguityGate.js";
import { toPublicCandidate } from "./skills/candidateBuilder.js";
import { visualAnalystGemini, visualAnalystGemmaFallback } from "./agents/visualAnalyst.js";
import { resolveImageCandidates, resolveTextCandidates } from "./agents/evidenceResolver.js";
import { criticJudge } from "./agents/criticJudge.js";
import { validateRanking, validateJudge, assertTop5ForUi } from "./hooks/guards.js";

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row?.id ?? `${row?.code}|${row?.part_id}`);
    if (!map.has(key)) map.set(key,row);
  }
  return [...map.values()];
}

function signatureQueries(signature) {
  if (!signature) return [];

  return [
    signature.object_family,
    ...(signature.dominant_colors || []),
    ...(signature.silhouette || []),
    ...(signature.mounting_features || []),
    ...(signature.distinctive_features || [])
  ].filter(Boolean).slice(0,8);
}

function textQueries(message,constraints) {
  return [
    ...constraints.exact_tokens,
    String(message || "").slice(0,140),
    ...constraints.terms.slice(0,5)
  ].filter(Boolean);
}

function rowMap(rows) {
  return new Map(rows.map(r => [String(r.id),r]));
}

function topFromMetadata(ranked) {
  return ranked
    .filter(x => x.meta.score > 0)
    .slice(0,5)
    .map(x => toPublicCandidate(x.row,{reason:"deterministic metadata filter"},x.meta));
}

function topFromRanking(ranking,poolRows,rankedMeta) {
  const map = rowMap(poolRows);
  const metaMap = new Map(rankedMeta.map(x => [String(x.row.id),x.meta]));

  return [...(ranking?.rankings || [])]
    .sort((a,b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0,5)
    .map(r => {
      const row = map.get(String(r.candidate_id));
      return row ? toPublicCandidate(row,r,metaMap.get(String(row.id)) || {}) : null;
    })
    .filter(Boolean);
}

function topFromJudge(judge,poolRows,rankedMeta) {
  const map = rowMap(poolRows);
  const metaMap = new Map(rankedMeta.map(x => [String(x.row.id),x.meta]));

  return (judge?.top5 || [])
    .slice(0,5)
    .map(r => {
      const row = map.get(String(r.candidate_id));
      return row ? toPublicCandidate(row,r,metaMap.get(String(row.id)) || {}) : null;
    })
    .filter(Boolean);
}

async function ensureCandidatePool(env,token,initialRows,constraints,signature,budget) {
  let rows = dedupeRows(initialRows);

  const visualRows = signature
    ? await retrieveByQueries(env,token,signatureQueries(signature),{limitPerQuery:50})
    : [];

  rows = dedupeRows([...rows,...visualRows]);

  if (rows.length < 8) {
    const scanned = await scanCatalogue(env,token,{maxRows:budget.maxScanRows});
    rows = dedupeRows([...rows,...scanned]);
  }

  const ranked = rankMetadata(rows,constraints,signature);

  return {
    rows,
    ranked,
    positive:ranked.filter(x => x.meta.score > 0)
  };
}

export async function runDenisV4(env, {
  token,
  queryId,
  message="",
  imageDataUrl=null
}) {
  const ctx = await createQueryContext({queryId,message,imageDataUrl});
  const budget = readBudget(env);
  const models = readModels(env);
  const warnings = [];
  const evidence = [];

  await validateSession(env,token);
  trace(ctx,"session.validated");

  const constraints = extractTextConstraints(message);
  trace(ctx,"text.constraints",{
    terms:constraints.terms,
    colors:constraints.colors,
    hole_count:constraints.hole_count,
    strong_constraint_count:constraints.strong_constraint_count
  });

  const initialRows = await retrieveByQueries(
    env,
    token,
    textQueries(message,constraints),
    {limitPerQuery:50}
  );

  trace(ctx,"initial.retrieval",{count:initialRows.length});

  let initialRanked = rankMetadata(initialRows,constraints,null);

  // Exact deterministic path.
  const exact = initialRanked.find(x =>
    x.meta.matched.includes("exact code") ||
    x.meta.matched.includes("exact part_id")
  );

  if (exact) {
    const candidates = [
      toPublicCandidate(
        exact.row,
        {confidence:1,reason:"Khớp chính xác code/part_id."},
        exact.meta
      )
    ];

    assertTop5ForUi({queryId:ctx.query_id,candidates});

    return {
      ok:true,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash,
      candidate_pool_hash:await hashCandidatePool([exact.row]),
      mode:"EASY_EXACT",
      summary:`Tìm thấy chính xác ${exact.row.code}.`,
      observation:null,
      evidence:["exact code/part_id"],
      warnings,
      candidates,
      trace:publicTrace(ctx)
    };
  }

  // Simple filter-first gate.
  const beforeGate = gateBeforeVision({
    hasImage:!!imageDataUrl,
    constraints,
    ranked:initialRanked
  });

  trace(ctx,"gate.before_ai",beforeGate);

  if (beforeGate.mode === "easy_filter") {
    const candidates = topFromMetadata(initialRanked);
    assertTop5ForUi({queryId:ctx.query_id,candidates});

    return {
      ok:true,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash,
      candidate_pool_hash:await hashCandidatePool(candidates),
      mode:"EASY_FILTER",
      summary:"Đặc điểm nhận dạng đã đủ rõ; Denis dùng filter thường và không gọi AI.",
      observation:null,
      evidence:["deterministic metadata filter"],
      warnings,
      candidates,
      trace:publicTrace(ctx)
    };
  }

  // Text-only ambiguous path: Agent B (Gemma) once.
  if (!imageDataUrl) {
    let pool = initialRanked.filter(x => x.meta.score > 0);

    if (pool.length < 6) {
      const scanned = await scanCatalogue(env,token,{maxRows:budget.maxScanRows});
      pool = rankMetadata(scanned,constraints,null).filter(x => x.meta.score > 0);
    }

    pool = pool.slice(0,budget.maxCandidatePool);

    if (!pool.length) {
      return {
        ok:true,
        query_id:ctx.query_id,
        image_hash:null,
        candidate_pool_hash:await hashCandidatePool([]),
        mode:"NO_MATCH",
        summary:"Chưa có ứng viên metadata đủ phù hợp.",
        observation:null,
        evidence:[],
        warnings:["Hãy bổ sung đặc điểm nhận dạng cụ thể hơn hoặc đính kèm ảnh."],
        candidates:[],
        trace:publicTrace(ctx)
      };
    }

    if (!env.OPENROUTER_API_KEY) {
      const candidates = pool.slice(0,5).map(x =>
        toPublicCandidate(x.row,{reason:"metadata fallback"},x.meta)
      );
      assertTop5ForUi({queryId:ctx.query_id,candidates});

      return {
        ok:true,
        query_id:ctx.query_id,
        image_hash:null,
        candidate_pool_hash:await hashCandidatePool(pool.map(x=>x.row)),
        mode:"TEXT_FILTER_FALLBACK",
        summary:"OpenRouter chưa cấu hình; Denis trả Top 5 theo metadata deterministic.",
        observation:null,
        evidence:["metadata fallback"],
        warnings:["Thiếu OPENROUTER_API_KEY cho Agent B metadata resolver."],
        candidates,
        trace:publicTrace(ctx)
      };
    }

    consume(ctx,budget,"openrouter","Agent B — Metadata Evidence Resolver");

    const poolRows = pool.map(x=>x.row);
    const poolHash = await hashCandidatePool(poolRows);

    const resolved = await resolveTextCandidates(env,{
      model:models.gemma,
      timeoutMs:budget.openrouterTimeoutMs,
      message,
      candidates:poolRows
    });

    validateRanking(resolved,poolRows);

    const candidates = topFromRanking(resolved,poolRows,pool);
    assertTop5ForUi({queryId:ctx.query_id,candidates});

    return {
      ok:true,
      query_id:ctx.query_id,
      image_hash:null,
      candidate_pool_hash:poolHash,
      mode:"MEDIUM_AGENT_B_METADATA",
      summary:resolved.summary,
      observation:null,
      evidence:["Agent B ranked supplied metadata candidates"],
      warnings:[...(resolved.warnings || [])],
      candidates,
      trace:publicTrace(ctx)
    };
  }

  // -----------------------------------------------------------------
  // IMAGE PATH
  // Agent A Visual Analyst → deterministic filtering →
  // Agent B Evidence Resolver → optional Agent C Judge.
  // -----------------------------------------------------------------

  let signature = null;

  // Agent A primary: Gemini 3.1 Pro.
  if (env.GEMINI_API_KEY) {
    consume(ctx,budget,"gemini","Agent A — Visual Analyst");

    try {
      signature = await visualAnalystGemini(env,{
        model:models.gemini,
        timeoutMs:budget.geminiTimeoutMs,
        message,
        queryImage:imageDataUrl
      });

      evidence.push("Agent A visual signature by Gemini");
      trace(ctx,"agent_a.visual_signature",signature);
    } catch (e) {
      warnings.push(`Gemini Visual Analyst lỗi: ${e.message}`);
      trace(ctx,"agent_a.gemini_error",{message:e.message});
    }
  }

  // Agent A fallback: Gemma 4 31B multimodal via OpenRouter.
  if (!signature && env.OPENROUTER_API_KEY && ctx.ai_calls.openrouter < budget.maxOpenRouter) {
    consume(ctx,budget,"openrouter","Agent A — Visual Analyst Fallback");

    try {
      signature = await visualAnalystGemmaFallback(env,{
        model:models.gemma,
        timeoutMs:budget.openrouterTimeoutMs,
        message,
        queryImage:imageDataUrl
      });

      evidence.push("Agent A visual signature fallback by Gemma");
      trace(ctx,"agent_a.fallback_signature",signature);
    } catch (e) {
      warnings.push(`Gemma Visual Analyst fallback lỗi: ${e.message}`);
      trace(ctx,"agent_a.fallback_error",{message:e.message});
    }
  }

  if (!signature) {
    const e = new Error("Không tạo được visual signature. Denis từ chối dùng lại Top 5 cũ.");
    e.status = 502;
    throw e;
  }

  const candidateState = await ensureCandidatePool(
    env,token,initialRows,constraints,signature,budget
  );

  trace(ctx,"post_signature.retrieval",{
    rows:candidateState.rows.length,
    positive:candidateState.positive.length
  });

  const afterGate = gateAfterSignature({ranked:candidateState.ranked});
  trace(ctx,"gate.after_signature",afterGate);

  if (afterGate.mode === "signature_sufficient") {
    const candidates = topFromMetadata(candidateState.ranked);
    assertTop5ForUi({queryId:ctx.query_id,candidates});

    return {
      ok:true,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash,
      candidate_pool_hash:await hashCandidatePool(candidateState.positive.map(x=>x.row)),
      mode:"IMAGE_AGENT_A_SUFFICIENT",
      summary:"Agent A đã trích visual signature; metadata + signature đủ để lọc Top 5.",
      observation:signature,
      evidence,
      warnings,
      candidates,
      trace:publicTrace(ctx)
    };
  }

  // Agent B needs direct multimodal comparison.
  if (!env.GEMINI_API_KEY) {
    const candidates = candidateState.ranked
      .filter(x=>x.meta.score>0)
      .slice(0,5)
      .map(x=>toPublicCandidate(x.row,{reason:"signature metadata fallback"},x.meta));

    assertTop5ForUi({queryId:ctx.query_id,candidates});

    return {
      ok:true,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash,
      candidate_pool_hash:await hashCandidatePool(candidateState.positive.map(x=>x.row)),
      mode:"IMAGE_SIGNATURE_FALLBACK",
      summary:"Thiếu GEMINI_API_KEY cho Agent B direct visual resolver; trả fallback có cảnh báo.",
      observation:signature,
      evidence,
      warnings:[...warnings,"Cần GEMINI_API_KEY để so sánh trực tiếp query image với candidate images."],
      candidates,
      trace:publicTrace(ctx)
    };
  }

  const resolverPool = (
    candidateState.positive.length
      ? candidateState.positive
      : candidateState.ranked
  )
    .slice(0,budget.maxCandidateImages);

  const resolverRows = resolverPool.map(x=>x.row);
  const poolHash = await hashCandidatePool(resolverRows);

  consume(ctx,budget,"gemini","Agent B — Multimodal Evidence Resolver");

  const resolved = await resolveImageCandidates(env,{
    model:models.gemini,
    timeoutMs:budget.geminiTimeoutMs,
    message,
    signature,
    queryImage:imageDataUrl,
    candidates:resolverRows
  });

  validateRanking(resolved,resolverRows);
  trace(ctx,"agent_b.resolved",{
    pool_count:resolverRows.length,
    ambiguous:resolved.ambiguous,
    top_scores:(resolved.rankings || []).slice(0,3).map(x=>x.score)
  });

  evidence.push("Agent B direct query-vs-candidate image resolution");

  const ambiguous = isResolverAmbiguous(resolved,budget.ambiguityGap);

  // Agent C optional — only if ambiguous and OpenRouter budget remains.
  if (ambiguous &&
      env.OPENROUTER_API_KEY &&
      ctx.ai_calls.openrouter < budget.maxOpenRouter &&
      ctx.ai_calls.total < budget.maxTotal) {

    consume(ctx,budget,"openrouter","Agent C — Critic / Judge");

    const judged = await criticJudge(env,{
      model:models.gemma,
      timeoutMs:budget.openrouterTimeoutMs,
      message,
      signature,
      ranking:resolved,
      candidates:resolverRows,
      candidatePoolHash:poolHash
    });

    validateJudge(judged,resolverRows);
    trace(ctx,"agent_c.judged",{
      decision:judged.decision,
      top5_count:judged.top5?.length || 0
    });

    const candidates = topFromJudge(judged,resolverRows,resolverPool);
    assertTop5ForUi({queryId:ctx.query_id,candidates});

    return {
      ok:true,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash,
      candidate_pool_hash:poolHash,
      mode:"HARD_3_AGENT",
      summary:judged.summary,
      observation:signature,
      evidence:[...evidence,"Agent C reviewed ambiguity/conflicts"],
      warnings:[...warnings,...(resolved.warnings || []),...(judged.warnings || [])],
      candidates,
      trace:publicTrace(ctx)
    };
  }

  // Default two-agent result.
  const candidates = topFromRanking(resolved,resolverRows,resolverPool);
  assertTop5ForUi({queryId:ctx.query_id,candidates});

  return {
    ok:true,
    query_id:ctx.query_id,
    image_hash:ctx.image_hash,
    candidate_pool_hash:poolHash,
    mode:ambiguous ? "HARD_2_AGENT_AMBIGUOUS" : "HARD_2_AGENT",
    summary:resolved.summary,
    observation:signature,
    evidence,
    warnings:[
      ...warnings,
      ...(resolved.warnings || []),
      ...(ambiguous ? ["Kết quả vẫn mơ hồ; Agent C không chạy do thiếu key/budget."] : [])
    ],
    candidates,
    trace:publicTrace(ctx)
  };
}
