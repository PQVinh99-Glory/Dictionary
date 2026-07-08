import { searchCatalogue, scanCatalogue } from "./supabase.js";

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

export async function exactLookup(env, token, query) {
  const q = norm(query?.message);
  if (!q) return [];

  const rows = await searchCatalogue(env, token, {
    search:q,
    usageSide:query?.filters?.usage_side || "all",
    viewMode:query?.filters?.view_mode || "all",
    limit:20,
    offset:0
  });

  return rows.filter(row =>
    [row?.code, row?.part_id, row?.id]
      .some(v => norm(v) === q)
  );
}

export async function hydrateVectorHits(env, token, hits, {maxRows=1500}={}) {
  // Bridge implementation that preserves existing RPC/schema.
  // Replace with a dedicated safe hydration RPC after physical schema review.
  const all = await scanCatalogue(env, token, {maxRows});
  const byId = new Map(all.map(row => [String(row?.id ?? ""), row]));

  return (hits || []).map(hit => {
    const row = byId.get(String(hit.record_id)) || {};
    return {
      ...row,
      id:row?.id ?? hit.record_id,
      record_id:String(hit.record_id),
      vector_similarity:Number(hit.similarity || 0),
      vector_object_key:hit.object_key || "",
      vector_asset_type:hit.asset_type || ""
    };
  });
}
