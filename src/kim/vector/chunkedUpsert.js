export const KIM_VECTOR_UPSERT_MAX_PER_REQUEST = 20;

export function chunkArray(rows, size=KIM_VECTOR_UPSERT_MAX_PER_REQUEST) {
  const limit = Math.max(1, Math.min(
    Number(size || KIM_VECTOR_UPSERT_MAX_PER_REQUEST),
    KIM_VECTOR_UPSERT_MAX_PER_REQUEST
  ));

  const out = [];
  for (let i=0; i<(rows || []).length; i+=limit) {
    out.push(rows.slice(i, i+limit));
  }
  return out;
}

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

export async function upsertVectorsChunked({
  endpoint="/api/kim/vector-upsert",
  sessionToken,
  vectors,
  chunkSize=KIM_VECTOR_UPSERT_MAX_PER_REQUEST,
  timeoutMs=180000,
  strict=true,
  fetchImpl=fetch,
  onChunk
}={}) {
  const rows = Array.isArray(vectors) ? vectors : [];
  if (!rows.length) {
    return {
      ok:true,
      accepted:0,
      written:0,
      failed:0,
      chunks:0,
      results:[]
    };
  }

  const chunks = chunkArray(rows, chunkSize);

  const aggregate = {
    ok:true,
    accepted:0,
    written:0,
    failed:0,
    chunks:chunks.length,
    results:[]
  };

  for (let index=0; index<chunks.length; index++) {
    const chunk = chunks[index];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      onChunk?.({
        phase:"start",
        chunk_index:index,
        chunk_number:index+1,
        chunk_count:chunks.length,
        size:chunk.length,
        aggregate:{...aggregate}
      });

      const res = await fetchImpl(endpoint,{
        method:"POST",
        signal:controller.signal,
        headers:{
          "content-type":"application/json"
        },
        body:JSON.stringify({
          session_token:String(sessionToken || ""),
          vectors:chunk
        })
      });

      const data = await parseJsonSafe(res);

      if (!res.ok || data?.ok === false) {
        const error = new Error(
          data?.error ||
          `Vector upsert chunk ${index+1}/${chunks.length} HTTP ${res.status}`
        );
        error.status = res.status;
        error.chunk_index = index;
        error.chunk_number = index+1;
        error.chunk_count = chunks.length;
        error.details = data;
        throw error;
      }

      const accepted = Number(data?.accepted ?? chunk.length);
      const written = Number(data?.written || 0);
      const failed = Number(data?.failed || 0);

      aggregate.accepted += accepted;
      aggregate.written += written;
      aggregate.failed += failed;
      aggregate.results.push(...(
        Array.isArray(data?.results) ? data.results : []
      ));

      onChunk?.({
        phase:"done",
        chunk_index:index,
        chunk_number:index+1,
        chunk_count:chunks.length,
        size:chunk.length,
        accepted,
        written,
        failed,
        aggregate:{...aggregate}
      });

      if (strict && failed > 0) {
        const error = new Error(
          data?.first_error ||
          `Chunk ${index+1}/${chunks.length} có ${failed} vector ghi thất bại.`
        );
        error.chunk_index = index;
        error.chunk_number = index+1;
        error.chunk_count = chunks.length;
        error.details = data;
        throw error;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(
          `Vector upsert timeout tại chunk ${index+1}/${chunks.length}.`
        );
        timeoutError.code = "KIM_VECTOR_UPSERT_TIMEOUT";
        timeoutError.chunk_index = index;
        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  if (strict && aggregate.written !== rows.length) {
    const error = new Error(
      `Vector write không toàn vẹn: expected=${rows.length}, written=${aggregate.written}.`
    );
    error.code = "KIM_VECTOR_WRITE_INTEGRITY";
    error.details = aggregate;
    throw error;
  }

  return aggregate;
}
