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
    metadata_score:Number(row?.metadata_score || 0),
    structural_score:Number(row?.structural_score || 0),
    final_score:Number(row?.final_score ?? row?.score ?? 0),
    reason:row?.reason || null,
    matched:row?.matched || [],
    conflicts:row?.conflicts || [],
    unknown:row?.unknown || []
  };
}
