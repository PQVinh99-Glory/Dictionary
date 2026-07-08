// Provider-agnostic contract.
// Wire this to the existing Gemini provider only after vector retrieval.

export function buildGeminiResolverInput({
  queryImage,
  canonicalImage,
  candidates,
  queryEvidence
}) {
  return {
    role:"visual_compatibility_resolver",
    rules:[
      "Only rank supplied candidate IDs.",
      "Vector score is retrieval evidence, not truth.",
      "Missing metadata is UNKNOWN.",
      "Visible contradiction is CONFLICT.",
      "Do not mirror left/right.",
      "Account for lighting, angle, partial occlusion and perspective.",
      "Prefer hole placement and silhouette over generic color."
    ],
    query:{
      image:queryImage,
      canonical_image:canonicalImage,
      evidence:queryEvidence
    },
    candidates:(candidates || []).slice(0,10)
  };
}
