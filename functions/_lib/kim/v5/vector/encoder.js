import {
  assertEmbeddingContract,
  l2Normalize
} from "./contracts.js";
import {
  activeVectorProfile,
  sameVectorProfile
} from "./profiles.js";

export async function encodeQueryImage(env, config, {
  canonicalImage,
  suppliedEmbedding,
  suppliedProfile
}) {
  const expected = activeVectorProfile(config);

  if (Array.isArray(suppliedEmbedding)) {
    if (!sameVectorProfile(expected, suppliedProfile)) {
      const e = new Error(
        "query_embedding profile không khớp active embedding profile."
      );
      e.code = "KIM_VECTOR_PROFILE_MISMATCH";
      e.status = 400;
      throw e;
    }

    const vector = l2Normalize(suppliedEmbedding);

    assertEmbeddingContract({
      vector,
      dimension:expected.dimension,
      model:expected.model,
      modelVersion:expected.model_version,
      preprocessVersion:expected.preprocess_version,
      profile:expected.profile
    });

    return {
      vector,
      source:"client",
      profile:expected
    };
  }

  if (!config.endpoints.embedding) {
    const e = new Error(
      "Thiếu query_embedding và KIM_EMBEDDING_ENDPOINT."
    );
    e.code = "KIM_VECTOR_ENCODER_NOT_CONFIGURED";
    e.status = 503;
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    60000
  );

  try {
    const res = await fetch(
      config.endpoints.embedding,
      {
        method:"POST",
        signal:controller.signal,
        headers:{
          "content-type":"application/json",
          ...(env.KIM_EMBEDDING_BEARER_TOKEN
            ? {
                "authorization":
                  `Bearer ${env.KIM_EMBEDDING_BEARER_TOKEN}`
              }
            : {})
        },
        body:JSON.stringify({
          image_data_url:canonicalImage,
          profile:expected
        })
      }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok || !Array.isArray(data?.embedding)) {
      const e = new Error(
        data?.error ||
        `Embedding endpoint HTTP ${res.status}`
      );
      e.code = "KIM_VECTOR_ENCODER_FAILED";
      e.status = res.status || 502;
      throw e;
    }

    const vector = l2Normalize(data.embedding);

    assertEmbeddingContract({
      vector,
      dimension:expected.dimension,
      model:expected.model,
      modelVersion:expected.model_version,
      preprocessVersion:expected.preprocess_version,
      profile:expected.profile
    });

    return {
      vector,
      source:"endpoint",
      profile:expected
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const e = new Error("Embedding endpoint timeout.");
      e.code = "KIM_VECTOR_ENCODER_TIMEOUT";
      e.status = 504;
      throw e;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
