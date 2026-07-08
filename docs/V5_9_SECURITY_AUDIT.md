# V5.9 Security Audit

## Critical fixes in code

1. Vector-match RPC is no longer executable by `anon` or `authenticated`.
   Search uses server secret only.
2. `/api/kim/*` middleware rejects foreign `Origin` requests.
3. JSON Content-Type required for state-changing API calls.
4. Public health endpoint no longer reveals provider/key configuration.
5. Strict query embedding validation: finite numbers, exact 384D, max 3 probes.
6. New `SUPABASE_SECRET_KEY` is supported; legacy service-role remains fallback.

## Remaining risks

### P1 — custom session token in localStorage
XSS could steal the token. Long-term migration target:

```text
HttpOnly + Secure + SameSite=Strict cookie
```

Do not change this casually because current RPC contracts use `p_session_token`.

### P1 — no application-level distributed rate limiter
Configure Cloudflare WAF rate limiting:

```text
/api/kim/search          30 requests / minute / IP
/api/kim/vector-upsert   20 requests / minute / IP
/api/kim/reindex-*       10 requests / minute / IP
login RPC route          5 attempts / minute / IP
```

Add Turnstile to login if abuse is possible.

### P2 — model/CDN supply chain
Pin exact Transformers.js version and model revision. Consider self-hosting approved ONNX artifacts after license and integrity review.

### P2 — service secret blast radius
Use a dedicated Supabase secret key where possible; rotate immediately if exposed. Never place it in `index.html` or browser storage.

### P2 — prompt injection through metadata
LLM prompts must treat catalogue metadata as untrusted evidence. Candidate IDs remain constrained by the deterministic candidate pool.

## Recommended operational controls

- Cloudflare rate limiting
- Turnstile on login
- daily backup / restore drill
- secret rotation schedule
- Cloudflare Functions metrics and logs
- Supabase audit review
- dependency pinning and SRI where feasible
