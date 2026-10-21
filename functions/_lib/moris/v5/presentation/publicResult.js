import { buildMorisUserMessage } from "./userMessage.js";

export function toPublicMorisResult(result,{debug=false}={}){
  const rawList = Array.isArray(result?.candidates) ? [...result.candidates] : [];
  const isFeatureMode = result?.mode === 'feature_filter' || result?.match_source === 'identifying_features';

  const processedList = rawList.map(c => {
    if (isFeatureMode || c?.match_source === 'identifying_features' || c?.score_source === 'identifying_features_match' || c?.is_feature_match) {
      return {
        ...c,
        is_feature_match: true,
        badge_label: 'Khớp'
      };
    }
    return c;
  });

  const sortedCandidates = processedList
    .sort((a, b) => {
      if(a?.selection_group || b?.selection_group){
        const groupRank=group=>group==='rescue_outside'?2:group==='rescue_unknown'?1:0;
        const groupA=groupRank(a?.selection_group);
        const groupB=groupRank(b?.selection_group);
        if(groupA!==groupB)return groupA-groupB;
      }
      const scoreA = Number(a?.match_score ?? a?.final_score ?? a?.geometric_score ?? a?.vector_similarity ?? 0);
      const scoreB = Number(b?.match_score ?? b?.final_score ?? b?.geometric_score ?? b?.vector_similarity ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  const out = {
    ok:true,
    user_message:buildMorisUserMessage({ ...result, candidates: sortedCandidates }),
    candidates:sortedCandidates,
    decision:result?.decision || null
  };

  if(result?.size_evidence) out.size_evidence = result.size_evidence;
  if(result?.size_shortlist_evidence) out.size_shortlist_evidence = result.size_shortlist_evidence;
  if(result?.hole_format_evidence) out.hole_format_evidence = result.hole_format_evidence;
  if(result?.confusing_pair_evidence) out.confusing_pair_evidence = result.confusing_pair_evidence;

  if(debug){
    out.debug = {
      mode:result?.mode || null,
      summary:result?.summary || null,
      warnings:result?.warnings || [],
      ai_calls:result?.ai_calls ?? null,
      candidate_pool_hash:result?.candidate_pool_hash || null,
      size_evidence:result?.size_evidence || null,
      size_shortlist_evidence:result?.size_shortlist_evidence || null,
      hole_format_evidence:result?.hole_format_evidence || null,
      confusing_pair_evidence:result?.confusing_pair_evidence || null
    };
  }
  return out;
}
