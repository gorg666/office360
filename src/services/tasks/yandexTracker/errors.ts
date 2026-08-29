export type TaskErrorCode =
  | "unauthorized"
  | "permission-denied"
  | "configuration-required"
  | "organization-mismatch"
  | "assignee-unresolved"
  | "queue-unavailable"
  | "conflict"
  | "not-found"
  | "rate-limited"
  | "offline"
  | "unavailable"
  | "provider-unavailable";

export class TaskError extends Error {
  readonly code: TaskErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(code: TaskErrorCode, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    this.name = "TaskError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.cause = options?.cause;
  }
}

export function isTaskError(error: unknown): error is TaskError {
  return error instanceof TaskError;
}
