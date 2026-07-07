export async function onRequestGet({env}) {
  const body = {
    ok:!!env.SUPABASE_URL && !!env.SUPABASE_ANON_KEY,
    service:"denis-v4-complete",
    architecture:"2-agent default + optional 3rd judge",
    providers:{
      gemini:{
        configured:!!env.GEMINI_API_KEY,
        model:env.DENIS_GEMINI_MODEL || "gemini-3.5-flash"
      },
      openrouter:{
        configured:!!env.OPENROUTER_API_KEY,
        model:env.DENIS_GEMMA_MODEL || "google/gemma-4-31b-it:free"
      }
    },
    budget:{
      max_total:Number(env.DENIS_MAX_AI_CALLS_PER_QUERY || 3),
      max_gemini:Number(env.DENIS_MAX_GEMINI_CALLS_PER_QUERY || 2),
      max_openrouter:Number(env.DENIS_MAX_OPENROUTER_CALLS_PER_QUERY || 1),
      max_candidate_images:Number(env.DENIS_MAX_CANDIDATE_IMAGES || 10)
    }
  };

  return new Response(JSON.stringify(body),{
    status:body.ok ? 200 : 503,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}
