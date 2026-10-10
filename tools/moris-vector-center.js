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

const state = {
  modelReady: false,
  items: [],
  filteredItems: [],
  visibleLimit: 20,
  loadingItems: false,
  batchRunning: false
};

const $ = id => document.getElementById(id);

function token() {
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

// ==================== TOAST & MODAL UI NỔI ====================
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(type, message, duration = 4000) {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  const isErr = type === "error";
  const isOk = type === "success";
  const bgClass = isErr
    ? "bg-rose-50 border-rose-200 text-rose-800"
    : isOk
    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
    : "bg-amber-50 border-amber-200 text-amber-800";
  const iconName = isErr ? "alert-circle" : isOk ? "check-circle" : "info";

  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl text-xs font-bold border backdrop-blur-md transition-all duration-200 ${bgClass}`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 shrink-0"></i>
    <span class="flex-1 leading-snug">${escapeHtml(message)}</span>
    <button class="text-slate-400 hover:text-slate-600 p-0.5 text-base leading-none">&times;</button>
  `;
  const closeBtn = toast.querySelector("button");
  if (closeBtn) closeBtn.onclick = () => toast.remove();

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-8px)";
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function showConfirm(title, message, { danger = false, okText = "Đồng ý", cancelText = "Hủy bỏ" } = {}) {
  return new Promise((resolve) => {
    const modal = $("confirmModal");
    const titleEl = $("confirmTitle");
    const msgEl = $("confirmMessage");
    const okBtn = $("btnConfirmOk");
    const cancelBtn = $("btnConfirmCancel");
    const iconWrap = $("confirmIconWrapper");

    if (!modal) {
      // Fallback
      resolve(true);
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    if (danger) {
      iconWrap.className = "w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto";
      okBtn.className = "btn flex-1 h-10 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md";
    } else {
      iconWrap.className = "w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto";
      okBtn.className = "btn flex-1 h-10 bg-rose-700 hover:bg-rose-800 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md";
    }

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    if (window.lucide) window.lucide.createIcons();

    const cleanup = () => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    okBtn.onclick = () => { cleanup(); resolve(true); };
    cancelBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

async function readJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.user_message || `HTTP ${res.status}`);
  }
  return data;
}

async function postJson(url, body) {
  return readJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function mediaUrl(key) {
  return "/api/media/" + String(key || "")
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

async function loadModel() {
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
  $("ready").className = "text-2xl font-black text-emerald-700 mt-1";
  $("testModel").disabled = false;
  return result;
}

async function refreshStatus() {
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

onDinov2Progress(progress => {
  if (progress?.status === "progress" && Number.isFinite(progress?.progress)) {
    const pct = Math.max(0, Math.min(100, Number(progress.progress)));
    $("modelBar").style.width = `${pct}%`;
    $("runtime").textContent = `Đang tải model ${Math.round(pct)}%...`;
  }
});

$("loadModel").onclick = () => loadModel().then(() => {
  showToast("success", "Đã nạp thành công mô hình DINOv2!");
}).catch(e => {
  renderParts($("runtime"), [[e?.message || e, { class: "bad" }]]);
  showToast("error", `Lỗi tải model: ${e?.message || e}`);
});

$("testModel").onclick = async () => {
  try {
    if (!state.modelReady) await loadModel();

    $("runtime").textContent = "Đang test embedding trên ảnh thật...";
    const data = await readJson(
      `/api/moris/vector-items?session_token=${encodeURIComponent(token())}&limit=5`
    );
    const first = (data?.items || []).find(i => i.assets && i.assets.length > 0);

    if (!first || !first.assets?.[0]?.image_path) {
      throw new Error("Không tìm thấy ảnh catalogue nào để test model.");
    }

    const testAsset = first.assets[0];
    const result = await embedImageDinov2Variants(
      new URL(mediaUrl(testAsset.image_path), location.origin).href,
      { includeGray: true }
    );

    const firstProbe = result?.probes?.[0];
    if (!Array.isArray(firstProbe?.embedding) || firstProbe.embedding.length !== 384) {
      throw new Error(`Embedding test sai dimension: ${firstProbe?.embedding?.length || 0}`);
    }

    renderParts($("runtime"), [
      "Test thật thành công: ", ["384D", { bold: true }], " · ",
      [firstProbe?.runtime?.device || "?", {}], "/",
      [firstProbe?.runtime?.dtype || "?", {}]
    ]);

    showToast("success", `Test DINOv2 thành công 384D trên mã ${first.code}!`);
  } catch (error) {
    renderParts($("runtime"), [
      ["Test thất bại: ", {}],
      [error?.message || error, { class: "bad" }]
    ]);
    showToast("error", `Test model thất bại: ${error?.message || error}`);
  }
};

$("refreshStatus").onclick = () => refreshStatus().then(() => {
  showToast("success", "Đã làm mới độ phủ vector trong Database.");
}).catch(e => {
  renderParts($("coverage"), [[e?.message || e, { class: "bad" }]]);
  showToast("error", `Lỗi: ${e?.message || e}`);
});

// ==================== PURGE ALL VECTORS ====================
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
      purgeModal.classList.add("hidden");
      purgeModal.classList.remove("flex");

      await refreshStatus();
      await loadItems($("itemSearchInput")?.value || "");
      showToast("success", res?.message || "Đã xóa sạch toàn bộ vector trong hệ thống!");
    } catch (err) {
      showToast("error", `Lỗi khi xóa vector: ${err?.message || err}`);
    } finally {
      btnConfirmPurge.disabled = false;
      btnConfirmPurge.textContent = "Xác nhận xóa sạch";
      if (window.lucide) window.lucide.createIcons();
    }
  };
}

// ==================== DANH SÁCH LINH KIỆN & VIRTUAL SCROLL ====================
function renderItemsSlice() {
  const tbody = $("itemsTableBody");
  if (!tbody) return;

  const items = state.filteredItems || [];
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 font-bold">Không tìm thấy linh kiện nào.</td></tr>`;
    return;
  }

  const slice = items.slice(0, state.visibleLimit);

  tbody.innerHTML = slice.map((item, idx) => {
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
      ? `<button data-id="${item.id}" class="btn-vectorize-item btn h-8 px-3 text-[11px] font-black rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200" title="Mã này đã có vector">
           <i data-lucide="check" class="w-3.5 h-3.5"></i> Đã tạo
         </button>`
      : `<button data-id="${item.id}" class="btn-vectorize-item btn h-8 px-3 text-[11px] font-black rounded-xl bg-rose-700 hover:bg-rose-800 text-white shadow-sm" title="Tách vector cho mã này">
           <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Tách vector
         </button>`;

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="p-3">
          <div class="font-black text-slate-900 text-sm tracking-tight">${escapeHtml(item.code)}</div>
        </td>
        <td class="p-3">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isDual ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600'}">
              ${isDual ? '2 mặt' : '1 mặt'}
            </span>
            <span class="text-[11px] text-slate-400 font-semibold">${item.assets?.length || 0} ảnh trong DB</span>
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
      const id = btn.getAttribute("data-id");
      const item = state.items.find(i => String(i.id) === String(id));
      if (item) vectorizeSingleItem(item, btn);
    };
  });

  const hint = $("renderedRowsHint");
  if (hint) {
    if (items.length <= 20) {
      hint.textContent = `Hiển thị toàn bộ ${items.length} mã.`;
    } else if (slice.length >= items.length) {
      hint.textContent = `Đã hiển thị tất cả ${items.length} mã. Cuộn lên đầu để thu gọn.`;
    } else {
      hint.textContent = `Đang hiển thị ${slice.length} / ${items.length} mã. Cuộn xuống để xem tiếp.`;
    }
  }

  const topHint = $("scrollTopHint");
  if (topHint) {
    if (state.visibleLimit > 20) {
      topHint.classList.remove("hidden");
    } else {
      topHint.classList.add("hidden");
    }
  }

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
    state.filteredItems = items;
    state.visibleLimit = 20;

    const withVec = items.filter(i => i.has_vector).length;
    const pending = items.length - withVec;

    if ($("pendingCount")) $("pendingCount").textContent = pending;
    if ($("records")) $("records").textContent = withVec;

    if (countBadge) {
      countBadge.textContent = `${items.length} mã (${withVec} đã có vector, ${pending} chờ tách)`;
    }

    renderItemsSlice();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">Lỗi tải danh sách: ${escapeHtml(err?.message || String(err))}</td></tr>`;
    }
    showToast("error", `Không thể tải danh sách mã: ${err?.message || err}`);
  } finally {
    state.loadingItems = false;
  }
}

async function vectorizeSingleItem(item, btn) {
  if (item.has_vector) {
    showToast("warning", `Mã [${item.code}] đã có vector trước đó! Bỏ qua để tránh tạo nhiều vector trùng lặp.`);
    return;
  }

  const assets = Array.isArray(item.assets) ? item.assets.filter(a => a.image_path) : [];
  if (!assets.length) {
    showToast("warning", `Mã [${item.code}] chưa có hình ảnh thật nào trong cơ sở dữ liệu.`);
    return;
  }

  const origHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span> Đang tạo...`;
  }

  try {
    if (!state.modelReady) await loadModel();

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

    const upsertRes = await postJson("/api/moris/vector-upsert", {
      session_token: token(),
      vectors,
      prevent_duplicate: true
    });

    if (upsertRes?.already_exists) {
      showToast("warning", `Mã [${item.code}] đã có vector trước đó! Hệ thống đã bỏ qua để tránh trùng lặp.`);
      item.has_vector = true;
    } else {
      item.has_vector = true;
      showToast("success", `Tách vector thành công cho mã [${item.code}]!`);
    }

    await refreshStatus();
    const withVec = state.items.filter(i => i.has_vector).length;
    if ($("pendingCount")) $("pendingCount").textContent = state.items.length - withVec;
    renderItemsSlice();
  } catch (err) {
    if (String(err?.message || "").includes("đã có vector") || err?.status === 409) {
      showToast("warning", `Mã [${item.code}] đã có vector trước đó! Tránh tạo nhiều vector trùng lặp.`);
      item.has_vector = true;
      renderItemsSlice();
    } else {
      showToast("error", `Lỗi khi tạo vector cho mã [${item.code}]: ${err?.message || err}`);
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
  if (state.batchRunning) return;

  const pending = (state.items || []).filter(i => !i.has_vector && i.assets && i.assets.length > 0);
  if (!pending.length) {
    showToast("info", "Tất cả các mã hiện tại đều đã có vector!");
    return;
  }

  const ok = await showConfirm(
    "Tách vector hàng loạt",
    `Tìm thấy ${pending.length} mã đang chờ tách vector. Bạn có muốn bắt đầu xử lý hàng loạt ngay không?`,
    { okText: "Bắt đầu tách", cancelText: "Hủy bỏ" }
  );
  if (!ok) return;

  state.batchRunning = true;
  const btn = $("btnBatchVectorize");
  const progWrapper = $("batchProgressWrapper");
  const progBar = $("batchProgressBar");
  const progLabel = $("batchProgressLabel");
  const progPct = $("batchProgressPct");

  if (btn) btn.disabled = true;
  if (progWrapper) progWrapper.classList.remove("hidden");

  let doneCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  try {
    if (!state.modelReady) await loadModel();

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const pct = Math.round(((i + 1) / pending.length) * 100);

      if (progBar) progBar.style.width = `${pct}%`;
      if (progPct) progPct.textContent = `${pct}%`;
      if (progLabel) progLabel.textContent = `Đang xử lý ${i + 1}/${pending.length}: mã ${item.code}...`;

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
          }
        }
      } catch (err) {
        if (String(err?.message || "").includes("đã có vector") || err?.status === 409) {
          skippedCount++;
          item.has_vector = true;
        } else {
          failCount++;
        }
      }

      renderItemsSlice();
    }

    await refreshStatus();
    const withVec = state.items.filter(i => i.has_vector).length;
    if ($("pendingCount")) $("pendingCount").textContent = state.items.length - withVec;

    showToast("success", `Hoàn tất tách hàng loạt: Thành công ${doneCount} mã, Bỏ qua ${skippedCount} mã, Thất bại ${failCount} mã.`);
  } catch (err) {
    showToast("error", `Lỗi tiến trình hàng loạt: ${err?.message || err}`);
  } finally {
    state.batchRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4"></i>Tách vector hàng loạt`;
    }
    if (progWrapper) {
      setTimeout(() => progWrapper.classList.add("hidden"), 1500);
    }
    if (window.lucide) window.lucide.createIcons();
  }
}

// ==================== SỰ KIỆN CUỘN TRANG (VIRTUAL SCROLL WINDOW) ====================
const scrollContainer = $("itemsScrollContainer");
if (scrollContainer) {
  scrollContainer.onscroll = () => {
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

    // Cuộn về đầu trang (scrollTop <= 10): tự động thu gọn về 20 dòng
    if (scrollTop <= 10 && state.visibleLimit > 20) {
      state.visibleLimit = 20;
      renderItemsSlice();
      return;
    }

    // Cuộn xuống gần đáy (còn 60px): render thêm 20 dòng
    if (scrollTop + clientHeight >= scrollHeight - 60) {
      if (state.visibleLimit < state.filteredItems.length) {
        state.visibleLimit = Math.min(state.filteredItems.length, state.visibleLimit + 20);
        renderItemsSlice();
      }
    }
  };
}

const scrollTopBtn = $("scrollTopHint");
if (scrollTopBtn && scrollContainer) {
  scrollTopBtn.onclick = () => {
    scrollContainer.scrollTop = 0;
    state.visibleLimit = 20;
    renderItemsSlice();
  };
}

if ($("btnBatchVectorize")) {
  $("btnBatchVectorize").onclick = batchVectorizePending;
}

if ($("btnRefreshItems")) {
  $("btnRefreshItems").onclick = () => {
    loadItems($("itemSearchInput")?.value || "").then(() => {
      showToast("success", "Đã tải lại danh sách linh kiện.");
    });
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

// Khởi tạo
refreshStatus().catch(e => showToast("error", `Status: ${e?.message || e}`));
loadItems().catch(e => showToast("error", `Items: ${e?.message || e}`));
if (window.lucide) window.lucide.createIcons();
