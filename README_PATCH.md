# V5.9 Exact Patch

Apply after V5.8.

Important migration:

```text
KIM_PREPROCESS_VERSION=kim_canon_v2
```

Reindex from offset 0 after deploy.

Run the reviewed SQL patch because vector search is moved from public anon RPC access to server-secret-only access.
