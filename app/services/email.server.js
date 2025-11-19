import { ExternalServiceError } from "../errors/external-service-error.js";
import { fetchWithTimeout } from "../utils/http.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const emailLogger = createScopedLogger({ service: "email" });

export async function sendDigestEmail({ recipients, subject, body }) {
  const endpoint = process.env.PROFIT_PULSE_EMAIL_ENDPOINT;
  const normalizedRecipients = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : typeof recipients === "string"
      ? recipients
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  const payload = {
    to: normalizedRecipients,
    subject,
    body,
  };

  if (endpoint) {
    try {
      const response = await fetchWithTimeout("email", endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new ExternalServiceError("email", {
          status: response.status,
          message: "Email API rejected the digest payload",
          detail: detail.slice(0, 200),
        });
      }
    } catch (error) {
      emailLogger.error("digest_email_failed", {
        context: {
          recipientsCount: normalizedRecipients.length,
        },
        endpoint,
        error: serializeError(error),
      });
      return false;
    }
    return true;
  }

  emailLogger.info("digest_email_mock", {
    context: {
      recipientsCount: normalizedRecipients.length,
    },
    subject,
  });
  return true;
}
