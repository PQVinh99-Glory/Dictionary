export async function sha256Hex(input){
  const bytes = new TextEncoder().encode(String(input || ""));
  const digest = await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)]
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

export async function stableHash(value){
  const normalized = JSON.stringify(value);
  return sha256Hex(normalized);
}
