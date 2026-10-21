import {describe,it,expect} from 'vitest';
import {selectPrimaryRescue} from '../functions/_lib/moris/v5/retrieval/primaryRescue.js';
import {toPublicMorisResult} from '../functions/_lib/moris/v5/presentation/publicResult.js';
import {assessImageResult} from '../functions/_lib/moris/v5/presentation/imageDecision.js';

const row=(id,status,score)=>({id,code:id,size_status:status,final_score:score,match_score:score});

describe('P09 primary/rescue top10',()=>{
  it('10 primary blocks rescue even if rescue score is higher',async()=>{
    const rows=[...Array.from({length:10},(_,i)=>row(`p${i}`,'match',.9-i*.01)),row('outside','outside_tolerance',.99)];
    const selected=await selectPrimaryRescue(rows,{hasQuerySize:true,sizeStatus:'applied'});
    expect(selected).toHaveLength(10);
    expect(selected.every(c=>c.selection_group==='primary')).toBe(true);
  });

  it('7 primary fills only 3 rescue slots; API keeps group order and original score',async()=>{
    const rows=[...Array.from({length:7},(_,i)=>row(`p${i}`,'match',.7-i*.01)),
      row('unknown','unknown',.99),row('outside1','outside_tolerance',.98),
      row('outside2','outside_tolerance',.97),row('outside3','outside_tolerance',.96)];
    const selected=await selectPrimaryRescue(rows,{hasQuerySize:true,sizeStatus:'applied'});
    expect(selected.map(c=>c.selection_group)).toEqual([
      ...Array(7).fill('primary'),'rescue_unknown','rescue_outside','rescue_outside'
    ]);
    expect(selected.map(c=>c.id)).not.toContain('outside3');
    const publicResult=toPublicMorisResult({mode:'MORIS_VECTOR_SUGGESTIONS',candidates:selected});
    expect(publicResult.candidates.map(c=>c.id)).toEqual(selected.map(c=>c.id));
    expect(publicResult.candidates[7].match_score).toBe(.99);
    expect(publicResult.candidates[8].reason).toContain('vượt dung sai');
  });

  it('0 primary and no rescue returns empty rather than padding',async()=>{
    expect(await selectPrimaryRescue([],{hasQuerySize:true,sizeStatus:'applied'})).toEqual([]);
  });

  it('rescue ở top phải cần người đối chiếu, score cao không thành xác nhận chắc chắn',()=>{
    const decision=assessImageResult([row('r','outside_tolerance',.99)].map(c=>({...c,selection_group:'rescue_outside'})));
    expect(decision).toMatchObject({status:'needs_review',accepted:false,reasons:['size_unverified']});
  });
});
