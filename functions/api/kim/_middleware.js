function allowedOrigins(env,request){
  const current=new URL(request.url).origin;
  const extra=String(env.KIM_ALLOWED_ORIGINS || "")
    .split(",").map(x=>x.trim()).filter(Boolean);
  return new Set([current,...extra]);
}

export async function onRequest(context){
  const {request,env,next}=context;
  const method=request.method.toUpperCase();
  const origin=request.headers.get("origin");

  if(origin && !allowedOrigins(env,request).has(origin)){
    return new Response(JSON.stringify({ok:false,error:"Origin không được phép."}),{
      status:403,
      headers:{"content-type":"application/json; charset=utf-8"}
    });
  }

  if(["POST","PUT","PATCH"].includes(method)){
    const type=String(request.headers.get("content-type") || "").toLowerCase();
    if(!type.includes("application/json")){
      return new Response(JSON.stringify({ok:false,error:"Content-Type không hợp lệ."}),{
        status:415,
        headers:{"content-type":"application/json; charset=utf-8"}
      });
    }
  }

  const response=await next();
  const out=new Response(response.body,response);
  out.headers.set("x-content-type-options","nosniff");
  out.headers.set("referrer-policy","same-origin");
  out.headers.set("x-frame-options","DENY");
  out.headers.set("permissions-policy","camera=(), microphone=(), geolocation=()");
  out.headers.set("cache-control","no-store");
  return out;
}
