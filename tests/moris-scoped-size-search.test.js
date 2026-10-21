import {describe,it,expect,vi,afterEach} from 'vitest';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
import {runMorisSearch} from '../functions/_lib/moris/v5/orchestrator.js';

vi.mock('../functions/_lib/moris/v5/connectors/catalogue.js',()=>({
  exactLookup:vi.fn(async()=>[]),
  filterVisibleCatalogueIds:vi.fn(async()=>({status:'complete',ids:['target']})),
  hydrateVectorHits:vi.fn(async(_env,_token,hits)=>hits.map(hit=>({
    id:hit.record_id,record_id:hit.record_id,code:hit.record_id,
    raw_vector_similarity:hit.similarity,vector_similarity:hit.similarity,
    retrieval_channels:hit.retrieval_channels,quality:{reliable:true}
  })))
}));
vi.mock('../functions/_lib/moris/v5/connectors/supabase.js',()=>({
  searchCatalogue:vi.fn(async()=>[]),
  scanCatalogue:vi.fn(async()=>[{id:'a'},{id:'target'}])
}));
vi.mock('../functions/_lib/moris/v5/vector/encoder.js',()=>({encodeQueryImage:vi.fn(async()=>({vector:[1],source:'fixture'}))}));
vi.mock('../functions/_lib/moris/v5/vector/search.js',()=>({
  searchVectorIndex:vi.fn(async()=>[{record_id:'a',similarity:.90}]),
  searchScopedVectorIndex:vi.fn(async()=>({status:'ok',hits:[{record_id:'target',similarity:.85}]}))
}));

afterEach(()=>vi.unstubAllGlobals());

describe('P06/P08 scoped length recall',()=>{
  it('candidate ngoài global ANN vẫn vào pool qua size shortlist + scoped cosine',async()=>{
    vi.stubGlobal('fetch',vi.fn(async url=>{
      const params=new URL(url).searchParams;
      if(params.has('and')) return Response.json([{record_id:'target',length_mm:180,width_mm:null}]);
      return Response.json([{record_id:'target',length_mm:180,width_mm:null}]);
    }));
    const config=readMorisConfig({MORIS_VECTOR_SEARCH_ENABLED:'true',MORIS_SCOPED_SIZE_SEARCH_ENABLED:'true'});
    const result=await runMorisSearch({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},config,{
      token:'fixture',ctx:{trace:[],warnings:[],vector_rpc_attempts:[]},query:{
        message:'',query_embedding:[1],query_embeddings:[],
        filters:{usage_side:'all',view_mode:'all'},hints:{},
        size:{length_mm:180,width_mm:null,source:'user'}
      }
    });
    expect(result.size_shortlist_evidence).toMatchObject({status:'matched',visible_candidate_count:1,vector_hit_count:1});
    expect(result.candidates.map(c=>c.id)).toContain('target');
    expect(result.candidates.find(c=>c.id==='target').retrieval_channels).toContain('length_scoped');
  });
});
