import {
  EVENTS,
  externalUrlDecision,
  senderAllowed,
  validateInvocation,
} from "../shared/pageshelf-contract.js";

const failure = (code, message) => Object.assign(new Error(message), { code });

/**
 * @param {{
 *   senderUrl: string,
 *   payload: { method?: unknown, params?: unknown } | null,
 *   dev?: boolean,
 *   request: (method: string, params: unknown) => Promise<unknown>,
 *   openExternal: (url: string, confirmed: boolean) => Promise<unknown>,
 *   openOriginal: (itemId: string) => Promise<unknown>,
 *   chooseFolder: () => Promise<unknown>,
 *   copyItemPath?: (id: string) => Promise<unknown>,
 *   saveItem?: (id: string, format: string) => Promise<unknown>,
 * }} input
 */
export async function handleRendererInvoke({
  senderUrl,
  payload,
  dev = false,
  request,
  openExternal,
  openOriginal,
  chooseFolder,
  saveItem,
  copyItemPath,
}) {
  if (!senderAllowed(senderUrl, { dev }))
    throw failure("METHOD_NOT_ALLOWED", "调用方不被允许");
  if (!payload || typeof payload !== "object")
    throw failure("INVALID_MESSAGE", "请求无效");
  const method = payload.method;
  const input = validateInvocation({ method, params: payload.params });
  if (method === "system.openExternal")
    return openExternal(input.url, input.confirmed);
  if (method === "window.openOriginal") return openOriginal(input.itemId);
  if (method === "system.chooseFolder") return chooseFolder();
  if (method === "system.copyItemPath") {
    if (!copyItemPath) throw failure("DESKTOP_ONLY", "复制路径只在桌面主进程执行");
    return copyItemPath(input.id);
  }
  if (method === "system.saveItem") {
    if (!saveItem) throw failure("DESKTOP_ONLY", "保存文件只在桌面主进程执行");
    return saveItem(input.id, input.format);
  }
  return request(method, input);
}

/**
 * @param {string} url
 * @param {boolean} confirmed
 * @param {(url: string) => void | Promise<void>} opener
 */
export async function openExternalUrl(url, confirmed, opener) {
  const decision = externalUrlDecision(url, { confirmed });
  if (!decision.ok) throw failure(decision.code, decision.message);
  await opener(decision.url);
  return { opened: true };
}

export function rendererEvent(message) {
  if (!message || typeof message.event !== "string" || !EVENTS.includes(message.event))
    return null;
  const payload =
    message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
      ? message.payload
      : {};
  return { event: message.event, payload };
}
