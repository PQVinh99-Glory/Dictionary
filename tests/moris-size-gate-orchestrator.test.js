import {describe,it,expect,vi,afterEach} from 'vitest';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
import {runMorisSearch} from '../functions/_lib/moris/v5/orchestrator.js';

vi.mock('../functions/_lib/moris/v5/connectors/catalogue.js',()=>({
  exactLookup:vi.fn(async()=>[]),
  hydrateVectorHits:vi.fn(async()=>[
    {id:'a',record_id:'a',part_id:'A',raw_vector_similarity:.94,hole_count:5,quality:{reliable:true}},
    {id:'b',record_id:'b',part_id:'B',raw_vector_similarity:.90,hole_count:17,quality:{reliable:true}},
    {id:'c',record_id:'c',part_id:'C',raw_vector_similarity:.88,hole_count:9,quality:{reliable:true}}
  ])
}));
vi.mock('../functions/_lib/moris/v5/connectors/supabase.js',()=>({searchCatalogue:vi.fn(async()=>[]),scanCatalogue:vi.fn(async()=>[])}));
vi.mock('../functions/_lib/moris/v5/vector/encoder.js',()=>({encodeQueryImage:vi.fn(async()=>({vector:[1],source:'fixture'}))}));
vi.mock('../functions/_lib/moris/v5/vector/search.js',()=>({searchVectorIndex:vi.fn(async()=>[
  {record_id:'a',similarity:.94},{record_id:'b',similarity:.90},{record_id:'c',similarity:.88}
])}));

const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'};
const sizeQuery={length_mm:100,width_mm:60,shape_class:'rect',source:'user',confidence:null};

async function search({querySize=sizeQuery,configEnv={}}={}){
  const config=readMorisConfig({MORIS_VECTOR_SEARCH_ENABLED:'true',...configEnv});
  return runMorisSearch(env,config,{token:'fixture',ctx:{trace:[],warnings:[]},query:{
    message:'',query_embedding:[1],query_embeddings:[],filters:{usage_side:'all',view_mode:'all'},hints:{},size:querySize
  }});
}

afterEach(()=>vi.unstubAllGlobals());

describe('M28 Size Gate — tích hợp orchestrator (gate sau hydrate, trước rankMetadata)',()=>{
  it('applied: giữ match + unknown, loại mismatch, gắn size_evidence và cảnh báo',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json([
      {record_id:'a',length_mm:100,width_mm:60},
      {record_id:'b',length_mm:300,width_mm:50}
    ])));
    const result=await search();
    expect(result.mode).not.toBe('MORIS_SIZE_GATE_NO_MATCH');
    expect(result.candidates.map(c=>c.id)).toEqual(['a','c','b']);
    expect(result.candidates[0].size_status).toBe('match');
    expect(result.candidates[0].size_evidence.d_max).toBeLessThanOrEqual(0.05);
    expect(result.candidates[1].size_status).toBe('unknown');
    expect(result.candidates[2]).toMatchObject({size_status:'outside_tolerance',selection_group:'rescue_outside'});
    expect(result.size_evidence.status).toBe('applied');
    expect(result.size_evidence).toMatchObject({matched_count:1,unknown_count:1,rejected_count:1});
    expect(result.warnings.some(w=>w.includes('chuyển 1 mã'))).toBe(true);
  });

  it('không có primary thì vẫn trả ứng viên ngoài dung sai có ghi chú cứu sinh',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json([
      {record_id:'a',length_mm:300,width_mm:300},
      {record_id:'b',length_mm:200,width_mm:200},
      {record_id:'c',length_mm:400,width_mm:150}
    ])));
    const result=await search();
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every(c=>c.selection_group==='rescue_outside')).toBe(true);
    expect(result.candidates.every(c=>c.reason.includes('vượt dung sai'))).toBe(true);
    expect(result.size_evidence).toMatchObject({status:'applied',rejected_count:3});
  });

  it('bảng dims chưa tồn tại (404) -> dims_unavailable, giữ nguyên pool (fail-open)',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:404})));
    const result=await search();
    expect(result.candidates).toHaveLength(3);
    expect(result.size_evidence.status).toBe('dims_unavailable');
    expect(result.warnings.some(w=>w.includes('Chưa có dữ liệu kích thước catalogue'))).toBe(true);
  });

  it('tắt bằng MORIS_SIZE_GATE_ENABLED=false -> không đọc dims, không có size_evidence',async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    const result=await search({configEnv:{MORIS_SIZE_GATE_ENABLED:'false'}});
    expect(fetchMock).not.toHaveBeenCalled();
    expect('size_evidence' in result).toBe(false);
    expect(result.candidates).toHaveLength(3);
  });

  it('query không có size -> không gọi dims, không có size_evidence',async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    const result=await search({querySize:null});
    expect(fetchMock).not.toHaveBeenCalled();
    expect('size_evidence' in result).toBe(false);
  });
});
