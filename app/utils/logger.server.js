const SENSITIVE_PARAM_KEYWORDS = [
  "token",
  "secret",
  "key",
  "signature",
  "password",
  "code",
];
const SENSITIVE_META_KEYWORDS = [
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "credential",
  "api_key",
  "client_secret",
];
const BODY_KEY_MATCHERS = ["body", "payload", "raw", "response_body", "responsebody"];

function redactScalar(value, hint = "value") {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return `[REDACTED_${hint.toUpperCase()}:${Math.min(value.length, 256)}]`;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(value)) {
    return `[REDACTED_${hint.toUpperCase()}:buffer:${value.length}]`;
  }
  if (Array.isArray(value)) {
    return value.map(() => `[REDACTED_${hint.toUpperCase()}]`);
  }
  if (typeof value === "object") {
    return { redacted: true, type: hint };
  }
  return `[REDACTED_${hint.toUpperCase()}]`;
}

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
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(meta)) {
    return redactScalar(meta, "binary");
  }
  if (Array.isArray(meta)) {
    return meta.map((item) => sanitizeMeta(item));
  }
  if (typeof meta === "object") {
    const result = {};
    for (const [key, value] of Object.entries(meta)) {
      const lowerKey = key.toLowerCase();
      if (typeof value === "string" && lowerKey.includes("url")) {
        result[key] = redactUrl(value);
      } else if (
        SENSITIVE_META_KEYWORDS.some((keyword) => lowerKey.includes(keyword))
      ) {
        result[key] = redactScalar(value, "secret");
      } else if (typeof value === "string" && lowerKey.includes("authorization")) {
        result[key] = "[REDACTED]";
      } else if (BODY_KEY_MATCHERS.some((matcher) => lowerKey.includes(matcher))) {
        result[key] = redactScalar(value, "body");
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

export function serializeError(error) {
  if (error instanceof Error) {
    const serialized = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) {
      serialized.stack = error.stack;
    }
    if (error.cause) {
      serialized.cause = serializeError(error.cause);
    }
    return serialized;
  }
  if (error == null) {
    return { message: String(error) };
  }
  if (typeof error === "object") {
    return sanitizeMeta(error);
  }
  return { message: String(error) };
}
