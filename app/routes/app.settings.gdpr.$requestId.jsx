import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getGdprRequest } from "../services/privacy.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const requestId = params.requestId;
  if (!requestId) {
    throw new Response("Request not found", { status: 404 });
  }

  const record = await getGdprRequest({
    merchantId: store.merchantId,
    requestId,
  });

  if (!record || record.type !== "EXPORT" || !record.exportPayload) {
    throw new Response("No export available", { status: 404 });
  }

  return new Response(JSON.stringify(record.exportPayload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="gdpr-export-${record.subjectEmail}.json"`,
    },
  });
};

export const headers = (args) => boundary.headers(args);
