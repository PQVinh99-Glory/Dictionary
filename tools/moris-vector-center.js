import {
  initDinov2,
  embedImageDinov2,
  embedImageDinov2Variants,
  onDinov2Progress
} from "/src/moris/vector/browserDinov2.js";

import {
  upsertVectorsChunked
} from "/src/moris/vector/chunkedUpsert.js";

import { renderParts } from "./render-parts.js";
const OFFSET_KEY = "kim_v56_vector_center_offset";
const BATCH_LIMIT = 20;

const state = {
  running:false,
  pause:false,
  modelReady:false,
  offset:Number(localStorage.getItem(OFFSET_KEY) || 0),
  processed:0,
  written:0,
  failed:0,
  batchNo:0,
  items:[],
  loadingItems:false
};

const $ = id => document.getElementById(id);

const logEl = $("log");

function token(){
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
  throw new Error("Hãy đăng nhập Catalogue trước.");
}

function log(message){
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function sync(){
  $("processed").textContent = state.processed;
  $("written").textContent = state.written;
  $("failed").textContent = state.failed;
  $("batchNo").textContent = state.batchNo;
  $("offset").textContent = state.offset;
  $("start").disabled = state.running;
  $("pause").disabled = !state.running;
  $("testModel").disabled = !state.modelReady;
}

async function readJson(url, options={}){
  const res = await fetch(url,options);
  const data = await res.json().catch(()=>({}));
  if(!res.ok || data?.ok === false){
    throw new Error(data?.error || data?.user_message || `HTTP ${res.status}`);
  }
  return data;
}

async function postJson(url, body){
  return readJson(url,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
}

function mediaUrl(key){
  return "/api/media/" + String(key || "")
    .replace(/^\/+/,"")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

async function loadModel(){
  $("runtime").textContent = "Đang khởi tạo DINOv2...";
  const result = await initDinov2();
  state.modelReady = true;
  const rt = result?.runtime || {};
  renderParts($("runtime"), [
    "Sẵn sàng: ",
    [rt.device || "?", { bold: true }],
    "/",
    [rt.dtype || "?", { bold: true }]
  ]);
  $("ready").textContent = "Có";
  $("ready").className = "good";
  sync();
  return result;
}

async function refreshStatus(){
  const data = await readJson(
    `/api/moris/reindex-status?session_token=${encodeURIComponent(token())}`
  );

  const s = data?.status || {};
  $("records").textContent = Number(s.distinct_records || 0);
  $("vectors").textContent = Number(s.active_vectors || 0);

  renderParts($("coverage"), [
    "Profile: ", [data?.profile?.model || "?", { bold: true }], { br: true },
    "SKU có vector: ", [Number(s.distinct_records || 0), { bold: true }], { br: true },
    "Tổng vector ảnh: ", [Number(s.active_vectors || 0), { bold: true }], { br: true },
    "Cập nhật gần nhất: ", [s.latest_updated_at || "chưa có", { bold: true }]
  ]);
}

onDinov2Progress(progress=>{
  if(progress?.status === "progress" && Number.isFinite(progress?.progress)){
    const pct = Math.max(0,Math.min(100,Number(progress.progress)));
    $("modelBar").style.width = `${pct}%`;
    $("runtime").textContent = `Đang tải model ${Math.round(pct)}%...`;
  }
});

async function run(){
  state.running = true;
  state.pause = false;
  sync();

  try{
    if(!state.modelReady) await loadModel();

    while(!state.pause){
      const batch = await postJson("/api/moris/reindex-batch",{
        session_token:token(),
        offset:state.offset,
        limit:BATCH_LIMIT
      });

      state.batchNo += 1;
      sync();

      const items = Array.isArray(batch?.items) ? batch.items : [];

      renderParts($("batchDiag"), [
        "Dòng catalogue: ", [Number(batch?.row_count || 0), { bold: true }], " · ",
        "SKU có asset: ", [Number(batch?.rows_with_assets || 0), { bold: true }], " · ",
        "Ảnh thật: ", [Number(batch?.asset_count || 0), { bold: true }], " · ",
        "SKU thiếu ảnh: ", [Number(batch?.rows_without_assets?.length || 0), { bold: true }], " · ",
        "Lỗi asset RPC: ", [Number(batch?.asset_errors?.length || 0), { bold: true }]
      ]);

      if(
        Number(batch?.row_count || 0) > 0 &&
        items.length === 0
      ){
        const firstAssetError =
          batch?.asset_errors?.[0]?.error || "";

        throw new Error(
          firstAssetError
            ? `Không lấy được asset thật: ${firstAssetError}`
            : "Batch có SKU nhưng 0 ảnh thật. Cursor bị khóa để tránh false progress."
        );
      }

      if(!items.length && !batch?.has_more){
        $("jobStatus").textContent = "Hoàn tất toàn bộ catalogue.";
        log("Hoàn tất reindex.");
        break;
      }

      const vectors = [];
      let itemIndex = 0;

      for(const item of items){
        if(state.pause) break;
        itemIndex += 1;

        $("jobBar").style.width =
          `${Math.round((itemIndex / Math.max(1,items.length))*100)}%`;

        $("jobStatus").textContent =
          `Đang vector hóa ${item.code || item.record_id} (${item.asset_type})`;

        try{
          const result = await embedImageDinov2Variants(
            new URL(mediaUrl(item.object_key), location.origin).href,
            {includeGray:true}
          );

          for (const probe of (result.probes || [])) {
            vectors.push({
              record_id:item.record_id,
              asset_type:item.asset_type,
              object_key:item.object_key,
              view_variant:probe.view_variant,
              embedding:probe.embedding,
              embedding_profile:probe.profile,
              foreground_status:"browser_dinov2_v59_canonical"
            });
          }

          state.processed += 1;
          log(`EMBED OK ${item.code || item.record_id}/${item.asset_type}`);
        }catch(error){
          state.processed += 1;
          state.failed += 1;
          log(`EMBED ERR ${item.code || item.record_id}: ${error?.message || error}`);
        }

        sync();
      }

      if(items.length > 0 && vectors.length === 0){
        throw new Error(
          "Có ảnh thật nhưng không tạo được embedding nào. Cursor bị khóa."
        );
      }

      let batchWritten = 0;
      let batchFailed = 0;

      if(vectors.length){
        const upsert = await upsertVectorsChunked({
          endpoint:"/api/moris/vector-upsert",
          sessionToken:token(),
          vectors,
          chunkSize:20,
          timeoutMs:180000,
          strict:true,

          onChunk:info => {
            if(info?.phase === "start"){
              $("jobStatus").textContent =
                `Đang ghi vector chunk ` +
                `${info.chunk_number}/${info.chunk_count}...`;
            }

            if(info?.phase === "done"){
              log(
                `UPSERT CHUNK ${info.chunk_number}/${info.chunk_count} ` +
                `+${info.written}, lỗi ${info.failed}`
              );
            }
          }
        });

        batchWritten = Number(upsert?.written || 0);
        batchFailed = Number(upsert?.failed || 0);

        state.written += batchWritten;
        state.failed += batchFailed;

        log(
          `UPSERT BATCH hoàn tất +${batchWritten}, ` +
          `lỗi ${batchFailed}, chunks ${upsert?.chunks || 0}`
        );

        sync();
      }

      // Integrity gate theo batch hiện tại, không dùng cumulative state.written.
      if(
        vectors.length > 0 &&
        batchWritten !== vectors.length
      ){
        throw new Error(
          `Batch write không toàn vẹn: ` +
          `embed=${vectors.length}, written=${batchWritten}. ` +
          `Cursor bị khóa.`
        );
      }

      state.offset = Number(batch?.next_offset || state.offset);
      localStorage.setItem(OFFSET_KEY,String(state.offset));
      sync();

      await refreshStatus().catch(()=>{});

      if(!batch?.has_more){
        $("jobStatus").textContent = "Hoàn tất toàn bộ catalogue.";
        log("Hoàn tất.");
        break;
      }
    }
  }catch(error){
    $("jobStatus").textContent = "Đã dừng do lỗi.";
    log(`FATAL: ${error?.message || error}`);
  }finally{
    state.running = false;
    sync();
  }
}

$("loadModel").onclick = ()=>loadModel().catch(e=>{
  renderParts($("runtime"), [[e?.message || e, { class: "bad" }]]);
  log(`MODEL ERR: ${e?.message || e}`);
});

$("testModel").onclick = async ()=>{
  try{
    if(!state.modelReady) await loadModel();

    $("runtime").textContent =
      "Đang test embedding trên ảnh catalogue thật...";

    const batch = await postJson("/api/moris/reindex-batch",{
      session_token:token(),
      offset:0,
      limit:5
    });

    const first = (batch?.items || [])[0];

    if(!first){
      throw new Error(
        "Batch không trả ảnh nào. Kiểm tra app_get_part_assets."
      );
    }

    const result = await embedImageDinov2Variants(
      new URL(mediaUrl(first.object_key), location.origin).href,
      {includeGray:true}
    );

    const firstProbe = result?.probes?.[0];
    if(
      !Array.isArray(firstProbe?.embedding) ||
      firstProbe.embedding.length !== 384
    ){
      throw new Error(
        `Embedding test sai dimension: ${result?.embedding?.length || 0}`
      );
    }

    renderParts($("runtime"), [
      "Test thật thành công: ", ["384D", { bold: true }], " · ",
      [firstProbe?.runtime?.device || "?", {}], "/",
      [firstProbe?.runtime?.dtype || "?", {}]
    ]);

    log(
      `MODEL TEST OK 384D trên ${first.code || first.record_id}/${first.asset_type}`
    );
  }catch(error){
    renderParts($("runtime"), [
      ["Test thật thất bại: ", {}],
      [error?.message || error, { class: "bad" }]
    ]);
    log(`MODEL TEST ERR: ${error?.message || error}`);
  }
};

$("refreshStatus").onclick = ()=>refreshStatus().catch(e=>{
  renderParts($("coverage"), [[e?.message || e, { class: "bad" }]]);
});

$("start").onclick = run;
$("pause").onclick = ()=>{
  state.pause = true;
  $("jobStatus").textContent = "Đang tạm dừng sau tác vụ hiện tại...";
};

$("reset").onclick = ()=>{
  if(state.running) return;
  state.offset = 0;
  state.processed = 0;
  state.written = 0;
  state.failed = 0;
  state.batchNo = 0;
  localStorage.removeItem(OFFSET_KEY);
  logEl.textContent = "";
  $("jobStatus").textContent = "Đã reset offset.";
  $("jobBar").style.width = "0%";
  sync();
};

// ==================== PURGE MODAL ====================
const purgeModal = $("purgeModal");
const btnOpenPurgeModal = $("btnOpenPurgeModal");
const btnCancelPurge = $("btnCancelPurge");
const btnConfirmPurge = $("btnConfirmPurge");

if (btnOpenPurgeModal) {
  btnOpenPurgeModal.onclick = () => {
    purgeModal.classList.remove("hidden");
    purgeModal.classList.add("flex");
    if (window.lucide) window.lucide.createIcons();
  };
}

if (btnCancelPurge) {
  btnCancelPurge.onclick = () => {
    purgeModal.classList.add("hidden");
    purgeModal.classList.remove("flex");
  };
}

if (btnConfirmPurge) {
  btnConfirmPurge.onclick = async () => {
    try {
      btnConfirmPurge.disabled = true;
      btnConfirmPurge.textContent = "Đang xóa...";
      const res = await postJson("/api/moris/vector-purge", {
        session_token: token()
      });
      log(`PURGE OK: Đã xóa toàn bộ vector thành công.`);
      purgeModal.classList.add("hidden");
      purgeModal.classList.remove("flex");

      // Reset local offset & counters
      state.offset = 0;
      state.processed = 0;
      state.written = 0;
      state.failed = 0;
      state.batchNo = 0;
      localStorage.removeItem(OFFSET_KEY);
      $("jobBar").style.width = "0%";
      sync();

      await refreshStatus();
      await loadItems($("itemSearchInput")?.value || "");
      alert(res?.message || "Đã xóa sạch toàn bộ vector trong hệ thống!");
    } catch (err) {
      log(`PURGE ERR: ${err?.message || err}`);
      alert(`Lỗi khi xóa vector: ${err?.message || err}`);
    } finally {
      btnConfirmPurge.disabled = false;
      btnConfirmPurge.textContent = "Xác nhận xóa sạch";
      if (window.lucide) window.lucide.createIcons();
    }
  };
}

// ==================== SECTION 3: ITEMS LIST & VECTORIZATION ====================
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderItemsTable(items) {
  const tbody = $("itemsTableBody");
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 font-bold">Không tìm thấy linh kiện nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((item, idx) => {
    const thumbUrl = item.thumb_path ? mediaUrl(item.thumb_path) : "";
    const isDual = item.view_mode === "dual_face";
    const sideMap = {
      all: "Cả 2 bên",
      left: "Bên trái (LH)",
      right: "Bên phải (RH)",
      unknown: "Chưa xác định"
    };
    const sideLabel = sideMap[item.usage_side] || (item.usage_side || "—");

    const statusBadge = item.has_vector
      ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
           <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-600"></i> Đã có vector
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black bg-amber-50 text-amber-700 border border-amber-200">
           <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-600"></i> Chờ tách vector
         </span>`;

    const actionBtn = item.has_vector
      ? `<button data-idx="${idx}" class="btn-vectorize-item btn h-8 px-3 text-[11px] font-black rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200" title="Mã này đã có vector">
           <i data-lucide="check" class="w-3.5 h-3.5"></i> Đã tạo
         </button>`
      : `<button data-idx="${idx}" class="btn-vectorize-item btn h-8 px-3 text-[11px] font-black rounded-xl bg-rose-700 hover:bg-rose-800 text-white shadow-sm" title="Tách vector cho mã này">
           <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Tách vector
         </button>`;

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="p-3">
          <div class="w-12 h-12 rounded-xl border border-slate-200 overflow-hidden checker flex items-center justify-center shrink-0">
            ${thumbUrl
              ? `<img src="${escapeHtml(thumbUrl)}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<span class=\\'text-[10px] text-slate-400 font-bold\\'>Ảnh lỗi</span>'" loading="lazy" />`
              : `<span class="text-[10px] text-slate-400 font-bold">Chưa có</span>`
            }
          </div>
        </td>
        <td class="p-3">
          <div class="font-black text-slate-900 text-xs">${escapeHtml(item.code)}</div>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isDual ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600'}">
              ${isDual ? '2 mặt' : '1 mặt'}
            </span>
            <span class="text-[10px] text-slate-400 font-semibold">${item.assets?.length || 0} ảnh</span>
          </div>
        </td>
        <td class="p-3 text-slate-600 text-xs font-bold">
          ${escapeHtml(sideLabel)}
        </td>
        <td class="p-3">
          ${statusBadge}
        </td>
        <td class="p-3 text-right">
          ${actionBtn}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-vectorize-item").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-idx"));
      const item = items[idx];
      if (item) vectorizeSingleItem(item, btn);
    };
  });

  if (window.lucide) window.lucide.createIcons();
}

async function loadItems(query = "") {
  if (state.loadingItems) return;
  state.loadingItems = true;
  const tbody = $("itemsTableBody");
  const countBadge = $("itemsCountBadge");

  try {
    const t = token();
    const data = await readJson(
      `/api/moris/vector-items?session_token=${encodeURIComponent(t)}&limit=100&search=${encodeURIComponent(query)}`
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    state.items = items;

    if (countBadge) {
      const withVec = items.filter(i => i.has_vector).length;
      countBadge.textContent = `${items.length} mã (${withVec} đã có vector, ${items.length - withVec} chờ tách)`;
    }

    renderItemsTable(items);
  } catch (err) {
    log(`ITEMS ERR: ${err?.message || err}`);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">Lỗi tải danh sách: ${escapeHtml(err?.message || String(err))}</td></tr>`;
    }
  } finally {
    state.loadingItems = false;
  }
}

async function vectorizeSingleItem(item, btn) {
  // Nếu ảnh đã có vector rồi thì báo lỗi ngay để tránh trùng lặp
  if (item.has_vector) {
    alert(`Mã [${item.code}] đã có vector trước đó! Bỏ qua để tránh tạo nhiều vector trùng lặp.`);
    return;
  }

  const assets = Array.isArray(item.assets) ? item.assets.filter(a => a.image_path) : [];
  if (!assets.length) {
    alert(`Mã [${item.code}] chưa có hình ảnh thật nào trong cơ sở dữ liệu.`);
    return;
  }

  const origHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span> Đang tạo...`;
  }

  try {
    if (!state.modelReady) await loadModel();

    log(`Bắt đầu tách vector cho mã ${item.code} (${assets.length} ảnh)...`);

    const vectors = [];
    for (const asset of assets) {
      const fullUrl = new URL(mediaUrl(asset.image_path), location.origin).href;
      const result = await embedImageDinov2Variants(fullUrl, { includeGray: true });

      for (const probe of (result.probes || [])) {
        vectors.push({
          record_id: item.id,
          asset_type: asset.asset_type || "front",
          object_key: asset.image_path,
          view_variant: probe.view_variant,
          embedding: probe.embedding,
          embedding_profile: probe.profile,
          foreground_status: "browser_dinov2_v59_canonical"
        });
      }
    }

    if (!vectors.length) {
      throw new Error("Không tạo được embedding nào từ các ảnh.");
    }

    log(`Đang ghi ${vectors.length} vector của mã ${item.code} vào Supabase...`);

    const upsertRes = await postJson("/api/moris/vector-upsert", {
      session_token: token(),
      vectors,
      prevent_duplicate: true
    });

    if (upsertRes?.already_exists) {
      alert(`Mã [${item.code}] đã có vector trước đó! Hệ thống đã bỏ qua để tránh trùng lặp.`);
      item.has_vector = true;
    } else {
      item.has_vector = true;
      log(`TẠO VECTOR THÀNH CÔNG cho mã ${item.code} (+${upsertRes?.written || vectors.length} vector).`);
      alert(`Tách vector thành công cho mã [${item.code}]!`);
    }

    await refreshStatus();
    renderItemsTable(state.items);
  } catch (err) {
    log(`LỖI TẠO VECTOR [${item.code}]: ${err?.message || err}`);
    if (String(err?.message || "").includes("đã có vector") || err?.status === 409) {
      alert(`Mã [${item.code}] đã có vector trước đó! Tránh tạo nhiều vector trùng lặp.`);
      item.has_vector = true;
      renderItemsTable(state.items);
    } else {
      alert(`Lỗi khi tạo vector cho mã [${item.code}]: ${err?.message || err}`);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

async function batchVectorizePending() {
  const pending = (state.items || []).filter(i => !i.has_vector && i.assets && i.assets.length > 0);
  if (!pending.length) {
    alert("Tất cả các mã hiện tại đều đã có vector!");
    return;
  }

  const ok = confirm(`Tìm thấy ${pending.length} mã chưa có vector. Bạn có muốn bắt đầu tách vector hàng loạt không?`);
  if (!ok) return;

  const btn = $("btnBatchVectorize");
  if (btn) {
    btn.disabled = true;
    btn.textContent = `Đang tách 0/${pending.length}...`;
  }

  let doneCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  try {
    if (!state.modelReady) await loadModel();

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (btn) btn.textContent = `Đang tách ${i + 1}/${pending.length} (${item.code})...`;

      try {
        const assets = item.assets.filter(a => a.image_path);
        const vectors = [];

        for (const asset of assets) {
          const fullUrl = new URL(mediaUrl(asset.image_path), location.origin).href;
          const result = await embedImageDinov2Variants(fullUrl, { includeGray: true });

          for (const probe of (result.probes || [])) {
            vectors.push({
              record_id: item.id,
              asset_type: asset.asset_type || "front",
              object_key: asset.image_path,
              view_variant: probe.view_variant,
              embedding: probe.embedding,
              embedding_profile: probe.profile,
              foreground_status: "browser_dinov2_v59_canonical"
            });
          }
        }

        if (vectors.length) {
          const upsertRes = await postJson("/api/moris/vector-upsert", {
            session_token: token(),
            vectors,
            prevent_duplicate: true
          });

          if (upsertRes?.already_exists) {
            skippedCount++;
            item.has_vector = true;
          } else {
            doneCount++;
            item.has_vector = true;
            log(`BATCH: Mã ${item.code} OK (+${vectors.length} vector)`);
          }
        }
      } catch (err) {
        if (String(err?.message || "").includes("đã có vector") || err?.status === 409) {
          skippedCount++;
          item.has_vector = true;
        } else {
          failCount++;
          log(`BATCH ERR [${item.code}]: ${err?.message || err}`);
        }
      }

      renderItemsTable(state.items);
    }

    await refreshStatus();
    alert(`Hoàn tất tách hàng loạt:\n- Thành công: ${doneCount} mã\n- Đã có trước (bỏ qua): ${skippedCount} mã\n- Thất bại: ${failCount} mã`);
  } catch (err) {
    log(`BATCH FATAL: ${err?.message || err}`);
    alert(`Lỗi tiến trình hàng loạt: ${err?.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4"></i>Tách vector hàng loạt`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

if ($("btnBatchVectorize")) {
  $("btnBatchVectorize").onclick = batchVectorizePending;
}

if ($("btnRefreshItems")) {
  $("btnRefreshItems").onclick = () => {
    loadItems($("itemSearchInput")?.value || "");
  };
}

if ($("itemSearchInput")) {
  let searchTimer = null;
  $("itemSearchInput").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadItems(e.target.value.trim());
    }, 350);
  };
}

sync();
refreshStatus().catch(e=>log(`STATUS: ${e?.message || e}`));
loadItems().catch(e=>log(`ITEMS: ${e?.message || e}`));
if (window.lucide) window.lucide.createIcons();
