interface PageshelfApi {
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(
    event: "scan-progress" | "library-changed" | "worker-status" | "command" | "external-link",
    callback: (payload: unknown) => void,
  ): () => void;
  pickFolder(): Promise<unknown>;
  revealInFinder(target: Record<string, unknown>): Promise<unknown>;
  openTrash(): Promise<unknown>;
  openOriginal(itemId: string): Promise<unknown>;
  openExternal(url: string, confirmed: boolean): Promise<unknown>;
}

interface Window {
  pageshelf?: PageshelfApi;
}
