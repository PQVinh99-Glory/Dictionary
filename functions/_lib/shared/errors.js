export class HttpError extends Error {
  constructor(status, message, details=null) {
    super(String(message || "Unexpected error"));
    this.name = "HttpError";
    this.status = Number(status || 500);
    this.details = details;
  }
}

export function asHttpError(error, fallbackStatus=500) {
  if (error instanceof HttpError) return error;
  const status = Number(error?.status || fallbackStatus || 500);
  return new HttpError(status, error?.message || String(error || "Unexpected error"), error?.details || null);
}
