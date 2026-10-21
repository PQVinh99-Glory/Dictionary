import {describe,it,expect,vi,afterEach} from 'vitest';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
import {runMorisSearch} from '../functions/_lib/moris/v5/orchestrator.js';

vi.mock('../functions/_lib/moris/v5/connectors/catalogue.js',()=>({
  exactLookup:vi.fn(async()=>[]),
  hydrateVectorHits:vi.fn(async()=>[
    {id:'a',record_id:'a',part_id:'A',raw_vector_similarity:.94,identifying_features:'3 lỗ tròn',
     hole_count:5,quality:{reliable:true}},
    {id:'b',record_id:'b',part_id:'B',raw_vector_similarity:.938,identifying_features:'1 lỗ dài',
     hole_count:9,quality:{reliable:true}},
    {id:'c',record_id:'c',part_id:'C',raw_vector_similarity:.88,identifying_features:'lỗ oval cong',
     hole_count:4,quality:{reliable:true}}
  ])
}));
vi.mock('../functions/_lib/moris/v5/connectors/supabase.js',()=>({searchCatalogue:vi.fn(async()=>[]),scanCatalogue:vi.fn(async()=>[])}));
vi.mock('../functions/_lib/moris/v5/vector/encoder.js',()=>({encodeQueryImage:vi.fn(async()=>({vector:[1],source:'fixture'}))}));
vi.mock('../functions/_lib/moris/v5/vector/search.js',()=>({searchVectorIndex:vi.fn(async()=>[
  {record_id:'a',similarity:.94},{record_id:'b',similarity:.938},{record_id:'c',similarity:.88}
])}));

const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture'};

async function search({holeFormats=null,message='',configEnv={}}={}){
  const config=readMorisConfig({MORIS_VECTOR_SEARCH_ENABLED:'true',...configEnv});
  return runMorisSearch(env,config,{token:'fixture',ctx:{trace:[],warnings:[]},query:{
    message,query_embedding:[1],query_embeddings:[],filters:{usage_side:'all',view_mode:'all'},
    hints:{},size:null,hole_formats:holeFormats
  }});
}

afterEach(()=>vi.unstubAllGlobals());

describe('Từ điển mẫu lỗ — boost định dạng tích hợp orchestrator (flag OFF mặc định)',()=>{
  it('flag ON + hole_formats {dai:1}: mã mô tả "lỗ dài" được boost, có evidence + nhãn khớp',async()=>{
    const result=await search({holeFormats:{dai:1},configEnv:{MORIS_HOLE_FORMAT_BOOST_ENABLED:'true'}});
    expect(result.hole_format_evidence).toMatchObject({version:'hole_format_ref_v1',query_tags:['dai'],matched_count:1,matched_per_tag:{dai:1}});
    expect(result.candidates.map(c=>c.id)).toEqual(['b','a','c']);
  });

  it('flag OFF (mặc định): không boost, không evidence, thứ hạng thuần vector',async()=>{
    const result=await search({holeFormats:{dai:1}});
    expect('hole_format_evidence' in result).toBe(false);
    expect(result.candidates.map(c=>c.id)).toEqual(['a','b','c']);
  });

  it('flag ON nhưng truy vấn không có định dạng lỗ -> không đánh dấu gì',async()=>{
    const result=await search({configEnv:{MORIS_HOLE_FORMAT_BOOST_ENABLED:'true'}});
    expect('hole_format_evidence' in result).toBe(false);
    expect(result.candidates.map(c=>c.id)).toEqual(['a','b','c']);
  });

  it('suy định dạng từ câu chat ("2 lỗ dài") khi flag ON, không cần payload camera',async()=>{
    const result=await search({message:'cần tìm 2 lỗ dài',configEnv:{MORIS_HOLE_FORMAT_BOOST_ENABLED:'true'}});
    expect(result.hole_format_evidence).toMatchObject({query_tags:['dai'],matched_count:1});
  });

  it('"thân dài 20mm" không kích hoạt boost dài (tránh nhầm kích thước)',async()=>{
    const result=await search({message:'thân dài 20mm',configEnv:{MORIS_HOLE_FORMAT_BOOST_ENABLED:'true'}});
    expect('hole_format_evidence' in result).toBe(false);
  });
});
