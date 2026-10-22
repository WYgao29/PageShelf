import { chooseFolder, reveal } from "../services/system.js";

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
  chooseDirectory,
  sendJson,
  body,
  registry,
  library,
  systemExecFile,
}) {
  if (
    ["/api/system/choose-folder", "/api/settings/choose-folder"].includes(
      url.pathname,
    ) &&
    request.method === "POST"
  ) {
    writeResult(response, sendJson, await chooseFolder({ chooseDirectory }));
    return true;
  }
  if (url.pathname === "/api/system/reveal" && request.method === "POST") {
    writeResult(
      response,
      sendJson,
      await reveal({ body, registry, library, systemExecFile }),
    );
    return true;
  }
  return false;
}
