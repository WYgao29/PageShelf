import {
  assertKnownRoot,
  listRoots,
  listSeries,
  orderRoots,
  removeRoot,
  saveRoot,
  scanAll,
  scanRoot,
  scanStatus,
} from "../services/roots.js";

export { rootResponse } from "../services/roots.js";

function writeResult(response, sendJson, result) {
  if (Object.hasOwn(result, "json")) {
    sendJson(response, result.status, result.json);
    return;
  }
  response.writeHead(result.status, result.headers);
  if (result.body === undefined) response.end();
  else response.end(result.body);
}

export async function handle(context) {
  const { request, response, url, library, registry, sendJson, body, decode } =
    context;
  const route = url.pathname,
    method = request.method,
    deps = { library, registry };
  if (route === "/api/roots" && method === "GET") {
    writeResult(response, sendJson, await listRoots(deps));
    return true;
  }
  if (route === "/api/scan/status" && method === "GET") {
    writeResult(response, sendJson, await scanStatus(deps));
    return true;
  }
  if (route === "/api/scan" && method === "POST") {
    writeResult(
      response,
      sendJson,
      await scanAll({ ...deps, full: url.searchParams.get("full") === "1" }),
    );
    return true;
  }
  if (route === "/api/roots/order" && method === "PUT") {
    writeResult(
      response,
      sendJson,
      await orderRoots({ ...deps, ids: body.ids }),
    );
    return true;
  }
  if (route === "/api/roots" && method === "POST") {
    writeResult(
      response,
      sendJson,
      await saveRoot({
        ...deps,
        mode: "add",
        body,
        dryRun: url.searchParams.get("dryRun") === "1",
      }),
    );
    return true;
  }
  const match = route.match(/^\/api\/roots\/([^/]+)(?:\/(scan|series))?$/);
  if (!match) return false;
  const id = decode(match[1]);
  assertKnownRoot({ registry, id });
  if (match[2] === "scan" && method === "POST") {
    writeResult(
      response,
      sendJson,
      await scanRoot({
        library,
        registry,
        id,
        full: url.searchParams.get("full") === "1",
      }),
    );
    return true;
  }
  if (match[2] === "series" && method === "GET") {
    writeResult(
      response,
      sendJson,
      await listSeries({ library, registry, id }),
    );
    return true;
  }
  if (!match[2] && method === "PATCH") {
    writeResult(
      response,
      sendJson,
      await saveRoot({
        ...deps,
        mode: "patch",
        id,
        body,
        dryRun: url.searchParams.get("dryRun") === "1",
      }),
    );
    return true;
  }
  if (!match[2] && method === "DELETE") {
    writeResult(response, sendJson, await removeRoot({ ...deps, id }));
    return true;
  }
  return false;
}
