const SENSITIVE_PARAM_KEYWORDS = [
  "token",
  "secret",
  "key",
  "signature",
  "password",
  "code",
];

function redactUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  try {
    const url = new URL(value);
    const params = url.searchParams;
    let mutated = false;
    for (const key of params.keys()) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_PARAM_KEYWORDS.some((keyword) => lowerKey.includes(keyword))) {
        params.set(key, "[REDACTED]");
        mutated = true;
      }
    }
    if (mutated) {
      url.search = params.toString();
      return url.toString();
    }
    return value;
  } catch {
    return value;
  }
}

function sanitizeMeta(meta) {
  if (meta == null) {
    return meta;
  }
  if (Array.isArray(meta)) {
    return meta.map((item) => sanitizeMeta(item));
  }
  if (typeof meta === "object") {
    const result = {};
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === "string" && key.toLowerCase().includes("url")) {
        result[key] = redactUrl(value);
      } else if (typeof value === "string" && key.toLowerCase().includes("authorization")) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeMeta(value);
      }
    }
    return result;
  }
  return meta;
}

function write(level, scope, message, meta) {
  const payload = {
    level,
    time: new Date().toISOString(),
    msg: message,
  };
  if (scope && Object.keys(scope).length > 0) {
    payload.scope = scope;
  }
  if (meta && Object.keys(meta).length > 0) {
    payload.meta = sanitizeMeta(meta);
  }
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function createLogger(scope = {}) {
  return {
    info(message, meta = {}) {
      write("info", scope, message, meta);
    },
    warn(message, meta = {}) {
      write("warn", scope, message, meta);
    },
    error(message, meta = {}) {
      write("error", scope, message, meta);
    },
    child(childScope = {}) {
      return createLogger({ ...scope, ...childScope });
    },
  };
}

export const logger = createLogger();
export function createScopedLogger(scope) {
  return createLogger(scope);
}
