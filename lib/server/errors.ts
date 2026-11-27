// One error type for the whole server. The HTTP layer turns it into the API's error envelope.

export type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "validation_failed" | "conflict" | "rate_limited" | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, validation_failed: 422, rate_limited: 429, internal: 500,
};

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: Record<string, string>) {
    super(message);
  }
  get status() { return STATUS[this.code]; }
}

export const notFound = (what: string) => new ApiError("not_found", `${what} not found.`);
export const forbidden = (message = "You don't have access to this.") => new ApiError("forbidden", message);
export const conflict = (message: string) => new ApiError("conflict", message);

/** Field errors from a validator (e.g. validateLeave) become a 422 with the first message as the summary. */
export function invalid(details: Record<string, string>): ApiError {
  const first = Object.values(details)[0] ?? "Some fields aren't valid.";
  return new ApiError("validation_failed", first, details);
}
