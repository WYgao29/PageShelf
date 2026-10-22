import { testTrashFor } from "../test-trash.js";
import { createLibraryHost, handleWorkerEnvelope } from "./host.js";

type ParentPort = {
  on(event: "message", listener: (event: { data?: unknown }) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;

if (!parentPort) throw new Error("库进程必须由主进程启动");

delete process.env.PORT;
delete process.env.HOST;

const trashService = await testTrashFor(process.env);
const host = await createLibraryHost({
  dataDir: process.env.HTML_LIBRARY_DATA_DIR,
  waitForInitialScan: false,
  ...(trashService ? { trashService } : {}),
});

parentPort.on("message", (event) => {
  const message =
    event && typeof event === "object" && "data" in event ? event.data : event;
  void handleWorkerEnvelope(host, message).then((reply) => {
    parentPort.postMessage(reply);
  });
});

host.subscribe((event: unknown) => {
  parentPort.postMessage(event);
});

parentPort.postMessage({ event: "worker-ready" });
