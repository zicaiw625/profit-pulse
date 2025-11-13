export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self' https: data:; " +
    "script-src 'self' https://cdn.shopify.com https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.shopify.com; " +
    "img-src 'self' data: https://cdn.shopify.com; " +
    "font-src 'self' https://cdn.shopify.com; " +
    "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com;",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function applySecurityHeaders(headers) {
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  });
}
