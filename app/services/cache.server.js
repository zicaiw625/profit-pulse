import { createScopedLogger } from "../utils/logger.server.js";

const cacheLogger = createScopedLogger({ service: "cache" });

function createMemoryCacheBackend() {
  const cacheStore = new Map();

  return {
    name: "memory",
    async memoize(key, ttlMs, compute) {
      const now = Date.now();
      const cached = cacheStore.get(key);
      if (cached) {
        if (cached.value !== undefined && cached.expiresAt > now) {
          return cached.value;
        }
        if (cached.promise) {
          return cached.promise;
        }
      }

      const ttl = Math.max(Number(ttlMs ?? 0), 0);
      const promise = (async () => {
        const value = await compute();
        if (ttl > 0) {
          cacheStore.set(key, {
            value,
            expiresAt: Date.now() + ttl,
          });
        } else {
          cacheStore.delete(key);
        }
        return value;
      })();

      cacheStore.set(key, {
        promise,
        expiresAt: now + ttl,
      });

      return promise;
    },
    async clear(key) {
      cacheStore.delete(key);
    },
    async shutdown() {
      cacheStore.clear();
    },
  };
}

function createUpstashCacheBackend({ url, token }) {
  const normalizedBase = url.replace(/\/+$/, "");
  const endpoint = `${normalizedBase}/pipeline`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const inflight = new Map();

  async function execute(command) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify([command]),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Upstash request failed with ${response.status}: ${text?.slice(0, 200) ?? ""}`,
      );
    }
    const payload = await response.json();
    const [result] = Array.isArray(payload) ? payload : [];
    if (!result) {
      return null;
    }
    if (result.error) {
      throw new Error(result.error);
    }
    return result.result ?? null;
  }

  return {
    name: "upstash",
    async memoize(key, ttlMs, compute) {
      const ttl = Math.max(Number(ttlMs ?? 0), 0);
      if (ttl === 0) {
        return compute();
      }

      if (inflight.has(key)) {
        return inflight.get(key);
      }

      const promise = (async () => {
        try {
          const cached = await execute(["GET", key]);
          if (cached !== null && cached !== undefined) {
            return JSON.parse(cached);
          }
        } catch (error) {
          cacheLogger.warn("Failed to read Upstash cache entry", {
            backend: "upstash",
            key,
            error: error.message,
          });
        }

        const value = await compute();

        try {
          const serialized = JSON.stringify(value);
          await execute(["SET", key, serialized, "PX", String(ttl)]);
        } catch (error) {
          cacheLogger.warn("Failed to store Upstash cache entry", {
            backend: "upstash",
            key,
            error: error.message,
          });
        }

        return value;
      })().finally(() => {
        inflight.delete(key);
      });

      inflight.set(key, promise);
      return promise;
    },
    async clear(key) {
      inflight.delete(key);
      try {
        await execute(["DEL", key]);
      } catch (error) {
        cacheLogger.warn("Failed to clear Upstash cache entry", {
          backend: "upstash",
          key,
          error: error.message,
        });
      }
    },
    async shutdown() {
      inflight.clear();
    },
  };
}

let activeBackend = createMemoryCacheBackend();

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
if (upstashUrl && upstashToken) {
  try {
    activeBackend = createUpstashCacheBackend({ url: upstashUrl, token: upstashToken });
    cacheLogger.info("Using Upstash Redis cache backend", {
      backend: "upstash",
      url: sanitizeUpstashUrl(upstashUrl),
    });
  } catch (error) {
    cacheLogger.warn("Failed to initialize Upstash cache backend", {
      backend: "upstash",
      error: error.message,
    });
  }
}

export function buildCacheKey(prefix, identifier, rangeStartIso) {
  const keyParts = [prefix, identifier];
  if (rangeStartIso) {
    keyParts.push(rangeStartIso);
  }
  return keyParts.join(":");
}

export async function memoizeAsync(key, ttlMs, compute) {
  return activeBackend.memoize(key, ttlMs, compute);
}

export function clearCache(key) {
  return activeBackend.clear(key);
}

export function getCacheBackendName() {
  return activeBackend.name ?? "unknown";
}

export function setCacheBackendForTests(backend) {
  if (!backend) {
    activeBackend = createMemoryCacheBackend();
    return;
  }
  if (typeof backend.memoize !== "function" || typeof backend.clear !== "function") {
    throw new Error("cache backend must implement memoize() and clear()");
  }
  activeBackend = backend;
}

export async function shutdownCache() {
  if (typeof activeBackend.shutdown === "function") {
    await activeBackend.shutdown();
  }
}

export const memoryCacheBackendFactory = createMemoryCacheBackend;

function sanitizeUpstashUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "***");
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}
