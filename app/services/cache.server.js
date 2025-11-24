// Simple in-process cache backend. Replace this module with a centralized cache if
// you need shared memoization across multiple app instances.

// NOTE: The cache backend keeps memoized entries inside a single Node.js process via
// a module-scoped Map. In multi-instance/serverless deployments this cache is not
// shared, so any new keys should remain tolerant of short-lived divergence. If you
// later need a shared cache, swap this module to a centralized store.

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

let activeBackend = createMemoryCacheBackend();

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
