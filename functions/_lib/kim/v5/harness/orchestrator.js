import { shouldCallGemini, shouldCallGemma } from "./ambiguityGate.js";
import { fuseCandidateScore } from "./scoreFusion.js";

export async function runKimV5({
  exactLookup,
  strongTextFilter,
  preprocessImage,
  encodeImage,
  vectorSearch,
  hydrateCandidates,
  structuralAnalysis,
  geminiResolve,
  gemmaJudge,
  query
}) {
  // 1. Exact/text path.
  const exact = await exactLookup(query);
  if (exact?.length) {
    return {mode:"KIM_EXACT",ai_calls:0,candidates:exact.slice(0,5)};
  }

  const strong = await strongTextFilter(query);
  if (!query.image && strong?.sufficient) {
    return {mode:"KIM_TEXT_FILTER",ai_calls:0,candidates:strong.rows.slice(0,5)};
  }

  // 2. Image preprocessing + vector.
  const prep = await preprocessImage(query.image);
  const vector = await encodeImage(prep.canonicalImage);

  // 3. Vector retrieval.
  const rawHits = await vectorSearch(vector, 30);
  const hydrated = await hydrateCandidates(rawHits);

  // 4. Deterministic evidence fusion.
  const structural = await structuralAnalysis({
    query,
    prep,
    candidates:hydrated
  });

  const fused = hydrated
    .map(row => fuseCandidateScore({
      ...row,
      structural_score:structural.byId?.[row.id]?.score || 0
    }))
    .sort((a,b) => b.final_score - a.final_score);

  // 5. Clear result => no LLM.
  const callGemini = shouldCallGemini({
    candidates:fused,
    queryQuality:prep.qualityScore,
    structuralConflicts:structural.conflicts || 0,
    angleRisk:structural.angleRisk || 0,
    lightingRisk:structural.lightingRisk || 0
  });

  if (!callGemini) {
    return {
      mode:"KIM_VECTOR_CLEAR",
      ai_calls:0,
      candidates:fused.slice(0,5)
    };
  }

  // 6. Gemini only on Top 10.
  const resolverPool = fused.slice(0,10);
  const gemini = await geminiResolve({
    query,
    prep,
    candidates:resolverPool,
    structural
  });

  // 7. Optional Gemma judge.
  const callGemma = shouldCallGemma({
    geminiResult:gemini,
    orientationConflict:structural.orientationConflict,
    holeConflict:structural.holeConflict
  });

  if (!callGemma) {
    return {
      mode:"KIM_VECTOR_GEMINI",
      ai_calls:1,
      candidates:(gemini.rankings || []).slice(0,5)
    };
  }

  const judged = await gemmaJudge({
    query,
    prep,
    candidates:resolverPool,
    gemini,
    structural
  });

  return {
    mode:"KIM_VECTOR_GEMINI_GEMMA",
    ai_calls:2,
    decision:judged.decision,
    candidates:(judged.top5 || []).slice(0,5)
  };
}
