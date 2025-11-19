import { ExternalServiceError } from "../errors/external-service-error.js";

const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(
  service,
  input,
  { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {},
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ExternalServiceError(service, {
        message: `Request timed out after ${timeoutMs}ms`,
      });
    }
    if (error instanceof ExternalServiceError) {
      throw error;
    }
    throw new ExternalServiceError(service, {
      message: error?.message ?? "Network request failed",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

