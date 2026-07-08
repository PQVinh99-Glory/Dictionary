export function requireString(value, name, {max=5000, allowEmpty=false}={}) {
  const s = String(value ?? "");
  if (!allowEmpty && !s.trim()) {
    const e = new Error(`Thiếu ${name}.`);
    e.status = 400;
    throw e;
  }
  if (s.length > max) {
    const e = new Error(`${name} vượt quá ${max} ký tự.`);
    e.status = 400;
    throw e;
  }
  return s;
}

export function optionalString(value, {max=5000}={}) {
  if (value == null) return "";
  return requireString(value, "string", {max, allowEmpty:true});
}

export function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function boolEnv(value, fallback=false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}
