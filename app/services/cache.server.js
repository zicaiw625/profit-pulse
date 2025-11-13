const cacheStore = new Map();

export function buildCacheKey(prefix, identifier, rangeStartIso) {
  const keyParts = [prefix, identifier];
  if (rangeStartIso) {
    keyParts.push(rangeStartIso);
  }
  return keyParts.join(":");
}

export async function memoizeAsync(key, ttlMs, compute) {
  const now = Date.now();
  const cached = cacheStore.get(key);
  if (cached) {
    if (cached.expiresAt > now && cached.value !== undefined) {
      return cached.value;
    }
    if (cached.promise) {
      return cached.promise;
    }
  }

  const promise = (async () => {
    const value = await compute();
    cacheStore.set(key, {
      value,
      expiresAt: Date.now() + Math.max(ttlMs, 0),
    });
    return value;
  })();

  cacheStore.set(key, {
    promise,
    expiresAt: now + Math.max(ttlMs, 0),
  });

  return promise;
}

export function clearCache(key) {
  cacheStore.delete(key);
}
