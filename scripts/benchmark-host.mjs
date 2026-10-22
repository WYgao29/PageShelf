import { app, utilityProcess } from "electron";
import { fileURLToPath } from "node:url";
void app.whenReady().then(() => {
const worker = utilityProcess.fork(fileURLToPath(new URL("./benchmark-search.mjs", import.meta.url)), [], { serviceName: "PageShelf search benchmark", stdio: "inherit" });
const timer = setTimeout(() => { worker.kill(); app.exit(1); }, 30000);
worker.on("message", result => {
  console.log("BENCHMARK_WORKER " + JSON.stringify(result));
  clearTimeout(timer); worker.kill(); app.quit();
});
worker.on("exit", code => { if (code) { clearTimeout(timer); app.exit(1); } });

});
