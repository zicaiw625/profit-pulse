export async function sendDigestEmail({ recipients, subject, body }) {
  const endpoint = process.env.PROFIT_PULSE_EMAIL_ENDPOINT;
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
      console.error("Failed to send scheduled digest email", error);
      return false;
    }
    return true;
  }

  console.log("Scheduled digest email (mock)");
  console.log(JSON.stringify(payload, null, 2));
  return true;
}
