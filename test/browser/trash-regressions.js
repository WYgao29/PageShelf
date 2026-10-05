export async function runTrashRegressionTests({ test, until }) {
  const fixture = await (await fetch("/test/fixture-info")).json();
  const mutate = async (route, method, body) => {
    const response = await fetch(route, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) throw Error("Fixture setup failed: " + response.status);
    return response.json();
  };
  const added = await mutate("/api/roots", "POST", {
    path: fixture.trashFixturePath,
    label: "Trash 回归",
  });
  const frame = document.createElement("iframe");
  frame.title = "Trash 回归";
  frame.src = "/r/" + added.root.id + "?sort=series";
  document.querySelector("#test-host").append(frame);
  try {
    await new Promise((resolve) =>
      frame.addEventListener("load", resolve, { once: true }),
    );
    const win = frame.contentWindow,
      doc = frame.contentDocument;
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 4,
      "trash fixture did not load",
    );
    const items = (
      await (
        await fetch("/api/items?roots=" + added.root.id + "&sort=series")
      ).json()
    ).items;
    const selectedId = () =>
      new URL(win.location.href).searchParams.get("item");
    const select = async (item) => {
      doc.querySelector('[data-item-id="' + item.id + '"]').click();
      await until(
        () =>
          doc.querySelector(".article-header h1")?.textContent === item.title,
        "selected article did not load",
      );
    };
    const buttonNamed = (selector, label) =>
      [...doc.querySelectorAll(selector)].find(
        (node) => node.textContent === label,
      );
    const confirmTrash = () => {
      doc.querySelector("#toasts").replaceChildren();
      doc.querySelector('[aria-label="文章操作"]').click();
      buttonNamed(".menu button", "移入废纸篓…").click();
      buttonNamed("dialog .dialog-footer button", "移入废纸篓").click();
    };
    const finished = () =>
      [...doc.querySelectorAll(".toast span")].some(
        (node) => node.textContent === "已移入废纸篓",
      );

    for (const [index, stage] of ["trash", "roots"].entries()) {
      await test(`late ${stage} response preserves the newer reader selection`, async (assert) => {
        await select(items[index]);
        const original = win.fetch;
        let release,
          started = false;
        win.fetch = async (url, options) => {
          const trash = String(url).endsWith("/trash");
          if (trash) started = true;
          const response = await original(url, options);
          if (
            (stage === "trash" && trash) ||
            (stage === "roots" && started && String(url) === "/api/roots")
          ) {
            started = false;
            await new Promise((resolve) => (release = resolve));
          }
          return response;
        };
        try {
          confirmTrash();
          await until(() => release, "delayed response was not reached");
          buttonNamed("dialog .dialog-footer button", "取消").click();
          await select(items[3]);
          release();
          await until(finished, "trash completion did not run");
          assert(
            selectedId() === items[3].id,
            "late response replaced article B",
          );
          assert(
            doc.querySelector(".article-header h1")?.textContent ===
              items[3].title,
            "late response changed article B's title",
          );
          const listed = await (
            await fetch("/api/items?roots=" + added.root.id)
          ).json();
          assert(
            !listed.items.some((item) => item.id === items[index].id),
            "temporary source was not trashed",
          );
        } finally {
          release?.();
          win.fetch = original;
        }
      });
    }

    await test("successful trash advances while the deleted article is still selected", async (assert) => {
      await select(items[2]);
      confirmTrash();
      await until(finished, "successful trash did not finish");
      assert(selectedId() === items[3].id, "current article did not advance");
      await until(
        () =>
          doc.querySelector(".article-header h1")?.textContent ===
          items[3].title,
        "next article did not load",
      );
    });
    await test("successful trash clears the current reader when there is no next article", async (assert) => {
      await select(items[3]);
      confirmTrash();
      await until(finished, "final trash did not finish");
      assert(!selectedId(), "deleted last article stayed selected");
      await until(
        () => !doc.querySelector(".article-header"),
        "last article remained visible",
      );
    });
  } finally {
    frame.remove();
    await mutate("/api/roots/" + added.root.id, "DELETE");
  }
}
