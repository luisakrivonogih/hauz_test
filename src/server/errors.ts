/** Distinct, typed failure modes for the app's own server functions (separate from the Function's own copy in functions/register-personal-account). */

export class ValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>

  constructor(issues: Array<{ path: string; message: string }>) {
    super('Invalid input')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** Something that already exists / a precondition that's already satisfied — not a crash, just not actionable as requested. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ExternalServiceError extends Error {
  readonly cause: unknown

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'ExternalServiceError'
    this.cause = cause
  }
}
