/** Distinct, typed failure modes so callers can react without string-matching messages. */

export class ValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>

  constructor(issues: Array<{ path: string; message: string }>) {
    super('Invalid registration input')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** Wraps an unexpected failure talking to Appwrite (network, permissions, misconfigured schema). */
export class ExternalServiceError extends Error {
  readonly cause: unknown

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'ExternalServiceError'
    this.cause = cause
  }
}
