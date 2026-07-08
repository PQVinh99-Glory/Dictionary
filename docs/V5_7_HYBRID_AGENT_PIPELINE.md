# V5.7 — Backfill Integrity + Hybrid Agent Pipeline

## Root cause fixed

The old reindex route expected fields like:

```text
front_path
back_path
detail_path
thumb_path
```

The real application stores assets separately and reads them with:

```text
app_get_part_assets(
  p_session_token,
  p_image_id
)
```

Each real asset provides:

```text
asset_type
image_path
sort_order
```

V5.7 reads that real contract.

## Cursor invariant

Old:

```text
rows read
-> cursor increases
```

New:

```text
rows read
-> real assets found
-> embedding generated
-> Supabase write succeeds
-> only then cursor advances
```

## Hybrid image search

```text
Query image
  -> Browser DINOv2 384D
  -> pgvector HNSW Top30
  -> hydrate catalogue metadata
  -> metadata rank
  -> structural evidence
  -> deterministic fusion
       vector 75%
       metadata 15%
       structural 10%
  -> Top8-10 candidate pool
  -> Gemini Resolver conditional
       query image
       candidate images
       identifying_features
       confusing_note
       usage_side
       vector_similarity
       final_score
  -> Gemma Critic conditional
  -> Thư ký Kim public response
```

## Activation order

1. Backfill until active_vectors > 0
2. Test image retrieval with agents OFF
3. Measure Recall@30
4. Enable Gemini
5. Enable Gemma
