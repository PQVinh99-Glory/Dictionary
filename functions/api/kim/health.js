export async function onRequestGet({env}) {
  const body = {
    ok:true,
    service:"thu-ky-kim-v5",
    architecture:"hybrid-vector-vision",
    vector:{
      model:env.KIM_VECTOR_MODEL || "dinov2_vits14",
      dimensions:384,
      profile:env.KIM_EMBEDDING_PROFILE || "cls_l2_v1"
    },
    providers:{
      gemini:{
        configured:!!env.GEMINI_API_KEY,
        model:env.KIM_GEMINI_MODEL || "gemini-3.5-flash"
      },
      openrouter:{
        configured:!!env.OPENROUTER_API_KEY,
        model:env.KIM_GEMMA_MODEL || "google/gemma-4-31b-it:free"
      }
    }
  };

  return new Response(JSON.stringify(body),{
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}
