export class ExternalServiceError extends Error {
  constructor(service, { status, message, detail } = {}) {
    const baseMessage =
      message || `External service ${service} encountered an error`;
    super(baseMessage);
    this.name = "ExternalServiceError";
    this.service = service;
    this.status = status ?? null;
    this.detail = detail ?? null;
  }
}

