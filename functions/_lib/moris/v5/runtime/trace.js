export function trace(ctx, stage, data={}) {
  ctx.stage = stage;
  ctx.trace.push({
    stage,
    at:new Date().toISOString(),
    ...data
  });

  if (ctx.trace.length > 40) {
    ctx.trace.splice(0, ctx.trace.length - 40);
  }
}
