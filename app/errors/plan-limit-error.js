export class PlanLimitError extends Error {
  constructor({ code, message, detail }) {
    super(message ?? "Plan limit reached");
    this.name = "PlanLimitError";
    this.code = code;
    this.detail = detail;
  }
}

export function isPlanLimitError(error) {
  return error instanceof PlanLimitError;
}
