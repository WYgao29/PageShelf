export const DEV_ORIGIN = "http://127.0.0.1:5173";
export const APP_CSP =
  "default-src 'self'; script-src 'self'; frame-src pageshelf:; connect-src 'none'; object-src 'none'";
export const EVENTS = Object.freeze([
  "scan-progress",
  "library-changed",
  "worker-status",
]);
export const FORCE_KILL_MS = 1200;
export const IPC_CHANNEL = "pageshelf:invoke";
export const EVENT_CHANNEL = "pageshelf:event";
export const DESKTOP_SURFACE = Object.freeze({
  listens: false,
  authToken: null,
  cookies: false,
});
export const MAIN_ONLY_METHODS = Object.freeze([
  "system.openExternal",
  "window.openOriginal",
]);

const SOURCE_ACTIONS = new Set([
  "original",
  "document",
  "html",
  "mhtml",
  "markdown",
  "asset",
]);
const SEARCH_KEYS = new Set([
  "q",
  "fmt",
  "kind",
  "sort",
  "roots",
  "series",
  "folder",
  "limit",
  "offset",
]);

const invalid = (message = "参数无效") =>
  Object.assign(new Error(message), { code: "INVALID_PARAMS" });

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export const isItemId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !value.includes("/") &&
  !value.includes("\\") &&
  !value.includes("%") &&
  !value.includes("\0") &&
  !value.includes("..");

const isShortText = (value, max) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  [...value].length <= max;

const isPathText = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !value.includes("\0");

const onlyKeys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.includes(key));

function copySearch(query) {
  if (query === undefined) return {};
  if (!isPlainObject(query) || !onlyKeys(query, [...SEARCH_KEYS]))
    throw invalid();
  const copy = {};
  for (const key of ["q", "fmt", "kind", "sort", "roots", "series", "folder"]) {
    if (query[key] === undefined) continue;
    if (!isShortText(query[key], key === "q" ? 500 : 200)) throw invalid();
    copy[key] = query[key];
  }
  for (const key of ["limit", "offset"]) {
    if (query[key] === undefined) continue;
    if (!Number.isFinite(query[key])) throw invalid();
    copy[key] = query[key];
  }
  return copy;
}

function copyRootBody(params, { pathRequired, extraKeys = [] }) {
  if (!onlyKeys(params, ["path", "label", "enabled", "options", ...extraKeys]))
    throw invalid();
  const body = {};
  if (params.path !== undefined) {
    if (!isPathText(params.path)) throw invalid();
    body.path = params.path;
  } else if (pathRequired) throw invalid();
  if (params.label !== undefined) {
    if (!isShortText(params.label, 80)) throw invalid();
    body.label = params.label;
  }
  if (params.enabled !== undefined) {
    if (typeof params.enabled !== "boolean") throw invalid();
    body.enabled = params.enabled;
  }
  if (params.options !== undefined) {
    if (
      !isPlainObject(params.options) ||
      !onlyKeys(params.options, ["series"]) ||
      !["auto", "off"].includes(params.options.series)
    )
      throw invalid();
    body.options = { series: params.options.series };
  }
  return body;
}

const schemas = {
  "roots.list": (params) => {
    if (Object.keys(params).length) throw invalid();
    return {};
  },
  "roots.preflight": (params) => {
    const body = copyRootBody(params, {
      pathRequired: true,
      extraKeys: ["excludeId"],
    });
    if (params.excludeId !== undefined && !isItemId(params.excludeId))
      throw invalid();
    return {
      path: body.path,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(params.excludeId ? { excludeId: params.excludeId } : {}),
    };
  },
  "roots.add": (params) => copyRootBody(params, { pathRequired: true }),
  "roots.update": (params) => {
    if (!isItemId(params.id)) throw invalid();
    const { id, ...rest } = params;
    const body = copyRootBody(rest, { pathRequired: false });
    return { id, ...body };
  },
  "roots.remove": (params) => {
    if (!onlyKeys(params, ["id"]) || !isItemId(params.id)) throw invalid();
    return { id: params.id };
  },
  "roots.order": (params) => {
    if (
      !onlyKeys(params, ["ids"]) ||
      !Array.isArray(params.ids) ||
      params.ids.length > 200 ||
      params.ids.some((id) => !isItemId(id))
    )
      throw invalid();
    return { ids: [...params.ids] };
  },
  "roots.rescan": (params) => {
    if (!onlyKeys(params, ["id", "full"]) || !isItemId(params.id))
      throw invalid();
    if (params.full !== undefined && typeof params.full !== "boolean")
      throw invalid();
    return { id: params.id, full: params.full === true };
  },
  "roots.series": (params) => {
    if (!onlyKeys(params, ["id"]) || !isItemId(params.id)) throw invalid();
    return { id: params.id };
  },
  "scan.all": (params) => {
    if (!onlyKeys(params, ["full"])) throw invalid();
    if (params.full !== undefined && typeof params.full !== "boolean")
      throw invalid();
    return { full: params.full === true };
  },
  "scan.status": (params) => {
    if (Object.keys(params).length) throw invalid();
    return {};
  },
  "items.search": (params) => {
    if (!onlyKeys(params, ["query"])) throw invalid();
    return { query: copySearch(params.query) };
  },
  "items.get": (params) => {
    if (!onlyKeys(params, ["id"]) || !isItemId(params.id)) throw invalid();
    return { id: params.id };
  },
  "items.trash": (params) => {
    if (!onlyKeys(params, ["id", "confirm"]) || !isItemId(params.id))
      throw invalid();
    if (typeof params.confirm !== "boolean") throw invalid();
    return { id: params.id, confirm: params.confirm };
  },
  "items.document": (params) => copyRead(params),
  "items.original": (params) => copyRead(params),
  "items.source": (params) => copyFormat(params),
  "items.download": (params) => copyFormat(params),
  "items.asset": (params) => {
    if (!onlyKeys(params, ["id", "path"]) || !isItemId(params.id))
      throw invalid();
    if (
      typeof params.path !== "string" ||
      params.path.length === 0 ||
      params.path.length > 4096 ||
      params.path.includes("\0")
    )
      throw invalid();
    return { id: params.id, path: params.path };
  },
  "system.clearCache": (params) => {
    if (Object.keys(params).length) throw invalid();
    return {};
  },
  "system.chooseFolder": (params) => {
    if (Object.keys(params).length) throw invalid();
    return {};
  },
  "system.reveal": (params) => ({ body: copyReveal(params) }),
  "system.openTrash": (params) => {
    if (Object.keys(params).length) throw invalid();
    return {};
  },
  "system.openExternal": (params) => {
    if (!onlyKeys(params, ["url", "confirmed"])) throw invalid();
    if (typeof params.url !== "string" || params.url.length > 2048)
      throw invalid();
    if (params.url.includes("\0")) throw invalid();
    if (typeof params.confirmed !== "boolean") throw invalid();
    return { url: params.url, confirmed: params.confirmed };
  },
  "window.openOriginal": (params) => {
    if (!onlyKeys(params, ["itemId"]) || !isItemId(params.itemId))
      throw invalid();
    return { itemId: params.itemId };
  },
};

function copyRead(params) {
  if (!onlyKeys(params, ["id", "ifNoneMatch"]) || !isItemId(params.id))
    throw invalid();
  if (
    params.ifNoneMatch !== undefined &&
    !isShortText(params.ifNoneMatch, 200)
  )
    throw invalid();
  return {
    id: params.id,
    ifNoneMatch: params.ifNoneMatch,
  };
}

function copyFormat(params) {
  if (!onlyKeys(params, ["id", "format"]) || !isItemId(params.id))
    throw invalid();
  if (!isShortText(params.format, 32) || params.format.includes("/"))
    throw invalid();
  return { id: params.id, format: params.format };
}

function copyReveal(params) {
  const keys = Object.keys(params);
  if (keys.length !== 1 || !["itemId", "rootId", "trash"].includes(keys[0]))
    throw invalid("请指定条目、来源目录或废纸篓");
  if (keys[0] === "trash") {
    if (params.trash !== true) throw invalid("请指定条目、来源目录或废纸篓");
    return { trash: true };
  }
  if (!isItemId(params[keys[0]])) throw invalid();
  return { [keys[0]]: params[keys[0]] };
}

export function validateInvocation({ method, params }) {
  if (typeof method !== "string" || !Object.hasOwn(schemas, method))
    throw Object.assign(new Error("方法不在白名单内"), {
      code: "METHOD_NOT_ALLOWED",
    });
  const input = params === undefined ? {} : params;
  if (!isPlainObject(input)) throw invalid();
  let encoded = "";
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw invalid();
  }
  if (encoded.length > 1_000_000)
    throw Object.assign(new Error("参数过大"), { code: "PARAMS_TOO_LARGE" });
  return schemas[method](input);
}

export function senderAllowed(
  senderUrl,
  { dev = false, devOrigin = DEV_ORIGIN } = {},
) {
  if (typeof senderUrl !== "string" || !senderUrl) return false;
  let url;
  try {
    url = new URL(senderUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "pageshelf:" && url.host === "app") return true;
  return dev === true && url.origin === devOrigin;
}

export function rawPageshelfUnsafe(raw) {
  return (
    typeof raw !== "string" ||
    raw.includes("\\") ||
    raw.includes("\0") ||
    raw.includes("..") ||
    /%(?:2e|2f|5c)/i.test(raw)
  );
}

export function parsePageshelfUrl(input) {
  const raw = String(input);
  if (rawPageshelfUnsafe(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "pageshelf:" || url.username || url.password)
    return null;
  if (url.hash) return null;
  if (url.host === "app") {
    if (url.search) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === ".." || part.includes("%")))
      return null;
    return { kind: "app", pathname: url.pathname || "/" };
  }
  if (url.host !== "source") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  let id = "";
  try {
    id = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  if (!isItemId(id) || !SOURCE_ACTIONS.has(parts[1])) return null;
  if (parts[1] === "asset") {
    if ([...url.searchParams.keys()].join(",") !== "path") return null;
    const assetPath = url.searchParams.get("path");
    if (
      typeof assetPath !== "string" ||
      !assetPath ||
      assetPath.length > 4096 ||
      assetPath.includes("\0")
    )
      return null;
    return { kind: "source", id, action: "asset", assetPath };
  }
  if (url.search) return null;
  if (parts[1] === "original" || parts[1] === "document")
    return { kind: "source", id, action: parts[1] };
  return { kind: "source", id, action: "source", format: parts[1] };
}

export function externalUrlDecision(url, { confirmed } = {}) {
  if (confirmed !== true)
    return { ok: false, code: "CONFIRM_REQUIRED", message: "需要确认后才能打开外部链接" };
  if (typeof url !== "string" || !url || url.length > 2048 || url.includes("\0"))
    return { ok: false, code: "INVALID_URL", message: "链接无效" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "链接无效" };
  }
  if (parsed.username || parsed.password)
    return { ok: false, code: "INVALID_URL", message: "链接无效" };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return { ok: false, code: "INVALID_URL", message: "只允许打开 http 或 https 链接" };
  return { ok: true, url: parsed.toString() };
}

export function desktopWorkerEnv(baseEnv, dataDir) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (typeof value === "string") env[key] = value;
  }
  env.HTML_LIBRARY_DATA_DIR = dataDir;
  delete env.AUTH_TOKEN;
  delete env.PORT;
  delete env.HOST;
  if (env.FORCE_COLOR) delete env.NO_COLOR;
  return env;
}

export function navigationAllowed(
  targetUrl,
  {
    dev = false,
    devOrigin = DEV_ORIGIN,
    kind = "app",
    itemId = "",
    frame = false,
  } = {},
) {
  if (typeof targetUrl !== "string" || rawPageshelfUnsafe(targetUrl)) return false;
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (kind === "source") {
    if (url.protocol !== "pageshelf:" || url.host !== "source") return false;
    const parsed = parsePageshelfUrl(targetUrl);
    return Boolean(parsed && parsed.kind === "source" && parsed.id === itemId);
  }
  if (url.protocol === "pageshelf:" && url.host === "app") return true;
  if (frame && url.protocol === "pageshelf:" && url.host === "source") return true;
  return dev === true && url.origin === devOrigin;
}
