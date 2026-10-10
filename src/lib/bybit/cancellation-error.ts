/** A rejected local check is different from an exchange request with an unknown result. */
export class OrderCancellationError extends Error {
  constructor(message: string, readonly dispatchState: "not_sent" | "unknown") {
    super(message);
    this.name = "OrderCancellationError";
  }
}
