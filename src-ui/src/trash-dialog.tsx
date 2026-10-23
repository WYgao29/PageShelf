import { useRef, useState } from "react";
import { Dialog } from "./components/dialog";
import { invoke, type ItemDetail } from "./items";
import { errorMessage } from "./library";
import { useLibrary } from "./library-context";
import { useRoute } from "./router";

export function TrashDialog({ detail, onClose }: { detail: ItemDetail; onClose: () => void }) {
  const library = useLibrary();
  const { navigate } = useRoute();
  const [files, setFiles] = useState(detail.files);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [partial, setPartial] = useState(false);
  async function trash() {
    if (pending.current || library.snapshot.readOnly) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await invoke<{ trashed: string[]; failed: { path: string; message: string }[] }>("items.trash", { id: detail.item.id, confirm: true });
      if (result.failed.length) {
        setPartial(true);
        setFiles(current => current.filter(file => result.failed.some(failure => failure.path === file.path)));
        setError("部分文件未能移入废纸篓，以下文件仍保留：\n" + result.failed.map(file => file.path + "：" + file.message).join("\n"));
        library.toast("部分文件未能移入废纸篓", true);
      } else {
        onClose(); navigate({ item: detail.next?.id || detail.prev?.id || "" });
        library.toast("已移入废纸篓，可在访达中放回原处", false, { label: "打开废纸篓", run: async () => { try { await library.openTrash(); } catch (reason) { library.toast(errorMessage(reason), true); } } });
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title="移入废纸篓？" onClose={() => { if (!pending.current) onClose(); }} autoFocusSelector="[data-trash-cancel]" footer={<>
    <button type="button" data-trash-cancel disabled={busy} onClick={onClose}>取消</button>
    <button type="button" className="button-danger" disabled={busy || library.snapshot.readOnly} onClick={() => void trash()}>{busy ? "正在移动…" : partial ? "重试剩余文件" : "移入废纸篓"}</button>
  </>}><p>“{detail.item.title}”的全部关联源文件将移入 macOS 废纸篓，可在访达中放回原处。</p><ul className="file-list">{files.map(file => <li key={file.path}>{file.path} · {file.size} 字节</li>)}</ul>{error ? <p role="alert" className="danger-text">{error}</p> : null}</Dialog>;
}
