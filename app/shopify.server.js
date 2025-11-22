import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  LogSeverity,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.js";
import { BILLING_CONFIG } from "./config/billing.js";

const REQUIRED_SCOPES = [
  "read_orders",
  "read_refunds",
  "read_customers",
  "read_products",
  "read_inventory",
];

function resolveScopes() {
  const envScopes = (process.env.SCOPES ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  const merged = new Set([...envScopes, ...REQUIRED_SCOPES]);
  return Array.from(merged);
}

const useMemorySession = !process.env.DATABASE_URL;
const memorySessionStore = new Map();

const sessionStorageInstance = useMemorySession
  ? {
      async storeSession(session) {
        memorySessionStore.set(session.id, session);
        return true;
      },
      async loadSession(id) {
        return memorySessionStore.get(id) ?? null;
      },
      async deleteSession(id) {
        return memorySessionStore.delete(id);
      },
      async deleteSessions(ids) {
        ids.forEach((id) => memorySessionStore.delete(id));
        return true;
      },
      async findSessionsByShop() {
        return [];
      },
    }
  : new PrismaSessionStorage(prisma);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "test-key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "test-secret",
  apiVersion: ApiVersion.October25,
  scopes: resolveScopes(),
  appUrl: process.env.SHOPIFY_APP_URL || "http://localhost",
  authPathPrefix: "/auth",
  sessionStorage: sessionStorageInstance,
  distribution: AppDistribution.AppStore,
  billing: BILLING_CONFIG,
  logger: {
    level: LogSeverity.Debug,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
