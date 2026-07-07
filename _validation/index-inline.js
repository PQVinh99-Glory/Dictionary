




// =======================================================================
// CẤU HÌNH HỆ THỐNG
// =======================================================================
const CONFIG = {
  SUPABASE_URL: 'https://vhsikdgkzecdfopkpzum.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoc2lrZGdremVjZGZvcGtwenVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjgyMTcsImV4cCI6MjA5Njg0NDIxN30.bj1yl4azsk8X-V2I1C6l5Qpa0kqt6j0TP4ZCJ3Du0l4',
  R2_PUBLIC_URL: 'https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev',
  // Chỉ đổi đường ĐỌC ảnh: đi qua Pages Function cùng origin.
  // Upload giữ nguyên như hiện tại.
  R2_MEDIA_BASE_URL: '/api/media',
  
  // Upload mới: ưu tiên Pages Function cùng origin.
  // Trên dictionary.pages.dev => https://dictionary.pages.dev/api/upload
  UPLOAD_PRIMARY_URL: '/api/upload',
  UPLOAD_HEALTH_URL: '/api/upload/health',
  UPLOAD_HEALTH_TTL_MS: 60000,

  // Worker cũ vẫn giữ làm fallback/rollback. Chưa xóa.
  R2_WORKER_URL: 'https://catalogue-r2-upload-api.pqvinh1999.workers.dev',
  
  // URL CỦA WORKER PROXY REMOVE.BG (Anh thay link worker vừa deploy vào đây)
  REMOVE_BG_WORKER_URL: 'https://remove.pqvinh1999.workers.dev',
  
  ALLOWED_ORIGIN: 'https://pqvinh99-glory.github.io',
  SUPABASE_BUCKET_FALLBACK: 'product-images',
  LOCAL_TOKEN_KEY: 'catalogue_app_session_token_v3_r2',
  PAGE_LIMIT: 60
};

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      CONFIG,
      sb:null, loading:false, loadingImages:false, saving:false,
      notice:{type:'', text:''}, nowText:'',
      session:{ token: localStorage.getItem(CONFIG.LOCAL_TOKEN_KEY) || '', user:null },
      loginForm:{ username:'', password:'' },
      filters:{ search:'', usage:'all', viewMode:'all' },
      parts:[], page:0, hasMore:false,
      detail:{ open:false, item:null, assets:[], tab:'front', activeAsset:null, flipped:false, zoom:1, panX:0, panY:0, rotX:-8, rotY:18, dragging:false, pointerId:null, startX:0, startY:0, startPanX:0, startPanY:0, startRotX:-8, startRotY:18, pinchStartDistance:0, pinchStartZoom:1 },
      editor:{ open:false, autoRemoveBg: true, form:this.emptyForm(), assets:[], files:{}, previews:{} },
      bulkImport: { open: false, files: [], groups: [], uploading: false, progress: 0, current: 0, total: 0, successCount: 0, errorCount: 0, statusText: '' },
      
      // Cache lựa chọn đường upload để không health-check lặp lại mỗi ảnh.
      uploadRoute: { provider:'unknown', endpoint:'', checkedAt:0, health:'' },

      denis: {
        open:false,
        busy:false,
        status:'',
        input:'',
        imageDataUrl:'',
        imagePreview:'',
        imageName:'',
        messages:[
          {
            id:'denis-welcome',
            role:'assistant',
            text:'Denis sẵn sàng sàng lọc catalogue. Anh hãy up ảnh hoặc mô tả đặc điểm nhận dạng; Denis chỉ gọi AI khi filter thường chưa đủ và sẽ lọc Top 5 trực tiếp trên giao diện.'
          }
        ]
      },
      denisSearch:{
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
      denisDebugOpen:false,

      isLowPower3D:false,
      pointerCache:null
    };
  },
  computed:{
    canEdit() { return ['admin','editor'].includes(this.session.user?.role_name); },
    displayedParts() {
      return this.denisSearch.active ? this.denisSearch.results : this.parts;
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
    detailTabLabel() { return {front:'Mặt chính', back:'Mặt sau', detail:'Ảnh chi tiết', sim:'3D mô phỏng'}[this.detail.tab] || 'Ảnh'; },
    viewerTransform() { return `transform: translate3d(${this.detail.panX}px, ${this.detail.panY}px, 0) scale(${this.detail.zoom});`; },
    
    // --- 3D LOGIC ---
    simFrontUrl() {
      return this.assetTypeUrl('front') || this.assetTypeUrl('back') || this.activeAssetUrl || '';
    },
    simBackUrl() {
      const front = this.assetTypeUrl('front') || this.assetTypeUrl('back');
      const back = this.trueBackUrl;
      return this.detail.item?.is_symmetric ? (this.assetTypeUrl('back') || front) : back;
    },
    simBackImgStyle() {
      // SỬA LỖI LẬP MẶT 3D:
      // Nếu mã KHÔNG ĐỐI XỨNG và CÓ MẶT SAU THẬT -> Mặt sau đã bị lật 180 độ bởi thẻ div cha (hiệu ứng gương).
      // Do đó cần scaleX(-1) để lật ngược hình ảnh lại một lần nữa -> Khôi phục đúng chiều.
      if (this.detail.item && !this.detail.item.is_symmetric && this.trueBackUrl) {
        return 'transform: scaleX(-1);';
      }
      return '';
    },
    simEdgeLayers() {
      if (this.isLowPower3D) return [];
      return [-3,-2,-1,0,1,2,3];
    },
    simTransform() {
      const thickness = this.isLowPower3D ? '6px' : '12px';
      const z = Math.round(this.detail.zoom * 100) / 100;
      const rx = Math.round(this.detail.rotX * 10) / 10;
      const ry = Math.round(this.detail.rotY * 10) / 10;
      return `--thickness:${thickness}; transform: translate3d(0px, 0px, 0) scale(${z}) rotateX(${rx}deg) rotateY(${ry}deg);`;
    },
    // --- END 3D LOGIC ---

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
    this.isLowPower3D = this.detectLowPower3D();
    window.addEventListener('resize', () => { this.isLowPower3D = this.detectLowPower3D(); }, {passive:true});
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
    readError(err) { return err?.message || String(err) || 'Có lỗi xảy ra'; },
    detectLowPower3D() {
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isMobile = window.matchMedia?.('(max-width: 760px)').matches;
      return !!(isIOS || isMobile);
    },
    async rpcRow(fn,args) { const {data,error} = await this.sb.rpc(fn,args); if(error) throw error; return Array.isArray(data) ? data[0] : data; },
    async rpcRows(fn,args) { const {data,error} = await this.sb.rpc(fn,args); if(error) throw error; return data || []; },

    async checkSession() {
      if (!this.session.token) return;
      try {
        const me = await this.rpcRow('app_me', {p_session_token:this.session.token});
        if (!me?.ok) throw new Error(me?.message || 'Session hết hạn');
        this.session.user = me;
        await this.loadParts(true);
      } catch(e) { localStorage.removeItem(CONFIG.LOCAL_TOKEN_KEY); this.session.token=''; this.session.user=null; }
    },
    async login() {
      this.loading=true;
      try {
        const row = await this.rpcRow('app_login', { p_username:this.loginForm.username, p_password:this.loginForm.password });
        if (!row?.ok) throw new Error(row?.message || 'Đăng nhập thất bại');
        this.session.token = row.session_token;
        localStorage.setItem(CONFIG.LOCAL_TOKEN_KEY, row.session_token);
        await this.checkSession();
        this.toast('success','Đăng nhập thành công.');
      } catch(e) { this.toast('error', this.readError(e)); } finally { this.loading=false; }
    },
    async logout() {
      try { if(this.session.token) await this.rpcRow('app_logout', {p_session_token:this.session.token}); } catch(_) {}
      localStorage.removeItem(CONFIG.LOCAL_TOKEN_KEY); this.session={token:'',user:null}; this.parts=[];
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
      if(reset) { this.page=0; this.parts=[]; }
      this.loadingImages=true;
      try {
        const rows = await this.rpcRows('app_search_catalogue', {
          p_session_token:this.session.token,
          p_search:this.filters.search || '',
          p_usage_side:this.filters.usage,
          p_view_mode:this.filters.viewMode,
          p_limit:CONFIG.PAGE_LIMIT,
          p_offset:this.page * CONFIG.PAGE_LIMIT
        });
        this.hasMore = rows.length === CONFIG.PAGE_LIMIT;
        this.parts = reset ? rows : this.parts.concat(rows);
      } catch(e) { this.toast('error', this.readError(e)); } finally { this.loadingImages=false; this.renderIcons(); }
    },
    async loadMore() { this.page += 1; await this.loadParts(false); },

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
    flipSim() {
      if (this.detail.tab !== 'sim') this.detail.tab = 'sim';
      this.detail.rotY = this.detail.rotY + 180;
    },
    simLayerStyle(n) {
      const z = Number(n) * 1.1;
      const x = Number(n) * 0.28;
      const opacity = 0.04 + Math.max(0, 3 - Math.abs(Number(n))) * 0.018;
      return `transform: translateZ(${z}px) translateX(${x}px); opacity:${opacity};`;
    },
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

        if (this.detail.tab === 'sim') {
          const nextY = Math.round((this.detail.startRotY + dx * 0.35) * 10) / 10;
          const nextX = Math.round(this.clamp(this.detail.startRotX - dy * 0.25, -60, 60) * 10) / 10;
          if (Math.abs(nextY - this.detail.rotY) > 0.1) this.detail.rotY = nextY;
          if (Math.abs(nextX - this.detail.rotX) > 0.1) this.detail.rotX = nextX;
        } else {
          this.detail.panX = this.detail.startPanX + dx;
          this.detail.panY = this.detail.startPanY + dy;
        }
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
    
    // Gọi Cloudflare Worker để tách nền bằng API remove.bg
    async removeBgApi(file) {
      if (!CONFIG.REMOVE_BG_WORKER_URL || CONFIG.REMOVE_BG_WORKER_URL.includes('[THAY-LINK-WORKER')) {
        throw new Error('Chưa cấu hình Link Cloudflare Worker (REMOVE_BG_WORKER_URL) trong phần <script>.');
      }
      const form = new FormData();
      form.append('image_file', file);
      
      const res = await fetch(CONFIG.REMOVE_BG_WORKER_URL, { 
        method: 'POST', 
        body: form 
      });
      
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const blob = await res.blob();
      return new File([blob], file.name.replace(/\.[^.]+$/, '.png'), {type: 'image/png'});
    },

    async onFileChange(type, order, e) {
      let file = e.target.files?.[0]; e.target.value=''; if(!file) return;
      
      const key = `${type}_${order}`;
      if(this.editor.previews[key]) URL.revokeObjectURL(this.editor.previews[key]);
      
      // LOGIC TỰ ĐỘNG TÁCH NỀN (CHỈ ÁP DỤNG CHO FRONT/BACK)
      if (this.editor.autoRemoveBg && (type === 'front' || type === 'back')) {
        this.saving = true; // Khóa nút lưu trong lúc tách nền
        this.toast('info', `AI đang tách nền...`);
        try {
          file = await this.removeBgApi(file);
          this.toast('success', `Tách nền thành công mặt ${type}!`);
        } catch(err) {
          this.toast('error', 'Lỗi tách nền: ' + this.readError(err));
          // Nếu tách lỗi, vẫn dùng ảnh gốc để người dùng tự xử lý
        } finally {
          this.saving = false;
        }
      }

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
    // DENIS — Client bridge to server-side Catalogue AI Harness
    // ===============================================================
    openDenis() {
      this.denis.open = true;
      this.$nextTick(() => {
        this.renderIcons();
        this.scrollDenisToBottom();
      });
    },

    closeDenis() {
      this.denis.open = false;
    },

    useDenisSuggestion(text) {
      this.denis.input = text;
      this.$nextTick(() => this.sendDenisMessage());
    },

    triggerDenisImage() {
      this.$refs.denisImageInput?.click();
    },

    async onDenisImageSelect(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      try {
        this.denis.status = 'Đang chuẩn bị ảnh...';
        const dataUrl = await this.prepareDenisImage(file);
        this.denis.imageDataUrl = dataUrl;
        this.denis.imagePreview = dataUrl;
        this.denis.imageName = file.name || 'query-image';
      } catch (e) {
        this.toast('error', `Không chuẩn bị được ảnh cho Denis: ${this.readError(e)}`);
      } finally {
        this.denis.status = '';
        if (event?.target) event.target.value = '';
        this.$nextTick(() => this.renderIcons());
      }
    },

    async prepareDenisImage(file) {
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

    clearDenisImage() {
      this.denis.imageDataUrl = '';
      this.denis.imagePreview = '';
      this.denis.imageName = '';
      this.$nextTick(() => this.renderIcons());
    },

    scrollDenisToBottom() {
      this.$nextTick(() => {
        const el = this.$refs.denisThread;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },

    denisCandidateUrl(candidate) {
      return this.partThumbUrl(candidate || {});
    },

    async openDenisCandidate(candidate) {
      if (!candidate?.id) return;
      await this.openDetail(candidate);
    },

    applyDenisSearchResults(data) {
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];

      this.denisSearch.active = true;
      this.denisSearch.results = candidates;
      this.denisSearch.ids = candidates.map(c => c.id).filter(Boolean);
      this.denisSearch.summary = data.summary || 'Denis đã lọc Top 5.';
      this.denisSearch.observation = data.observation || null;
      this.denisSearch.updatedAt = Date.now();
      this.denisSearch.mode = data.mode || '';
      this.denisSearch.trace = data.trace || null;
      this.denisSearch.imageHash = data.image_hash || '';
      this.denisSearch.candidatePoolHash = data.candidate_pool_hash || '';

      const aiCalls = data.trace?.ai_calls?.total ?? 0;
      const msg = [
        data.summary || 'Em đã lọc Top 5 trực tiếp trên giao diện.',
        `\nMode: ${data.mode || '---'} · AI calls: ${aiCalls}`,
        candidates.length ? `\nTop ${candidates.length}: ${candidates.map(c => c.code).filter(Boolean).join(', ')}` : '',
        Array.isArray(data.warnings) && data.warnings.length ? `\nLưu ý: ${data.warnings.join('; ')}` : ''
      ].join('');

      this.denis.messages.push({
        id:`a-${Date.now()}`,
        role:'assistant',
        text:msg,
        evidence:Array.isArray(data.evidence) ? data.evidence : [],
        warnings:Array.isArray(data.warnings) ? data.warnings : [],
        candidates
      });
    },

    clearDenisSearch() {
      this.denisSearch.active = false;
      this.denisSearch.results = [];
      this.denisSearch.ids = [];
      this.denisSearch.summary = '';
      this.denisSearch.observation = null;
      this.denisSearch.updatedAt = null;
      this.denisSearch.queryId = '';
      this.denisSearch.mode = '';
      this.denisSearch.trace = null;
      this.denisSearch.imageHash = '';
      this.denisSearch.candidatePoolHash = '';
      this.denisDebugOpen = false;
      this.$nextTick(() => this.renderIcons());
    },

    async sendDenisMessage() {
      if (this.denis.busy) return;

      const message = String(this.denis.input || '').trim();
      const imageDataUrl = this.denis.imageDataUrl || '';

      if (!message && !imageDataUrl) {
        this.toast('info', 'Anh hãy nhập mô tả hoặc đính kèm ảnh.');
        return;
      }

      const queryId = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const userText = message || 'Tìm linh kiện giống ảnh này. Ưu tiên hình dạng, số lỗ, vị trí lỗ và đặc điểm nhận dạng.';

      // Xóa candidate cards cũ để không gây hiểu nhầm với query mới.
      this.denis.messages = this.denis.messages.map(m =>
        m?.candidates?.length ? {...m, candidates:[]} : m
      );

      this.denis.messages.push({
        id:`u-${queryId}`,
        role:'user',
        text:userText
      });

      this.denis.input = '';
      this.denis.busy = true;
      this.denis.status = imageDataUrl
        ? 'Denis đang sàng lọc: filter → Visual Analyst → Resolver...'
        : 'Denis đang lọc metadata và đánh giá độ mơ hồ...';

      this.clearDenisSearch();
      this.denisSearch.queryId = queryId;
      this.scrollDenisToBottom();

      try {
        const res = await this.fetchWithTimeout(
          '/api/denis/search-v4',
          {
            method:'POST',
            headers:{
              'content-type':'application/json',
              'x-session-token':this.session.token
            },
            body:JSON.stringify({
              query_id:queryId,
              message:userText,
              image_data_url:imageDataUrl || null
            })
          },
          180000
        );

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
          throw new Error(data.message || `Denis V4 API lỗi HTTP ${res.status}`);
        }

        // Response cũ tuyệt đối không được ghi đè query mới.
        if (data.query_id !== this.denisSearch.queryId) return;

        this.applyDenisSearchResults(data);
        this.clearDenisImage();

        this.toast(
          'success',
          `Denis V4 đã lọc Top ${Math.min(5, data.candidates?.length || 0)} · ${data.mode || ''}`
        );
      } catch (e) {
        if (queryId !== this.denisSearch.queryId) return;

        this.denis.messages.push({
          id:`a-${queryId}`,
          role:'assistant',
          text:`Em chưa lọc được kết quả: ${this.readError(e)}`,
          warnings:['Không có thay đổi nào được ghi vào catalogue.']
        });
      } finally {
        if (queryId === this.denisSearch.queryId) {
          this.denis.busy = false;
          this.denis.status = '';
        }

        this.scrollDenisToBottom();
        this.$nextTick(() => this.renderIcons());
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
