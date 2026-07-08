export function boundedInt(value,fallback,min,max){
  const n = Number(value);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,Math.trunc(n)));
}

export function boolEnv(value,fallback=false){
  if(value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}
