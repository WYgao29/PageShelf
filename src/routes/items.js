import {
  clearCache,
  getItem,
  readAsset,
  readDocument,
  readItemFile,
  requireItem,
  search,
  trashItem,
} from "../services/items.js";

export { SOURCE_CSP } from "../services/items.js";

function writeResult(response, sendJson, result) {
  if (Object.hasOwn(result, "json")) {
    sendJson(response, result.status, result.json);
    return;
  }
  response.writeHead(result.status, result.headers);
  if (result.body === undefined) response.end();
  else response.end(result.body);
}

export async function handle({
  request,
  response,
  url,
  library,
  registry,
  cache,
  sendJson,
  body,
  decode,
}) {
  const route = url.pathname,
    method = request.method;
  if (route === "/api/items" && method === "GET") {
    writeResult(
      response,
      sendJson,
      await search({
        library,
        query: Object.fromEntries(url.searchParams),
      }),
    );
    return true;
  }
  if (route === "/api/cache" && method === "DELETE") {
    writeResult(response, sendJson, await clearCache({ cache }));
    return true;
  }
  const match = route.match(
    /^\/api\/items\/([^/]+)(?:\/(document|original|asset|trash|source|download)(?:\/([^/]+))?)?$/,
  );
  if (!match) return false;
  const id = decode(match[1]),
    action = match[2];
  requireItem({ library, id });
  if (!action && method === "GET") {
    writeResult(response, sendJson, await getItem({ library, id }));
    return true;
  }
  if (action === "trash" && method === "POST") {
    writeResult(
      response,
      sendJson,
      await trashItem({ library, cache, id, confirm: body.confirm }),
    );
    return true;
  }
  if (method !== "GET") return false;
  if (action === "asset") {
    writeResult(
      response,
      sendJson,
      await readAsset({
        library,
        registry,
        id,
        assetPath: url.searchParams.get("path"),
      }),
    );
    return true;
  }
  if (["source", "download"].includes(action)) {
    writeResult(
      response,
      sendJson,
      await readItemFile({
        library,
        id,
        format: decode(match[3] || ""),
        action,
      }),
    );
    return true;
  }
  if (["document", "original"].includes(action)) {
    writeResult(
      response,
      sendJson,
      await readDocument({
        library,
        cache,
        id,
        action,
        ifNoneMatch: request.headers["if-none-match"],
      }),
    );
    return true;
  }
  return false;
}
