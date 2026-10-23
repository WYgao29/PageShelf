import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "./router";
import { ConfirmDialog } from "./components/dialog";
import { Toasts, type ToastItem, type ToastAction } from "./components/toast";
import {
  countIssues,
  errorMessage,
  isScanActive,
  parseLibrary,
  parsePreflight,
  parseScan,
  parseSeries,
  previewParams,
  type LibrarySnapshot,
  type Preflight,
  type PreviewSource,
  type ScanStatus,
  type Selection,
  type SeriesEntry,
} from "./library";

type ConfirmOptions = { title: string; message: string; confirmLabel: string; danger?: boolean };
type ManagerRequest = { focusAdd?: boolean; relocateId?: string };

type LibraryContextValue = {
  snapshot: LibrarySnapshot;
  loaded: boolean;
  error: string;
  scan: ScanStatus;
  busy: boolean;
  catalogEpoch: number;
  selection: Selection;
  seriesName: string;
  selectAll: () => void;
  selectRoot: (rootId: string) => void;
  selectSeries: (rootId: string, seriesKey: string, name: string) => void;
  manager: ManagerRequest | null;
  openManager: (focus?: ManagerRequest) => void;
  closeManager: () => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  preflight: (source: PreviewSource) => Promise<Preflight>;
  addRoot: (source: PreviewSource) => Promise<void>;
  updateRoot: (id: string, body: Record<string, unknown>) => Promise<void>;
  orderRoots: (ids: string[]) => Promise<void>;
  removeRoot: (id: string) => Promise<void>;
  rescan: (id?: string, full?: boolean) => Promise<void>;
  chooseFolder: () => Promise<{ cancelled: true } | { cancelled: false; path: string }>;
  revealRoot: (rootId: string) => Promise<void>;
  openTrash: () => Promise<void>;
  clearCache: () => Promise<void>;
  reload: () => Promise<LibrarySnapshot | null>;
};

const emptySnapshot = (): LibrarySnapshot => ({
  roots: [],
  totals: { items: 0, available: 0 },
  readOnly: false,
  startupWarning: "",
});

const LibraryContext = createContext<LibraryContextValue | null>(null);

function requireApi() {
  const api = window.pageshelf;
  if (!api) throw new Error("桌面接口不可用");
  return api;
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(emptySnapshot);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [scan, setScan] = useState<ScanStatus>({ running: [], queued: [] });
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const { route, navigate } = useRoute();
  const selection = useMemo<Selection>(() => route.seriesKey && route.rootId ? { kind: "series", rootId: route.rootId, seriesKey: route.seriesKey } : route.rootId ? { kind: "root", rootId: route.rootId } : { kind: "all" }, [route.rootId, route.seriesKey]);
  const [seriesCatalog, setSeriesCatalog] = useState<{ rootId: string; epoch: number; entries: SeriesEntry[] } | null>(null);
  const seriesRootId = selection.kind === "series" ? selection.rootId : "";
  const seriesName = seriesCatalog?.rootId === seriesRootId && seriesCatalog.epoch === catalogEpoch
    ? seriesCatalog.entries.find((entry) => entry.key === route.seriesKey)?.name || ""
    : "";
  const [manager, setManager] = useState<ManagerRequest | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const toastId = useRef(0);
  const confirmResolve = useRef<((value: boolean) => void) | null>(null);
  const refreshSerial = useRef(0);
  const scanActive = useRef(false);
  const summaryPending = useRef(false);
  const loadedRef = useRef(false);
  const progressVersion = useRef(0);

  const toast = useCallback((message: string, isError = false, action?: ToastAction) => {
    if (!message) return;
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current, { id, message, error: isError, action }]);
  }, []);

  useEffect(() => {
    if (!loaded || !seriesRootId) return;
    let cancelled = false;
    void requireApi().invoke("roots.series", { id: seriesRootId }).then((result) => {
      if (!cancelled) setSeriesCatalog({ rootId: seriesRootId, epoch: catalogEpoch, entries: parseSeries(result) });
    }).catch((reason: unknown) => {
      if (!cancelled) toast(errorMessage(reason, "无法读取系列"), true);
    });
    return () => { cancelled = true; };
  }, [catalogEpoch, loaded, seriesRootId, toast]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const settleConfirm = useCallback((value: boolean) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmOptions(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      confirmResolve.current?.(false);
      confirmResolve.current = resolve;
      setConfirmOptions(options);
    });
  }, []);

  useEffect(() => () => { confirmResolve.current?.(false); confirmResolve.current = null; }, []);

  const applySnapshot = useCallback((next: LibrarySnapshot) => {
    loadedRef.current = true;
    setSnapshot(next);
    setCatalogEpoch((value) => value + 1);
    setLoaded(true);
    setError("");
    if (summaryPending.current) {
      summaryPending.current = false;
      const issues = countIssues(next.roots);
      toast(issues ? "扫描完成，发现 " + issues + " 个问题" : "扫描完成");
    }
  }, [toast]);

  const refreshRoots = useCallback(async () => {
    const serial = ++refreshSerial.current;
    try {
      const parsed = parseLibrary(await requireApi().invoke("roots.list"));
      if (serial !== refreshSerial.current) return null;
      if (!parsed) throw new Error("来源列表无效");
      applySnapshot(parsed);
      return parsed;
    } catch (reason) {
      if (serial !== refreshSerial.current) return null;
      if (!loadedRef.current) {
        loadedRef.current = true;
        setError(errorMessage(reason, "无法读取来源"));
        setLoaded(true);
      } else toast(errorMessage(reason, "无法读取来源"), true);
      return null;
    }
  }, [applySnapshot, toast]);

  const refreshScan = useCallback(async () => {
    const version = progressVersion.current;
    try {
      const next = parseScan(await requireApi().invoke("scan.status"));
      if (version !== progressVersion.current) return;
      scanActive.current = isScanActive(next);
      setScan(next);
    } catch (reason) {
      toast(errorMessage(reason, "无法读取扫描状态"), true);
    }
  }, [toast]);

  const refreshRef = useRef(refreshRoots);
  const scanRef = useRef(refreshScan);
  refreshRef.current = refreshRoots;
  scanRef.current = refreshScan;

  useEffect(() => {
    const api = window.pageshelf;
    if (!api) {
      setError("桌面接口不可用");
      setLoaded(true);
      return;
    }
    const onProgress = (payload: unknown) => {
      progressVersion.current += 1;
      const next = parseScan(payload);
      const active = isScanActive(next);
      if (scanActive.current && !active) {
        summaryPending.current = true;
        void refreshRef.current();
      }
      scanActive.current = active;
      setScan(next);
    };
    const onLibrary = () => {
      void refreshRef.current();
    };
    const onWorker = () => {
      void refreshRef.current();
      void scanRef.current();
    };
    const offProgress = api.on("scan-progress", onProgress);
    const offLibrary = api.on("library-changed", onLibrary);
    const offWorker = api.on("worker-status", onWorker);
    void refreshRef.current();
    void scanRef.current();
    return () => {
      offProgress();
      offLibrary();
      offWorker();
    };
  }, []);

  const selectAll = useCallback(() => {
    navigate({ rootId: "", seriesKey: "", folder: "", item: "", scope: "all" });
  }, [navigate]);

  const selectRoot = useCallback((rootId: string) => {
    navigate({ rootId, seriesKey: "", folder: "", item: "", scope: "root", sort: "updated" });
  }, [navigate]);

  const selectSeries = useCallback((rootId: string, seriesKey: string) => {
    navigate({ rootId, seriesKey, folder: "", item: "", scope: "root", sort: "series" });
  }, [navigate]);

  const openManager = useCallback((focus: ManagerRequest = {}) => {
    setManager(focus);
    navigate({ settings: true });
  }, [navigate]);

  const closeManager = useCallback(() => {
    setManager(null);
    navigate({ settings: false });
  }, [navigate]);

  useEffect(() => {
    setManager(current => route.settings ? current || {} : null);
  }, [route.settings]);

  const preflight = useCallback(async (source: PreviewSource) => {
    const parsed = parsePreflight(await requireApi().invoke("roots.preflight", previewParams(source)));
    if (!parsed) throw new Error("预检结果无效");
    return parsed;
  }, []);

  const addRoot = useCallback(async (source: PreviewSource) => {
    await requireApi().invoke("roots.add", previewParams(source));
    await refreshRoots();
    toast("目录已添加");
  }, [refreshRoots, toast]);

  const updateRoot = useCallback(async (id: string, body: Record<string, unknown>) => {
    await requireApi().invoke("roots.update", { id, ...body });
    await refreshRoots();
  }, [refreshRoots]);

  const orderRoots = useCallback(async (ids: string[]) => {
    await requireApi().invoke("roots.order", { ids });
    await refreshRoots();
  }, [refreshRoots]);

  const removeRoot = useCallback(async (id: string) => {
    await requireApi().invoke("roots.remove", { id });
    if (route.rootId === id) navigate({ rootId: "", seriesKey: "", folder: "", item: "", scope: "all" });
    await refreshRoots();
    toast("来源目录已移除");
  }, [refreshRoots, toast, route.rootId, navigate]);

  const rescan = useCallback(async (id?: string, full = false) => {
    const api = requireApi();
    if (id) await api.invoke("roots.rescan", { id, full });
    else await api.invoke("scan.all", { full });
  }, []);

  const chooseFolder = useCallback(async () => {
    const result = await requireApi().pickFolder();
    const record = result && typeof result === "object" ? (result as { cancelled?: boolean; path?: string }) : null;
    if (!record || record.cancelled || typeof record.path !== "string" || !record.path) return { cancelled: true as const };
    return { cancelled: false as const, path: record.path };
  }, []);

  const revealRoot = useCallback(async (rootId: string) => {
    await requireApi().revealInFinder({ rootId });
  }, []);

  const openTrash = useCallback(async () => {
    await requireApi().openTrash();
  }, []);

  const clearCache = useCallback(async () => {
    await requireApi().invoke("system.clearCache");
    toast("正文缓存已清除");
  }, [toast]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      snapshot,
      loaded,
      error,
      scan,
      busy: isScanActive(scan),
      catalogEpoch,
      selection,
      seriesName,
      selectAll,
      selectRoot,
      selectSeries,
      manager,
      openManager,
      closeManager,
      toast,
      confirm,
      preflight,
      addRoot,
      updateRoot,
      orderRoots,
      removeRoot,
      rescan,
      chooseFolder,
      revealRoot,
      openTrash,
      clearCache,
      reload: refreshRoots,
    }),
    [
      snapshot,
      loaded,
      error,
      scan,
      catalogEpoch,
      selection,
      seriesName,
      selectAll,
      selectRoot,
      selectSeries,
      manager,
      openManager,
      closeManager,
      toast,
      confirm,
      preflight,
      addRoot,
      updateRoot,
      orderRoots,
      removeRoot,
      rescan,
      chooseFolder,
      revealRoot,
      openTrash,
      clearCache,
      refreshRoots,
    ],
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}
      {confirmOptions ? (
        <ConfirmDialog
          title={confirmOptions.title}
          message={confirmOptions.message}
          confirmLabel={confirmOptions.confirmLabel}
          danger={confirmOptions.danger}
          onSettle={settleConfirm}
        />
      ) : null}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("目录状态不可用");
  return value;
}
