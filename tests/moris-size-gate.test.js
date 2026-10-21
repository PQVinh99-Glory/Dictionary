import {describe,it,expect,vi,afterEach} from 'vitest';
import {applySizeGate,loadCandidateDims,loadLengthShortlist} from '../functions/_lib/moris/v5/retrieval/sizeGate.js';
import {validateMorisQuery} from '../functions/_lib/moris/v5/schemas/query.js';
import {publicCandidate} from '../functions/_lib/moris/v5/schemas/candidate.js';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
import {toPublicMorisResult} from '../functions/_lib/moris/v5/presentation/publicResult.js';
import {
  buildMorisUserMessage,
  MORIS_PUBLIC_MESSAGES
} from '../functions/_lib/moris/v5/presentation/userMessage.js';

const env={
  SUPABASE_URL:'https://fixture.invalid',
  SUPABASE_ANON_KEY:'fixture',
  SUPABASE_SERVICE_ROLE_KEY:'fixture'
};

afterEach(()=>vi.unstubAllGlobals());

describe('M28 Size Gate — fail-open & lọc theo dung sai',()=>{
  it('không có size query -> not_provided, giữ nguyên pool',()=>{
    const candidates=[{id:'a',code:'A'}];
    const out=applySizeGate({candidates,querySize:null,dimsById:new Map()});
    expect(out.candidates).toBe(candidates);
    expect(out.evidence.status).toBe('not_provided');
    expect(out.warnings).toEqual([]);
  });

  it('bảng dims chưa sẵn sàng (null) -> dims_unavailable, giữ nguyên + cảnh báo trung tính',()=>{
    const candidates=[{id:'a',code:'A'},{id:'b',code:'B'}];
    const out=applySizeGate({candidates,querySize:{length_mm:100,width_mm:60},dimsById:null});
    expect(out.candidates).toHaveLength(2);
    expect(out.evidence.status).toBe('dims_unavailable');
    expect(out.evidence.measured.length_mm).toBe(100);
    expect(out.warnings[0]).toContain('Chưa có dữ liệu kích thước catalogue');
  });

  it('applied: giữ match/unknown, loại mismatch, ghi evidence đầy đủ',()=>{
    const candidates=[{id:'a',code:'A1'},{id:'b',code:'B2'},{id:'c',code:'C3'}];
    const dimsById=new Map([
      ['a',{length_mm:100,width_mm:60}],
      ['b',{length_mm:200,width_mm:60}]
    ]);
    const out=applySizeGate({candidates,querySize:{length_mm:102,width_mm:60},dimsById});
    expect(out.candidates.map(c=>c.id)).toEqual(['a','c']);
    expect(out.candidates[0].size_status).toBe('match');
    expect(out.candidates[0].size_evidence.d_max).toBeCloseTo(2/102,6);
    expect(out.candidates[1].size_status).toBe('unknown');
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({id:'b',code:'B2'});
    expect(out.evidence).toMatchObject({status:'applied',matched_count:1,unknown_count:1,rejected_count:1});
    expect(out.evidence.rejected).toHaveLength(1);
    expect(out.warnings[0]).toContain('chuyển 1 mã');
    expect(out.rescueCandidates).toMatchObject([{id:'b',size_status:'outside_tolerance'}]);
  });

  it('dims lưu ngược thứ tự vẫn khớp sau chuẩn hoá; record_id được nhận diện',()=>{
    const out=applySizeGate({
      candidates:[{record_id:'r1',code:'R1'}],
      querySize:{length_mm:120,width_mm:30},
      dimsById:new Map([['r1',{length_mm:30,width_mm:120}]])
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].size_status).toBe('match');
  });

  it('S1.1: dims thiếu cạnh ngắn -> match_partial (chỉ so cạnh dài), KHÔNG loại oan',()=>{
    const out=applySizeGate({
      candidates:[{id:'a',code:'A'}],
      querySize:{length_mm:100,width_mm:60,source:'user'},
      dimsById:new Map([['a',{length_mm:102,width_mm:null,method:'user'}]])
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].size_status).toBe('match_partial');
    expect(out.candidates[0].size_evidence.partial).toBe(true);
    expect(out.evidence).toMatchObject({matched_count:0,partial_count:1,rejected_count:0});

    const queryPartial=applySizeGate({
      candidates:[{id:'a',code:'A'}],
      querySize:{length_mm:100,source:'user'},
      dimsById:new Map([['a',{length_mm:102,width_mm:60,method:'user'}]])
    });
    expect(queryPartial.candidates[0].size_status).toBe('match_partial');

    const partialReject=applySizeGate({
      candidates:[{id:'a',code:'A'}],
      querySize:{length_mm:100,source:'user'},
      dimsById:new Map([['a',{length_mm:70,width_mm:60,method:'user'}]])
    });
    expect(partialReject.candidates).toHaveLength(0);
    expect(partialReject.rejected).toHaveLength(1);
  });

  it('dung sai nhập tay và verified đều 5% theo cạnh dài query',()=>{
    const manualMatch=applySizeGate({
      candidates:[{id:'a'},{id:'b'}],
      querySize:{length_mm:200,width_mm:100,source:'user'},
      dimsById:new Map([
        ['a',{length_mm:180,width_mm:100,method:'user'}],
        ['b',{length_mm:180,width_mm:100,method:'caliper'}]
      ])
    });
    expect(manualMatch.candidates).toHaveLength(0);
    expect(manualMatch.rejected).toHaveLength(2);

    const verifiedStrict=applySizeGate({
      candidates:[{id:'a'}],
      querySize:{length_mm:200,width_mm:100,source:'camera_measured'},
      dimsById:new Map([['a',{length_mm:180,width_mm:100,method:'caliper'}]])
    });
    expect(verifiedStrict.candidates).toHaveLength(0);
    expect(verifiedStrict.rejected).toHaveLength(1);
  });

  it('vật nhỏ: đúng 5% khớp, vượt 5% bị loại, không có sàn mm',()=>{
    const inRange=applySizeGate({
      candidates:[{id:'a'}],
      querySize:{length_mm:20,width_mm:20},
      dimsById:new Map([['a',{length_mm:21,width_mm:20}]])
    });
    expect(inRange.candidates[0].size_status).toBe('match');

    const outRange=applySizeGate({
      candidates:[{id:'a'}],
      querySize:{length_mm:20,width_mm:20},
      dimsById:new Map([['a',{length_mm:21.01,width_mm:20}]])
    });
    expect(outRange.candidates).toHaveLength(0);
    expect(outRange.rejected).toHaveLength(1);
  });

  it('toàn bộ ứng viên bị loại -> pool rỗng để orchestrator báo NO_MATCH',()=>{
    const dimsById=new Map(Array.from({length:12},(_,i)=>[`id${i}`,{length_mm:300,width_mm:300}]));
    const candidates=Array.from({length:12},(_,i)=>({id:`id${i}`,code:`C${i}`}));
    const out=applySizeGate({candidates,querySize:{length_mm:100,width_mm:100},dimsById});
    expect(out.candidates).toHaveLength(0);
    expect(out.rejected).toHaveLength(12);
    expect(out.evidence.rejected).toHaveLength(10);
    expect(out.evidence.rejected_count).toBe(12);
  });
});

describe('P06 length shortlist — read-only trước ANN',()=>{
  it('180mm truy vấn đúng biên 171–189, không cần width',async()=>{
    const urls=[];
    vi.stubGlobal('fetch',vi.fn(async(url)=>{urls.push(new URL(url));return Response.json([{record_id:'target',length_mm:180,width_mm:null}]);}));
    const result=await loadLengthShortlist(env,{length_mm:180},{pageSize:20});
    expect(result.status).toBe('complete');
    expect(result.rows.map(row=>row.record_id)).toEqual(['target']);
    expect(urls[0].searchParams.get('and')).toBe('(length_mm.gte.171,length_mm.lte.189)');
  });

  it('không coi danh sách đã vượt budget là đầy đủ',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{record_id:'a'},{record_id:'b'}])));
    const result=await loadLengthShortlist(env,{length_mm:180},{maxRows:2,pageSize:2});
    expect(result.status).toBe('budget_exceeded');
    expect(result.rows).toEqual([]);
  });

  it('thiếu secret hoặc lỗi bảng trả unavailable, không tuyên bố size match',async()=>{
    expect((await loadLengthShortlist({SUPABASE_URL:env.SUPABASE_URL},{length_mm:180})).status).toBe('dims_unavailable');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:404})));
    expect((await loadLengthShortlist(env,{length_mm:180})).status).toBe('dims_unavailable');
    expect((await loadLengthShortlist(env,{length_mm:NaN})).status).toBe('not_provided');
  });
});

describe('M28 loadCandidateDims — fail-open trước bảng proposal (Gate D)',()=>{
  it('đọc thành công -> Map theo record_id, đúng select + in.(...)',async()=>{
    const fetchMock=vi.fn(async(url)=>{
      const parsed=new URL(String(url));
      expect(parsed.pathname).toBe('/rest/v1/catalogue_part_dimensions');
      expect(parsed.searchParams.get('select')).toBe('record_id,length_mm,width_mm,method,confidence');
      expect(parsed.searchParams.get('record_id')).toBe('in.(a,b)');
      return Response.json([{record_id:'a',length_mm:100,width_mm:60}]);
    });
    vi.stubGlobal('fetch',fetchMock);
    const dims=await loadCandidateDims(env,'tok',['a','b','a']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dims.get('a').length_mm).toBe(100);
    expect(dims.has('b')).toBe(false);
  });

  it('T5 (sau Gate D) — row thật method/confidence vào Map và gate dùng đúng cặp cạnh',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json([
      {record_id:'r1',length_mm:120.5,width_mm:80,method:'user',confidence:0.9},
      {record_id:'r2',length_mm:60,width_mm:60,method:'caliper',confidence:1}
    ])));
    const dims=await loadCandidateDims(env,'tok',['r1','r2']);
    expect(dims.size).toBe(2);
    expect(dims.get('r1')).toMatchObject({length_mm:120.5,width_mm:80,method:'user',confidence:0.9});
    expect(dims.get('r2')).toMatchObject({length_mm:60,width_mm:60,method:'caliper',confidence:1});

    const out=applySizeGate({
      candidates:[{id:'r1',code:'A'},{id:'r2',code:'B'}],
      querySize:{length_mm:121,width_mm:79},
      dimsById:dims
    });
    expect(out.evidence.status).toBe('applied');
    expect(out.candidates.map(c=>c.id)).toEqual(['r1']);
    expect(out.rejected.map(c=>c.id)).toEqual(['r2']);
  });

  it('bảng chưa tồn tại (404) -> null, không ném lỗi',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:404})));
    expect(await loadCandidateDims(env,'tok',['a'])).toBeNull();
  });

  it('lỗi mạng -> null',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
    expect(await loadCandidateDims(env,'tok',['a'])).toBeNull();
  });

  it('response 200 nhưng JSON không phải mảng -> null',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({message:'không phải bảng dữ liệu'})));
    expect(await loadCandidateDims(env,'tok',['a'])).toBeNull();
  });

  it('response 200 nhưng body không phải JSON -> null, không ném lỗi',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('not-json',{status:200})));
    expect(await loadCandidateDims(env,'tok',['a'])).toBeNull();
  });

  it('không có id -> Map rỗng, không gọi mạng',async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    const dims=await loadCandidateDims(env,'tok',[]);
    expect(dims.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('giới hạn tối đa 100 id/request',async()=>{
    const captured=[];
    vi.stubGlobal('fetch',vi.fn(async(url)=>{captured.push(String(url));return Response.json([]);}));
    const ids=Array.from({length:150},(_,i)=>`r${i}`);
    await loadCandidateDims(env,'tok',ids);
    expect(captured).toHaveLength(2);
    expect(new URL(captured[0]).searchParams.get('record_id').split(',')).toHaveLength(100);
    expect(new URL(captured[1]).searchParams.get('record_id').split(',')).toHaveLength(50);
  });

  it('thiếu SUPABASE_URL -> null (không lọc)',async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    expect(await loadCandidateDims({},'tok',['a'])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('M28 tích hợp schema/config/presentation',()=>{
  it('validateMorisQuery nhận và chuẩn hoá size, size sai -> null (fail-open)',()=>{
    const config=readMorisConfig({});
    const q=validateMorisQuery({message:'x',size:{length_mm:20,width_mm:30,source:'user'}},config);
    expect(q.size).toEqual({length_mm:30,width_mm:20,shape_class:'rect',source:'user',confidence:null});
    expect(validateMorisQuery({message:'x',size:{length_mm:-1,width_mm:30}},config).size).toBeNull();
    expect(validateMorisQuery({message:'x'},config).size).toBeNull();
  });

  it('config.features.sizeGate mặc định true, tắt được bằng env',()=>{
    expect(readMorisConfig({}).features.sizeGate).toBe(true);
    expect(readMorisConfig({MORIS_SIZE_GATE_ENABLED:'false'}).features.sizeGate).toBe(false);
  });

  it('publicCandidate truyền size_status/size_evidence',()=>{
    const pub=publicCandidate({id:'x',code:'X',size_status:'match',size_evidence:{d_max:0.01}});
    expect(pub.size_status).toBe('match');
    expect(pub.size_evidence).toEqual({d_max:0.01});
    expect(publicCandidate({id:'x'}).size_status).toBeNull();
  });

  it('toPublicMorisResult phơi size_evidence (top-level + debug)',()=>{
    const result={mode:'MORIS_VECTOR_SUGGESTIONS',candidates:[{id:'a',code:'A',size_status:'match'}],size_evidence:{status:'applied',rejected_count:0}};
    const out=toPublicMorisResult(result);
    expect(out.size_evidence).toEqual({status:'applied',rejected_count:0});
    expect(out.candidates[0].size_status).toBe('match');

    const dbg=toPublicMorisResult(result,{debug:true});
    expect(dbg.debug.size_evidence).toEqual({status:'applied',rejected_count:0});

    const none=toPublicMorisResult({mode:'MORIS_VECTOR_SUGGESTIONS',candidates:[]});
    expect('size_evidence' in none).toBe(false);
  });

  it('userMessage: mode NO_MATCH do size gate có thông điệp riêng',()=>{
    const msg=buildMorisUserMessage({mode:'MORIS_SIZE_GATE_NO_MATCH',candidates:[]});
    expect(msg).toBe(MORIS_PUBLIC_MESSAGES.sizeGateNoMatch);
  });

  it('userMessage: ghi chú trung tính khi dims_unavailable, ghi chú loại mã khi applied',()=>{
    const neutral=buildMorisUserMessage({mode:'MORIS_NO_MATCH',candidates:[],size_evidence:{status:'dims_unavailable'}});
    expect(neutral).toContain('Chưa có dữ liệu kích thước catalogue');

    const filtered=buildMorisUserMessage({
      mode:'MORIS_VECTOR_SUGGESTIONS',
      candidates:[{code:'A'}],
      decision:{reasons:[]},
      size_evidence:{status:'applied',rejected_count:3,tolerance:{relative:0.05,floorMm:0}}
    });
    expect(filtered).toContain('loại 3 mã');
    expect(filtered).toContain('±5%');
  });
});
