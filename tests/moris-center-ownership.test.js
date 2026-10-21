import {selectAssets,onlyLegacyZeroAssets,previewBatch,createPauseControl,runManualBatch} from '../src/moris/vector/manualBatch.js';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { upsertVectorsChunked } from '../src/moris/vector/chunkedUpsert.js';
import { onRequestPost } from '../functions/api/moris/vector-upsert.js';

function center({ missingModal = false } = {}) {
  const elements = new Map();
  const element = () => ({ style: {}, classList: { add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => null, appendChild() {}, innerHTML: '', textContent: '' });
  const get = id => { if (missingModal && id === 'confirmModal') return null; if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [], status: {} })));
  const embed = vi.fn(async () => ({ probes: [{ view_variant: 'canon_rgb_v2', embedding: [1], profile: {} }] }));
  const sandbox = { selectAssets,onlyLegacyZeroAssets,previewBatch,createPauseControl,runManualBatch, document: { getElementById: get, createElement: element }, window: { location: { search: '' } },
    localStorage: { getItem: () => 'test.jwt.token' }, sessionStorage: { getItem: () => '' },
    location: { origin: 'http://localhost' }, URL, URLSearchParams, fetch, console, setTimeout: vi.fn(), clearTimeout() {},
    initDinov2: vi.fn(async () => ({})), embedImageDinov2: embed, embedImageDinov2Variants: embed,
    onDinov2Progress() {}, renderParts() {}, upsertVectorsChunked: args => upsertVectorsChunked({...args, fetchImpl:fetch}) };
  const source = readFileSync('tools/moris-vector-center.js','utf8').replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
  vm.runInNewContext(source+'\nglobalThis.api = { state, vectorizeSingleItem, batchVectorizePending, showBatchPreview, showConfirm };', sandbox);
  return { ...sandbox.api, get, embed, fetch };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('M03 explicit Center intent', () => {
  it('mount/status/list never embeds or writes', async () => {
    const c = center(); await tick();
    expect(c.embed).not.toHaveBeenCalled();
    expect(c.fetch.mock.calls.every(([url]) => !url.includes('upsert'))).toBe(true);
  });
  it.each(['single', 'batch'])('%s waits for confirmation and cancel makes zero writes', async kind => {
    const c = center(); await tick();
    const item = { id:'part', code:'ABC', assets:[{asset_type:'front',image_path:'p.webp'}] };
    c.state.items=[item];
    const pending=kind==='single' ? c.vectorizeSingleItem(item,null) : c.batchVectorizePending();
    expect(c.embed).not.toHaveBeenCalled();
    c.get('btnConfirmCancel').onclick(); await pending;
    expect(c.embed).not.toHaveBeenCalled();
    expect(c.fetch.mock.calls.some(([url]) => url.includes('upsert'))).toBe(false);
  });
  it('missing confirmation modal fails closed', async () => {
    const c=center({missingModal:true});
    expect(await c.showConfirm('title','body')).toBe(false);
  });
  it('repair-zero preview excludes healthy and unmeasured legacy assets before confirmation',async()=>{
    const c=center();await tick();
    c.get('vectorWriteMode').value='repair_zero';
    c.state.items=[{id:'part',code:'ABC',assets:[
      {asset_type:'front',image_path:'front.webp',legacy_hole_zero:true},
      {asset_type:'thumb',image_path:'thumb.webp',legacy_hole_zero:false}
    ]}];
    expect(c.showBatchPreview()).toMatchObject({assets:1,skus:1});
    const work=c.batchVectorizePending();
    c.get('btnConfirmCancel').onclick();await work;
    expect(c.embed).not.toHaveBeenCalled();
    expect(c.fetch.mock.calls.some(([url])=>url.includes('upsert'))).toBe(false);
  });
  it('confirmed single selects only that item', async () => {
    const c=center(); await tick();
    c.fetch.mockImplementation(async url => new Response(JSON.stringify(url.includes('upsert') ? {ok:true,written:1,failed:0} : {ok:true,items:[],status:{}}), {headers:{etag:'\"version1\"'}}));
    const work=c.vectorizeSingleItem({id:'selected',code:'SELECTED',assets:[{asset_type:'front',image_path:'selected.webp'}]},null);
    c.get('btnConfirmOk').onclick(); await work;
    expect(c.fetch).toHaveBeenCalledWith('/api/media/selected.webp', {cache:'no-store'});
    expect(c.embed).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), {includeGray:false});
    const write=c.fetch.mock.calls.find(([url])=>url.includes('upsert'));
    expect(JSON.parse(write[1].body)).toMatchObject({source:'vector_center',confirmed:true,vectors:[{record_id:'selected'}]});
  });
  it('legacy reindex script cannot write', () => {
    const source=readFileSync('tools/moris-vector-reindex.js','utf8');
    expect(source).toContain('moris-vector-center.html');
    expect(source).not.toContain('fetch(');
  });
});

describe('M03 server authorization', () => {
  it.each([['', 'admin', 401], ['a.b.c','viewer',403], ['a.b.c','admin',400], ['a.b.c','editor',400], ['a.b.c','converter',400]])('token %s role %s rejects unauthorized intent (%s)', async (token,role,status) => {
    const original=globalThis.fetch;
    const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:true,role_name:role})));
    globalThis.fetch=fetch;
    try {
      const res=await onRequestPost({env:{SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'test'},request:new Request('https://example.test/api/moris/vector-upsert',{method:'POST',body:JSON.stringify({session_token:token,vectors:[]})})});
      expect(res.status).toBe(status);
      expect(fetch.mock.calls.every(([url])=>url.endsWith('/rpc/app_me'))).toBe(true);
    } finally { globalThis.fetch=original; }
  });
});
