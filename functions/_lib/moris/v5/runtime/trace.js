export function trace(ctx, stage, data={}) {
  const now=performance.now();
  const previous=ctx.trace.at(-1);
  if(previous && Number.isFinite(previous.monotonic_ms)) {
    previous.duration_ms=Math.max(0,now-previous.monotonic_ms);
  }
  ctx.stage = stage;
  ctx.trace.push({
    stage,
    at:new Date().toISOString(),
    ...data,
    monotonic_ms:now,
    elapsed_ms:Number.isFinite(ctx.started_monotonic_ms)
      ? Math.max(0,now-ctx.started_monotonic_ms)
      : null
  });

  if (ctx.trace.length > 40) {
    ctx.trace.splice(0, ctx.trace.length - 40);
  }
}

export function summarizeTrace(ctx) {
  const now=performance.now();
  return (ctx?.trace || []).map((entry) => ({
    stage:entry.stage,
    ...(Number.isFinite(entry.count) ? {count:entry.count} : {}),
    elapsed_ms:entry.elapsed_ms,
    duration_ms:Number.isFinite(entry.duration_ms)
      ? entry.duration_ms
      : Math.max(0,now-entry.monotonic_ms)
  }));
}
