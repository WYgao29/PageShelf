export async function runKeyboardRegressionTests({
  command,
  baseUrl,
  library,
  result,
}) {
  const series = library
    .getSnapshot()
    .series.find((value) => value.itemIds.length === 10);
  if (!series) throw Error("Ten-article keyboard fixture is missing");
  const url =
    baseUrl + "/r/" + series.rootId + "/s/" + series.key + "?sort=series";
  const { targetId } = await command("Target.createTarget", { url });
  const { sessionId } = await command("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  result.nativeKeyboard = { passed: 0, failed: 0 };
  try {
    await command("Runtime.enable", {}, sessionId);
    const evaluate = async (expression) => {
      const evaluated = await command(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId,
      );
      if (evaluated.exceptionDetails)
        throw Error(evaluated.exceptionDetails.text);
      return evaluated.result?.value;
    };
    const until = async (expression) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error("Keyboard condition timed out: " + expression);
    };
    const press = async (key, code, keyCode) => {
      for (const type of ["keyDown", "keyUp"])
        await command(
          "Input.dispatchKeyEvent",
          {
            type,
            key,
            code,
            windowsVirtualKeyCode: keyCode,
            nativeVirtualKeyCode: keyCode,
            ...(type === "keyDown" && (key === "Enter" || key.length === 1)
              ? { text: key === "Enter" ? "\r" : key }
              : {}),
          },
          sessionId,
        );
    };
    const reset = async () => {
      await command("Page.navigate", { url }, sessionId);
      await until(
        `document.querySelector('.expand-group') && !new URL(location.href).searchParams.get('item')`,
      );
    };
    const test = async (name, callback) => {
      try {
        await reset();
        await callback((condition, message) => {
          if (!condition) throw Error(message);
        });
        result.passed++;
        result.nativeKeyboard.passed++;
      } catch (error) {
        result.status = "failed";
        result.failed++;
        result.nativeKeyboard.failed++;
        result.failures.push({ name, message: error.message });
      }
    };
    await test("native Tab then Enter opens the fourth focused article", async (assert) => {
      const expected = await evaluate(
        `(() => { const rows = document.querySelectorAll('.item-row'); rows[2].focus(); return rows[3].dataset.itemId; })()`,
      );
      await press("Tab", "Tab", 9);
      assert(
        (await evaluate(`document.activeElement.dataset.itemId`)) === expected,
        "Tab did not focus the fourth article",
      );
      await press("Enter", "Enter", 13);
      const actual = await until(
        `new URL(location.href).searchParams.get('item')`,
      );
      assert(
        actual === expected,
        "Enter opened the first article instead of the focused fourth article",
      );
    });
    await test("native Enter expands six rows to ten without selecting an article", async (assert) => {
      await evaluate(`document.querySelector('.expand-group').focus()`);
      await press("Enter", "Enter", 13);
      const actual = await evaluate(
        `({ count: document.querySelectorAll('.item-row').length, item: new URL(location.href).searchParams.get('item') })`,
      );
      assert(actual.count === 10, "Enter did not expand the six visible rows");
      assert(!actual.item, "Enter on the expand button selected an article");
    });
    await test("native j and k followed by Enter opens the focused article", async (assert) => {
      const expected = await evaluate(
        `document.querySelector('.item-row').dataset.itemId`,
      );
      await press("j", "KeyJ", 74);
      await press("j", "KeyJ", 74);
      await press("k", "KeyK", 75);
      await press("Enter", "Enter", 13);
      const actual = await until(
        `new URL(location.href).searchParams.get('item')`,
      );
      assert(
        actual === expected,
        "j/k selection did not activate the focused article",
      );
    });
  } finally {
    await command("Target.closeTarget", { targetId });
  }
}
