import { useEffect, useState } from "react";

type RootRow = { id: string; label: string; path: string };

function isRootList(value: unknown): value is { roots: RootRow[] } {
  if (typeof value !== "object" || value === null) return false;
  const roots = (value as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) return false;
  return roots.every(
    (root) =>
      typeof root === "object" &&
      root !== null &&
      typeof (root as RootRow).id === "string" &&
      typeof (root as RootRow).label === "string" &&
      typeof (root as RootRow).path === "string",
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "无法读取来源";
}

export function App() {
  const [roots, setRoots] = useState<RootRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const api = window.pageshelf;
    if (!api) {
      setError("桌面接口不可用");
      setRoots([]);
      return;
    }
    let cancelled = false;
    api
      .invoke("roots.list")
      .then((result) => {
        if (cancelled) return;
        if (!isRootList(result)) throw new Error("来源列表无效");
        setRoots(result.roots);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(errorMessage(reason));
        setRoots([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <a className="skip" href="#sources">
        跳到来源列表
      </a>
      <h1>PageShelf</h1>
      {roots === null ? <p role="status">正在读取来源…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div id="sources">
        {roots && roots.length === 0 && !error ? <p>还没有来源目录</p> : null}
        {roots && roots.length > 0 ? (
          <ul aria-label="来源目录">
            {roots.map((root) => (
              <li key={root.id}>
                <span>{root.label}</span> <span>{root.path}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
