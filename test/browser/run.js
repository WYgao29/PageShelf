export async function runTests() {
  const result = {
    status: "passed",
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };
  const assert = (condition, message = "Assertion failed") => {
    if (!condition) throw new Error(message);
  };
  const test = async (name, callback) => {
    try {
      await callback(assert);
      result.passed++;
    } catch (error) {
      result.failed++;
      result.failures.push({
        name,
        message: error.message + "\n" + (error.stack || ""),
      });
    }
  };
  await test("browser harness and CSP are active", (assert) => {
    assert(!!document.querySelector("#test-result"));
    assert(location.hostname === "127.0.0.1");
  });
  if (new URL(location.href).searchParams.has("fail"))
    await test("intentional harness failure", (assert) =>
      assert(false, "injected failure"));
  await test("reader test module loads", async () => {
    const { runReaderTests } = await import("./reader-tests.js");
    await runReaderTests({ test, assert, result });
  });
  if (!new URL(location.href).searchParams.has("real"))
    await test("library UI tests load", async () => {
      const { runLibraryUiTests } = await import("./library-ui.js");
      await runLibraryUiTests({ test, result });
    });
  if (new URL(location.href).searchParams.has("real"))
    await test("real reader tests load", async () => {
      const { runRealTests } = await import("./reader-real-tests.js");
      await runRealTests({ test, result });
    });
  if (result.failed) result.status = "failed";
  document.querySelector("#test-result").textContent = JSON.stringify(result);
  globalThis.__testResult = result;
  if (new URL(location.href).searchParams.has("manual"))
    await fetch("/test/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...result,
        userAgent: navigator.userAgent,
        verifiedAt: new Date().toISOString(),
      }),
    });
}
if (typeof document !== "undefined") await runTests();
