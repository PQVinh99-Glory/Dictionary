export function assertQueryIdentity(expected, actual) {
  if (String(expected?.query_id || "") !== String(actual?.query_id || "")) {
    const e = new Error("Stale query_id.");
    e.status = 409;
    throw e;
  }

  if (
    expected?.image_hash &&
    actual?.image_hash &&
    expected.image_hash !== actual.image_hash
  ) {
    const e = new Error("image_hash không khớp.");
    e.status = 409;
    throw e;
  }
}
