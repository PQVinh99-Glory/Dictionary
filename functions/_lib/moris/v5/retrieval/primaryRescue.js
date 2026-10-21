import {finalizeCandidatePool} from './candidatePool.js';

/** Group priority is a selection rule; final_score remains the measured fusion score. */
export async function selectPrimaryRescue(rows,{hasQuerySize=false,sizeGateEnabled=true,sizeStatus='not_provided',limit=10}={}){
  const ranked=Array.isArray(rows)?rows:[];
  const cap=Math.max(0,Math.min(10,Math.floor(limit)));
  const isPrimary=row=>!hasQuerySize||!sizeGateEnabled||
    (sizeStatus==='applied'&&['match','match_partial'].includes(row.size_status));
  const {candidates:primary}=await finalizeCandidatePool(ranked.filter(isPrimary),{limit:cap});
  const unknownSlots=cap-primary.length;
  const {candidates:unknown}=unknownSlots>0
    ? await finalizeCandidatePool(ranked.filter(row=>!isPrimary(row)&&row.size_status!=='outside_tolerance'),{limit:unknownSlots})
    : {candidates:[]};
  const outsideSlots=unknownSlots-unknown.length;
  const {candidates:outside}=outsideSlots>0
    ? await finalizeCandidatePool(ranked.filter(row=>row.size_status==='outside_tolerance'),{limit:outsideSlots})
    : {candidates:[]};
  return [
    ...primary.map(row=>({...row,selection_group:'primary'})),
    ...unknown.map(row=>({...row,selection_group:'rescue_unknown',
      reason:'Chưa có số đo cạnh dài trong catalogue; cần đối chiếu thêm.'})),
    ...outside.map(row=>({...row,selection_group:'rescue_outside',
      reason:'Cạnh dài vượt dung sai 5%; chỉ để đối chiếu thêm.'}))
  ];
}
