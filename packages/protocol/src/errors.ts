/**
 * Aibou error codes — used in ErrorFrame and typed errors.
 */
export const AibouErrorCode = {
  UNAUTHORIZED: 'AIBOU_UNAUTHORIZED',
  BAD_CWD: 'AIBOU_BAD_CWD',
  SESSION_LIMIT: 'AIBOU_SESSION_LIMIT',
  SESSION_NOT_FOUND: 'AIBOU_SESSION_NOT_FOUND',
  ALREADY_RESOLVED: 'AIBOU_ALREADY_RESOLVED',
  APPROVAL_NOT_FOUND: 'AIBOU_APPROVAL_NOT_FOUND',
  UNSUPPORTED: 'AIBOU_UNSUPPORTED',
  AGENT_DOWN: 'AIBOU_AGENT_DOWN',
  RATE_LIMITED: 'AIBOU_RATE_LIMITED',
  BAD_FRAME: 'AIBOU_BAD_FRAME',
  INTERNAL: 'AIBOU_INTERNAL',
} as const;

export type AibouErrorCode = (typeof AibouErrorCode)[keyof typeof AibouErrorCode];

/**
 * Exit codes for the Bridge process.
 */
export const ExitCode = {
  AGENT_UNAVAILABLE: 78,
  PORT_IN_USE: 98,
  UNHANDLED: 1,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Typed error class for Aibou errors.
 */
export class AibouError extends Error {
  constructor(
    public readonly code: AibouErrorCode,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AibouError';
  }
}
