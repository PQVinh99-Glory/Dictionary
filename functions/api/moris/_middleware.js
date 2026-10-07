function allowedOrigins(env,request){
  const current=new URL(request.url).origin;
  const extra=String(env.MORIS_ALLOWED_ORIGINS || "")
    .split(",").map(x=>x.trim()).filter(Boolean);
  return new Set([current,...extra]);
}

function securityHeaders(response){
  const out=new Response(response.body,response);
  out.headers.set("x-content-type-options","nosniff");
  out.headers.set("referrer-policy","same-origin");
  out.headers.set("x-frame-options","DENY");
  out.headers.set("permissions-policy","camera=(), microphone=(), geolocation=()");
  out.headers.set("cache-control","no-store");
  return out;
}

function jsonResponse(body,status){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "x-content-type-options":"nosniff",
      "referrer-policy":"same-origin",
      "x-frame-options":"DENY",
      "permissions-policy":"camera=(), microphone=(), geolocation=()",
      "cache-control":"no-store"
    }
  });
}

export async function onRequest(context){
  const {request,env,next}=context;
  const method=request.method.toUpperCase();
  const origin=request.headers.get("origin");

  if(origin && !allowedOrigins(env,request).has(origin)){
    return jsonResponse({ok:false,error:"Origin không được phép."},403);
  }

  if(["POST","PUT","PATCH"].includes(method)){
    const type=String(request.headers.get("content-type") || "").toLowerCase();
    if(!type.includes("application/json")){
      return jsonResponse({ok:false,error:"Content-Type không hợp lệ."},415);
    }
  }

  // Bắt mọi lỗi ném ra từ handler: Pages/Workers KHÔNG tôn trọng error.status
  // nên nếu để lọt ra ngoài sẽ thành 500 "error code: 1101" (trả text/plain).
  let response;
  try{
    response=await next();
  }catch(error){
    const status=Number(error?.status);
    const code=(Number.isInteger(status) && status>=400 && status<600) ? status : 500;
    if(code>=500) console.error("moris handler error:", error);
    return jsonResponse({
      ok:false,
      error: code>=500
        ? "Lỗi máy chủ. Vui lòng thử lại sau."
        : String(error?.message || "Yêu cầu không hợp lệ.")
    }, code);
  }

  return securityHeaders(response);
}
