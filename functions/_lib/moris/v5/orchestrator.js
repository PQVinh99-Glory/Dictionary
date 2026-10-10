import { exactLookup, hydrateVectorHits } from "./connectors/catalogue.js";
import {
  searchCatalogue,
  scanCatalogue
} from "./connectors/supabase.js";
import { canonicalizeImage } from "./preprocess/canonicalize.js";
import { encodeQueryImage } from "./vector/encoder.js";
import { searchVectorIndex } from "./vector/search.js";
import { searchMultiProbeVectorIndex } from "./retrieval/multiProbeSearch.js";
import {
  strongTextResult,
  rankMetadata,
  strictConstraintMatches
} from "./retrieval/metadataFilter.js";
import {
  parseTextConstraints,
  buildSearchAnchors
} from "./retrieval/textConstraints.js";
import { analyzeStructuralEvidence } from "./retrieval/structuralEvidence.js";
import { fuseCandidateScore } from "./retrieval/scoreFusion.js";
import { finalizeCandidatePool } from "./retrieval/candidatePool.js";
import { collapseBestVectorHitPerRecord } from "./retrieval/vectorHitCollapse.js";
import { orientationWarnings } from "./guards/orientation.js";
import { publicCandidate } from "./schemas/candidate.js";
import { trace } from "./runtime/trace.js";

function dedupeRows(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const key = String(
      row?.id ??
      row?.code ??
      `${row?.part_id || ""}|${row?.identifying_features || ""}`
    );

    if (!key || map.has(key)) continue;
    map.set(key,row);
  }

  return [...map.values()];
}

async function retrieveTextCandidates(env, config, token, query) {
  const constraints = parseTextConstraints(query.message);
  const anchors = buildSearchAnchors(constraints);
  const collected = [];

  // 1. Existing RPC with original query.
  const originalRows = await searchCatalogue(env, token, {
    search:query.message,
    usageSide:query.filters.usage_side,
    viewMode:query.filters.view_mode,
    limit:80,
    offset:0
  }).catch(() => []);

  collected.push(...originalRows);

  // 2. Search meaningful anchors instead of whole natural sentence.
  for (const anchor of anchors.slice(0,4)) {
    const rows = await searchCatalogue(env, token, {
      search:anchor,
      usageSide:query.filters.usage_side,
      viewMode:query.filters.view_mode,
      limit:80,
      offset:0
    }).catch(() => []);

    collected.push(...rows);

    if (dedupeRows(collected).length >= 80) break;
  }

  let pool = dedupeRows(collected);

  // 3. Correctness fallback for natural-language filters.
  // Only scans when RPC retrieval is too weak.
  const strictNow = strictConstraintMatches(pool, query.message);

  if (
    pool.length < 8 ||
    (
      (constraints.hole_count != null || constraints.shape) &&
      strictNow.length === 0
    )
  ) {
    const scanned = await scanCatalogue(env, token, {
      maxRows:config.limits.maxScanRows
    });

    pool = dedupeRows([...pool,...scanned]);
  }

  return {pool,constraints,anchors};
}

export async function runMorisSearch(env, config, {
  token,
  query,
  ctx
}) {

  trace(ctx,"exact_lookup");

  const exact = await exactLookup(env, token, query);

  if (exact.length) {
    return {
      mode:"MORIS_EXACT",
      summary:"Tìm thấy mã khớp chính xác.",
      candidates:exact.slice(0,5).map(publicCandidate),
      warnings:[],
      ai_calls:null
    };
  }

  trace(ctx,"text_retrieval");

  const textRetrieval = await retrieveTextCandidates(
    env,
    config,
    token,
    query
  );

  const strong = strongTextResult(
    textRetrieval.pool,
    query.message
  );

  // TEXT-ONLY: deterministic first, no AI.
  if (!query.image_data_url && !query.query_embedding) {
    const strict = strictConstraintMatches(
      textRetrieval.pool,
      query.message
    );

    if (strict.length) {
      return {
        mode:"MORIS_TEXT_STRICT",
        summary:"Đã lọc theo đặc điểm catalogue.",
        candidates:strict.slice(0,5).map(publicCandidate),
        warnings:[],
        ai_calls:null
      };
    }

    const ranked = rankMetadata(
      textRetrieval.pool,
      query.message
    ).filter(row => Number(row.metadata_score || 0) >= 0.20);

    if (!ranked.length) {
      return {
        mode:"MORIS_TEXT_NO_MATCH",
        summary:"Không có kết quả metadata đủ phù hợp.",
        candidates:[],
        warnings:[],
        ai_calls:null
      };
    }

    return {
      mode:strong.sufficient
        ? "MORIS_TEXT_STRONG"
        : "MORIS_TEXT_METADATA",
      summary:"Đã lọc catalogue theo metadata.",
      candidates:(strong.sufficient ? strong.rows : ranked)
        .slice(0,5)
        .map(publicCandidate),
      warnings:[],
      ai_calls:null
    };
  }

  // IMAGE: vector runtime must really exist.
  if (!config.features.vectorSearch) {
    const e = new Error("MORIS_VECTOR_SEARCH_ENABLED=false.");
    e.code = "MORIS_VECTOR_DISABLED";
    e.status = 503;
    throw e;
  }

  trace(ctx,"preprocess");

  const prep = query.image_data_url
    ? await canonicalizeImage(
        env,
        config,
        query.image_data_url,
        {
          ...query.hints,
          qualityScore:query.hints?.quality_score
        }
      )
    : {
        originalImage:"",
        canonicalImage:"",
        foregroundStatus:"embedding_only",
        qualityScore:Number(
          query.hints?.quality_score ?? 0.8
        ),
        warnings:[]
      };

  ctx.warnings.push(...(prep.warnings || []));

  trace(ctx,"encode");

  const suppliedProbes = Array.isArray(query.query_embeddings)
    ? query.query_embeddings
    : [];

  let hits=[];
  let encodedSource="single";

  if(suppliedProbes.length){
    const encodedProbes=[];
    for(const probe of suppliedProbes){
      const encoded = await encodeQueryImage(env, config, {
        canonicalImage:prep.canonicalImage,
        suppliedEmbedding:probe.embedding,
        suppliedProfile:probe.embedding_profile
      });
      encodedProbes.push({
        probe_id:probe.probe_id,
        vector:encoded.vector
      });
    }
    hits = await searchMultiProbeVectorIndex(
      env,
      config,
      encodedProbes,
      {topK:config.vector.topK}
    );
    encodedSource="multi_probe";
  }else{
    const encoded = await encodeQueryImage(env, config, {
      canonicalImage:prep.canonicalImage,
      suppliedEmbedding:query.query_embedding,
      suppliedProfile:query.embedding_profile
    });
    hits = await searchVectorIndex(
      env,
      config,
      encoded.vector,
      config.vector.topK
    );
    encodedSource=encoded.source;
  }

  trace(ctx,"vector_search",{source:encodedSource});

  const usefulHits = hits.filter(
    h => Number(h?.similarity || 0) >=
      config.vector.minSimilarity
  );

  // Một SKU có thể có front/back/detail.
  // Chỉ giữ view có similarity tốt nhất trước khi hydrate metadata.
  const collapsedHits = collapseBestVectorHitPerRecord(
    usefulHits,
    {limit:config.vector.topK}
  );

  if (!collapsedHits.length) {
    return {
      mode:"MORIS_VECTOR_NO_MATCH",
      summary:"Không có ứng viên vector đạt ngưỡng.",
      candidates:[],
      warnings:ctx.warnings,
      ai_calls:null
    };
  }

  trace(ctx,"hydrate_candidates",{
    count:usefulHits.length
  });

  const hydrated = await hydrateVectorHits(
    env,
    token,
    collapsedHits,
    {maxRows:config.limits.maxScanRows}
  );

  const metadataRanked = rankMetadata(
    hydrated,
    query.message
  );

  const structural = analyzeStructuralEvidence({
    query,
    candidates:metadataRanked
  });

  const fused = metadataRanked
    .map(row => {
      const key = String(
        row?.id ?? row?.record_id
      );

      const structuralRow = structural.byId?.[key] || {};
      return fuseCandidateScore({
        ...row,
        structural_score:structuralRow.score,
        structural_available:structuralRow.available === true,
        conflicts:[
          ...(Array.isArray(row?.conflicts) ? row.conflicts : []),
          ...(structuralRow.available === true && structuralRow.score === 0
            ? ["structural_conflict"]
            : [])
        ]
      });
    })
    .sort((a,b) =>
      b.final_score - a.final_score
    );

  const {
    candidates:resolverPool,
    hash:poolHash
  } = await finalizeCandidatePool(
    fused,
    {limit:config.vector.resolverK}
  );

  ctx.candidate_pool_hash = poolHash;

  const warnings = [
    ...ctx.warnings,
    ...orientationWarnings(
      query.message,
      resolverPool
    )
  ];

  // Moris: chỉ dùng retrieval vector + metadata (không LLM).
  return {
    mode:"MORIS_VECTOR_CLEAR",
    summary:"Vector retrieval đủ rõ.",
    candidates:fused.slice(0,10).map(publicCandidate),
    warnings,
    ai_calls:null,
    candidate_pool_hash:poolHash
  };
}
