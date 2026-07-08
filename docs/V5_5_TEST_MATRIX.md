# V5.5 Test Matrix

## Build
- Wrangler Pages Functions bundle
- zero missing imports
- index inline JS syntax

## Browser model
- Edge/Chrome WebGPU fp16
- forced WASM q8 fallback
- first model download
- second run browser cache
- worker error recovery

## Query
- exact same catalogue image
- same SKU, different angle
- dark
- glare
- crop
- hand visible
- ruler visible
- left/right pair
- same family differing one hole

## Reindex
- 20-row batch
- pause
- continue from offset
- duplicate run upserts, not duplicates
- missing image
- one bad image does not stop batch

## New SKU
- desktop save -> vector written
- vector failure does not break save
- mobile save does not force model download

## Metrics
- Recall@5
- Recall@10
- Recall@30
- MRR

Gate:
- do not enable Gemini until raw vector Recall@30 is measured
