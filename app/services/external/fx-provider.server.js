import { ExternalServiceError } from "../../errors/external-service-error.js";
import { fetchWithTimeout } from "../../utils/http.server.js";
import { createScopedLogger, serializeError } from "../../utils/logger.server.js";

const DEFAULT_ENDPOINT = "https://api.exchangerate.host/latest";
const fxLogger = createScopedLogger({ service: "fx-provider" });

export async function fetchLatestRates(base = "USD") {
  const endpoint =
    process.env.EXCHANGE_RATE_API_URL?.trim() || DEFAULT_ENDPOINT;
  const url = new URL(endpoint);
  if (!url.searchParams.has("base")) {
    url.searchParams.set("base", base);
  }
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (apiKey && !url.searchParams.has("api_key")) {
    url.searchParams.set("api_key", apiKey);
  }

  try {
    const response = await fetchWithTimeout("fx-provider", url, {
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : undefined,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ExternalServiceError("fx-provider", {
        status: response.status,
        message: "FX provider responded with an error",
        detail: detail.slice(0, 200),
      });
    }
    const payload = await response.json();
    const rates = payload?.rates;
    if (!rates || typeof rates !== "object") {
      throw new Error("FX provider payload missing rates");
    }
    const rawAsOf =
      payload?.time_last_update_unix ||
      payload?.timestamp ||
      payload?.date ||
      new Date();
    const asOfDate =
      typeof rawAsOf === "number"
        ? new Date(rawAsOf * (rawAsOf > 1_000_000_000 ? 1 : 1000))
        : new Date(rawAsOf);
    return {
      base: payload?.base || base,
      asOf: Number.isNaN(asOfDate.getTime()) ? new Date() : asOfDate,
      source: payload?.provider ?? payload?.source ?? "RemoteFX",
      rates,
    };
  } catch (error) {
    fxLogger.error("fx_rates_fetch_failed", {
      context: {
        base,
      },
      endpoint: url.toString(),
      error: serializeError(error),
    });
    const now = new Date();
    return {
      base,
      asOf: now,
      source: "Fallback",
      rates: {
        USD: 1,
        EUR: 0.9,
        CAD: 1.3,
        GBP: 0.78,
      },
    };
  }
}
