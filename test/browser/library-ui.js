const until = async (predicate, message, timeout = 7000) => {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
};
export async function runLibraryUiTests({ test, result }) {
  const frame = document.createElement("iframe");
  frame.title = "应用验收";
  frame.width = "1440";
  frame.height = "900";
  frame.src = "/";
  document.querySelector("#test-host").replaceChildren(frame);
  await new Promise((resolve) =>
    frame.addEventListener("load", resolve, { once: true }),
  );
  const win = frame.contentWindow,
    doc = frame.contentDocument;
  let ready = false;
  await test("application loads source sidebar and article rows", async (assert) => {
    await until(
      () => doc.querySelector("[data-item-id]"),
      "article rows missing",
    );
    assert(doc.querySelector("[data-root-id]"));
    assert(doc.querySelector("#search-input"));
    assert(doc.querySelector("#reader-pane"));
    ready = true;
  });
  if (!ready) {
    frame.remove();
    return;
  }
  const change = (input, value) => {
      input.value = value;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    },
    click = (selector) => {
      const element = doc.querySelector(selector);
      if (!element) throw Error("Missing " + selector);
      element.click();
      return element;
    };
  await test("root selection and series navigation restore URL", async (assert) => {
    click("[data-root-id]");
    await until(
      () => doc.querySelectorAll("[data-series-key]").length >= 7,
      "series missing",
    );
    assert(win.location.pathname.startsWith("/r/"));
    click("[data-series-key]");
    await until(
      () => win.location.pathname.includes("/s/"),
      "series URL missing",
    );
    assert(doc.querySelector("[data-series-key][aria-current=page]"));
    click("[data-all-roots]");
    await until(
      () =>
        win.location.pathname === "/" &&
        doc.querySelectorAll("[data-item-id]").length === 48,
      "all roots not restored",
    );
  });
  await test("ordinary article click opens in place and restores view switches", async (assert) => {
    let opened = 0;
    win.open = () => {
      opened++;
    };
    click("[data-item-id]");
    await until(() => doc.querySelector(".reading-article"), "reader missing");
    assert(opened === 0);
    assert(win.location.search.includes("item="));
    const original = [...doc.querySelectorAll("[data-view]")].find(
      (x) => x.dataset.view === "original",
    );
    original.click();
    await until(
      () =>
        doc.querySelector("#original-frame") ||
        doc.querySelector(".source-text"),
      "original view missing",
    );
    if (doc.querySelector("#original-frame"))
      assert(doc.querySelector("#original-frame").hasAttribute("sandbox"));
    click("[data-view=reader]");
    await until(
      () => doc.querySelector(".reading-article"),
      "reader did not return",
    );
  });
  await test("search debounce, clearing and old requests cannot overwrite current results", async (assert) => {
    const search = doc.querySelector("#search-input");
    change(search, "研究问题");
    await until(
      () =>
        win.location.search.includes("q=") &&
        doc.querySelector(".result-info")?.textContent.includes("结果"),
      "search did not run",
    );
    assert(doc.querySelectorAll("[data-item-id]").length > 0);
    change(search, "不存在的关键词");
    await until(
      () => doc.querySelector(".empty-state")?.textContent.includes("没有找到"),
      "empty search missing",
    );
    change(search, "");
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "clear failed",
    );
    let release;
    const original = win.fetch;
    win.fetch = (url, options) =>
      String(url).includes("/api/items?") && String(url).includes("q=old")
        ? new Promise(
            (resolve) =>
              (release = () =>
                resolve(
                  new win.Response(
                    JSON.stringify({
                      total: 1,
                      roots: 1,
                      groups: [],
                      items: [
                        {
                          id: "old",
                          title: "过期结果",
                          formats: {},
                          excerpt: "old",
                          relativePath: "old",
                        },
                      ],
                    }),
                    { headers: { "content-type": "application/json" } },
                  ),
                )),
          )
        : original(url, options);
    change(search, "old");
    await until(() => release, "slow query never started");
    change(search, "证据");
    await until(
      () => doc.querySelector(".result-info")?.textContent.includes("证据"),
      "new query never published",
    );
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(!doc.querySelector("#list-rows").textContent.includes("过期结果"));
    win.fetch = original;
    change(search, "");
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "reset failed",
    );
  });
  await test("manager opens, duplicate preview blocks add and source rename keeps root id", async (assert) => {
    click("[data-open-manager]");
    await until(
      () => doc.querySelector("dialog.manager[open]"),
      "manager missing",
    );
    const fixture = await (await fetch("/test/fixture-info")).json(),
      input = doc.querySelector("#root-path");
    change(input, fixture.rootPath);
    await until(
      () => doc.querySelector("#root-preview").textContent.includes("已经添加"),
      "duplicate preview missing",
    );
    assert(doc.querySelector("#add-root").disabled);
    const label = doc.querySelector("[data-root-label-input]"),
      id = label.dataset.rootLabelInput;
    label.value = "改名资料";
    label.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await until(
      () =>
        doc
          .querySelector('[data-root-id="' + id + '"]')
          .textContent.includes("改名资料"),
      "rename did not publish",
    );
    doc.querySelector("dialog.manager .dialog-header button").click();
    await until(
      () => !doc.querySelector("dialog.manager"),
      "manager did not close",
    );
    assert(!win.location.pathname.includes("settings"));
  });

  await test("group expansion and keyboard selection keep the focused row visible", async (assert) => {
    const sort = doc.querySelector("#sort-select");
    sort.value = "series";
    sort.dispatchEvent(new win.Event("change", { bubbles: true }));
    await until(
      () => doc.querySelector(".expand-group"),
      "group expansion missing",
    );
    const expand = [...doc.querySelectorAll(".expand-group")].find((node) =>
      node.textContent.includes("4 篇"),
    );
    assert(expand);
    const before = doc.querySelectorAll("[data-item-id]").length;
    expand.click();
    assert(doc.querySelectorAll("[data-item-id]").length === before + 4);
    doc.body.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
    assert(
      doc.activeElement.hasAttribute("data-item-id"),
      "j did not focus selected row",
    );
    doc.activeElement.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await until(
      () => doc.querySelector(".reading-article"),
      "Enter did not open row",
    );
  });
  await test("TOC scrolling, find shortcuts, series neighbors and font preference have real actions", async (assert) => {
    const item = (
      await (await fetch("/api/items?fmt=html&limit=100")).json()
    ).items.find(
      (item) => item.series?.total === 10 && item.series.position === 3,
    );
    click("[data-all-roots]");
    await until(
      () => doc.querySelector('[data-item-id="' + item.id + '"]'),
      "series item missing",
    );
    click('[data-item-id="' + item.id + '"]');
    await until(
      () =>
        doc.querySelector(".reading-article") &&
        doc.querySelector(".article-header h1")?.textContent === item.title &&
        doc.querySelectorAll("[data-heading-id]").length === 2,
      "TOC missing",
    );
    const toc = [...doc.querySelectorAll("[data-heading-id]")];
    assert(new Set(toc.map((x) => x.dataset.headingId)).size === toc.length);
    toc.at(-1).click();
    await until(
      () => toc.at(-1).getAttribute("aria-current") === "location",
      "TOC active did not follow click",
    );
    const scroller = doc.querySelector(".reader-scroll");
    scroller.scrollTo({ top: 0, behavior: "instant" });
    scroller.dispatchEvent(new win.Event("scroll"));
    await until(
      () => toc[0].getAttribute("aria-current") === "location",
      "TOC did not return to first section",
    );
    const previous = win.location.search;
    doc.body.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "]", bubbles: true }),
    );
    await until(
      () =>
        win.location.search !== previous &&
        doc.querySelector(".reading-article"),
      "next series shortcut failed",
    );
    const input = doc.querySelector("#search-input"),
      url = win.location.href;
    input.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
    assert(win.location.href === url);
    change(input, "证据");
    await until(
      () =>
        doc.querySelector(".find-count")?.textContent.includes("处") &&
        doc.querySelector("mark.reader-hit"),
      "find did not index body",
    );
    doc.body.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "n", bubbles: true }),
    );
    assert(
      doc.querySelector(".find-count").textContent.includes("/"),
      "n did not jump",
    );
    const currentCount = doc.querySelector(".find-count").textContent;
    doc.body.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
    assert(
      doc.querySelector(".find-count").textContent === currentCount,
      "list focus reset current find count",
    );
    doc.body.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "N",
        shiftKey: true,
        bubbles: true,
      }),
    );
    assert(doc.querySelector(".current-hit"));
    click('[aria-label="调整正文字号"]');
    [...doc.querySelectorAll(".menu button")]
      .find((x) => x.textContent === "21 px")
      .click();
    assert(
      win.getComputedStyle(doc.querySelector(".reading-article")).fontSize ===
        "21px",
    );
    assert(JSON.parse(win.localStorage.getItem("ui.readerFont")) === 21);
    change(input, "");
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "reset after shortcuts failed",
    );
  });
  await test("late confirmation preview never replaces a newer path draft", async (assert) => {
    click("[data-open-manager]");
    const fixture = await (await fetch("/test/fixture-info")).json();
    change(doc.querySelector("#root-path"), fixture.childPath);
    await until(
      () => doc.querySelector("#root-preview").textContent.includes("8 条资料"),
      "initial child preview missing",
    );
    const original = win.fetch;
    let release;
    win.fetch = (url, options) =>
      String(url) === "/api/roots?dryRun=1" &&
      JSON.parse(options.body).path === fixture.childPath
        ? new Promise(
            (resolve) => (release = () => original(url, options).then(resolve)),
          )
        : original(url, options);
    click("#add-root");
    await until(() => release, "confirmation preview was not requested");
    change(doc.querySelector("#root-path"), "/__missing_new_path__");
    await until(
      () => doc.querySelector("#root-preview").textContent.includes("不存在"),
      "new missing-path preview did not publish",
    );
    release();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert(
      doc.querySelector("#add-root").disabled,
      "late preview enabled wrong draft",
    );
    assert(
      !doc.querySelector("#root-preview").textContent.includes("8 条资料"),
      "late preview replaced current path",
    );
    win.fetch = original;
    doc.querySelector("dialog.manager .dialog-header button").click();
  });
  await test("child-root preview and add-remove preserve single ownership in the manager", async (assert) => {
    click("[data-open-manager]");
    const fixture = await (await fetch("/test/fixture-info")).json();
    change(doc.querySelector("#root-path"), fixture.childPath);
    await until(
      () => doc.querySelector("#root-preview").textContent.includes("8 条资料"),
      "overlap preview missing",
    );
    assert(doc.querySelector("#root-preview").textContent.includes("40 条"));
    click("#add-root");
    await until(
      () => doc.querySelectorAll("[data-manager-root]").length === 2,
      "child root add failed",
    );
    await until(
      () =>
        [...doc.querySelectorAll(".manager-counts strong")]
          .map((x) => x.textContent)
          .includes("40 条") &&
        [...doc.querySelectorAll(".manager-counts strong")]
          .map((x) => x.textContent)
          .includes("8 条"),
      "ownership counts not published",
    );
    const child = [...doc.querySelectorAll("[data-manager-root]")].find(
      (node) => node.querySelector(".manager-path").title === fixture.childPath,
    );
    child.querySelector(".drag-handle").dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
      }),
    );
    await until(
      () => doc.querySelector("[data-manager-root]") === child,
      "keyboard root reorder failed",
    );
    child.querySelector('[aria-label$="目录操作"]').click();
    [...doc.querySelectorAll(".menu button")]
      .find((x) => x.textContent === "移除…")
      .click();
    await until(
      () => doc.querySelectorAll("dialog[open]").length === 2,
      "remove confirmation missing",
    );
    const confirmation = [...doc.querySelectorAll("dialog[open]")].at(-1);
    [...confirmation.querySelectorAll("button")]
      .find((x) => x.textContent === "移除")
      .click();
    await until(
      () =>
        doc.querySelectorAll("[data-manager-root]").length === 1 &&
        doc.querySelector(".manager-counts strong").textContent === "48 条",
      "parent did not recover child",
    );
    doc.querySelector("dialog.manager .dialog-header button").click();
  });
  await test("1000 results paginate fully and first100 DOM render stays below100ms", async (assert) => {
    const original = win.fetch,
      template = (await (await fetch("/api/items?limit=1")).json()).items[0],
      synthetic = Array.from({ length: 1000 }, (_, index) => ({
        ...template,
        id: "synthetic:" + index,
        title: "资料" + index,
        series: null,
      })),
      limits = [];
    win.fetch = (url, options) => {
      const request = new URL(url, win.location.href);
      if (
        request.pathname === "/api/items" &&
        request.searchParams.get("q") === "thousand"
      ) {
        const offset = Number(request.searchParams.get("offset") || 0),
          limit = Number(request.searchParams.get("limit") || 100);
        limits.push(limit);
        return Promise.resolve(
          new win.Response(
            JSON.stringify({
              total: 1000,
              roots: 1,
              groups: [],
              items: synthetic.slice(offset, offset + limit),
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }
      return original(url, options);
    };
    change(doc.querySelector("#search-input"), "thousand");
    await until(
      () =>
        doc.querySelectorAll("[data-item-id]").length >= 100 &&
        doc.querySelector('[data-item-id="synthetic:0"]'),
      "first100 missing",
    );
    const measurements = win.performance.getEntriesByName(
      "library-first-100-dom",
    );
    result.first100DomMs = measurements.at(-1).duration;
    assert(result.first100DomMs < 100, "first100 took " + result.first100DomMs);
    let count = doc.querySelectorAll("[data-item-id]").length;
    while (count < 1000) {
      doc.querySelector("#list-rows").scrollTop =
        doc.querySelector("#list-rows").scrollHeight;
      await until(
        () => doc.querySelectorAll("[data-item-id]").length > count,
        "next page never rendered",
      );
      count = doc.querySelectorAll("[data-item-id]").length;
    }
    assert(count === 1000);
    assert(limits.every((limit) => limit <= 500));
    win.fetch = original;
    change(doc.querySelector("#search-input"), "");
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "post1000 reset failed",
    );
  });

  await test("empty filters offer a working reset and connection errors have retry", async (assert) => {
    click("[data-all-roots]");
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "reset before empty state failed",
    );
    [...doc.querySelectorAll(".filter-chips button")]
      .find((node) => node.textContent === "MD")
      .click();
    [...doc.querySelectorAll(".filter-chips button")]
      .find((node) => node.textContent === "系列")
      .click();
    await until(
      () =>
        doc.querySelector(".empty-state")?.textContent.includes("筛选结果为空"),
      "empty filter state missing",
    );
    const reset = [...doc.querySelectorAll(".empty-state button")].find(
      (node) => node.textContent === "清除筛选",
    );
    assert(reset, "filter reset action missing");
    reset.click();
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "filter reset did not restore results",
    );
    const original = win.fetch;
    let fail = true;
    win.fetch = (url, options) =>
      String(url).includes("/api/items?") && fail
        ? Promise.reject(Error("test connection lost"))
        : original(url, options);
    change(doc.querySelector("#search-input"), "证据");
    await until(
      () => doc.querySelector(".empty-state")?.textContent.includes("无法连接"),
      "connection error state missing",
    );
    fail = false;
    doc.querySelector(".empty-state button").click();
    await until(
      () => doc.querySelector("[data-item-id]"),
      "retry did not fetch results",
    );
    win.fetch = original;
    change(doc.querySelector("#search-input"), "");
    await until(
      () => doc.querySelectorAll("[data-item-id]").length === 48,
      "reset after failure state failed",
    );
  });
  result.uiRows = doc.querySelectorAll("[data-item-id]").length;
  frame.remove();
}
