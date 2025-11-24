import {
  UNINSTALL_RETENTION_DAYS,
  UNINSTALL_RETENTION_WINDOW_MS,
} from "../constants/retention.js";
import { purgeDisconnectedStores } from "../services/retention.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const retentionLogger = createScopedLogger({ route: "internal.retention.cleanup" });
const AUTH_TOKEN = process.env.RETENTION_CRON_SECRET || process.env.SHOPIFY_API_SECRET;

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!AUTH_TOKEN) {
    retentionLogger.error("retention_cleanup_unauthorized", {
      reason: "missing_secret",
    });
    return new Response("Server not configured", { status: 500 });
  }

  if (!isAuthorized(request)) {
    retentionLogger.warn("retention_cleanup_unauthorized", {
      reason: "invalid_token",
    });
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await purgeDisconnectedStores({
      retentionDays: UNINSTALL_RETENTION_DAYS,
    });
    retentionLogger.info("retention_cleanup_ran", {
      ...result,
      deleteAfterDays: UNINSTALL_RETENTION_DAYS,
      retentionWindowMs: UNINSTALL_RETENTION_WINDOW_MS,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    retentionLogger.error("retention_cleanup_failed", {
      error: serializeError(error),
    });
    return new Response("Internal server error", { status: 500 });
  }
};

function isAuthorized(request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : header;
  return token === AUTH_TOKEN;
}
