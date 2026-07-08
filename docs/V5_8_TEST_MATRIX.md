# V5.8 Test Matrix

## Query Vector Bridge
- health vectorSearch=false -> clean disabled message
- vectorSearch=true -> query embedding 384D
- wrong profile -> reject
- same catalogue image -> expected SKU in Top30
- different angle
- glare
- crop
- left/right pair
- same family differing one hole

## Chunked Backfill
- 1 vector
- 20 vectors
- 21 vectors
- 43 vectors
- 107 vectors
- server request >20 -> 413, never truncate
- chunk 2 failure -> cursor locked
- rerun -> idempotent upsert

## Auto Embed Queue
- save new SKU on desktop
- reload during model load
- retry after login
- 4 retry exhaustion -> failed queue
- manual "Tạo vector"
- mobile save queues job but does not force model by default

## Harness
- raw vector retrieval
- metadata fusion
- structural evidence
- Gemini conditional
- Gemma conditional
- no candidate invention
