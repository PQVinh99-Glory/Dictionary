import {
  rpc,
  searchCatalogue,
  validateSession
} from "../../_lib/kim/v5/connectors/supabase.js";

import {
  json,
  readJson,
  errorResponse
} from "../../_lib/shared/http.js";

function requireAdmin(me) {
  if (String(me?.role_name || "").toLowerCase() !== "admin") {
    const e = new Error("Chỉ admin được chạy vector reindex.");
    e.status = 403;
    throw e;
  }
}

const ALLOWED_TYPES = new Set([
  "thumb",
  "front",
  "back",
  "detail",
  "compare"
]);

function normalizeAsset(row, asset) {
  const objectKey = String(asset?.image_path || "")
    .replace(/^\/+/, "")
    .trim();

  if (!objectKey) return null;

  let assetType = String(asset?.asset_type || "front").toLowerCase();
  if (!ALLOWED_TYPES.has(assetType)) assetType = "detail";

  return {
    record_id:String(row?.id ?? ""),
    code:row?.code ?? null,
    part_id:row?.part_id ?? null,
    asset_type:assetType,
    object_key:objectKey,
    sort_order:Number(asset?.sort_order || 1)
  };
}

async function loadAssets(env, token, row) {
  const data = await rpc(
    env,
    "app_get_part_assets",
    {
      p_session_token:token,
      p_image_id:row?.id
    }
  );

  const assets = Array.isArray(data) ? data : [];
  const seen = new Set();
  const out = [];

  for (const asset of assets) {
    const normalized = normalizeAsset(row, asset);
    if (!normalized) continue;

    const dedupeKey =
      `${normalized.asset_type}|${normalized.object_key}`;

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
  }

  return out;
}

async function mapWithConcurrency(rows, limit, worker) {
  const out = new Array(rows.length);
  let cursor = 0;

  async function runOne() {
    while (cursor < rows.length) {
      const index = cursor++;
      out[index] = await worker(rows[index], index);
    }
  }

  const count = Math.max(1, Math.min(limit, rows.length || 1));
  await Promise.all(
    Array.from({length:count}, () => runOne())
  );

  return out;
}

export async function onRequestPost({request,env}) {
  try {
    const body = await readJson(request, {maxBytes:100_000});
    const token = String(body?.session_token || "");
    const offset = Math.max(0, Number(body?.offset || 0));
    const limit = Math.max(
      1,
      Math.min(Number(body?.limit || 20), 50)
    );

    const me = await validateSession(env, token);
    requireAdmin(me);

    const rows = await searchCatalogue(env, token, {
      search:"",
      usageSide:"all",
      viewMode:"all",
      limit,
      offset
    });

    const mapped = await mapWithConcurrency(
      rows,
      5,
      async row => {
        try {
          const assets = await loadAssets(env, token, row);
          return {ok:true,row,assets};
        } catch (error) {
          return {
            ok:false,
            row,
            assets:[],
            error:error?.message || String(error)
          };
        }
      }
    );

    const items = mapped.flatMap(x => x.assets || []);

    const rowsWithAssets = mapped.filter(
      x => x.ok && (x.assets?.length || 0) > 0
    ).length;

    const rowsWithoutAssets = mapped.filter(
      x => x.ok && !(x.assets?.length || 0)
    ).map(x => ({
      id:String(x.row?.id ?? ""),
      code:x.row?.code ?? null
    }));

    const assetErrors = mapped.filter(x => !x.ok).map(x => ({
      id:String(x.row?.id ?? ""),
      code:x.row?.code ?? null,
      error:x.error
    }));

    return json({
      ok:true,
      offset,
      row_count:rows.length,
      rows_with_assets:rowsWithAssets,
      rows_without_assets:rowsWithoutAssets,
      asset_errors:assetErrors,
      asset_count:items.length,
      items,
      next_offset:offset + rows.length,
      has_more:rows.length === limit
    });
  } catch (error) {
    return errorResponse(error);
  }
}
