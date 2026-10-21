import { assessImageResult } from "./presentation/imageDecision.js";
import { comparePatches } from "./retrieval/patchVerifier.js";
import { compareContour } from "./retrieval/contourVerifier.js";
import { exactLookup, hydrateVectorHits, filterVisibleCatalogueIds } from "./connectors/catalogue.js";
import {
  searchCatalogue,
  scanCatalogue
} from "./connectors/supabase.js";
import { canonicalizeImage } from "./preprocess/canonicalize.js";
import { encodeQueryImage } from "./vector/encoder.js";
import { searchVectorIndex, searchScopedVectorIndex } from "./vector/search.js";
import { searchMultiProbeVectorIndex, fuseProbeHits } from "./retrieval/multiProbeSearch.js";
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
import { collectGeometryEvidence } from "./retrieval/geometricReranker.js";
import { finalizeCandidatePool } from "./retrieval/candidatePool.js";
import { selectPrimaryRescue } from "./retrieval/primaryRescue.js";
import { collapseBestVectorHitPerRecord } from "./retrieval/vectorHitCollapse.js";
import {
  applySizeGate,
  loadCandidateDims,
  loadLengthShortlist
} from "./retrieval/sizeGate.js";
import {
  applyHoleFormatBoost,
  holeFormatsFromCounts,
  inferFormatTagsFromText
} from "./retrieval/holeFormatReference.js";
import { orientationWarnings } from "./guards/orientation.js";
import { publicCandidate } from "./schemas/candidate.js";
import {
  filterCatalogueByQueryFeatures,
  filterCatalogueByTargetQuery
} from "./retrieval/featureMatcher.js";
import { detectConfusingPairInTopCandidates } from "./retrieval/confusingPairs.js";
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
    const targetCheck = filterCatalogueByTargetQuery(
      textRetrieval.pool,
      query.message
    );
    if (targetCheck.isTargetQuery) {
      let targetPool = textRetrieval.pool;
      if (targetPool.length < 500) {
        const scanned = await scanCatalogue(env, token, { maxRows: 1500 }).catch(() => []);
        targetPool = dedupeRows([...targetPool, ...scanned]);
      }
      const targetMatched = filterCatalogueByTargetQuery(targetPool, query.message).matchedRows;
      return {
        mode: targetMatched.length ? "MORIS_TARGET_MATCH" : "MORIS_TARGET_NO_MATCH",
        summary: targetMatched.length
          ? (targetCheck.targetQuery.type === "id" ? "Đã lọc theo ID chính xác." : "Đã lọc theo mã linh kiện.")
          : "Không tìm thấy linh kiện phù hợp.",
        candidates: targetMatched.slice(0, 10).map(c => {
          const pub = publicCandidate(c);
          pub.is_feature_match = true;
          pub.badge_label = "Khớp";
          return pub;
        }),
        warnings: [],
        ai_calls: null
      };
    }

    const featCheck = filterCatalogueByQueryFeatures(
      textRetrieval.pool,
      query.message
    );
    if (featCheck.isFeatureQuery) {
      let featPool = textRetrieval.pool;
      if (featPool.length < 500) {
        const scanned = await scanCatalogue(env, token, { maxRows: 1500 }).catch(() => []);
        featPool = dedupeRows([...featPool, ...scanned]);
      }
      const featMatched = filterCatalogueByQueryFeatures(featPool, query.message).matchedRows;
      return {
        mode: featMatched.length ? "MORIS_FEATURE_MATCH" : "MORIS_FEATURE_NO_MATCH",
        summary: featMatched.length ? "Đã lọc theo đặc điểm nhận dạng chính xác." : "Không tìm thấy mã khớp đặc điểm nhận dạng.",
        candidates: featMatched.slice(0, 10).map(publicCandidate),
        warnings: [],
        ai_calls: null
      };
    }

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

  // Bounded oversampling before SKU collapse/filter hydration avoids view crowding.
  const retrievalLimit=Math.min(100,config.vector.topK*2);
  let hits=[];
  let encodedSource="single";
  let encodedProbes=null;
  let encodedVector=null;

  if(suppliedProbes.length){
    encodedProbes=[];
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
    encodedSource="multi_probe";
  }else{
    const encoded = await encodeQueryImage(env, config, {
      canonicalImage:prep.canonicalImage,
      suppliedEmbedding:query.query_embedding,
      suppliedProfile:query.embedding_profile
    });
    encodedVector=encoded.vector;
    encodedSource=encoded.source;
  }

  trace(ctx,"vector_search",{source:encodedSource});
  const onRpc=attempt=>ctx.vector_rpc_attempts.push(attempt);
  let scopedEvidence = null;
  let scopedHits = [];
  if (config.features.scopedSizeSearch === true && query.size) {
    const shortlist = await loadLengthShortlist(env, query.size);
    scopedEvidence = {status:shortlist.status, length_candidate_count:shortlist.rows.length};
    trace(ctx,'length_shortlist',scopedEvidence);
    if (shortlist.status === 'complete' && shortlist.rows.length) {
      // Session-checked keyed RPC owns visibility; never trust size-table IDs alone.
      const visible = await filterVisibleCatalogueIds(env,token,
        shortlist.rows.map(row=>row.record_id),query.filters);
      if (visible.status === 'complete') {
        const ids = visible.ids;
        scopedEvidence.visible_candidate_count = ids.length;
        if (ids.length) {
          const probes = encodedProbes || [{probe_id:'primary',vector:encodedVector}];
          const perProbe = [];
          let allAvailable = true;
          for (const probe of probes.slice(0,3)) {
            const result = await searchScopedVectorIndex(env,config,probe.vector,ids,retrievalLimit,{onRpc});
            if (result.status !== 'ok') allAvailable = false;
            perProbe.push({probe_id:probe.probe_id,hits:result.hits});
          }
          if (allAvailable) {
            scopedHits = encodedProbes
              ? fuseProbeHits(perProbe,{topK:retrievalLimit})
              : perProbe[0].hits;
            scopedEvidence.status = 'matched';
            scopedEvidence.vector_hit_count = scopedHits.length;
          } else scopedEvidence.status = 'scoped_rpc_unavailable';
        }
      } else scopedEvidence.status = 'catalogue_visibility_unavailable';
    }
  }
  hits = encodedProbes
    ? await searchMultiProbeVectorIndex(env,config,encodedProbes,{topK:retrievalLimit,onRpc})
    : await searchVectorIndex(env,config,encodedVector,retrievalLimit,{onRpc});
  // Same exact profile/cosine space, best view wins per record after union.
  hits = [
    ...hits.map(hit=>({...hit,retrieval_channels:['global_ann']})),
    ...scopedHits.map(hit=>({...hit,retrieval_channels:['length_scoped']}))
  ];
  if (scopedEvidence) ctx.size_shortlist_evidence = scopedEvidence;
  trace(ctx,"vector_results",{count:hits.length});

  const usefulHits = hits.filter(
    h => Number(h?.raw_vector_similarity ?? h?.similarity ?? 0) >=
      config.vector.minSimilarity
  );

  // Một SKU có thể có front/back/detail.
  // Chỉ giữ view có similarity tốt nhất trước khi hydrate metadata.
  const collapsedHits = collapseBestVectorHitPerRecord(
    usefulHits,
    {limit:retrievalLimit}
  );

  if (!collapsedHits.length) {
    return {
      mode:"MORIS_VECTOR_NO_MATCH",
      summary:"Không có ứng viên vector đạt ngưỡng.",
      candidates:[],
      warnings:ctx.warnings,
      ...(scopedEvidence ? {size_shortlist_evidence:scopedEvidence} : {}),
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
    {maxRows:config.limits.maxScanRows,filters:query.filters,
      keyed:config.features.keyedHydration === true,
      onStatus:status=>{ctx.hydration_status=status;}}
  );

  // M28 Size Gate (S1, query-side only): lọc theo kích thước sau hydrate,
  // trước rankMetadata. Fail-open: thiếu size query hoặc thiếu dims -> giữ nguyên pool.
  let sizeGate = {
    candidates:hydrated,
    rejected:[],
    evidence:{status:"not_provided"},
    warnings:[]
  };

  if (config.features.sizeGate !== false && query.size) {
    const dimsById = await loadCandidateDims(
      env,
      token,
      hydrated.map(row => row?.record_id ?? row?.id)
    );
    sizeGate = applySizeGate({
      candidates:hydrated,
      querySize:query.size,
      dimsById
    });
    ctx.warnings.push(...(sizeGate.warnings || []));
  }

  const sizeEvidenceAttach = sizeGate.evidence.status === "not_provided"
    ? {}
    : {size_evidence:sizeGate.evidence};

  let metadataRanked = rankMetadata(
    [...sizeGate.candidates, ...(sizeGate.rescueCandidates || [])],
    query.message,
    {excludeHoleEvidence:true}
  );

  // Từ điển mẫu lỗ (2026-10-19, chủ dự án): Moris tham chiếu MỀM định dạng lỗ —
  // đối chiếu đếm định dạng từ camera (query.hole_formats) + từ khóa trong câu query
  // với mô tả identifying_features của ứng viên. CHỈ CỘNG khi khớp, không bao giờ phạt
  // hay loại trừ; mặc định OFF (MORIS_HOLE_FORMAT_BOOST_ENABLED) tới khi có đo lường thật.
  let holeFormatEvidence = null;
  if (config.features.holeFormatBoost === true) {
    const queryTags = [...new Set([
      ...holeFormatsFromCounts(query.hole_formats),
      ...inferFormatTagsFromText(query.message)
    ])];
    const applied = applyHoleFormatBoost({ rows: metadataRanked, queryTags, queryCounts:query.hole_formats });
    metadataRanked = applied.rows;
    holeFormatEvidence = applied.evidence;
  }

  const structural = analyzeStructuralEvidence({
    // Disabled image geometry must not re-enter fusion through count fallback.
    // Explicit text constraints remain available for operator-directed searches.
    query:config.features.geometryVerification === true ? query : {...query,geometry:null},
    candidates:metadataRanked
  });

  const patchEligible = new Set([...metadataRanked].sort((a,b)=>(b.retrieval_score||0)-(a.retrieval_score||0)).slice(0,10));
  const fused = metadataRanked
    .map(row => {
      const key = String(
        row?.id ?? row?.record_id
      );

      const structuralRow = structural.byId?.[key] || {};
      return fuseCandidateScore({
        ...row,
        geometry_evidence:{
          ...(config.features.geometryVerification === true
            ? collectGeometryEvidence(row,{...query.geometry,usage_side:query.filters.usage_side,view_mode:query.filters.view_mode})
            : {}),
          patch:config.features.spatialVerification && patchEligible.has(row) ? comparePatches({...query.geometry,...query.filters},row) : null,
          contour:config.features.contourVerification ? compareContour({...query.geometry,...query.filters},row) : null
        },
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

  const geometricRanked = fused;

  const {
    candidates:resolverPool,
    hash:poolHash
  } = await finalizeCandidatePool(
    geometricRanked,
    {limit:config.vector.resolverK}
  );

  ctx.candidate_pool_hash = poolHash;

  const geoWarnings = resolverPool
    .map(c => c?.geometric_warning)
    .filter(Boolean);

  const warnings = [
    ...ctx.warnings,
    ...geoWarnings,
    ...orientationWarnings(
      query.message,
      resolverPool
    )
  ];

  const selected = await selectPrimaryRescue(geometricRanked,{
    hasQuerySize:Boolean(query.size),sizeGateEnabled:config.features.sizeGate!==false,
    sizeStatus:sizeGate.evidence.status,limit:10
  });
  const sortedCandidates=selected.map(row=>publicCandidate({...row,query_quality:query.geometry?.quality}));

  const confusingPairNotice = detectConfusingPairInTopCandidates(sortedCandidates, 3);
  if (confusingPairNotice?.active) {
    warnings.push(`Cặp dễ nhầm lẫn trong top kết quả: ${confusingPairNotice.skuA} và ${confusingPairNotice.skuB}. Cần đối chiếu kỹ vị trí và kích thước lỗ.`);
  }

  const decision=assessImageResult(sortedCandidates,{quality:query.geometry?.quality,
    orientationAmbiguous:orientationWarnings(query.message,resolverPool).length>0});
  return {
    mode:decision.status==='no_match'?'MORIS_VECTOR_NO_MATCH':
      decision.status==='needs_review'?"MORIS_VECTOR_AMBIGUOUS":"MORIS_VECTOR_SUGGESTIONS",
    summary:"Ứng viên theo điểm so khớp; cần đối chiếu trước khi xác nhận mã.",
    decision,
    candidates:sortedCandidates,
    warnings,
    ...sizeEvidenceAttach,
    ...(scopedEvidence ? {size_shortlist_evidence:scopedEvidence} : {}),
    ...(holeFormatEvidence ? {hole_format_evidence:holeFormatEvidence} : {}),
    ...(confusingPairNotice ? {confusing_pair_evidence:confusingPairNotice} : {}),
    ai_calls:null,
    candidate_pool_hash:poolHash
  };
}
