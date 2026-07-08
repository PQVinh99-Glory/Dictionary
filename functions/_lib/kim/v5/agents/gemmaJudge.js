export function buildGemmaJudgeInput({
  candidatePoolHash,
  queryEvidence,
  geminiResult,
  candidates
}) {
  return {
    role:"critic_judge",
    rules:[
      "Do not rerun retrieval.",
      "Do not add IDs.",
      "Review only supplied candidates.",
      "Check unsupported confidence.",
      "Check orientation and hole-count conflicts.",
      "Decision must be accept, ambiguous or abstain."
    ],
    candidate_pool_hash:candidatePoolHash,
    query_evidence:queryEvidence,
    resolver_output:geminiResult,
    candidates
  };
}
