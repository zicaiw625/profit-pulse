import { createScopedLogger } from "./logger.server.js";

const concurrencyLogger = createScopedLogger({ service: "concurrency" });

function normalizeLimit(limit) {
  const numeric = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }
  return numeric;
}

export async function mapWithConcurrency(items, limit, worker) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  if (typeof worker !== "function") {
    throw new TypeError("worker must be a function");
  }

  const maxConcurrency = Math.max(normalizeLimit(limit), 1);
  concurrencyLogger.debug?.("concurrency.map.start", {
    size: items.length,
    limit: maxConcurrency,
  });

  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const nextIndex = cursor;
      cursor += 1;
      if (nextIndex >= items.length) {
        return;
      }

      try {
        results[nextIndex] = await worker(items[nextIndex], nextIndex);
      } catch (error) {
        concurrencyLogger.error?.("concurrency.map.failure", {
          index: nextIndex,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

export async function runWithConcurrency(items, limit, worker) {
  await mapWithConcurrency(items, limit, worker);
}
