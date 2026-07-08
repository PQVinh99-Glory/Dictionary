import { exactLookup, hydrateVectorHits } from "./connectors/catalogue.js";
import { searchCatalogue, scanCatalogue } from "./connectors/supabase.js";
import { canonicalizeImage } from "./preprocess/canonicalize.js";
import { encodeQueryImage } from "./vector/encoder.js";
import { searchVectorIndex } from "./vector/search.js";
import { strongTextResult, rankMetadata } from "./retrieval/metadataFilter.js";
import { analyzeStructuralEvidence } from "./retrieval/structuralEvidence.js";
import { fuseCandidateScore } from "./retrieval/scoreFusion.js";
import { finalizeCandidatePool } from "./retrieval/candidatePool.js";
import { shouldCallGemini, shouldCallGemma } from "./harness/ambiguityGate.js";
import { resolveWithGemini } from "./agents/geminiResolver.js";
import { judgeWithGemma } from "./agents/gemmaJudge.js";
import { enforceCandidatePool } from "./guards/candidatePool.js";
import { orientationWarnings } from "./guards/orientation.js";
import { publicCandidate } from "./schemas/candidate.js";
import { createBudget } from "./runtime/budget.js";
import { trace } from "./runtime/trace.js";

function mapResolverRows(rankings, candidatePool) {
  const byId = new Map(
    candidatePool.map(c => [String(c?.id ?? c?.record_id), c])
  );

  return (rankings || []).map(r => ({
    ...(byId.get(String(r?.candidate_id)) || {}),
    ...r,
    id:String(r?.candidate_id),
    final_score:Number(r?.score || 0)
  }));
}

export async function runKimSearch(env, config, {
  token,
  query,
  ctx
}) {
  const budget = createBudget(config);

  trace(ctx,"exact_lookup");
  const exact = await exactLookup(env, token, query);
  if (exact.length) {
    return {
      mode:"KIM_EXACT",
      summary:"Tìm thấy mã khớp chính xác.",
      candidates:exact.slice(0,5).map(publicCandidate),
      warnings:[],
      ai_calls:budget.snapshot()
    };
  }

  trace(ctx,"metadata_retrieval");
  const initialRows = await searchCatalogue(env, token, {
    search:query.message,
    usageSide:query.filters.usage_side,
    viewMode:query.filters.view_mode,
    limit:80,
    offset:0
  });

  const strong = strongTextResult(initialRows, query.message);

  if (!query.image_data_url && !query.query_embedding) {
    const rows = strong.sufficient
      ? strong.rows
      : rankMetadata(initialRows, query.message).slice(0,5);

    return {
      mode:strong.sufficient ? "KIM_TEXT_STRONG" : "KIM_TEXT_METADATA",
      summary:strong.sufficient
        ? "Đã lọc bằng metadata mạnh, không gọi AI."
        : "Đã xếp hạng bằng metadata, không gọi AI.",
      candidates:rows.map(publicCandidate),
      warnings:[],
      ai_calls:budget.snapshot()
    };
  }

  if (!config.features.vectorSearch) {
    const e = new Error("KIM_VECTOR_SEARCH_ENABLED=false.");
    e.status = 503;
    throw e;
  }

  trace(ctx,"preprocess");
  const prep = query.image_data_url
    ? await canonicalizeImage(env, config, query.image_data_url, {
        ...query.hints,
        qualityScore:query.hints?.quality_score
      })
    : {
        originalImage:"",
        canonicalImage:"",
        foregroundStatus:"embedding_only",
        qualityScore:Number(query.hints?.quality_score ?? 0.8),
        warnings:[]
      };

  ctx.warnings.push(...(prep.warnings || []));

  trace(ctx,"encode");
  const encoded = await encodeQueryImage(env, config, {
    canonicalImage:prep.canonicalImage,
    suppliedEmbedding:query.query_embedding,
    suppliedProfile:query.embedding_profile
  });

  trace(ctx,"vector_search",{source:encoded.source});
  const hits = await searchVectorIndex(
    env,
    config,
    encoded.vector,
    config.vector.topK
  );

  const usefulHits = hits.filter(
    h => Number(h?.similarity || 0) >= config.vector.minSimilarity
  );

  if (!usefulHits.length) {
    return {
      mode:"KIM_VECTOR_NO_MATCH",
      summary:"Không có ứng viên vector đạt ngưỡng tối thiểu.",
      candidates:[],
      warnings:ctx.warnings,
      ai_calls:budget.snapshot()
    };
  }

  trace(ctx,"hydrate_candidates",{count:usefulHits.length});
  const hydrated = await hydrateVectorHits(
    env,
    token,
    usefulHits,
    {maxRows:config.limits.maxScanRows}
  );

  const metadataRanked = rankMetadata(hydrated, query.message);
  const structural = analyzeStructuralEvidence({
    query,
    candidates:metadataRanked
  });

  const fused = metadataRanked
    .map(row => {
      const key = String(row?.id ?? row?.record_id);
      return fuseCandidateScore({
        ...row,
        structural_score:structural.byId?.[key]?.score || 0
      });
    })
    .sort((a,b) => b.final_score - a.final_score);

  const {candidates:resolverPool,hash:poolHash} =
    await finalizeCandidatePool(fused, {limit:config.vector.resolverK});

  ctx.candidate_pool_hash = poolHash;

  const warnings = [
    ...ctx.warnings,
    ...orientationWarnings(query.message,resolverPool)
  ];

  const callGemini = config.features.geminiRerank && shouldCallGemini({
    candidates:fused,
    queryQuality:prep.qualityScore,
    structuralConflicts:structural.conflicts,
    angleRisk:structural.angleRisk,
    lightingRisk:structural.lightingRisk,
    ambiguityGap:config.gates.ambiguityGap
  });

  if (!callGemini) {
    return {
      mode:"KIM_VECTOR_CLEAR",
      summary:"Vector retrieval và deterministic fusion đủ rõ; không gọi AI.",
      candidates:fused.slice(0,5).map(publicCandidate),
      warnings,
      ai_calls:budget.snapshot(),
      candidate_pool_hash:poolHash
    };
  }

  trace(ctx,"gemini_resolver");
  const gemini = await resolveWithGemini(env, config, {
    query,
    prep,
    candidates:resolverPool,
    budget
  });

  const safeRankings = enforceCandidatePool(
    gemini?.rankings,
    resolverPool,
    {limit:config.vector.resolverK}
  );

  const resolvedRows = mapResolverRows(safeRankings,resolverPool);

  const callGemma = config.features.gemmaJudge && shouldCallGemma({
    geminiResult:{...gemini,rankings:safeRankings},
    judgeGap:config.gates.judgeGap,
    orientationConflict:structural.orientationConflict,
    holeConflict:structural.holeConflict
  });

  if (!callGemma) {
    return {
      mode:"KIM_VECTOR_GEMINI",
      summary:gemini?.summary || "Gemini đã rerank candidate pool.",
      candidates:resolvedRows.slice(0,5).map(publicCandidate),
      warnings:[...warnings,...(gemini?.warnings || [])],
      ai_calls:budget.snapshot(),
      candidate_pool_hash:poolHash
    };
  }

  trace(ctx,"gemma_judge");
  const judged = await judgeWithGemma(env, config, {
    query,
    candidates:resolverPool,
    geminiResult:{...gemini,rankings:safeRankings},
    budget
  });

  const safeTop5 = enforceCandidatePool(
    judged?.top5,
    resolverPool,
    {limit:5}
  );

  const judgedRows = mapResolverRows(safeTop5,resolverPool);

  return {
    mode:"KIM_VECTOR_GEMINI_GEMMA",
    decision:judged?.decision || "ambiguous",
    summary:judged?.summary || "Gemma đã phản biện kết quả.",
    candidates:judgedRows.map(publicCandidate),
    warnings:[...warnings,...(gemini?.warnings || []),...(judged?.warnings || [])],
    ai_calls:budget.snapshot(),
    candidate_pool_hash:poolHash
  };
}
