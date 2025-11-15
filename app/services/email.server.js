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
    to: recipients,
    subject,
    body,
  };

  if (endpoint) {
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
