export function publicCandidate(row) {
  return {
    id:String(row?.id ?? row?.record_id ?? ""),
    code:row?.code ?? null,
    part_id:row?.part_id ?? null,
    identifying_features:row?.identifying_features ?? null,
    confusing_note:row?.confusing_note ?? null,
    usage_side:row?.usage_side ?? null,
    view_mode:row?.view_mode ?? null,
    thumb_path:row?.thumb_path ?? null,
    front_path:row?.front_path ?? null,
    back_path:row?.back_path ?? null,
    vector_similarity:Number(row?.vector_similarity || 0),
    raw_vector_similarity:Number(row?.raw_vector_similarity ?? row?.vector_similarity ?? 0),
    probe_consensus:Number(row?.probe_consensus ?? 0),
    metadata_score:row?.metadata_score == null ? null : Number(row.metadata_score),
    structural_score:row?.structural_score == null ? null : Number(row.structural_score),
    final_score:Number(row?.final_score ?? row?.score ?? 0),
    match_score:Number(row?.match_score ?? row?.final_score ?? row?.score ?? row?.vector_similarity ?? 0),
    score_source:row?.score_source || null,
    reason:row?.reason || null,
    matched:row?.matched || [],
    conflicts:row?.conflicts || [],
    unknown:row?.unknown || []
  };
}
