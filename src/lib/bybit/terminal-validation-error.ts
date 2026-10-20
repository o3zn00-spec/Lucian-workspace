// Only application-generated validation messages belong in this error.
// Provider errors and credentials must never be copied into it.
export class TerminalValidationError extends Error {}
