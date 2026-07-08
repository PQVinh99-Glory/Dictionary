export function toPublicCandidate(row, ranking={}, meta={}) {
  return {
    id:row.id,
    code:row.code,
    part_id:row.part_id,
    usage_side:row.usage_side,
    view_mode:row.view_mode,
    is_symmetric:!!row.is_symmetric,
    identifying_features:row.identifying_features,
    confusing_note:row.confusing_note,
    thumb_path:row.thumb_path,
    front_path:row.front_path,
    fallback_path:row.fallback_path,
    thumb_provider:row.thumb_provider,
    front_provider:row.front_provider,
    fallback_provider:row.fallback_provider,
    score:Number(ranking.confidence ?? ranking.score ?? Math.max(0,Math.min(1,(meta.score || 0)/100))),
    match_reason:ranking.reason || meta.matched?.join(", ") || "Denis V4",
    matched:ranking.matched || meta.matched || [],
    unknown:ranking.unknown || meta.unknown || [],
    conflicts:ranking.conflicts || meta.conflicts || []
  };
}
