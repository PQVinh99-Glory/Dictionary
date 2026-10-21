import {describe,it,expect,vi,beforeEach} from 'vitest';
import {hydrateVectorHits,filterVisibleCatalogueIds} from '../functions/_lib/moris/v5/connectors/catalogue.js';
import {rpc,scanCatalogue} from '../functions/_lib/moris/v5/connectors/supabase.js';

vi.mock('../functions/_lib/moris/v5/connectors/supabase.js',()=>({
  rpc:vi.fn(),searchCatalogue:vi.fn(),scanCatalogue:vi.fn()
}));

const uuid=i=>`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
beforeEach(()=>{vi.clearAllMocks();});

describe('P08 keyed hydration proposal contract',()=>{
  it('session-filtered ID RPC cannot return IDs outside requested scope',async()=>{
    rpc.mockResolvedValue([{id:uuid(1)},{id:uuid(999)}]);
    const result=await filterVisibleCatalogueIds({},'session',[uuid(1),uuid(2)],{usage_side:'right'});
    expect(result).toEqual({status:'complete',ids:[uuid(1)]});
    expect(rpc.mock.calls[0][2]).toMatchObject({p_session_token:'session',p_usage_side:'right'});
    expect(scanCatalogue).not.toHaveBeenCalled();
  });

  it('chunks >100 IDs, passes session/filters, drops orphan without a catalogue scan',async()=>{
    const hits=Array.from({length:101},(_,i)=>({record_id:uuid(i),similarity:.8}));
    rpc.mockImplementation(async(_env,_name,args)=>args.p_record_ids
      .filter(id=>id!==uuid(100))
      .map(id=>({id,code:id,usage_side:'right',view_mode:'single_face'})));
    const status=[];
    const rows=await hydrateVectorHits({},'session',hits,{
      keyed:true,filters:{usage_side:'right',view_mode:'single_face'},
      onStatus:s=>status.push(s)
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][2]).toMatchObject({
      p_session_token:'session',p_usage_side:'right',p_view_mode:'single_face'
    });
    expect(rpc.mock.calls[0][2].p_record_ids).toHaveLength(100);
    expect(rpc.mock.calls[1][2].p_record_ids).toHaveLength(1);
    expect(scanCatalogue).not.toHaveBeenCalled();
    expect(rows).toHaveLength(100);
    expect(rows.some(row=>row.record_id===uuid(100))).toBe(false);
    expect(status).toEqual([{status:'keyed',requested:101,returned:100}]);
  });

  it('RPC unavailable uses complete legacy scan only as explicit fallback',async()=>{
    rpc.mockRejectedValue(Object.assign(new Error('missing'),{status:404}));
    scanCatalogue.mockResolvedValue([{id:uuid(1),code:'A'}]);
    const status=[];
    const rows=await hydrateVectorHits({},'session',[{record_id:uuid(1),similarity:.9}],{
      keyed:true,onStatus:s=>status.push(s)
    });
    expect(rows).toHaveLength(1);
    expect(status.map(s=>s.status)).toEqual(['keyed_unavailable','scan_fallback']);
  });
});
