// Conservative operator guidance, not a calibrated identity/false-accept model.
export function assessImageResult(candidates,{quality=null,orientationAmbiguous=false}={}){
 if(!candidates.length)return {accepted:false,status:'no_match',reasons:['no_candidates'],margin:null,calibrated:false};
 const score=r=>typeof r.final_score==='number'&&Number.isFinite(r.final_score)?r.final_score:null;
 const first=score(candidates[0]),second=candidates.length>1?score(candidates[1]):null;
 const margin=first!=null&&second!=null?Math.max(0,first-second):null;
 const reasons=[];
 if(quality?.reliable===false)reasons.push('low_quality');
 if(candidates[0]?.selection_group?.startsWith('rescue_'))reasons.push('size_unverified');
 if(orientationAmbiguous)reasons.push('orientation_uncertain');
 if(margin!==null&&margin<.03)reasons.push('close_candidates');
 if(first===null)reasons.push('missing_score');
 return {accepted:reasons.length?false:null,status:reasons.length?'needs_review':'suggestions',reasons,margin,calibrated:false};
}
