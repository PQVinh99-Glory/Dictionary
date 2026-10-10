import {
  initDinov2,
  embedImageDinov2,
  onDinov2Progress
} from "/src/moris/vector/browserDinov2.js";
const BATCH_LIMIT = 20;

const state = {
  running:false,
  pause:false,
  offset:Number(localStorage.getItem("kim_v55_reindex_offset") || 0),
  processed:0,
  written:0,
  failed:0
};

const $ = id => document.getElementById(id);
const logEl = $("log");

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(message) {
  $("status").textContent = message;
}

function sync() {
  $("processed").textContent = state.processed;
  $("written").textContent = state.written;
  $("failed").textContent = state.failed;
  $("start").disabled = state.running;
  $("pause").disabled = !state.running;
}

function sessionToken() {
  if (typeof window !== "undefined" && window.location) {
    const urlToken = new URLSearchParams(window.location.search).get("token");
    if (urlToken) return urlToken;
  }
  const direct = localStorage.getItem("catalogue_access_token") || sessionStorage.getItem("catalogue_access_token");
  if (direct) return direct;
  try {
    const value = (typeof CatalogueAuth !== "undefined" && CatalogueAuth?.getAccessToken) ? CatalogueAuth.getAccessToken() : "";
    if (value) return value;
  } catch (_) {}
  try {
    if (window.parent && window.parent !== window && window.parent.CatalogueAuth) {
      const pVal = window.parent.CatalogueAuth.getAccessToken();
      if (pVal) return pVal;
    }
  } catch (_) {}
  throw new Error("Chưa có session. Hãy đăng nhập app Catalogue trước.");
}

function mediaUrl(key) {
  return "/api/media/" + String(key || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

async function postJson(url, body) {
  const res = await fetch(url,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });

  const data = await res.json().catch(()=>({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.user_message || `HTTP ${res.status}`);
  }
  return data;
}

onDinov2Progress(progress => {
  if (progress?.status === "progress" && Number.isFinite(progress?.progress)) {
    const pct = Math.max(0,Math.min(100,Number(progress.progress)));
    $("bar").firstElementChild.style.width = `${pct}%`;
    setStatus(`Đang tải model ${Math.round(pct)}%...`);
  }
});

async function run() {
  state.running = true;
  state.pause = false;
  sync();

  try {
    setStatus("Đang khởi tạo DINOv2...");
    const init = await initDinov2();
    log(`Runtime: ${init?.runtime?.device || "?"}/${init?.runtime?.dtype || "?"}`);

    while (!state.pause) {
      const token = sessionToken();

      setStatus(`Đang lấy batch tại offset ${state.offset}...`);
      const batch = await postJson("/api/moris/reindex-batch",{
        session_token:token,
        offset:state.offset,
        limit:BATCH_LIMIT
      });

      const items = Array.isArray(batch?.items) ? batch.items : [];
      if (!items.length && !batch?.has_more) {
        setStatus("Hoàn tất reindex.");
        log("Hoàn tất.");
        break;
      }

      const vectors = [];

      for (const item of items) {
        if (state.pause) break;

        try {
          setStatus(`Đang vector hóa ${item.code || item.record_id} / ${item.asset_type}...`);

          const result = await embedImageDinov2(
            new URL(mediaUrl(item.object_key), location.origin).href
          );

          vectors.push({
            record_id:item.record_id,
            asset_type:item.asset_type,
            object_key:item.object_key,
            view_variant:"canonical",
            embedding:result.embedding,
            embedding_profile:result.profile,
            foreground_status:"browser_dinov2_v55"
          });

          state.processed += 1;
          log(`OK embed ${item.code || item.record_id} ${item.asset_type}`);
          sync();
        } catch (error) {
          state.processed += 1;
          state.failed += 1;
          log(`ERR embed ${item.code || item.record_id}: ${error?.message || error}`);
          sync();
        }
      }

      if (vectors.length) {
        const upsert = await postJson("/api/moris/vector-upsert",{
          session_token:token,
          vectors
        });

        state.written += Number(upsert?.written || 0);
        state.failed += Number(upsert?.failed || 0);
        log(`Upsert: +${upsert?.written || 0}, lỗi ${upsert?.failed || 0}`);
        sync();
      }

      state.offset = Number(batch?.next_offset || state.offset);
      localStorage.setItem(
        "kim_v55_reindex_offset",
        String(state.offset)
      );

      if (!batch?.has_more) {
        setStatus("Hoàn tất reindex.");
        log("Hoàn tất.");
        break;
      }
    }
  } catch (error) {
    setStatus("Đã dừng do lỗi.");
    log(`FATAL: ${error?.message || error}`);
  } finally {
    state.running = false;
    sync();
  }
}

$("start").onclick = run;
$("pause").onclick = () => {
  state.pause = true;
  setStatus("Đang tạm dừng sau tác vụ hiện tại...");
};
$("reset").onclick = () => {
  if (state.running) return;
  state.offset = 0;
  state.processed = 0;
  state.written = 0;
  state.failed = 0;
  localStorage.removeItem("kim_v55_reindex_offset");
  logEl.textContent = "";
  setStatus("Đã reset offset.");
  sync();
};

sync();
log(`Offset hiện tại: ${state.offset}`);
