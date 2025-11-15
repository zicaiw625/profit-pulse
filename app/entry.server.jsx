import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { applySecurityHeaders } from "./utils/security.server";
import { validateRequiredEnv } from "./utils/env.server";
import { createScopedLogger, serializeError } from "./utils/logger.server.js";

validateRequiredEnv();

export const streamTimeout = 5000;

const renderLogger = createScopedLogger({ service: "entry.server" });

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  const cspNonce =
    reactRouterContext?.staticHandlerContext?.loaderData?.root?.cspNonce;
  if (!cspNonce) {
    throw new Error("Missing CSP nonce from root loader data");
  }

  applySecurityHeaders(responseHeaders, { cspNonce });
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          renderLogger.error("react_stream_error", {
            error: serializeError(error),
            url: request.url,
          });
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
