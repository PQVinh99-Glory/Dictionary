// =======================================================================
// CẤU HÌNH HỆ THỐNG
// =======================================================================
// Giá trị lấy từ /config.js (sinh lúc build từ .env/.dev.vars).
// Nếu chạy index.html trực tiếp bằng file:// thì PC = {} => dùng fallback.
const PC = window.MORIS_PUBLIC_CONFIG || {};
const CONFIG = {
  // ---- Đọc từ config.js (không hardcode) ----
  SUPABASE_URL: PC.PUBLIC_SUPABASE_URL || 'https://vhsikdgkzecdfopkpzum.supabase.co',
  SUPABASE_ANON_KEY: PC.PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoc2lrZGdremVjZGZvcGtwenVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjgyMTcsImV4cCI6MjA5Njg0NDIxN30.bj1yl4azsk8X-V2I1C6l5Qpa0kqt6j0TP4ZCJ3Du0l4',
  R2_PUBLIC_URL: PC.PUBLIC_R2_PUBLIC_URL || 'https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev',
  R2_MEDIA_BASE_URL: PC.PUBLIC_R2_MEDIA_BASE_URL || '/api/media',
  UPLOAD_PRIMARY_URL: PC.PUBLIC_UPLOAD_PRIMARY_URL || '/api/upload',
  R2_WORKER_URL: PC.PUBLIC_R2_WORKER_URL || '',
  UPLOAD_HEALTH_URL: '/api/upload/health',
  UPLOAD_HEALTH_TTL_MS: 60000,

  ALLOWED_ORIGIN: 'https://pqvinh99-glory.github.io',
  // Rỗng = chỉ dùng R2. Bucket Supabase 'product-images' không tồn tại (404).
  SUPABASE_BUCKET_FALLBACK: '',
  PAGE_LIMIT: Number(PC.PUBLIC_PAGE_LIMIT) || 36,

  // Auto-login (chế độ prototype): TẮT mặc định vì credential không được hardcode.
  // Muốn bật lại chỉ dùng cho demo nội bộ: set true + điền user/pass thật, KHÔNG commit lên production.
  AUTO_LOGIN_ENABLED: false,
  AUTO_LOGIN_USERNAME: '',
  AUTO_LOGIN_PASSWORD: '',

  // Moris V5.5 — Browser DINOv2
  MORIS_BROWSER_VECTOR_ENABLED: true,
  MORIS_BROWSER_VECTOR_MODULE_URL: PC.PUBLIC_MORIS_BROWSER_VECTOR_MODULE_URL || '/src/moris/vector/browserDinov2.js',
  MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP: true,
  MORIS_VECTOR_AUTO_ON_SAVE_MOBILE: false,

  // V5.8 Query Vector Bridge + durable queue
  MORIS_QUERY_VECTOR_BRIDGE_ENABLED: true,
  MORIS_VECTOR_HEALTH_TTL_MS: 30000,
  MORIS_VECTOR_UPSERT_MODULE_URL: PC.PUBLIC_MORIS_VECTOR_UPSERT_MODULE_URL || '/src/moris/vector/chunkedUpsert.js',
  MORIS_VECTOR_UPSERT_CHUNK_SIZE: 20,

  MORIS_VECTOR_QUEUE_KEY: 'kim_v56_vector_jobs',
  MORIS_VECTOR_QUEUE_FAILED_KEY: 'kim_v58_vector_jobs_failed',
  MORIS_VECTOR_QUEUE_MAX_RETRIES: 4
};

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      CONFIG,
      sb:null, loading:false, loadingImages:false, saving:false,
      catalogueRequestSeq:0,
      notice:{type:'', text:''}, nowText:'',
      // Token chỉ nằm trong RAM. KHÔNG ghi localStorage/sessionStorage/cookie:
      // reload trang hoặc đóng tab => mất phiên => bắt buộc đăng nhập lại.
      // localStorage chỉ còn dùng cho hàng đợi vector (không chứa bí mật).
      session:{ token:'', user:null },
      loginForm:{ username:'', password:'' },
      filters:{ search:'', usage:'all', viewMode:'all' },
      parts:[], page:0, hasMore:false,
      detail:{ open:false, item:null, assets:[], tab:'front', activeAsset:null, flipped:false, zoom:1, panX:0, panY:0, rotX:-8, rotY:18, dragging:false, pointerId:null, startX:0, startY:0, startPanX:0, startPanY:0, startRotX:-8, startRotY:18, pinchStartDistance:0, pinchStartZoom:1 },
      editor:{ open:false, form:this.emptyForm(), assets:[], files:{}, previews:{}, vectorStatus:'', vectorBusy:false },
      bulkImport: { open: false, files: [], groups: [], uploading: false, progress: 0, current: 0, total: 0, successCount: 0, errorCount: 0, statusText: '' },
      
      // Cache lựa chọn đường upload để không health-check lặp lại mỗi ảnh.
      uploadRoute: { provider:'unknown', endpoint:'', checkedAt:0, health:'' },

      moris: {
        open:false,
        busy:false,
        status:'',
        input:'',
        imageDataUrl:'',
        imagePreview:'',
        imageName:'',
        imageFile:null,
        vectorStatus:'',
        messages:[
          {
            id:'moris-welcome',
            role:'assistant',
            text:'Chào anh, em là Moris. Em có thể giúp gì cho anh?'
          }
        ]
      },
      morisScan: {
        active: false,
        phase: '',
        phaseLabel: '',
        progress: 0,
        statusText: '',
        imageUrl: ''
      },
      morisSearch:{
        active:false,
        results:[],
        ids:[],
        summary:'',
        observation:null,
        updatedAt:null,
        queryId:'',
        mode:'',
        trace:null,
        imageHash:'',
        candidatePoolHash:''
      },
      pointerCache:null,

      // ---- Công cụ quy đổi định lượng (PCS <-> KG) ----
      weightCalc:{
        open:false,
        tab:'calc',            // 'calc' = màn LED, 'list' = danh sách đơn trọng
        list:[],               // MaterialWeight[] — nguồn dữ liệu chung của 2 tab
        loaded:false,
        loading:false,
        saving:false,
        selected:null,         // item đang nạp trong tab quy đổi
        form:{ code:'', pcs:null, kg:null },
        display:{ pcs:0, kg:0 }, // giá trị đang animate trên màn LED
        listFilter:'',
        draft:{ code:'', kg:'' },        // form thêm mới (tab list)
        editingId:null,                  // id đang sửa inline
        editDraft:{ code:'', kg:'' }
      }
    };
  },
  computed:{
    canEdit() { return ['admin','editor'].includes(this.session.user?.role_name); },

    // ---------------- Quy đổi định lượng ----------------
    /** Dropdown gợi ý mã trong tab quy đổi */
    calcCodes() {
      const w = this.weightCalc;
      const q = String(w.form.code ?? '').trim().toLowerCase();
      if (q.length < 2) return [];
      if (w.selected && String(w.selected.code).trim().toLowerCase() === q) return [];
      return w.list.filter(it => String(it.code).trim().toLowerCase().includes(q)).slice(0,5);
    },
    calcUnitWeightText() {
      const s = this.weightCalc.selected;
      return s ? Number(s.kg).toFixed(4) : null;
    },
    calcKgText() {
      return Number(this.weightCalc.display.kg || 0).toLocaleString('vi-VN', {minimumFractionDigits:4, maximumFractionDigits:4});
    },
    calcPcsText() {
      return Math.round(Number(this.weightCalc.display.pcs || 0)).toLocaleString('vi-VN');
    },
    /** Danh sách tham chiếu ở tab list (lọc theo ô tìm kiếm) */
    weightRows() {
      const w = this.weightCalc;
      const q = String(w.listFilter ?? '').trim().toLowerCase();
      const rows = q ? w.list.filter(it => String(it.code).toLowerCase().includes(q)) : w.list;
      return rows;
    },

    listStatusText() {
      if (this.morisSearch.active) {
        return `${this.morisSearch.results.length} mã từ Moris`;
      }
      return `Trang ${this.page + 1} · ${this.parts.length} mã đang render`;
    },
    displayedParts() {
      return this.morisSearch.active ? this.morisSearch.results : this.parts;
    },
    detailAssets() { return this.detail.assets.filter(a => a.asset_type === 'detail'); },
    activeAssetUrl() {
      if (this.detail.tab === 'detail') {
        return this.detail.activeAsset ? this.assetUrl(this.detail.activeAsset) : (this.detailAssets[0] ? this.assetUrl(this.detailAssets[0]) : '');
      }
      if (this.detail.tab === 'back') {
        return this.detail.item?.is_symmetric ? (this.assetTypeUrl('back') || this.assetTypeUrl('front')) : this.trueBackUrl;
      }
      if (this.detail.tab === 'front') return this.assetTypeUrl('front') || this.assetTypeUrl('back');
      return this.assetTypeUrl(this.detail.tab);
    },
    trueBackUrl() {
      const front = this.assetTypeUrl('front') || '';
      const back = this.assetTypeUrl('back') || '';
      if (!back) return '';
      return back === front ? '' : back;
    },
    hasBackView() {
      return !!(this.trueBackUrl || this.detail.item?.is_symmetric);
    },
    detailTabLabel() { return {front:'Mặt chính', back:'Mặt sau', detail:'Ảnh chi tiết'}[this.detail.tab] || 'Ảnh'; },
    viewerTransform() { return `transform: translate3d(${this.detail.panX}px, ${this.detail.panY}px, 0) scale(${this.detail.zoom});`; },

    editorPreview() {
      return this.editor.previews['front_1'] || this.assetPathUrl(this.findEditorAsset('front',1)?.image_path, this.findEditorAsset('front',1)?.storage_provider) || '';
    },
    editorAssetList() {
      const map = new Map();
      for (const a of this.editor.assets) map.set(`${a.asset_type}_${a.sort_order||1}`, {...a});
      for (const k of Object.keys(this.editor.previews)) {
        const [type, order] = k.split('_');
        map.set(k, { asset_type:type, sort_order:Number(order||1), preview:this.editor.previews[k], storage_provider:'r2', image_path:'' });
      }
      return [...map.values()].sort((a,b) => (this.assetSort(a)-this.assetSort(b)) || ((a.sort_order||1)-(b.sort_order||1)));
    }
  },
  async mounted() {
    this.sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    this.updateTime(); setInterval(this.updateTime, 30000);
    await this.checkSession();
    this.renderIcons();
  },
  updated() { this.renderIcons(); },
  methods:{
    emptyForm() { return { id:null, code:'', part_id:'', usage_side:'unknown', view_mode:'single_face', is_symmetric:false, identifying_features:'', confusing_note:'', image_path:'', image_name:'' }; },
    updateTime() { this.nowText = new Date().toLocaleString('vi-VN'); },
    renderIcons() { nextTick(() => lucide?.createIcons?.()); },
    toast(type,text) { 
      this.notice={type,text}; 
      // Auto close toast unless it's a processing state
      if(text && !text.includes('Đang')) setTimeout(()=>{ if(this.notice.text===text) this.notice={type:'',text:''}; }, 5500); 
    },
    readError(err) {
      const raw = err?.message || String(err) || 'Có lỗi xảy ra';
      if (/duplicate key|unique constraint|trùng|already exists/i.test(raw)) {
        return 'Mã này đã tồn tại trong hệ thống (vi phạm khóa chính). Vui lòng nhập mã khác.';
      }
      return raw;
    },
    // Lấy access_token Supabase Auth MỚI NHẤT.
    // Token hết hạn sau ~1h nên KHÔNG được cache; đọc lại trước mỗi lần gọi.
    async freshToken() {
      try {
        const { data } = await this.sb.auth.getSession();
        return data?.session?.access_token || '';
      } catch (_) { return ''; }
    },
    // Tự thay p_session_token bằng JWT hiện tại nếu tham số có mặt.
    async withAuth(args) {
      const a = { ...(args || {}) };
      if (a && Object.prototype.hasOwnProperty.call(a, 'p_session_token')) {
        a.p_session_token = await this.freshToken();
        this.session.token = a.p_session_token;
      }
      return a;
    },
    async rpcRow(fn,args) { const {data,error} = await this.sb.rpc(fn, await this.withAuth(args)); if(error) throw error; return Array.isArray(data) ? data[0] : data; },
    async rpcRows(fn,args) { const {data,error} = await this.sb.rpc(fn, await this.withAuth(args)); if(error) throw error; return data || []; },
    // Đăng nhập qua Supabase Auth (password). Rate-limit/do sai mật khẩu do
    // GoTrue xử lý. app_users KHÔNG còn là nguồn danh tính.
    async loginRow(username,password) {
      const { data, error } = await this.sb.auth.signInWithPassword({ email: username, password });
      if (error) {
        const e = new Error(
          error.message === 'Invalid login credentials'
            ? 'Tên đăng nhập hoặc mật khẩu không đúng.'
            : error.message
        );
        e.status = error.status || 400;
        throw e;
      }
      return { ok:true, session_token: data.session.access_token, user_id: data.user.id };
    },

    async checkSession() {
      // Supabase Auth tự lưu/đồng bộ session; đọc lại token hiện tại.
      const token = await this.freshToken();
      if (!token) {
        if (CONFIG.AUTO_LOGIN_ENABLED && CONFIG.AUTO_LOGIN_USERNAME) {
          await this.autoLogin();
        }
        return;
      }
      this.session.token = token;
      try {
        const me = await this.rpcRow('app_me', {p_session_token: token});
        if (!me?.ok) throw new Error(me?.message || 'Session hết hạn');
        this.session.user = me;
        await this.loadParts(true);

        // Retry các vector job còn tồn tại từ lần save trước.
        setTimeout(() => {
          this.processMorisVectorQueue().catch(
            error => console.warn('Moris vector queue retry failed', error)
          );
        }, 1200);
      } catch(e) { this.session.token=''; this.session.user=null; }
    },
    async login() {
      this.loading=true;
      try {
        const row = await this.loginRow(this.loginForm.username, this.loginForm.password);
        if (!row?.ok) throw new Error(row?.message || 'Đăng nhập thất bại');
        this.session.token = row.session_token; // chỉ giữ trong RAM
        await this.checkSession();
        this.toast('success','Đăng nhập thành công.');
      } catch(e) { this.toast('error', this.readError(e)); } finally { this.loading=false; }
    },
    async autoLogin() {
      try {
        const row = await this.loginRow(CONFIG.AUTO_LOGIN_USERNAME, CONFIG.AUTO_LOGIN_PASSWORD);
        if (!row?.ok || !row?.session_token) return; // Thất bại → hiện form đăng nhập thủ công
        this.session.token = row.session_token; // chỉ giữ trong RAM
        await this.checkSession(); // Luồng chuẩn: app_me + loadParts + retry vector queue
      } catch (_) {
        this.session.token = '';
        this.session.user = null; // Hiện form đăng nhập thủ công
      }
    },
    async logout() {
      // Supabase Auth: signOut() mới thực sự huỷ refresh token phía máy chủ.
      try { await this.sb.auth.signOut(); } catch(_) {}
      this.session={token:'',user:null}; this.parts=[];
    },

    // ================================================================
    // CÔNG CỤ QUY ĐỔI ĐỊNH LƯỢNG (PCS <-> KG)
    // Port từ weight-calculator.zip (useWeightCalculator.ts + Modal.vue)
    // sang Vue 3 Options API + lucide, không TypeScript.
    // ================================================================
    openWeightCalc() {
      this.weightCalc.open = true;
      this.weightCalc.tab = 'calc';
      if (!this.weightCalc.loaded) this.loadWeights();
    },
    closeWeightCalc() {
      this.wcCancelAnim();
      this.weightCalc.open = false;
    },
    async loadWeights() {
      const w = this.weightCalc;
      if (w.loading) return;
      w.loading = true;
      try {
        const { data, error } = await this.sb.from('material_weights')
          .select('id,code,kg').order('code', { ascending:true });
        if (error) throw error;
        w.list = (data || []).map(r => ({ id:r.id, code:r.code, kg:Number(r.kg) }));
        w.loaded = true;
      } catch(e) {
        console.error('Không tải được danh sách đơn trọng:', e);
        this.toast('error', 'Không tải được danh sách đơn trọng: ' + this.readError(e));
      } finally { w.loading = false; }
    },

    // -------------------------------------------------- animation màn LED
    wcCancelAnim() {
      const f = this._wcFrames;
      if (!f) return;
      for (const k of ['pcs','kg']) { if (f[k] !== null) { cancelAnimationFrame(f[k]); f[k] = null; } }
    },
    wcAnimate(type, target) {
      if (!this._wcFrames) this._wcFrames = { pcs:null, kg:null };
      const start = this.weightCalc.display[type];
      const duration = 250;
      const startTime = performance.now();
      const run = (now) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const value = start + (target - start) * progress;
        this.weightCalc.display[type] = type === 'pcs' ? Math.round(value) : Number(value.toFixed(4));
        if (progress < 1) { this._wcFrames[type] = requestAnimationFrame(run); }
        else { this.weightCalc.display[type] = target; this._wcFrames[type] = null; }
      };
      if (this._wcFrames[type] !== null) cancelAnimationFrame(this._wcFrames[type]);
      this._wcFrames[type] = requestAnimationFrame(run);
    },
    wcAnimateBoth(pcs, kg) { this.wcAnimate('pcs', pcs); this.wcAnimate('kg', kg); },

    // -------------------------------------------------- tab Quy đổi
    wcSelect(item) {
      const w = this.weightCalc;
      w.selected = item;
      w.form.code = item.code;
      w.form.pcs = null;
      w.form.kg = null;
      this.wcAnimateBoth(0, 0);
    },
    /** Gõ tay mã -> tự khớp đúng exact (hoặc bỏ chọn nếu không còn khớp) */
    wcCodeChanged() {
      const w = this.weightCalc;
      if (!w.form.code) { w.selected = null; this.wcAnimateBoth(0,0); return; }
      const q = String(w.form.code).trim().toLowerCase();
      const match = w.list.find(it => String(it.code).trim().toLowerCase() === q) || null;
      w.selected = match;
      if (!match) return;
      if (w.form.pcs !== null && w.form.pcs !== '' && !Number.isNaN(Number(w.form.pcs))) this.wcOnPcs();
      else if (w.form.kg !== null && w.form.kg !== '' && !Number.isNaN(Number(w.form.kg))) this.wcOnKg();
    },
    wcCodeEnter() {
      if (this.calcCodes.length > 0) { this.wcSelect(this.calcCodes[0]); return; }
      const q = String(this.weightCalc.form.code).trim().toLowerCase();
      const exact = this.weightCalc.list.find(it => String(it.code).trim().toLowerCase() === q);
      if (exact) this.wcSelect(exact);
    },
    /** PCS -> KG */
    wcOnPcs() {
      const w = this.weightCalc;
      const raw = w.form.pcs;
      if (!w.selected || raw === null || raw === '' || Number.isNaN(Number(raw))) { this.wcAnimateBoth(0,0); return; }
      const pcs = Number(raw);
      const unit = Number(w.selected.kg);
      const targetKg = Number((pcs * unit).toFixed(4));
      this.wcAnimateBoth(pcs, targetKg);
    },
    /** KG -> PCS */
    wcOnKg() {
      const w = this.weightCalc;
      const raw = w.form.kg;
      if (!w.selected || raw === null || raw === '' || Number.isNaN(Number(raw))) { this.wcAnimateBoth(0,0); return; }
      const unit = Number(w.selected.kg);
      if (unit === 0) return; // tránh chia cho 0 (CSV có 2 mã kg = 0)
      const kg = Number(raw);
      this.wcAnimateBoth(Math.round(kg / unit), kg);
    },
    wcReset() {
      const w = this.weightCalc;
      w.form.code = ''; w.form.pcs = null; w.form.kg = null; w.selected = null;
      this.wcAnimateBoth(0,0);
    },
    /** Chọn 1 mã từ tab list -> nhảy sang tab quy đổi với mã đó */
    wcUseInCalc(row) {
      const w = this.weightCalc;
      w.tab = 'calc';
      const item = w.list.find(it => it.id === row.id) || row;
      this.wcSelect(item);
      w.form.code = row.code;
    },

    // -------------------------------------------------- tab Danh sách
    wcStartEdit(row) {
      this.weightCalc.editingId = row.id;
      this.weightCalc.editDraft = { code:String(row.code), kg:String(row.kg) };
    },
    wcCancelEdit() { this.weightCalc.editingId = null; },
    async wcSaveNew() {
      const w = this.weightCalc;
      const code = String(w.draft.code ?? '').trim();
      const kg = Number(w.draft.kg);
      if (!code) return this.toast('error','Thiếu mã hàng.');
      if (w.list.some(it => String(it.code).toLowerCase() === code.toLowerCase()))
        return this.toast('error','Mã này đã có trong danh sách.');
      if (!Number.isFinite(kg) || kg < 0) return this.toast('error','Đơn trọng phải là số >= 0 (kg/pcs).');
      w.saving = true;
      try {
        const { data, error } = await this.sb.from('material_weights')
          .insert({ code, kg }).select('id,code,kg').single();
        if (error) throw error;
        w.list.push({ id:data.id, code:data.code, kg:Number(data.kg) });
        w.list.sort((a,b) => String(a.code).localeCompare(String(b.code)));
        w.draft = { code:'', kg:'' };
        w.loaded = true;
        this.toast('success', `Đã thêm ${code} (${Number(data.kg).toFixed(4)} kg/pcs).`);
      } catch(e) { this.toast('error', this.readError(e)); }
      finally { w.saving = false; }
    },
    async wcSaveEdit(row) {
      const w = this.weightCalc;
      const code = String(w.editDraft.code ?? '').trim();
      const kg = Number(w.editDraft.kg);
      if (!code) return this.toast('error','Thiếu mã hàng.');
      if (!Number.isFinite(kg) || kg < 0) return this.toast('error','Đơn trọng phải là số >= 0 (kg/pcs).');
      const dup = w.list.find(it => it.id !== row.id && String(it.code).toLowerCase() === code.toLowerCase());
      if (dup) return this.toast('error','Mã này đã có trong danh sách.');
      w.saving = true;
      try {
        const { error } = await this.sb.from('material_weights')
          .update({ code, kg }).eq('id', row.id);
        if (error) throw error;
        row.code = code; row.kg = kg;
        w.list.sort((a,b) => String(a.code).localeCompare(String(b.code)));
        // Đồng bộ với tab quy đổi nếu đang chọn đúng mã này
        if (w.selected && w.selected.id === row.id) { w.selected = row; w.form.code = code; this.wcCodeChanged(); }
        w.editingId = null;
        this.toast('success', `Đã cập nhật ${code}.`);
      } catch(e) { this.toast('error', this.readError(e)); }
      finally { w.saving = false; }
    },
    async wcDelete(row) {
      if (!confirm(`Xoá ${row.code} (${Number(row.kg).toFixed(4)} kg/pcs) khỏi danh sách đơn trọng?`)) return;
      const w = this.weightCalc;
      w.saving = true;
      try {
        const { error } = await this.sb.from('material_weights').delete().eq('id', row.id);
        if (error) throw error;
        w.list = w.list.filter(it => it.id !== row.id);
        if (w.selected && w.selected.id === row.id) { w.selected = null; w.form.code = ''; this.wcAnimateBoth(0,0); }
        this.toast('success', `Đã xoá ${row.code}.`);
      } catch(e) { this.toast('error', this.readError(e)); }
      finally { w.saving = false; }
    },


    usageLabel(v) { return {left:'Bên trái', right:'Bên phải', both:'Cả hai bên', unknown:'Chưa xác định'}[v] || 'Chưa xác định'; },
    viewModeLabel(v) { return {single_face:'1 mặt', dual_face:'2 mặt', detail_set:'Chi tiết'}[v] || '1 mặt'; },
    assetSort(a) { return {thumb:0, front:1, back:2, detail:3, compare:4}[a.asset_type] ?? 9; },
    encodeObjectKey(path) {
      return String(path || '')
        .replace(/^\/+/, '')
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
    },

    assetPathUrl(path, provider='r2') {
      if (!path) return '';
      if (/^https?:\/\//i.test(path)) return path;

      const clean = String(path).replace(/^\/+/, '');

      if ((provider || 'r2') === 'r2') {
        const encodedKey = this.encodeObjectKey(clean);
        return `${CONFIG.R2_MEDIA_BASE_URL}/${encodedKey}`;
      }

      const { data } = this.sb.storage
        .from(CONFIG.SUPABASE_BUCKET_FALLBACK)
        .getPublicUrl(clean);

      return data?.publicUrl || '';
    },
    assetUrl(asset) { return this.assetPathUrl(asset?.image_path, asset?.storage_provider); },
    partThumbUrl(item) { return this.assetPathUrl(item.thumb_path || item.front_path || item.fallback_path, item.thumb_provider || item.front_provider || item.fallback_provider || 'r2'); },
    findAsset(type, order=1) { return this.detail.assets.find(a => a.asset_type===type && Number(a.sort_order||1)===order) || null; },
    assetTypeUrl(type) { const a = type==='detail' ? this.detailAssets[0] : this.findAsset(type,1); return a ? this.assetUrl(a) : ''; },
    findEditorAsset(type, order=1) { return this.editor.assets.find(a => a.asset_type===type && Number(a.sort_order||1)===order) || null; },

    async loadParts(reset=false) {
      if (reset) this.page = 0;

      const requestSeq = ++this.catalogueRequestSeq;
      this.loadingImages = true;

      try {
        // Lấy dư 1 row để biết chắc còn trang sau hay không.
        // DOM vẫn chỉ render đúng CONFIG.PAGE_LIMIT rows.
        const rows = await this.rpcRows('app_search_catalogue', {
          p_session_token:this.session.token,
          p_search:this.filters.search || '',
          p_usage_side:this.filters.usage,
          p_view_mode:this.filters.viewMode,
          p_limit:CONFIG.PAGE_LIMIT + 1,
          p_offset:this.page * CONFIG.PAGE_LIMIT
        });

        // Search/filter cũ trả về trễ không được ghi đè request mới.
        if (requestSeq !== this.catalogueRequestSeq) return;

        this.hasMore = rows.length > CONFIG.PAGE_LIMIT;
        this.parts = rows.slice(0, CONFIG.PAGE_LIMIT);
      } catch(e) {
        if (requestSeq === this.catalogueRequestSeq) {
          this.toast('error', this.readError(e));
        }
      } finally {
        if (requestSeq === this.catalogueRequestSeq) {
          this.loadingImages = false;
          this.renderIcons();
        }
      }
    },
    async goPage(delta) {
      if (this.loadingImages || this.morisSearch.active) return;

      const nextPage = this.page + Number(delta || 0);
      if (nextPage < 0) return;
      if (delta > 0 && !this.hasMore) return;

      this.page = nextPage;
      await this.loadParts(false);

      const appTop = document.querySelector('main');
      appTop?.scrollIntoView?.({behavior:'smooth', block:'start'});
    },
    async loadMore() {
      // Alias rollback-safe cho code cũ; không còn concat DOM.
      await this.goPage(1);
    },

    // --- Detail Viewer ---
    async openDetail(item) {
      this.detail = {open:true, item, assets:[], tab:'front', activeAsset:null, flipped:false, zoom:1, panX:0, panY:0, rotX:-8, rotY:18, dragging:false, pointerId:null, startX:0, startY:0, startPanX:0, startPanY:0, startRotX:-8, startRotY:18, pinchStartDistance:0, pinchStartZoom:1};
      try {
        this.detail.assets = await this.rpcRows('app_get_part_assets', {p_session_token:this.session.token, p_image_id:item.id});
        if (!this.assetTypeUrl('front') && this.assetTypeUrl('back')) this.detail.tab='back';
      } catch(e) { this.toast('error', this.readError(e)); }
      this.renderIcons();
    },
    closeDetail() { this.resetViewer(); this.detail.open=false; this.detail.assets=[]; this.detail.item=null; },
    setDetailTab(t) { this.detail.tab=t; if(t==='detail') this.detail.activeAsset=this.detailAssets[0] || null; this.resetViewer(); },
    tabBtnClass(t) { return ['btn h-10 px-3 text-xs sm:text-sm border transition-colors', this.detail.tab===t ? 'bg-emerald-600 text-white border-emerald-700 shadow-inner' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'].join(' '); },
    clamp(n,min,max) { return Math.max(min, Math.min(max, n)); },
    ensurePointerCache() {
      if (!this.pointerCache) this.pointerCache = new Map();
      return this.pointerCache;
    },
    resetViewer() {
      this.detail.zoom = 1; this.detail.panX = 0; this.detail.panY = 0;
      this.detail.rotX = -8; this.detail.rotY = 18;
      this.detail.startRotX = -8; this.detail.startRotY = 18;
      this.detail.dragging = false; this.detail.pointerId = null; this.detail.pinchStartDistance = 0;
      const cache = this.ensurePointerCache(); cache.clear();
    },
    zoomIn() { this.detail.zoom = this.clamp(this.detail.zoom * 1.25, 1, 8); },
    zoomOut() {
      this.detail.zoom = this.clamp(this.detail.zoom / 1.25, 1, 8);
      if (this.detail.zoom === 1) { this.detail.panX = 0; this.detail.panY = 0; }
    },
    onViewerWheel(e) {
      const delta = e.deltaY < 0 ? 1.12 : 0.88;
      this.detail.zoom = this.clamp(this.detail.zoom * delta, 1, 8);
      if (this.detail.zoom === 1) { this.detail.panX = 0; this.detail.panY = 0; }
    },
    pointerDistance(cache) {
      const pts = [...cache.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    },
    onViewerPointerDown(e) {
      const cache = this.ensurePointerCache();
      e.currentTarget?.setPointerCapture?.(e.pointerId);
      cache.set(e.pointerId, {x:e.clientX, y:e.clientY});
      this.detail.dragging = true;

      if (cache.size === 1) {
        this.detail.pointerId = e.pointerId;
        this.detail.startX = e.clientX; this.detail.startY = e.clientY;
        this.detail.startPanX = this.detail.panX; this.detail.startPanY = this.detail.panY;
        this.detail.startRotX = this.detail.rotX; this.detail.startRotY = this.detail.rotY;
      }
      if (cache.size === 2) {
        this.detail.pinchStartDistance = this.pointerDistance(cache);
        this.detail.pinchStartZoom = this.detail.zoom;
      }
    },
    onViewerPointerMove(e) {
      const cache = this.ensurePointerCache();
      if (!cache.has(e.pointerId)) return;
      cache.set(e.pointerId, {x:e.clientX, y:e.clientY});

      if (cache.size >= 2 && this.detail.pinchStartDistance > 0) {
        const dist = this.pointerDistance(cache);
        if (dist > 0) this.detail.zoom = this.clamp(this.detail.pinchStartZoom * (dist / this.detail.pinchStartDistance), 1, 8);
        return;
      }

      if (this.detail.dragging && e.pointerId === this.detail.pointerId) {
        const dx = e.clientX - this.detail.startX;
        const dy = e.clientY - this.detail.startY;

        this.detail.panX = this.detail.startPanX + dx;
        this.detail.panY = this.detail.startPanY + dy;
      }
    },
    onViewerPointerUp(e) {
      const cache = this.ensurePointerCache();
      try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch(_) {}
      cache.delete(e.pointerId);

      if (cache.size === 0) {
        this.detail.dragging = false; this.detail.pointerId = null; this.detail.pinchStartDistance = 0;
        return;
      }
      if (cache.size === 1) {
        const [id, pt] = [...cache.entries()][0];
        this.detail.pointerId = id;
        this.detail.startX = pt.x; this.detail.startY = pt.y;
        this.detail.startPanX = this.detail.panX; this.detail.startPanY = this.detail.panY;
        this.detail.startRotX = this.detail.rotX; this.detail.startRotY = this.detail.rotY;
        this.detail.pinchStartDistance = 0;
      }
    },

    // --- Editor & API Tách Nền ---
    async openEditor(item=null) {
      if(!this.canEdit) return this.toast('error','Tài khoản không có quyền.');
      this.clearEditorFiles();
      this.editor.open=true;
      if(item) {
        this.editor.form = { id:item.id, code:item.code || '', part_id:item.part_id || '', usage_side:item.usage_side || 'unknown', view_mode:item.view_mode || 'single_face', is_symmetric:!!item.is_symmetric, identifying_features:item.identifying_features || '', confusing_note:item.confusing_note || '', image_path:item.fallback_path || '', image_name:'' };
        try { this.editor.assets = await this.rpcRows('app_get_part_assets', {p_session_token:this.session.token, p_image_id:item.id}); } catch(e) { this.editor.assets=[]; }
      } else {
        this.editor.form = this.emptyForm();
        this.editor.assets = [];
      }
      this.renderIcons();
    },
    closeEditor() { this.editor.open=false; this.clearEditorFiles(); },
    clearEditorFiles() {
      for (const src of Object.values(this.editor?.previews || {})) { try { URL.revokeObjectURL(src); } catch(_) {} }
      if (this.editor) { this.editor.files={}; this.editor.previews={}; }
    },
    
    async onFileChange(type, order, e) {
      let file = e.target.files?.[0]; e.target.value=''; if(!file) return;
      
      const key = `${type}_${order}`;
      if(this.editor.previews[key]) URL.revokeObjectURL(this.editor.previews[key]);
      
      this.editor.files[key]=file;
      this.editor.previews[key]=URL.createObjectURL(file);
      
      if(!this.editor.form.code) this.editor.form.code = this.codeFromFilename(file.name);
      if(type==='back' && this.editor.form.view_mode === 'single_face') this.editor.form.view_mode='dual_face';
      if(type==='detail') this.editor.form.view_mode='detail_set';
    },
    codeFromFilename(name) { return String(name||'').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g,'').toUpperCase(); },

    // --- Compress & Upload ---
    async compressImageToWebp(file, maxEdge=1600, quality=.88) {
      if(!file?.type?.startsWith('image/')) return file;
      const img = new Image(); const objectUrl = URL.createObjectURL(file);
      try {
        await new Promise((resolve,reject)=>{ img.onload=resolve; img.onerror=reject; img.src=objectUrl; });
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
        const ctx = canvas.getContext('2d', {alpha:true}); ctx.clearRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if(!blob) return file;
        const base = String(file.name||'image').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g,'_');
        return new File([blob], `${base}.webp`, {type:'image/webp'});
      } finally { URL.revokeObjectURL(objectUrl); }
    },
    async makeThumbFile(file) { return this.compressImageToWebp(file, 460, .75); },
    
    async fetchWithTimeout(url, options={}, timeoutMs=3500) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {...options, signal:controller.signal});
      } finally {
        clearTimeout(timer);
      }
    },

    async resolveUploadProvider(force=false) {
      const now = Date.now();
      const ttl = Number(CONFIG.UPLOAD_HEALTH_TTL_MS || 60000);

      if (
        !force &&
        this.uploadRoute.endpoint &&
        (now - Number(this.uploadRoute.checkedAt || 0)) < ttl
      ) {
        return this.uploadRoute;
      }

      // 1) Ưu tiên Pages Function cùng origin.
      try {
        const res = await this.fetchWithTimeout(
          CONFIG.UPLOAD_HEALTH_URL,
          {
            method:'GET',
            headers:{'accept':'application/json'},
            cache:'no-store'
          },
          2500
        );
        const data = await res.json().catch(() => null);

        if (res.ok && data?.ok && data?.provider === 'pages-r2') {
          this.uploadRoute = {
            provider:'pages-r2',
            endpoint:CONFIG.UPLOAD_PRIMARY_URL,
            checkedAt:now,
            health:'healthy'
          };
          return this.uploadRoute;
        }
      } catch (_) {
        // App cũ/GitHub Pages có thể chưa có Pages Function.
      }

      // 2) Fallback có kiểm soát về Worker cũ.
      // Không POST thử rồi mới fallback để tránh upload trùng.
      this.uploadRoute = {
        provider:'legacy-worker',
        endpoint:`${String(CONFIG.R2_WORKER_URL || '').replace(/\/+$/,'')}/upload`,
        checkedAt:now,
        health:'fallback'
      };
      return this.uploadRoute;
    },

    async uploadToR2(file, code, assetType) {
      const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '');
      const maxEdge = assetType === 'thumb' ? 420 : (assetType === 'detail' ? (isIOS ? 1100 : 1300) : (isIOS ? 1400 : 1600));
      const quality = assetType === 'thumb' ? .75 : (isIOS ? .85 : .90);

      const prepared = assetType === 'thumb'
        ? await this.makeThumbFile(file)
        : await this.compressImageToWebp(file, maxEdge, quality);

      const route = await this.resolveUploadProvider(false);
      if (!route?.endpoint) throw new Error('Không tìm thấy đường upload khả dụng.');

      const form = new FormData();
      form.append('file', prepared);
      form.append('code', code);
      form.append('asset_type', assetType);

      const uploadId = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      form.append('upload_id', uploadId);

      let res;
      try {
        res = await this.fetchWithTimeout(
          route.endpoint,
          {
            method:'POST',
            headers:{
              'x-session-token':this.session.token,
              'x-upload-id':uploadId
            },
            body:form
          },
          30000
        );
      } catch (e) {
        // Không tự POST lại sang provider khác:
        // request đầu có thể đã ghi R2 nhưng response bị mất.
        throw new Error(
          `Upload qua ${route.provider} thất bại: ${e?.name === 'AbortError' ? 'quá thời gian chờ' : this.readError(e)}`
        );
      }

      const data = await res.json().catch(()=>({}));
      if(!res.ok || !data.ok) {
        throw new Error(
          data.message || `Lỗi upload R2 qua ${route.provider} (HTTP ${res.status})`
        );
      }

      return {
        asset_type:data.asset_type || assetType,
        storage_provider:'r2',
        bucket_name:'catalogue-images',
        image_path:data.image_path,
        image_name:data.image_name || prepared.name
      };
    },
    mergeAsset(list, asset, sortOrder=1) {
      const idx = list.findIndex(a => a.asset_type===asset.asset_type && Number(a.sort_order||1)===sortOrder);
      const row = {...asset, sort_order:sortOrder};
      if(idx>=0) list.splice(idx,1,row); else list.push(row);
    },

    async savePart() {
      if(!this.canEdit) return;
      this.saving=true;
      try {
        const code = this.editor.form.code.trim().toUpperCase();
        if(!code) throw new Error('Cần nhập mã sản phẩm.');

        // Kiểm tra trùng mã khi thêm mới (không có id): báo lỗi trong app, không dùng alert trình duyệt.
        if(!this.editor.form.id) {
          const existing = await this.rpcRows('app_search_catalogue', {
            p_session_token:this.session.token,
            p_search:code,
            p_usage_side:'',
            p_view_mode:'',
            p_limit:CONFIG.PAGE_LIMIT,
            p_offset:0
          });
          const dup = existing.find(r => (r.code || '').toUpperCase() === code);
          if(dup) throw new Error(`Mã "${code}" đã tồn tại trong hệ thống. Vui lòng nhập mã khác.`);
        }

        let assets = this.editor.assets.map(a => ({ asset_type:a.asset_type, storage_provider:a.storage_provider || 'r2', bucket_name:a.bucket_name || 'catalogue-images', image_path:a.image_path, image_name:a.image_name || null, sort_order:Number(a.sort_order||1) }));

        for(const [key,file] of Object.entries(this.editor.files)) {
          const [type, orderRaw] = key.split('_');
          const uploaded = await this.uploadToR2(file, code, type);
          this.mergeAsset(assets, uploaded, Number(orderRaw||1));
          if(type === 'front') {
            const thumb = await this.uploadToR2(file, code, 'thumb');
            this.mergeAsset(assets, thumb, 1);
          }
        }
        assets = assets.filter(a => a.image_path);
        const primary = assets.find(a => a.asset_type==='thumb') || assets.find(a => a.asset_type==='front') || assets[0];
        if(!primary) throw new Error('Cần có ảnh mặt chính/front hoặc giữ lại ảnh cũ.');

        const saved = await this.rpcRow('app_upsert_part_metadata', {
          p_session_token:this.session.token,
          p_id:this.editor.form.id,
          p_code:code,
          p_part_id:this.editor.form.part_id || null,
          p_usage_side:this.editor.form.usage_side || 'unknown',
          p_view_mode:this.editor.form.view_mode || 'single_face',
          p_is_symmetric:!!this.editor.form.is_symmetric,
          p_identifying_features:this.editor.form.identifying_features || null,
          p_confusing_note:this.editor.form.confusing_note || null,
          p_primary_image_path:primary.image_path,
          p_primary_image_name:primary.image_name || null
        });
        if(!saved?.ok) throw new Error(saved?.message || 'Không lưu được data vào Database.');

        const rep = await this.rpcRow('app_replace_part_assets', { p_session_token:this.session.token, p_image_id:saved.id, p_assets:assets });
        if(!rep?.ok) throw new Error(rep?.message || 'Không liên kết được hình ảnh.');

        this.toast('success','Lưu dữ liệu thành công!');

        // Ghi vào hàng đợi persisted để không mất job khi reload/tab đóng.
        this.enqueueMorisVectorJob(saved.id, assets, code);

        this.toast(
          'success',
          'Lưu thành công. Vector hình ảnh đã được đưa vào hàng đợi xử lý.'
        );

        this.processMorisVectorQueue()
          .catch(error => console.warn('Moris vector queue failed', error));

        this.closeEditor(); this.closeDetail(); await this.loadParts(true);
      } catch(e) { this.toast('error', this.readError(e)); } finally { this.saving=false; }
    },
    async deleteCurrentPart() {
      if(!this.detail.item || !confirm('Xác nhận xóa data của mã này? (Ảnh gốc trên Cloud sẽ không bị xóa để phòng ngừa lỗi rủi ro).')) return;
      try {
        const row = await this.rpcRow('app_delete_part', {p_session_token:this.session.token, p_image_id:this.detail.item.id});
        if(!row?.ok) throw new Error(row?.message || 'Không xóa được.');
        this.toast('success','Đã xóa thành công.'); this.closeDetail(); await this.loadParts(true);
      } catch(e) { this.toast('error', this.readError(e)); }
    },

    // --- BULK IMPORT ---
    openBulkImport() {
      if(!this.canEdit) return this.toast('error','Tài khoản không có quyền.');
      this.bulkImport = { open: true, files: [], groups: [], uploading: false, progress: 0, current: 0, total: 0, successCount: 0, errorCount: 0, statusText: '' };
      this.renderIcons();
    },
    closeBulkImport() {
      this.bulkImport.open = false;
    },
    onBulkFileSelect(e) {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      if(!files.length) return;
      
      const groupsMap = {};
      for(let f of files) {
        let name = f.name.replace(/\.[^.]+$/, '');
        let type = 'front';
        let code = name.toUpperCase();
        
        if (name.toLowerCase().endsWith('-back')) {
          code = name.substring(0, name.length - 5).toUpperCase();
          type = 'back';
        }
        
        if(!groupsMap[code]) groupsMap[code] = { code, front: null, back: null };
        groupsMap[code][type] = f;
      }
      
      this.bulkImport.groups = Object.values(groupsMap).sort((a, b) => a.code.localeCompare(b.code));
      this.renderIcons();
    },

    // ===============================================================
    // MORIS — Client bridge to server-side Catalogue AI Harness
    // ===============================================================
    openMoris() {
      this.moris.open = true;
      this.$nextTick(() => {
        this.renderIcons();
        this.scrollMorisToBottom();
      });
    },

    closeMoris() {
      this.moris.open = false;
    },

    useMorisSuggestion(text) {
      this.moris.input = text;
      this.$nextTick(() => this.sendMorisMessage());
    },

    triggerMorisImage() {
      this.$refs.morisImageInput?.click();
    },

    async onMorisImageSelect(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      try {
        this.moris.status = 'Đang chuẩn bị ảnh...';
        const dataUrl = await this.prepareMorisImage(file);
        this.moris.imageDataUrl = dataUrl;
        this.moris.imagePreview = dataUrl;
        this.moris.imageName = file.name || 'query-image';
        this.moris.imageFile = file;
      } catch (e) {
        this.toast('error', `Không chuẩn bị được ảnh cho Moris: ${this.readError(e)}`);
      } finally {
        this.moris.status = '';
        if (event?.target) event.target.value = '';
        this.$nextTick(() => this.renderIcons());
      }
    },

    async prepareMorisImage(file) {
      if (!file?.type?.startsWith('image/')) throw new Error('Chỉ hỗ trợ file ảnh.');
      const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '');
      const maxEdge = isIOS ? 1280 : 1536;
      const quality = isIOS ? .80 : .84;

      const img = new Image();
      const url = URL.createObjectURL(file);
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Không đọc được ảnh.'));
          img.src = url;
        });

        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', {alpha:false});
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,width,height);
        ctx.drawImage(img,0,0,width,height);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        canvas.width = 1;
        canvas.height = 1;
        if (!blob) throw new Error('Không nén được ảnh.');

        if (blob.size > 3 * 1024 * 1024) {
          throw new Error('Ảnh sau tối ưu vẫn lớn hơn 3 MB.');
        }

        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Không chuyển được ảnh.'));
          reader.readAsDataURL(blob);
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    },

    clearMorisImage() {
      this.moris.imageDataUrl = '';
      this.moris.imagePreview = '';
      this.moris.imageName = '';
      this.moris.imageFile = null;
      this.$nextTick(() => this.renderIcons());
    },

    scrollMorisToBottom() {
      this.$nextTick(() => {
        const el = this.$refs.morisThread;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },

    morisCandidatePercent(candidate) {
      const match = Number(candidate?.match_score);
      const vector = Number(candidate?.vector_similarity);
      const final = Number(candidate?.compatibility_score ?? candidate?.final_score);

      const score =
        Number.isFinite(match) && match > 0
          ? match
          : (
              Number.isFinite(final) && final > 0
                ? final
                : (
                    Number.isFinite(vector) && vector > 0
                      ? vector
                      : null
                  )
            );

      if (score == null) return null;
      return Math.max(0, Math.min(100, Math.round(score * 100)));
    },

    isMorisMobileDevice() {
      return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent || '')
        || (navigator.maxTouchPoints || 0) > 1;
    },

    async loadMorisBrowserVectorModule() {
      if (!CONFIG.MORIS_BROWSER_VECTOR_ENABLED) {
        throw new Error('Browser vector đang tắt.');
      }

      if (!this._morisVectorModulePromise) {
        this._morisVectorModulePromise = import(
          CONFIG.MORIS_BROWSER_VECTOR_MODULE_URL
        );
      }

      try {
        return await this._morisVectorModulePromise;
      } catch (error) {
        this._morisVectorModulePromise = null;
        throw error;
      }
    },

    async getMorisVectorReadiness({force=false}={}) {
      const now = Date.now();

      if (
        !force &&
        this._morisVectorHealthCache &&
        (
          now - Number(this._morisVectorHealthCacheAt || 0)
        ) < CONFIG.MORIS_VECTOR_HEALTH_TTL_MS
      ) {
        return this._morisVectorHealthCache;
      }

      const res = await this.fetchWithTimeout(
        '/api/moris/health',
        {method:'GET'},
        30000
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(
          data?.error ||
          `Moris health HTTP ${res.status}`
        );
      }

      this._morisVectorHealthCache = data;
      this._morisVectorHealthCacheAt = now;

      return data;
    },

    async buildMorisQueryVector(imageDataUrl) {
      if (!CONFIG.MORIS_QUERY_VECTOR_BRIDGE_ENABLED) {
        const error = new Error('Query Vector Bridge đang tắt.');
        error.code = 'MORIS_QUERY_VECTOR_BRIDGE_DISABLED';
        throw error;
      }

      const health = await this.getMorisVectorReadiness();
      const enabled =
        health?.vector_search_enabled === true ||
        health?.features?.vectorSearch === true;

      if (!enabled) {
        const error = new Error('MORIS_VECTOR_SEARCH_ENABLED=false.');
        error.code = 'MORIS_VECTOR_SEARCH_DISABLED';
        throw error;
      }

      const mod = await this.loadMorisBrowserVectorModule();
      const result = await mod.embedImageDinov2Variants(
        imageDataUrl,
        {includeGray:true}
      );

      const probes = Array.isArray(result?.probes)
        ? result.probes
        : [];

      if (!probes.length) {
        const error = new Error('Không tạo được query probes.');
        error.code = 'MORIS_QUERY_VECTOR_INVALID';
        throw error;
      }

      for (const probe of probes) {
        if (!Array.isArray(probe?.embedding) || probe.embedding.length !== 384) {
          const error = new Error('Query embedding sai dimension.');
          error.code = 'MORIS_QUERY_VECTOR_INVALID';
          throw error;
        }
      }

      return {
        embedding:probes[0].embedding,
        profile:probes[0].profile,
        probes,
        diagnostics:result?.diagnostics || null
      };
    },

    morisPublicImageSearchError(error) {
      const code = String(error?.code || '');

      if (code === 'MORIS_VECTOR_SEARCH_DISABLED') {
        return (
          'Xin lỗi anh, tìm kiếm bằng hình ảnh chưa được bật trên hệ thống.'
        );
      }

      if (
        code === 'MORIS_QUERY_VECTOR_BRIDGE_DISABLED' ||
        code === 'MORIS_QUERY_VECTOR_INVALID' ||
        code === 'MORIS_QUERY_VECTOR_PROFILE_INVALID'
      ) {
        return (
          'Xin lỗi anh, em chưa tạo được vector phù hợp cho ảnh này. ' +
          'Anh thử lại với ảnh rõ vật thể hơn giúp em nhé.'
        );
      }

      return (
        'Xin lỗi anh, em chưa thể xử lý tìm kiếm hình ảnh lúc này. ' +
        'Anh thử lại giúp em nhé.'
      );
    },

    async embedMorisImage(image) {
      const mod = await this.loadMorisBrowserVectorModule();

      let unsubscribe = () => {};
      try {
        unsubscribe = mod.onDinov2Progress?.(progress => {
          if (
            progress?.status === 'progress' &&
            Number.isFinite(progress?.progress)
          ) {
            const pct = Math.max(
              0,
              Math.min(100, Math.round(Number(progress.progress)))
            );
            this.moris.status = `Đang tải mô hình nhận dạng ${pct}%...`;
          }
        }) || (() => {});

        return await mod.embedImageDinov2(image);
      } finally {
        try { unsubscribe(); } catch {}
      }
    },

    mediaUrlForVectorPath(path) {
      if (!path) return '';
      return `${CONFIG.R2_MEDIA_BASE_URL}/${String(path)
        .replace(/^\/+/,'')
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
    },

    async upsertMorisVectors(vectors) {
      if (!Array.isArray(vectors) || !vectors.length) {
        return {
          ok:true,
          accepted:0,
          written:0,
          failed:0,
          chunks:0,
          results:[]
        };
      }

      if (!this._morisChunkedUpsertModulePromise) {
        this._morisChunkedUpsertModulePromise = import(
          CONFIG.MORIS_VECTOR_UPSERT_MODULE_URL
        );
      }

      let mod;
      try {
        mod = await this._morisChunkedUpsertModulePromise;
      } catch (error) {
        this._morisChunkedUpsertModulePromise = null;
        throw error;
      }

      return mod.upsertVectorsChunked({
        endpoint:'/api/moris/vector-upsert',
        sessionToken:this.session.token,
        vectors,
        chunkSize:CONFIG.MORIS_VECTOR_UPSERT_CHUNK_SIZE,
        timeoutMs:180000,
        strict:true,
        onChunk:info => {
          if (info?.phase === 'start' && info?.chunk_count > 1) {
            console.info(
              `Moris vector chunk ${info.chunk_number}/${info.chunk_count}`
            );
          }
        }
      });
    },

    readMorisVectorQueue() {
      try {
        const rows = JSON.parse(
          localStorage.getItem(CONFIG.MORIS_VECTOR_QUEUE_KEY) || '[]'
        );
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },

    writeMorisVectorQueue(rows) {
      localStorage.setItem(
        CONFIG.MORIS_VECTOR_QUEUE_KEY,
        JSON.stringify(Array.isArray(rows) ? rows : [])
      );
    },

    readMorisVectorFailedQueue() {
      try {
        const rows = JSON.parse(
          localStorage.getItem(
            CONFIG.MORIS_VECTOR_QUEUE_FAILED_KEY
          ) || '[]'
        );
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },

    moveMorisVectorJobToFailed(job) {
      const rows = this.readMorisVectorFailedQueue();

      rows.push({
        ...job,
        failed_at:new Date().toISOString()
      });

      localStorage.setItem(
        CONFIG.MORIS_VECTOR_QUEUE_FAILED_KEY,
        JSON.stringify(rows.slice(-100))
      );
    },

    enqueueMorisVectorJob(recordId, assets, code='') {
      const rows = this.readMorisVectorQueue();

      const normalizedAssets = (assets || [])
        .filter(a => a?.image_path)
        .map(a => ({
          asset_type:a.asset_type,
          image_path:a.image_path,
          storage_provider:a.storage_provider || 'r2',
          sort_order:Number(a.sort_order || 1)
        }));

      const key = String(recordId);
      const next = rows.filter(row => String(row?.record_id) !== key);

      next.push({
        record_id:key,
        code:String(code || ''),
        assets:normalizedAssets,
        retries:0,
        created_at:new Date().toISOString()
      });

      this.writeMorisVectorQueue(next);
      return next.length;
    },

    async processMorisVectorQueue() {
      if (this._morisVectorQueueRunning) return;
      if (!this.session.token || !this.canEdit) return;

      const isMobile = this.isMorisMobileDevice();
      if (
        (isMobile && !CONFIG.MORIS_VECTOR_AUTO_ON_SAVE_MOBILE) ||
        (!isMobile && !CONFIG.MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP)
      ) return;

      this._morisVectorQueueRunning = true;

      try {
        let rows = this.readMorisVectorQueue();

        while (rows.length) {
          const job = rows[0];

          try {
            const result = await this.vectorizeSavedPart(
              job.record_id,
              job.assets
            );

            rows.shift();
            this.writeMorisVectorQueue(rows);

            if (result?.written) {
              this.toast(
                'success',
                `Vector AI: đã cập nhật ${result.written} vector cho ${job.code || job.record_id}.`
              );
            }
          } catch (error) {
            job.retries = Number(job.retries || 0) + 1;
            job.last_error = error?.message || String(error);
            job.updated_at = new Date().toISOString();

            if (job.retries >= CONFIG.MORIS_VECTOR_QUEUE_MAX_RETRIES) {
              console.warn('Moris vector job exhausted', job);
              this.moveMorisVectorJobToFailed(job);
              rows.shift();

              this.toast(
                'error',
                `Vector AI chưa xử lý được ${job.code || job.record_id}. ` +
                'Job đã chuyển sang danh sách lỗi.'
              );
            } else {
              rows[0] = job;
            }

            this.writeMorisVectorQueue(rows);
            break;
          }
        }
      } finally {
        this._morisVectorQueueRunning = false;
      }
    },

    async vectorizeCurrentEditorPart() {
      if (!this.editor.form.id) return;

      this.editor.vectorBusy = true;
      this.editor.vectorStatus = 'Đang nạp model và tạo vector...';

      try {
        const result = await this.vectorizeSavedPart(
          this.editor.form.id,
          this.editor.assets
        );

        this.editor.vectorStatus =
          result?.written
            ? `Đã ghi ${result.written} vector vào Supabase.`
            : 'Không có vector mới được ghi.';

        this.toast('success', this.editor.vectorStatus);
      } catch (error) {
        this.editor.vectorStatus =
          `Tạo vector thất bại: ${error?.message || error}`;

        this.toast(
          'error',
          'Không tạo được vector. Mở Trung tâm Vector để kiểm tra.'
        );
      } finally {
        this.editor.vectorBusy = false;
      }
    },

    async vectorizeSavedPart(recordId, assets) {
      const isMobile = this.isMorisMobileDevice();

      if (
        (isMobile && !CONFIG.MORIS_VECTOR_AUTO_ON_SAVE_MOBILE) ||
        (!isMobile && !CONFIG.MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP)
      ) return;

      const seen = new Set();
      const selected = [];

      const priority = ['front','back','detail','compare'];

      for (const type of priority) {
        for (const asset of (assets || [])) {
          if (asset?.asset_type !== type) continue;

          const key = String(asset?.image_path || '').replace(/^\/+/,'');
          if (!key || seen.has(key)) continue;

          seen.add(key);
          selected.push({
            record_id:String(recordId),
            asset_type:type,
            object_key:key
          });
        }
      }

      if (!selected.length) {
        const fallback = (assets || []).find(
          a => ['thumb','front'].includes(a?.asset_type) && a?.image_path
        );
        if (fallback) {
          selected.push({
            record_id:String(recordId),
            asset_type:String(fallback.asset_type || 'thumb'),
            object_key:String(fallback.image_path).replace(/^\/+/,'')
          });
        }
      }

      if (!selected.length) {
        const error = new Error(
          'SKU không có asset image_path để tạo vector.'
        );
        error.code = 'MORIS_VECTOR_NO_ASSET';
        throw error;
      }

      const vectors = [];

      for (const item of selected.slice(0,4)) {
        const mod = await this.loadMorisBrowserVectorModule();
        const result = await mod.embedImageDinov2Variants(
          new URL(
            this.mediaUrlForVectorPath(item.object_key),
            location.origin
          ).href,
          {includeGray:true}
        );

        for (const probe of (result.probes || [])) {
          vectors.push({
            ...item,
            view_variant:probe.view_variant,
            embedding:probe.embedding,
            embedding_profile:probe.profile,
            foreground_status:'browser_dinov2_v59_canonical'
          });
        }
      }

      return this.upsertMorisVectors(vectors);
    },

    morisCandidateUrl(candidate) {
      return this.partThumbUrl(candidate || {});
    },

    async openMorisCandidate(candidate) {
      if (!candidate?.id) return;
      await this.openDetail(candidate);
    },

    applyMorisSearchResults(data) {
      const candidates = Array.isArray(data?.candidates)
        ? data.candidates.slice(0, 5)
        : [];

      // Chỉ lọc giao diện khi thật sự có kết quả.
      this.morisSearch.active = candidates.length > 0;
      this.morisSearch.results = candidates;
      this.morisSearch.ids = candidates.map(c => c.id).filter(Boolean);
      this.morisSearch.summary = String(data?.user_message || '').trim();
      this.morisSearch.observation = null;
      this.morisSearch.updatedAt = Date.now();
      this.morisSearch.mode = '';
      this.morisSearch.trace = null;
      this.morisSearch.imageHash = data?.image_hash || '';
      this.morisSearch.candidatePoolHash = '';

      const text = String(
        data?.user_message ||
        (candidates.length
          ? `Em tìm thấy ${candidates.length} mã phù hợp.`
          : 'Xin lỗi anh, em không tìm thấy kết quả phù hợp với yêu cầu này trong catalogue.')
      );

      this.moris.messages.push({
        id:`a-${Date.now()}`,
        role:'assistant',
        text,
        candidates
      });
    },

    clearMorisSearch() {
      this.morisSearch.active = false;
      this.morisSearch.results = [];
      this.morisSearch.ids = [];
      this.morisSearch.summary = '';
      this.morisSearch.observation = null;
      this.morisSearch.updatedAt = null;
      this.morisSearch.queryId = '';
      this.morisSearch.mode = '';
      this.morisSearch.trace = null;
      this.morisSearch.imageHash = '';
      this.morisSearch.candidatePoolHash = '';
      this.$nextTick(() => this.renderIcons());
    },

    async sendMorisMessage() {
      if (this.moris.busy) return;

      const message = String(this.moris.input || '').trim();
      const imageDataUrl = this.moris.imageDataUrl || '';

      if (!message && !imageDataUrl) {
        this.toast('info', 'Anh hãy nhập mô tả hoặc đính kèm ảnh.');
        return;
      }

      const queryId = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const userText = message ||
        'Tìm linh kiện giống ảnh này. Ưu tiên hình dạng, số lỗ, vị trí lỗ và đặc điểm nhận dạng.';

      // Xóa candidate cards cũ để không gây hiểu nhầm với query mới.
      this.moris.messages = this.moris.messages.map(m =>
        m?.candidates?.length ? {...m, candidates:[]} : m
      );

      this.moris.messages.push({
        id:`u-${queryId}`,
        role:'user',
        text:userText
      });

      this.moris.input = '';
      this.moris.busy = true;
      this.moris.status = imageDataUrl
        ? 'Em đang kiểm tra hình ảnh...'
        : 'Em đang tìm trong catalogue...';

      // Trigger wireframe scan animation for image queries
      if (imageDataUrl) {
        this.startMorisScanAnimation(imageDataUrl);
      }

      this.clearMorisSearch();
      this.morisSearch.queryId = queryId;
      this.scrollMorisToBottom();

      try {
        // ── CHẾ ĐỘ 1: Chỉ text (không ảnh) → gọi /api/moris/chat (RAG hỏi đáp) ──
        if (!imageDataUrl) {
          this.moris.status = 'Moris đang tra cứu dữ liệu...';

          const history = this.moris.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-10)
            .map(m => ({ role: m.role, content: m.text }));

          const res = await this.fetchWithTimeout(
            '/api/moris/chat',
            {
              method:'POST',
              headers:{
                'content-type':'application/json',
                'x-session-token':this.session.token
              },
              body:JSON.stringify({
                message: userText,
                session_token: this.session.token,
                history
              })
            },
            120000
          );

          const chatData = await res.json().catch(() => ({}));
          if (queryId !== this.morisSearch.queryId) return;

          if (!res.ok || !chatData?.ok) {
            // Fallback: thử /api/moris/search nếu chat endpoint chưa bật
            this.moris.status = 'Em đang tìm trong catalogue...';
            const fallbackRes = await this.fetchWithTimeout(
              '/api/moris/search',
              {
                method:'POST',
                headers:{
                  'content-type':'application/json',
                  'x-session-token':this.session.token
                },
                body:JSON.stringify({
                  query_id:queryId,
                  session_token:this.session.token,
                  message:userText,
                  image_data_url:null,
                  query_embedding:null,
                  query_embeddings:[],
                  embedding_profile:null,
                  hints:{ query_vector_source:null },
                  filters:{ usage_side:this.filters.usage, view_mode:this.filters.viewMode }
                })
              },
              180000
            );
            const fallbackData = await fallbackRes.json().catch(() => ({}));
            if (queryId !== this.morisSearch.queryId) return;

            if (!fallbackRes.ok || fallbackData?.ok === false) {
              this.moris.messages.push({
                id:`a-${queryId}`,
                role:'assistant',
                text:String(fallbackData?.user_message || 'Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này.')
              });
            } else {
              this.applyMorisSearchResults(fallbackData);
            }
          } else {
            // Chat thành công — hiển thị câu trả lời + candidates (nếu có)
            if (Array.isArray(chatData.candidates) && chatData.candidates.length > 0) {
              this.applyMorisSearchResults({
                ok: true,
                user_message: chatData.answer || `Em tìm thấy ${chatData.candidates.length} mã phù hợp.`,
                candidates: chatData.candidates
              });
            } else if (Array.isArray(chatData.top5) && chatData.top5.length > 0) {
              const mapped = chatData.top5.map(t => ({
                id: t.record_id || t.id || '',
                code: t.code || '',
                part_id: t.part_id || null,
                usage_side: t.usage_side || null,
                match_reason: t.match_reason || t.reason || '',
                final_score: t.similarity_score || t.score || 0,
                thumb_path: t.thumb_path || null,
                front_path: t.front_path || null
              }));
              this.applyMorisSearchResults({
                ok: true,
                user_message: chatData.answer || `Em tìm thấy ${mapped.length} mã phù hợp.`,
                candidates: mapped
              });
            } else {
              this.moris.messages.push({
                id:`a-${queryId}`,
                role:'assistant',
                text: chatData.answer || 'Em chưa tìm được câu trả lời phù hợp.'
              });
            }
          }
          return;
        }

        // ── CHẾ ĐỘ 2: Có ảnh → pipeline vector search cũ ──
        let queryEmbedding = null;
        let queryEmbeddings = [];
        let embeddingProfile = null;

        if (CONFIG.MORIS_BROWSER_VECTOR_ENABLED) {
          this.moris.status = 'Đang khởi tạo nhận dạng hình ảnh...';

          const vectorResult = await this.buildMorisQueryVector(
            imageDataUrl
          );

          queryEmbedding = vectorResult.embedding;
          queryEmbeddings = (vectorResult.probes || []).map(probe => ({
            probe_id:probe.probe_id,
            embedding:probe.embedding,
            embedding_profile:probe.profile
          }));
          embeddingProfile = vectorResult.profile;

          this.moris.status = 'Em đang so khớp hình ảnh...';
        }

        const res = await this.fetchWithTimeout(
          '/api/moris/search',
          {
            method:'POST',
            headers:{
              'content-type':'application/json',
              'x-session-token':this.session.token
            },
            body:JSON.stringify({
              query_id:queryId,
              session_token:this.session.token,
              message:userText,
              image_data_url:imageDataUrl || null,
              query_embedding:queryEmbedding,
              query_embeddings:queryEmbeddings,
              embedding_profile:embeddingProfile,
              hints:{
                query_vector_source:
                  queryEmbedding
                    ? 'browser_dinov2_v58'
                    : null
              },
              filters:{
                usage_side:this.filters.usage,
                view_mode:this.filters.viewMode
              }
            })
          },
          180000
        );

        const data = await res.json().catch(() => ({}));

        // Response cũ tuyệt đối không được ghi đè query mới.
        if (data?.query_id && data.query_id !== this.morisSearch.queryId) return;

        if (!res.ok || data?.ok === false) {
          this.moris.messages.push({
            id:`a-${queryId}`,
            role:'assistant',
            text:String(
              data?.user_message ||
              'Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé.'
            )
          });
          return;
        }

        this.endMorisScanAnimation(); // Stop scan animation
        this.applyMorisSearchResults(data);
        this.clearMorisImage();

        if (Array.isArray(data?.candidates) && data.candidates.length) {
          this.toast('success', `Đã tìm thấy ${Math.min(5, data.candidates.length)} mã phù hợp.`);
        }
      } catch (e) {
        if (queryId !== this.morisSearch.queryId) return;

        console.error('Moris UI request failed', e);

        this.endMorisScanAnimation(); // Stop scan animation on error
        this.moris.messages.push({
          id:`a-${queryId}`,
          role:'assistant',
          text:imageDataUrl
            ? this.morisPublicImageSearchError(e)
            : 'Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé.'
        });
      } finally {
        if (queryId === this.morisSearch.queryId) {
          this.moris.busy = false;
          this.moris.status = '';
        }

        this.scrollMorisToBottom();
        this.$nextTick(() => this.renderIcons());
      }
    },

    // ─── Moris v6 Scan Animation ───────────────────────────────────────
    startMorisScanAnimation(imageDataUrl) {
      this.morisScan = { active:true, phase:'boot', phaseLabel:'BOOT SEQUENCE', progress:0, statusText:'LOADING NEURAL MODULES...', imageUrl:imageDataUrl };
      
      const phases = [
        { at:0,   label:'BOOT SEQUENCE',       text:'LOADING NEURAL MODULES...' },
        { at:15,  label:'VECTOR ENCODING',      text:'DINOV2 EXTRACTING FEATURES...' },
        { at:35,  label:'EMBEDDING COMPLETE',   text:'384-DIM VECTOR GENERATED' },
        { at:45,  label:'DATABASE QUERY',       text:'SEARCHING PGVECTOR INDEX...' },
        { at:65,  label:'CANDIDATE POOL',       text:'TOP-20 MATCHES RETRIEVED' },
        { at:75,  label:'VISION ANALYSIS',      text:'MULTI-MODEL INFERENCE...' },
        { at:85,  label:'SYNTHESIZING',         text:'REFINING FEATURES...' },
        { at:92,  label:'RERANKING',            text:'ORCHESTRATOR SCORING...' },
        { at:98,  label:'FINALIZING',           text:'PREPARING TOP-5 RESULTS...' }
      ];
      
      let pct = 0;
      const tick = () => {
        if (!this.morisScan.active) return;
        pct += 0.4 + Math.random() * 0.6;
        if (pct > 99) pct = 99;
        this.morisScan.progress = Math.round(pct);
        
        // Update phase label based on progress
        for (let i = phases.length - 1; i >= 0; i--) {
          if (pct >= phases[i].at) {
            this.morisScan.phaseLabel = phases[i].label;
            this.morisScan.statusText = phases[i].text;
            break;
          }
        }
        
        this._morisScanTimer = requestAnimationFrame(tick);
      };
      this._morisScanTimer = requestAnimationFrame(tick);
    },

    // Cyberpunk animation is pure CSS — no WebGL needed



    endMorisScanAnimation() {
      if (this._morisScanTimer) cancelAnimationFrame(this._morisScanTimer);
      if (this._morisThreeRAF) cancelAnimationFrame(this._morisThreeRAF);
      this.morisScan.active = false;
      this.morisScan.phase = '';
      this.morisScan.progress = 0;
      this.morisScan.statusText = '';
      // Cleanup Three.js
      if (this._morisThree) {
        this._morisThree.renderer.dispose();
        this._morisThree = null;
      }
    },

    async startBulkImport() {
      this.bulkImport.uploading = true;
      this.bulkImport.total = this.bulkImport.groups.length;
      this.bulkImport.current = 0;
      this.bulkImport.successCount = 0;
      this.bulkImport.errorCount = 0;
      
      for(let group of this.bulkImport.groups) {
        this.bulkImport.current++;
        this.bulkImport.progress = (this.bulkImport.current / this.bulkImport.total) * 100;
        this.bulkImport.statusText = `Đang tải mã: ${group.code}...`;
        
        try {
          let assets = [];
          
          if(group.front) {
            const frontAsset = await this.uploadToR2(group.front, group.code, 'front');
            assets.push({...frontAsset, sort_order: 1});
            const thumbAsset = await this.uploadToR2(group.front, group.code, 'thumb');
            assets.push({...thumbAsset, sort_order: 1});
          }
          if(group.back) {
            const backAsset = await this.uploadToR2(group.back, group.code, 'back');
            assets.push({...backAsset, sort_order: 1});
          }
          
          if(!assets.length) continue;
          
          const primary = assets.find(a => a.asset_type === 'thumb') || assets.find(a => a.asset_type === 'front') || assets[0];
          const hasBack = !!group.back;
          
          const saved = await this.rpcRow('app_upsert_part_metadata', {
            p_session_token: this.session.token,
            p_id: null,
            p_code: group.code,
            p_part_id: null,
            p_usage_side: 'unknown',
            p_view_mode: hasBack ? 'dual_face' : 'single_face',
            p_is_symmetric: !hasBack, // Mã 1 mặt mặc định gán đối xứng
            p_identifying_features: null,
            p_confusing_note: null,
            p_primary_image_path: primary.image_path,
            p_primary_image_name: primary.image_name || null
          });
          
          if(!saved?.ok) throw new Error(saved?.message || 'Lỗi lưu metadata');
          
          const rep = await this.rpcRow('app_replace_part_assets', { 
            p_session_token: this.session.token, 
            p_image_id: saved.id, 
            p_assets: assets 
          });
          
          if(!rep?.ok) throw new Error(rep?.message || 'Lỗi liên kết ảnh');
          
          this.bulkImport.successCount++;
        } catch(e) {
          console.error(`Lỗi tải mã ${group.code}:`, e);
          this.bulkImport.errorCount++;
        }
      }
      
      this.bulkImport.statusText = "Đã xử lý xong toàn bộ danh sách!";
      this.renderIcons();
    },
    async finishBulkImport() {
      this.closeBulkImport();
      await this.loadParts(true);
    }
  }
}).mount('#app');