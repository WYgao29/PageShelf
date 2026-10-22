# PageShelf Electron 功能保留矩阵（M0）

盘点日期以任务说明为准：2026-10-22。工作树 `/Users/weisengao/Documents/ChatGPT/HTML 知识库`，分支 `electron-react`，任务派发时 HEAD 为 `a556edb7fe7b732698907e1bbe0302cc9a8af2c7`（本文件编写时 `git rev-parse HEAD` 与 `git branch --show-current` 结果相同）。

本文件只记录现行 Web 应用的行为与证据，以及计划中的 Electron 验证。仓库里没有 `electron/`、`src-ui/` 或 `pageshelf://` 实现。每一行的「目标侧验证」都是尚未执行的计划，不表示已经通过。

验收原文来自未修改的 `ELECTRON_PLAN.md`。§4 的复合清单拆成可追踪子行，子行 ID 回指同一条复选框，不合并不同复选框。§6、§8、§9 中影响保留或验收的义务单独成行。§5 视觉规范、§7 里程碑、§10 汇报格式和 §11 已知坑已阅读；除与下列行直接冲突的点外，不在本矩阵里改写成新的验收行为。

## 怎么读状态

| 状态 | 含义 |
|---|---|
| 保留 | 现行源码里有该行为。目标侧要证明 Electron 后仍然如此。 |
| 部分 | 实现能对上，但自动化证据只覆盖其中一部分，或只存在于未计入本次基线的浏览器套件。 |
| 替换 | 计划写明桌面端换机制。现行证据描述替换前的行为，不表示该机制继续存在。 |
| 新增 | 现行代码没有对应实现。目标侧验证仍是计划。 |
| 删除 | 现行代码有该行为，计划要求桌面版去掉。 |
| 过程 | Git 或发布约束，不是用户可见功能。 |

现行测试分两层，不要混用：

- `npm test` 是 `node --test test/*.test.js`。本次基线只覆盖这一层。
- `npm run test:browser`（`scripts/browser-test.mjs`，本机 Chrome）另有 UI 用例。下表点名这些用例作为证据位置。本次文档没有运行该命令，不能把它们算进 77/77。

计划 §2 所说的 17 个 `test/*.test.js` 与目录一致：`cache`、`config`、`e2e-smoke`、`formats`、`html-scan`、`library`、`markdown`、`metadata`、`root-recovery`、`roots`、`router`、`scheduler`、`search`、`server`、`service`、`trash`、`ui`。源码里有 76 处 `test()`。`root-recovery.test.js` 的循环把其中 1 处展开为 rename 与 order 两个运行时测试，因此按文件执行时是 77 个。这只是对照下面基线数字的源码计数，不是重新跑测试的结果。

## 基线（Codex 在本次文档改动之前提供）

本文件的作者没有运行 `npm test` 或 `npm run check`。

| 命令 | 任务中给出的结果 |
|---|---|
| `npm test` | 77 passed，0 failed |
| `npm run check` | 核对 marked 18.0.14、DOMPurify 3.4.16、Readability 0.6.0 |

`scripts/check-vendor.mjs` 对 `public/vendor/` 这三份文件做 SHA-256 校验，并打印 `Verified <路径>`。版本目录与 `public/vendor/VENDOR.md`、`README.md`「配置、缓存与内嵌库」一致。计划 §3 要求标记库继续用这些固定版本，或同版本 npm 包并保留 SHA 校验。

现行 `package.json` 脚本：`start`、`dev`、`service:install`、`service:status`、`service:stop`、`service:uninstall`、`test`、`check`、`test:browser`、`benchmark:search`。运行时依赖为空，`engines.node` 为 `>=20`，`"type": "module"`。计划 M9 才改脚本清单；M0 不改 `package.json`。

数据目录现行默认是 `~/.html-library/`（`HTML_LIBRARY_DATA_DIR` 可覆盖）。计划 §3 要求桌面版继续使用该目录和该覆盖变量。

## §4 来源目录

复选框 1：侧栏「添加目录」「管理」；原生选择文件夹或粘贴路径；1–40 字显示名；添加前预检（路径、重复、文件数、条目数、重叠影响），不通过不保存。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.1a | 侧栏「添加目录」「管理」 | 侧栏标题行按钮「管理」调用 `openManager()`（`public/js/views/sidebar.js`，`data-open-manager`）。页脚「＋ 添加目录」以 `focusAdd: true` 打开同一管理对话框。页脚还有「⚙ 设置」，同样打开管理对话框。管理对话框标题为「目录管理」（`public/js/views/manager.js`）。浏览器用例 `manager opens, duplicate preview blocks add and source rename keeps root id` 点击 `[data-open-manager]`。 | M4：侧栏仍能打开添加与目录管理。两个现行入口（「管理」和「＋ 添加目录」）以及额外的「设置」入口都要保留，除非后续验收明确合并。本矩阵不合并它们。 | 保留 |
| 4.1b | 原生选择文件夹或粘贴路径 | 管理表单有路径输入框，占位「粘贴文件夹的完整路径」（`#root-path`）。「选择文件夹…」POST `/api/system/choose-folder`。macOS 上 `src/server.js` 的 `chooseFolderWithNativeDialog` 用 `osascript` `choose folder`。用户取消时该函数返回 `null`，`src/routes/system.js` 把它写成 `{ cancelled: true }`。非 macOS 抛 `FOLDER_PICKER_UNAVAILABLE`。`src/routes/system.js` 处理该路由。node:test：`API returns the folder selected by the native folder picker`、`API reports when the native folder picker is cancelled`。 | M4：`dialog.showOpenDialog` 选文件夹，仍可粘贴路径。验证的是选中的路径进入预检，不是继续使用 `osascript`。 | 替换 |
| 4.1c | 显示名 1–40 字 | `src/roots.js` `labelFor` 用码点长度，空或超过 40 抛 `LABEL_INVALID`（「目录名称需为 1–40 个字符」）。留空时用目录基名。node:test：`paths are canonical, labels validated and order exactly covers roots`。侧栏内联输入和添加框的 `maxlength` 是 80（`sidebar.js`、`manager.js`）；保存前仍走 `labelFor`。40 字规则以注册表校验为准。 | 服务层预检继续拒绝 0 字和 41 字及以上。不要把输入框 `maxlength` 80 当成放宽后的规则。 | 保留 |
| 4.1d | 预检路径 | `registry.preview` 要求非空路径，`path.resolve` 后 `inspect`。不可用时 `valid: false`，检查码来自目录状态（如缺失、不是目录）。node:test：`API rejects invalid roots and unknown source formats`（不存在的路径 400）、`root contract exposes scan totals, affected series and specified validation codes`、`deepest available root owns files once and dry run does not write`。 | 服务层预检仍返回路径类失败且不写配置。IPC 错误码对应现行 400，而不是新开一套语义。 | 保留 |
| 4.1e | 预检重复来源 | 同一规范化路径视为重复，码 `ROOT_EXISTS`，文案「该目录已经添加」。浏览器用例见 4.1a（预检文本含「已经添加」，`#add-root` 禁用）。 | 重复路径不能保存。同名不同路径不走这条，见 4.3d。 | 部分 |
| 4.1f | 预检文件数与条目数 | 预检在可用目录上 `listSourceFiles`，返回 `counts.files` 与按 NFC 主干去重的 `counts.items`（`roots.js` `itemCount`）。扩展名见 4.2a。浏览器用例 `child-root preview and add-remove preserve single ownership in the manager` 检查预检里的条数。 | 预检结果仍包含文件数和合并后的条目数。 | 部分 |
| 4.1g | 预检重叠影响 | 预检计算父目录、子目录、`moved` 与 `parentAfter`，并生成重叠说明。`src/routes/roots.js` `previewResponse` 附带受影响系列。浏览器用例同上，预检文本含条数与父目录剩余。node:test：`root contract exposes scan totals, affected series and specified validation codes`。 | 重叠预检仍说明迁移条数、父目录剩余和受影响系列，且本身不写配置。 | 部分 |
| 4.1h | 预检不通过不保存 | `applyChange` 在 add 和改路径时先 `preview`，`valid === false` 则抛出，不进入 `configStore.update`。添加按钮在无效或只读时禁用（`manager.js`）。浏览器用例见 4.1a。 | 服务层失败路径不调用配置写入。对照测试保留「未写入」断言。 | 保留 |

复选框 2：支持 .html/.htm/.mhtml/.mht/.md；同路径同主干多格式合并；HTML 筛选含 MHTML。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.2a | 五种扩展名 | `src/roots.js` `EXTENSIONS` 为 `.html`、`.htm`、`.mhtml`、`.mht`、`.md`。`src/library.js` `FORMAT_EXTENSIONS` 把前两对分别归入 html 与 mhtml，`.md` 归入 markdown。未知来源格式：node:test `API rejects invalid roots and unknown source formats`、`readSource rejects unknown formats and files removed after scanning`。 | 扫描与打开仍只接受这五种。未知格式仍拒绝，不 500。 | 保留 |
| 4.2b | 同相对路径、同主干多格式合并为一条 | `scanRoot` 按主干分组。同一格式重复时 `chooseSource` 按扩展名优先级和文件名选择，并记入问题列表。条目可同时带 html、mhtml、markdown。node:test：`scan merges matching HTML and Markdown files into one item`、`scan chooses .html deterministically when a stem has duplicate HTML formats`、`scan indexes MHTML and extracts its embedded HTML for title and search`。 | 原 `library.test.js` 保持不改并通过。合并后的条目 ID 仍是 `rootId + ":" + sha1(主干).slice(0, 12)`（`createId`）。 | 保留 |
| 4.2c | HTML 筛选包含 MHTML | `src/search.js`：`fmt=html` 匹配 `item.html \|\| item.mhtml`；`fmt=mhtml` 与 `fmt=markdown` 只匹配对应字段。列表芯片是「全部 / HTML / MD」，没有单独的 MHTML 芯片（`public/js/views/list.js`）。node:test：`API opens MHTML as HTML and keeps the original archive for download` 断言 `fmt=html` 结果含该 MHTML 条目；`root filters series ordering grouping and pagination remain consistent` 覆盖 `fmt=markdown`。 | 服务层搜索保持该筛选语义。UI 若保留「HTML」芯片，MHTML 条目仍出现。 | 保留 |

复选框 3：父子重叠归属最深可用目录、不重复计数；停用/失效/移除后父目录回收；移除只取消索引，源文件保留；同名来源用路径区分。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.3a | 最深可用目录归属，不重复计数 | `recompute` 把更深层可用目录写入父级 `excludes`。`getSnapshot` 丢掉落在 exclude 内的条目。node:test：`deepest available root owns files once and dry run does not write`、`new roots always use NFC ids while overlap transfer never duplicates published items`、`legacy fixture retains all ids and ownership goes 48 to 40+8 to 48`。 | 原 `roots.test.js` 与 `library.test.js` 不改并通过。快照里同一文件只出现一次。 | 保留 |
| 4.3b | 停用、失效或移除后父目录回收 | 停用和 inspect 失败会使子目录不可用，父级 exclude 随之消失。移除子目录后父级重新索引。node:test：`legacy fixture retains all ids and ownership goes 48 to 40+8 to 48`、`restored child root is indexed after rename`、`restored child root is indexed after order`。浏览器用例 `child-root preview and add-remove preserve single ownership in the manager` 在移除子目录后看到父目录回到 48 条。 | 停用、目录缺失、移除三条路径都要看到父目录收回条目，且不把同一条目算两次。 | 保留 |
| 4.3c | 移除来源只取消索引，源文件保留 | 删除来源走注册表 remove，不删除磁盘上的源文件。node:test：`API removes a root without touching its source files`。确认框文案说明源文件仍留在原路径（`main.js` `removeRoot`）。这与条目「移入废纸篓」不同，见 §4 废纸篓。 | 服务层 remove 后源文件字节不变。不要把 launchd plist 的 `unlink`（`src/service.js`，只删 plist）当成源文件删除。 | 保留 |
| 4.3d | 同名来源用路径区分 | 预检 `duplicateLabel` 只标记同名，不因此失败。管理行显示 `displayPath`，同名时加「显示名相同」徽章（`manager.js`）。ID 与路径分离，见 4.4a。 | 两个同名、不同路径的来源可以同时存在，界面能看出路径差异。 | 部分 |

复选框 4：目录 ID 与路径分离；改名排序不读文件；重新定位保持条目链接；归属变化时条目 ID 规则不变。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.4a | 目录 ID 与路径分离 | 配置里的 `id` 独立保存。缺省 ID 才是 `root-` 加路径哈希（`config.js` `normalize`、`library.js` `normalizeRoot`）。改名不改 ID。浏览器用例见 4.1a（改名后仍用原 `data-root-label-input` ID 查找）。 | 改显示名后目录 ID 不变。新来源仍只在没有 ID 时生成 ID。 | 保留 |
| 4.4b | 改名、排序不读文件 | 只改 label 或 order 时不跑预检扫描。node:test：`ordinary rename and order do not enqueue scans for available roots`（对 `ok`、`warning`、`scanning` 都断言 `scan.queued` 为空）。 | 原断言保留：可用目录的改名和排序不入扫描队列。 | 保留 |
| 4.4c | 重新定位后，相对路径不变则条目链接仍可用 | 管理菜单「重新定位…」对路径再跑预检，通过后 patch 同一目录 ID（`manager.js` `relocate`）。条目 ID 使用该目录 ID 加相对主干哈希，所以同一目录、同一相对路径得到同一条目 ID。侧栏仅在状态不是 `ok`、`warning`、`scanning`、`disabled` 时提供「重新定位…」（`sidebar.js`）。失效目录恢复另见 `restored child root is indexed after rename/order`。没有名为「重新定位后旧条目 URL 仍打开」的 node:test。 | 同一目录 ID 重新定位到移动后的文件夹时，未变的相对路径仍解析到原条目 ID。侧栏与管理里两套重新定位入口的现行条件都要保留。 | 部分 |
| 4.4d | 归属变化时条目 ID 规则不变 | 规则是 `目录 ID + ":" + createId(相对主干)`。主干在新目录用 NFC；遗留目录可保持 v1（`resolveIdAlgorithm`，`options.idAlgo`）。资料改挂到另一个目录时，ID 随目录 ID 变化；子目录移除后父目录原 ID 回来。node:test：`legacy NFD stems retain v1 item ids and memory feedback persists on next mutation`、`new roots always use NFC ids while overlap transfer never duplicates published items`、`legacy fixture retains all ids and ownership goes 48 to 40+8 to 48`。 | 原 `library.test.js` 不改并通过。不要改成「归属变化时 ID 字符串永远不变」。 | 保留 |

复选框 5：目录菜单：增量/全量重扫、重新定位、停用/启用、系列识别开关、访达显示、移除；拖动排序与聚焦拖柄 `Alt+↑/↓`；全局最多 2 个来源并发扫描；扫描状态与问题列表；旧结果扫描期间可浏览，扫描时窗口保持可交互。

管理对话框的「⋯」菜单包含：增量重扫、全量重扫、重新定位、停用/启用、系列识别开关、在访达中显示、移除（`manager.js`）。侧栏根目录菜单是子集：重扫此目录（增量）、重命名、在访达中显示、仅失效时重新定位、停用/启用、移除；没有全量重扫和系列开关（`sidebar.js`）。两套菜单都是现行行为。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.5a | 增量重扫 | 管理项「增量重扫」和侧栏「重扫此目录」调用 `scan(id)`，POST `/api/roots/:id/scan`。未改签名的文件复用已抽取元数据。node:test：`incremental scans reuse unchanged metadata and full scans reread`。 | 单目录增量扫描仍跳过未变化文件，并在完成后替换该目录索引。 | 保留 |
| 4.5b | 全量重扫 | 管理项「全量重扫」调用 `scan(id, { full: true })`。管理顶部还有「全部重扫」和「全量重扫」（全部目录）。全量忽略未变化签名并重读。同一 node:test 覆盖 full。 | 单目录与全部目录的全量扫描都会重读。`Shift+R` 对应全部重扫，见 4.K8a。 | 保留 |
| 4.5c | 重新定位 | 见 4.4c。 | 见 4.4c。 | 部分 |
| 4.5d | 停用 / 启用 | PATCH `enabled`。停用后 `rootAvailable` 为假，快照不计其条目，父目录可回收。菜单文案在「停用」和「启用」间切换。node:test 覆盖 enabled 过滤的有归属用例（4.3a、4.3b）。 | 停用后条目不出现在默认快照中，启用后按原 ID 回来。 | 保留 |
| 4.5e | 系列识别开关 | 管理菜单在 `options.series === "off"` 与 `"auto"` 间切换。`finalizeRootMetadata` 读取 `seriesMode`。默认 `series: "auto"`（`config.js`）。没有单独的 node:test 名称只断言这个开关。系列规则本身见 `series requires two in same folder, R2 avoids root and numeric natural ordering`。 | 关闭系列识别后不再生成系列；再打开后按现行规则重建。开关只存在于管理菜单这一事实要保留。 | 部分 |
| 4.5f | 访达显示 | POST `/api/system/reveal`，正文只能有一个键：`rootId`、`itemId` 或 `trash: true`。实现是固定参数的 `/usr/bin/open`（目录和条目 `-R`，废纸篓 `-a Finder ~/.Trash`）。node:test：`system reveal accepts only known IDs and uses fixed argv`。 | 计划中的 `revealInFinder` 仍只接受已知 ID，参数数组固定。废纸篓入口见 4.T7。 | 替换 |
| 4.5g | 移除 | 菜单「移除…」使用应用内 `confirmDialog`，确认后 DELETE 该目录。见 4.3c。浏览器用例见 4.3b 的移除步骤。 | 未确认不删除索引。确认后源文件仍在。 | 保留 |
| 4.5h | 拖动排序 | 管理行拖柄 `draggable`，`dragstart` / `drop` 后 PUT `/api/roots/order`，正文 `{ ids }`。顺序必须恰好覆盖全部目录且不重复。node:test：`paths are canonical, labels validated and order exactly covers roots`、`v2 root API guards writes and supports preview rename order disable relocate remove`。没有找到指针拖放的浏览器用例；键盘排序见 4.5i。 | 拖放后的顺序写入配置且不触发可用目录扫描（见 4.4b）。 | 部分 |
| 4.5i | 聚焦拖柄后 `Alt+↑/↓` | 拖柄 `aria-label` 为「拖动或 Alt 加方向键排序」。`keydown` 绑在管理行上，Alt+方向键与相邻行交换。浏览器用例 `child-root preview and add-remove preserve single ownership in the manager` 在 `.drag-handle` 上派发 Alt+ArrowUp，并断言该行移到第一位。 | M4 与 M7：焦点在拖柄上时 Alt+方向键排序，只读配置下不排序。 | 部分 |
| 4.5j | 全局最多 2 个来源并发，来源内串行 | `createScheduler({ concurrency: 2 })`（`library.js` 写死 2）。同一目录已在运行时不会并行第二次；排队项会合并，`full` 取或。node:test：`same root scans serially with one merged rerun and global concurrency two`、`scan failure releases slots and idle waiters`。来源内串行写在计划 §2 和 README，测试与 §4 的并发条款是同一调度器。 | 原 `scheduler.test.js` 不改并通过。worker 里并发上限仍是 2。 | 保留 |
| 4.5k | 扫描状态与问题列表 | 调度器 `status()` 返回 `running` 与 `queued`，进度为 `files.done/total`。UI 轮询 `pollScan`（`main.js`）。管理行显示「扫描中 done/total」、状态文案，以及「N 个问题」对话框（路径加消息）。扫描结束 toast 汇总问题数。读取失败记入 `issues` 而不中断整个目录（`library.js`）。node:test：`root contract exposes scan totals, affected series and specified validation codes`。 | 进度事件名为计划中的 `scan-progress`（§3）。问题列表仍逐条给出路径和消息。旧 UI 的轮询可以换成事件，但状态字段要能对上。 | 保留 |
| 4.5l | 扫描期间旧结果仍可浏览 | 新索引在 `scanRoot` 末尾、且目录修订号仍匹配时才 `indexes.set`。修订号变化或目录已删除则丢弃结果，必要时重新排队。node:test：`a scan queued after removing a root cannot be overwritten by the earlier scan`、`a stale delayed scan cannot resurrect a trashed item`。没有名为「扫描中搜索仍返回旧快照」的测试。 | 扫描未完成时搜索和打开仍使用上一份已发布索引。完成前不闪空库。 | 部分 |
| 4.5m | 扫描时窗口保持可交互 | 现行扫描跑在提供 HTTP 的同一 Node 进程里。浏览器 UI 靠异步请求和轮询，没有桌面窗口拖动、滚动、搜索的交互测试。计划 §3 把扫描放进 utilityProcess，就是为了主进程不被堵住；§7 M4 要求扫描大目录时窗口拖动、滚动、搜索仍流畅。 | M4：大目录扫描期间拖动窗口、滚动列表、输入搜索仍然响应。此行没有现行 Electron 证据。 | 新增 |

## §4 阅读、搜索、界面

复选框 6：右侧阅读：sandbox iframe 原网页（经 `pageshelf://`）/ Markdown 源文本 / 抽取正文，三视图可切换；抽取 < 200 字回退并说明原因；短 Markdown 按笔记阅读。

现行视图不是每条资料都有三档。`main.js` `cycleView` 与 `reader.js`：纯 Markdown（无 html 且无 mhtml）为「阅读视图 / 源文本」；只有网页时为「阅读视图 / 原网页」；同时有网页和 Markdown 时为「阅读视图 / 原网页 / Markdown」。这与 README 一致。计划括号里的 `pageshelf://` 是目标 URL，现行 URL 是 `/api/items/:id/original` 与 `/source/...`。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.6a | 原网页 sandbox iframe | `reader.js` `original()` 创建 `iframe`，`sandbox=""`（无 `allow-scripts`、无 `allow-same-origin`），`src` 为 `/api/items/:id/original`。原网页响应带 `SOURCE_CSP`（`src/routes/items.js`：`sandbox; default-src 'none'; script-src 'none'; ...`）和 `X-Content-Type-Options: nosniff`。node:test：`source responses prevent executable HTML and unknown formats are not server errors`、`v2 document APIs use text/plain ETags safe images sandbox and series details`。 | M6：iframe 仍是空 sandbox。`src` 形如 `pageshelf://source/<itemId>/<format>`。响应带现行 `SOURCE_CSP` 与 `nosniff`。含 `<script>` 的样例不执行、不发请求（§7 M6，§8 Playwright）。 | 替换 |
| 4.6b | Markdown 源文本 | 纯 Markdown 且视图为 `original` 时，以 `pre.source-text` 显示 `/source/markdown` 正文，不走 iframe。 | 源文本视图仍是纯文本，不把 Markdown 源文件交给可执行的 HTML 解析。 | 保留 |
| 4.6c | 抽取正文 | `public/js/reader/pipeline.js` `buildReader`：站点选择器，失败再加载 Readability 0.6.0，然后 DOMPurify 3.4.16（`PURIFY_CONFIG`）。浏览器模块 `test/browser/reader-tests.js`：`extract <name>`、`source presentation is removed before parsing without CSP style errors`。真实库用例在 `reader-real-tests.js`，不属于 `npm test`。 | 抽取链保留站点规则、Readability 回退和同一 DOMPurify 配置。vendor 版本见基线。 | 部分 |
| 4.6d | 三视图切换 | 分段控件与 `v` 快捷键按 4.6 开头的规则循环。路由字段 `view` 只接受 `original`、`markdown`，其余归 `reader`（`router.js`）。node:test：`routes round trip unicode ids query filters view and settings`。浏览器用例 `ordinary article click opens in place and restores view switches`。 | 同时含网页和 Markdown 的条目能在三视图间切换；纯 Markdown 与纯网页保持现行两档，而不是强行做出第三档。 | 保留 |
| 4.6e | 抽取不足 200 字或找不到正文时回退并说明原因 | 非 Markdown：找不到正文返回 `未找到正文`；清洗后码点长度 &lt; 200 返回 `抽取正文不足 200 字`；Readability 失败用 `error.message`。`reader.js` 以 `fallback-banner` 显示原因并改显示原网页 iframe。浏览器用例 `short HTML falls back and short Markdown remains readable` 断言短 HTML 为 `fallback`。 | 两条原因文案保持不变。回退后加载的是 sandbox 原网页，不是未清洗的内联 HTML。 | 部分 |
| 4.6f | 短 Markdown 按笔记阅读 | 200 字门槛包在 `if (!isMarkdown)` 里。短 Markdown 仍返回 `status: "reader"`。同一浏览器用例断言短笔记可读，且 front matter 不出现在正文。node:test：`Markdown front matter only strips closed supported metadata`、`wikilinks prefer same folder then unique root and reject ambiguous missing or outside`。 | 短 Markdown 不因不足 200 字回退到「原网页」。 | 部分 |

复选框 7：搜索覆盖标题、系列、标签、相对路径、正文；空格 AND、`"短语"`、`-词` 排除；范围（当前/全部目录）、格式、系列/单篇、排序；高亮与命中数；分组默认 6 篇可展开；每批 100 条加载。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.7a | 搜索字段：标题、系列、标签、相对路径、正文 | `searchItems` 的字段数组依次是 title、`series.name`、tags、`relativePath`、`searchText`。全部 include 词都必须在某一字段出现，exclude 词命中任一字段即排除。node:test：`search matches title, path, and body content`。系列名和标签在计分里有权重，但没有单独的 node:test 只断言这两个字段。 | 五个字段都参与匹配。补测或对照时要单独覆盖系列名和标签，不能只复跑标题/路径/正文。 | 部分 |
| 4.7b | 空格表示 AND | `parseQuery`（`public/js/shared/text-search.js`）按空白切词，全部进入 include。node:test：`AND phrase exclusions pure exclusions and weighted NFKC search`（`证据 方法` 同时命中 a 与 b）。 | 原 `search.test.js` 不改并通过。vitest 再覆盖同一语法（§8）。 | 保留 |
| 4.7c | 双引号短语 | 引号内文本作为一个 include 词，保留内部空格。同一 node:test 断言 `"正文 证据"` 只命中 1 条。`parseQuery('"完整 短语" -词')` 在高亮测试里。 | 短语内空格不再拆成 AND。 | 保留 |
| 4.7d | `-词` 排除 | 前导 `-` 进入 exclude。纯排除（只有 `-词`）会留下未命中该词的条目。同一 node:test 覆盖 `方法 -排除` 与 `-排除`。 | 排除优先于「必须命中 include」。NFKC 大小写折叠保持现行。 | 保留 |
| 4.7e | 范围：当前目录 / 全部目录 | 有搜索词时列表显示范围分段（`list.js`）。当前目录把 `roots` 设为该目录 ID；选「全部目录」时不传 roots，并在有目录 ID 时于 URL 写 `scope=all`（`router.js`）。无搜索词时范围控件隐藏，列表仍按当前目录或系列过滤。 | 两种范围的 URL 往返与结果集与现行 `parseRoute` / `serializeRoute` 一致。 | 部分 |
| 4.7f | 格式筛选 | 芯片：全部、HTML、MD。语义见 4.2c。非法 `fmt` 抛 `INVALID_FILTER`。 | `html` 含 MHTML；`markdown` 不含 HTML。非法值仍是客户端错误。 | 保留 |
| 4.7g | 系列 / 单篇 | 芯片切换 `kind=series` 或 `single`，再点一次清除。`series` 要求有系列，`single` 要求没有。node:test 断言 `kind: "series"` 在样例中为 2 条。 | 筛选与 URL 字段 `kind` 往返一致。 | 保留 |
| 4.7h | 排序 | 选项：最近更新 `updated`、标题 `title`、系列顺序 `series`、相关度 `relevance`。有搜索词且未指定时默认 `relevance`；在系列内默认 `series`；否则 `updated`（`router.js` 与 `search.js` 一致）。非法 sort 抛 `INVALID_FILTER`。node:test覆盖系列顺序与非法值。 | 四种排序和三条默认规则保持不变。 | 保留 |
| 4.7i | 高亮与命中数 | 标题用原文范围；正文片段由 `snippet` 生成。命中数是正文 `countMatches`。列表显示「命中 N 处」和 `highlighted()`。node:test：`highlights use original UTF16 ranges for ligature fullwidth emoji and combining marks`，以及 AND 测试里的 `hits`。 | 高亮范围仍相对原文 UTF-16，而不是 NFKC 后的字符串。命中数仍来自正文。 | 保留 |
| 4.7j | 分组默认 6 篇，可展开 | API 在系列/相关度分组时返回组。列表对每组 `slice(0, 6)`，其余用展开按钮（`list.js`）。浏览器用例：`group expansion and keyboard selection keep the focused row visible`；`native Enter expands six rows to ten without selecting an article`（`test/browser/keyboard-regressions.mjs`）。6 这个数字没有 node:test。 | vitest 或 Electron 冒烟要断言默认 6 与展开，不能只断言 API 分组。 | 部分 |
| 4.7k | 每批 100 条 | `list.js` `fetchPage` 固定 `limit=100`，下一页 `offset` 为已加载条数。`search.js` 默认 limit 100，上限夹到 500。浏览器用例 `1000 results paginate fully and first100 DOM render stays below100ms` 不在 `npm test` 内。node:test 只用 `limit: 1, offset: 1` 检查分页与分组一致。 | 滚动继续加载时每批 100，不重复、不丢条。默认 limit 仍是 100。 | 部分 |

复选框 8：导航状态（目录/系列、搜索、筛选、排序、条目、视图）进入应用内路由（hash/history），后退/前进（`⌘[` / `⌘]` 菜单项或鼠标侧键）可恢复，重启后恢复上次状态。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.8a | 导航状态进入应用内路由 | 现行用 History API，不是 hash。`serializeRoute` / `parseRoute` 写入：目录 `/r/:id`、系列 `/s/`、文件夹 `/f/`、查询 `q`、`scope`、`fmt`、`kind`、`sort`、`item`、`view`，管理页为 `/settings/roots`。`navigate` 使用 `pushState`，部分输入用 `replace`。node:test：`routes round trip unicode ids query filters view and settings`。浏览器用例 `root selection and series navigation restore URL`。 | §4 写法是 hash 或 history。无论选哪一种，往返字段必须与现行 `router.js` 相同，包括 Unicode ID。§8 要求 vitest 做序列化往返。本矩阵不指定必须用 hash。 | 保留 |
| 4.8b | 后退 / 前进恢复 | `popstate` 重新 `parseRoute(location.href)`（`main.js`）。没有 `⌘[`、`⌘]` 监听，也没有鼠标侧键监听；浏览器自己的后退会触发 `popstate`。没有应用菜单。 | 计划允许「`⌘[` / `⌘]` 菜单项或鼠标侧键」。桌面版至少要提供其中一种，并且后退/前进后路由字段恢复。菜单实现见 4.K10，不能和渲染层各执行一次。 | 新增 |
| 4.8c | 重启后恢复上次导航状态 | 路由只在 URL 里。没有把路由写入 `localStorage` 的代码。关掉页面后，只有浏览器自己恢复标签页才会留下 URL。主题、字号、栏宽另存，见 4.10f。阅读滚动位置只在内存 `Map`（`reader.js` `positions`），刷新即失。计划此条要求重启后恢复的是本复选框括号里的导航状态，不是已读/收藏/进度（4.10g 禁止保存那些）。 | M5：退出并重新打开应用后，目录/系列、搜索、筛选、排序、条目和视图恢复。不要把内存滚动位置写成必须恢复的进度。现行代码没有这项持久化。 | 新增 |

复选框 9：TOC 跟随滚动；系列上一篇/下一篇用完整系列顺序。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.9a | TOC 跟随滚动 | `public/js/reader/toc.js` 用滚动位置（视口顶部加 30% 高度）和 `IntersectionObserver` 更新当前标题。标题来自抽取结果的 `h2, h3`。浏览器用例 `TOC scrolling, find shortcuts, series neighbors and font preference have real actions` 覆盖点击后的 `aria-current` 和滚回第一节。不在 `npm test` 内。 | 滚动阅读正文时当前 TOC 项跟着变。M6 阅读器验收包含 TOC。 | 部分 |
| 4.9b | 系列上一篇/下一篇使用完整系列顺序 | 条目详情用快照里的 `series.itemIds` 下标取 `prev` / `next`（`src/routes/items.js`），不是当前搜索页。系列顺序来自 `metadata.js`（同目录至少两篇、自然数排序）。UI 按钮与 `[` / `]` 都调用 `actions.openItem`。node:test：`series requires two in same folder, R2 avoids root and numeric natural ordering`；文档 API 测试名含 series details。没有 node:test 断言「搜索结果变少时 prev/next 仍按全系列」。浏览器用例在 10 篇系列的第 3 篇上按 `]`。 | 在筛选或搜索之后，上一篇/下一篇仍按完整 `itemIds`，不按当前列表裁剪。 | 部分 |

复选框 10：主题亮/暗/跟随系统；`Aa` 字号 15/17/19/21 px；两条分隔线可拖动、方向键调整、双击复位 252/384 px；主题、字号、栏宽本地持久化；不存已读/收藏/进度。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.10a | 亮色、暗色、跟随系统 | `cycleTheme` 循环 `system → light → dark`。`theme-boot.js` 在样式表之前同步写 `documentElement.dataset.theme`；跟随系统时读 `prefers-color-scheme`。`main.js` 监听系统主题变化，仅在偏好为 system 时更新。node:test：`app has three accessible panes and synchronous theme boot before styles`（`theme-boot.js` 出现在 `tokens.css` 之前，且 `index.html` 无内联脚本）。 | §8 vitest：主题三态。启动无白闪（§7 M3）。跟随系统时，系统主题变化仍更新界面。 | 保留 |
| 4.10b | 字号 15/17/19/21 px | `Aa` 菜单只列这四档。非法存储值回落 17。CSS 变量 `--reader-font`。浏览器用例见 4.9a，点「21 px」后计算样式为 21px，且 `localStorage` 的 `ui.readerFont` 为 21。 | 只能这四档。vitest 可覆盖菜单与回落。 | 部分 |
| 4.10c | 两条分隔线可拖动 | `#split-side` 与 `#split-list`（`splitter.js`）。指针拖动改变对应宽度。没有 node:test。 | 拖动中栏宽变化，松手后保持。M3 要求分隔条。 | 部分 |
| 4.10d | 方向键调整 | 分隔条聚焦后 Left/Right 每次 10px。范围夹在侧栏 200–320、列表 320–520。§8 把 clamp 列为新的 vitest 项。 | 方向键步进与夹取范围保持 10px 和上述最小/最大。 | 部分 |
| 4.10e | 双击复位 252/384 px | 任一分隔条双击都把两栏设为 252 和 384。默认值同样是 `[252, 384]`。计划 §5 把规范里的侧栏 240 写成产品例外，复位值仍是 252/384。本行按 §4 与现行代码，不改回 240。 | 双击任一分隔条都恢复 252 与 384。vitest 覆盖 clamp 与双击复位。 | 保留 |
| 4.10f | 主题、字号、栏宽本地持久化 | 键：`ui.theme`（普通字符串）、`ui.readerFont` 与 `ui.paneWidths`（`storageSet` JSON）。读写失败被吞掉。侧栏折叠只切换 `body.sidebar-collapsed`，不写入存储。 | 这三个键在重启后仍生效。折叠状态按现行不持久化，除非另有验收。 | 保留 |
| 4.10g | 不保存已读、收藏或阅读进度 | 源码中没有已读、收藏或进度字段写入配置或 `localStorage`。滚动位置只在内存。配置 `ui` 对象会保留未知字段（v1 迁移测试），但应用不写入阅读进度。 | 桌面版仍不新增已读、收藏、进度存储。重启恢复的是 4.8c 的导航字段。 | 保留 |

复选框 11：外部图片占位；Markdown 本地图片验证来源边界与真实图片类型；UI 与正文均不自动外连。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.11a | 外部图片占位 | `prepareImages` 保留光栅 data URL。Markdown 的相对路径改写到 `/api/items/:id/asset`。其他 `src`（含 http）被去掉，alt 前加「外部图片未加载」，无 `src` 的图片换成 `.image-placeholder`。浏览器用例 `Markdown GFM tables tasks nested lists headings images and wikilinks` 含远程图片样例。 | M6：外链图片不发请求，显示占位。占位文案保持可识别。 | 部分 |
| 4.11b | Markdown 本地图片校验边界与真实类型 | `action === "asset"` 只对带 markdown 的条目开放。`path.resolve` 后 `readSafeFile`（真实路径必须在来源根内，拒绝符号链接和越界）。`imageType` 只认 PNG、JPEG、GIF、WEBP、AVIF 的魔数与扩展名一致，否则 `SOURCE_NOT_FOUND`「仅支持本地图片」。node:test：`v2 document APIs use text/plain ETags safe images sandbox and series details`、`readSource rejects paths outside the configured root`、`readSource rejects a source file replaced by a symlink outside the root`。 | 主进程协议测试：路径穿越、越界、伪装扩展名均拒绝。成功响应带 `SOURCE_CSP` 与 `nosniff`。 | 保留 |
| 4.11c | UI 与正文不自动外连 | 主文档 `MAIN_CSP`（`src/server.js`）为 `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`。静态响应也带该 CSP 和 `nosniff`。正文是 `SOURCE_CSP`，`connect` 不在允许之列（`default-src 'none'`）。现行 `connect-src 'self'` 只为同源 API。计划 §6 把应用 CSP 写成另一串，见 6.4d。非锚点的 http 链接在抽取后设 `target=_blank` 与 `noopener noreferrer`（`pipeline.js`）。桌面版点击外链的规则见 6.5c，不是自动请求。 | M6 样例文档不发起外连。应用壳不再因为 API 而允许 `connect-src 'self'`。 | 替换 |

## §4 快捷键

总则：输入框、可编辑区、对话框内不触发单字母；非 macOS 用 Ctrl。实现在 `public/js/shortcuts.js`。对话框打开时，除下面注明的 Esc 外，处理函数直接返回。可编辑目标（`input, textarea, select, [contenteditable=true]`）或带 meta/ctrl/alt 时，单字母映射不运行。`⌘K` 与 `⌘\` 同时接受 `metaKey` 或 `ctrlKey`，不区分当前是不是 macOS。没有 node:test 覆盖快捷键；§8 要求 vitest 覆盖输入框屏蔽和 `g` 前缀 1 秒。浏览器套件只覆盖了下列点名的键。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.K0 | 单字母不在输入框、可编辑区、对话框中触发；Ctrl 等价于 ⌘ | 见本节总则。浏览器用例在搜索框里派发 `j`，URL 不变（`TOC scrolling...`）。对话框用 `<dialog open>` 检测。 | vitest：焦点在输入框、contenteditable 和打开的对话框时，`j`、`g`、`v`、`t` 等不触发。`Ctrl+K` 与 `Ctrl+\` 在非 macOS 上执行与 ⌘ 相同的动作。现行「两种修饰键都接受」应保留。 | 部分 |
| 4.K1a | `⌘K` 聚焦搜索 | meta 或 ctrl 加 `k` 时 `preventDefault` 并 `focusSearch`（`#search-input` 的 `focus()`）。 | 菜单与键各只触发一次，见 4.K10。 | 部分 |
| 4.K1b | `/` 聚焦搜索 | 无修饰键的 `/` 走映射表并聚焦搜索。`?` 由 Shift+/ 另处理，见 4.K9c。 | 搜索框内按 `/` 不抢键（4.K0）。 | 部分 |
| 4.K2a | `Esc` 关闭菜单 | 存在 `.menu` 时阻止默认并 `closeMenu()`。`menu.js` 自己的键监听也会对 Esc `stopPropagation` 后关闭。外部 `pointerdown` 同样关闭。路由变化没有专门关闭菜单的代码。§8 将「菜单 Esc/外部点击/路由变化关闭」列为新的 vitest，其中路由变化一项是计划要补的行为，不是现行已实现的事实。 | vitest 覆盖 Esc、外部点击，以及计划写明的路由变化关闭。实现路由变化关闭时不要改掉现行 Esc 顺序：先菜单，再对话框。 | 部分 |
| 4.K2b | `Esc` 关闭弹窗 | 若菜单不存在且有 `dialog[open]`，快捷键处理返回，交给对话框。`dialog.js` 在 `cancel` 上 `preventDefault` 后关闭并还原焦点。`confirmDialog` 未选择而关闭时 resolve `false`。 | §8：确认对话框 Promise。Esc 等于取消，不执行确认动作。 | 部分 |
| 4.K2c | `Esc` 清空搜索 | 无菜单、无对话框时调用 `escapeSearch`（`list.clearSearch`）。搜索框上的 Esc 也清空。其他可编辑控件上的 Esc 直接返回，不清搜索。侧栏改名输入框自行 `stopPropagation`，取消改名。 | 空状态下 Esc 清空搜索框并恢复无查询路由。其他输入框里 Esc 不触发全局清空。 | 部分 |
| 4.K3a | `j` 下一条 | `list.move(1)`，在 `[data-item-id]` 行之间移动焦点并 `scrollIntoView`。浏览器用例 `native j and k followed by Enter opens the focused article`。 | 不打开条目，只移动焦点。 | 部分 |
| 4.K3b | `k` 上一条 | `list.move(-1)`。同一浏览器用例在两次 `j` 后按 `k`。 | 到顶后停在第一行。 | 部分 |
| 4.K3c | `Enter` 打开 | 仅当目标是 `#search-input` 或 `document.body` 时调用 `openFocused`。展开按钮上的 Enter 由控件自己处理。浏览器用例：`native j and k followed by Enter opens the focused article`；`native Enter expands six rows to ten without selecting an article`；`native Tab then Enter opens the fourth focused article`。 | 保持这个范围：Enter 打开当前焦点条目，但不把「展开剩余篇目」误当成打开文章。 | 部分 |
| 4.K4a | `[` 系列上一篇 | `reader.neighbor(-1)`，有 `detail.prev` 才 `openItem`。数据来源见 4.9b。 | 无上一篇时不改变当前条目。 | 部分 |
| 4.K4b | `]` 系列下一篇 | `neighbor(1)`。浏览器用例在系列第 3 篇上派发 `]`，URL 查询变化且阅读区重新出现。 | 顺序规则同 4.9b。 | 部分 |
| 4.K5 | `v` 切换阅读视图 | `cycleView` 按 4.6d 的档位循环。无打开条目时返回。 | 三档与两档的现行划分保持不变。 | 部分 |
| 4.K6a | `n` 下一处正文命中 | `nextHit(1)` → `find.next`。浏览器用例见 4.9a：搜索「证据」后 `n` 使命中计数出现 `/`。 | 无查询或无命中时不抛错。 | 部分 |
| 4.K6b | `Shift+N` 上一处正文命中 | 映射键仍是 `n`，`shiftKey` 时方向为 -1。同一浏览器用例派发 `N` 加 shift，并断言 `.current-hit`。 | 与 `n` 共用查找器，方向相反。 | 部分 |
| 4.K7a | `g` 然后 `a`：全部目录 | `g` 把前缀窗口设为现在起 1000ms，自身不导航。窗口内 `a` 调用 `selectRoot("")`。过期后的下一个键按普通快捷键处理，并清掉前缀。窗口内若不是 `a` 或 `1–9`，也会清前缀并继续按该键的普通含义执行。 | vitest：间隔 ≤ 1 秒生效，超过 1 秒不生效。第二键的现行落空行为保持不变。 | 部分 |
| 4.K7b | `g` 然后 `1–9`：第 N 个目录 | 窗口内数字键调用 `selectRootByIndex(n - 1)`，即侧栏顺序的第 1 到第 9 个来源。越界则什么都不做。 | 只使用可见来源顺序，不使用系列序号。 | 部分 |
| 4.K8a | `Shift+R` 全部重扫 | `actions.scan()`，无目录 ID，POST `/api/scan`。 | 与管理里的「全部重扫」相同。只读或失败时现行用 toast，不静默失败。 | 部分 |
| 4.K8b | `Shift+M` 目录管理 | `openManager()`。已在管理页时保留 `backgroundRoute`。 | 打开 4.1a 的目录管理。 | 部分 |
| 4.K9a | `t` 切换主题 | `cycleTheme`，顺序见 4.10a，并 toast 当前主题名。 | 三态循环与本地持久化一致。 | 部分 |
| 4.K9b | `⌘\` 折叠侧栏 | meta 或 ctrl 加 `\` 切换 `sidebar-collapsed`。不写 `localStorage`。 | 折叠不改变路由。再次按下展开。 | 部分 |
| 4.K9c | `?` 快捷键帮助 | `?` 或 Shift+/ 打开应用内对话框，表内列出与 README 相同的键位（`main.js` `help`）。不是 `window.confirm`。 | 帮助对话框用应用内 dialog。Esc 关闭且不触发其他单字母动作。 | 部分 |
| 4.K10 | 应用菜单（View/Go）列出上述命令，且不与渲染层重复触发 | 现行没有应用菜单，也没有 View/Go。上述命令只在渲染层 `keydown`。 | M7：View/Go 列出这些命令。菜单触发走一条路径；若渲染层也收到该键，动作只发生一次。此行是新增验收，现行无法提供菜单证据。 | 新增 |

## §4 废纸篓、配置、缓存

复选框： 「文章操作 → 移入废纸篓…」用应用内危险确认对话框，列出全部关联源文件；优先系统 `trash`，必要时访达；从不 unlink；部分成功保留幸存格式并可重试；全部失败显示错误；目录管理「打开废纸篓」。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.T1 | 应用内危险确认，而不是系统 confirm | 阅读区菜单「移入废纸篓…」调用 `openDialog`，确认按钮 class 为 `danger`（`reader.js` `trash`）。POST 正文必须 `{ confirm: true }`，否则 `CONFIRM_REQUIRED`。`public/js` 中未使用 `window.confirm`。 | M7 使用应用内对话框。主进程不在未收到确认时移动文件。 | 保留 |
| 4.T2 | 列出全部关联源文件 | 对话框列出 `detail.files` 的路径和大小。详情 API 返回该条目 `sourceFiles` 的 format、path、size、updatedAt。 | 多格式条目在确认前列出每一个关联文件。 | 部分 |
| 4.T3 | 优先系统 `trash`，剩余文件再交访达 | `src/trash.js`：先 `/usr/bin/trash -- <paths>`，仍存在的文件再用 Finder `delete` AppleScript。返回 `method` 为 `trash-cli` 或 `finder`。node:test：`trash uses cli then Finder only for remaining files`。 | worker 继续调用这一服务，不改成直接删文件。Playwright 可用替身（§8）。 | 保留 |
| 4.T4 | 从不 unlink 源文件 | 失败路径不调用 `unlink`。符号链接在执行任何命令前拒绝。node:test：`failed trash never falls back to unlink`、`trash rejects symlinks before invoking any command`、`deleteItem refuses a source path replaced by an outside symlink`。`src/service.js` 的 `unlink` 只删除 LaunchAgent plist。 | 源文件失败时字节仍在。审查时把 plist 删除和源文件删除分开。 | 保留 |
| 4.T5 | 部分成功保留幸存格式，并可重试 | HTTP 207 加 `failed` 列表。索引只去掉已移走的格式。对话框列出失败路径并把按钮改成「重试剩余文件」。node:test：`partial trash reports surviving sources without claiming no changes`、`partial trash retains surviving formats and failed trash preserves files`。浏览器用例在 `test/browser/trash-regressions.js`：成功时前进到下一篇，没有下一篇时清空阅读区，迟到的响应不覆盖更新的选择。 | 207/部分失败的错误码与正文结构在服务层保留。重试只处理仍存在的文件。 | 保留 |
| 4.T6 | 全部失败显示错误 | 没有任何文件移走时抛 `TRASH_FAILED`，消息以「无法移入废纸篓」开头，并写明文件未被改动。对话框把 `error.message` 显示为 alert。同一失败测试覆盖。 | 全部失败时列表与磁盘都不变，界面显示该错误。 | 保留 |
| 4.T7 | 目录管理「打开废纸篓」 | 管理页页脚按钮调用 `reveal({ trash: true })`。成功移入后的 toast 也有「打开废纸篓」。见 4.5f 的 argv。 | `openTrash` 只打开系统废纸篓，不删除其中文件。 | 保留 |

复选框：配置/缓存行为（v1 迁移与 `config.v1.bak.json`、损坏另存 `config.broken-*.json`、>v2 只读、串行原子写、`cache/doc/` 500 MiB LRU、清除缓存）完全不变。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 4.C1 | v1 只在内存中迁移，首次写入前备份 `config.v1.bak.json` | `config.js` `read`：无 version 或 version 1 时保留原始字节。`update` 用 `flag: "wx"` 写 `config.v1.bak.json`，已存在则不再覆盖。备份发生在第一次修改，不是在单纯启动时。node:test：`migration preserves ids and unknown fields and backs up original bytes once`。 | 原 `config.test.js` 不改并通过。数据目录仍是 `~/.html-library/`。 | 保留 |
| 4.C2 | 损坏配置另存 `config.broken-*.json` | JSON 语法错误或现行版本的结构无效时，`rename` 到 `config.broken-` 加 ISO 时间（冒号换成 `-`）加 `.json`，内存改用空库，`startupWarning` 说明已备份。node:test：`broken config boots empty with a backup warning`、`invalid known-version labels and duplicate IDs are backed up instead of crashing or duplicating counts`。 | 原文件字节进备份，不就地改坏文件。启动提示仍出现。 | 保留 |
| 4.C3 | 高于 v2 只读 | `version > 2` 时 `readOnly`，目录结构仍能规范化则保留根并警告；不能规范化则空根、原字节不动，警告「目录结构暂不支持」。只读下仍可浏览、重扫、选文件夹、清缓存；写入抛 `CONFIG_READ_ONLY`。node:test：`future configuration is read only and remains byte identical`、`unsupported future schema remains untouched with a read-only warning`、`future config stays byte identical while browsing scanning and cache maintenance work`。 | 桌面版不升级写回更高版本。只读标志传到 UI，添加/改名/移除保持禁用。 | 保留 |
| 4.C4 | 串行队列与原子写 | `update` 串在 `queue` 上。写入先写 `config.json.tmp-<uuid>`，再 `rename` 覆盖；失败删除临时文件。模式 `0o600`。node:test：`concurrent configuration updates retain both roots`。 | 并发 IPC 写入仍串行，崩溃时不留下半截 `config.json`。 | 保留 |
| 4.C5 | `cache/doc/` 500 MiB LRU | `createDocumentCache` 默认 `maxBytes = 500 * 1024 * 1024`，目录为数据目录下 `cache/doc`。身份含 itemId、format、路径、dev、ino、size、mtimeMs。按访问时间淘汰。`clear` 增加 epoch，使迟到的生产者不能写回。node:test：`cache identity includes location inode format and file metadata`、`cache concurrent generation, budget eviction and clear invalidates late producer`。 | 原 `cache.test.js` 不改并通过。不要改预算或身份字段。 | 保留 |
| 4.C6 | 清除缓存 | 管理页「清除缓存」DELETE `/api/cache`，只删派生缓存。下次阅读经 `getOrCreate` 再生。只读配置下该按钮仍可用（4.C3 的 server 测试覆盖维护操作）。 | `system.clearCache` 只删除 `cache/doc` 派生文件，不碰源文件和 `config.json`。 | 保留 |

## §6 安全规则（影响保留或验收的义务）

这些行描述计划中的桌面约束。除「现行已经如此」的源文件规则外，Electron API 尚未存在。

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 6.1 | `BrowserWindow`：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`、`titleBarStyle: "hiddenInset"`、`trafficLightPosition: {x:16,y:18}`、`minWidth ≥ 960`、`backgroundColor` 随主题 | 现行是浏览器页面，没有 `BrowserWindow`。三栏节点由 `ui.test.js` 检查。最小宽度和标题条是计划值。规范 §4.1 把普通窗格顶栏定为 48px；规范 §4.2 把另一道 macOS 可拖拽标题条定为 52px。计划 M3 与 §11 的 logo 修法要求这道 52px 标题条。§11「顶栏 52（应为 48）」指普通窗格顶栏，不是这道标题条。两个高度各自成立。 | M2/M3：窗口选项与上述安全开关一致，最小宽度不小于 960。背景色跟随 4.10a。macOS 可拖拽标题条为 52px，普通窗格顶栏为 48px。 | 新增 |
| 6.2a | 不启动 HTTP 服务、不开端口 | 现行 `createServer` 使用 `node:http`。默认端口 4321、主机 `127.0.0.1`（`src/service.js`）。`npm start` 会监听。node:test `occupied port exits successfully without repeated errors` 描述的是端口被占用时的 HTTP 进程行为。 | M2：`lsof -iTCP -sTCP:LISTEN -p <应用 pid 及子进程>` 无监听端口。开发模式的 Vite 端口只允许开发，生产由 `pageshelf://app/` 加载（§3）。 | 删除 |
| 6.2b | 不使用令牌或 Cookie | 仅当设置 `AUTH_TOKEN` 时，`authorizeRequest` 用 `timingSafeEqual`，并把令牌写入 `HttpOnly; SameSite=Strict` Cookie `html_library_token`。node:test：`protected servers reject unauthenticated requests and support token bootstrap`。计划 §1 与 M9 删除这一模式。 | 生产路径没有令牌、Cookie 和 Bearer 检查。该 HTTP 测试不应原样变成桌面功能；与 §8「原断言逐条保留」的范围冲突见文末未决问题。 | 删除 |
| 6.3a | preload 只暴露具名函数 | 现行前端用 `fetch` 调 `/api`（`public/js/api.js`）。没有 preload。计划：`pageshelf.invoke`、`pageshelf.on`，以及 `pickFolder` / `revealInFinder` / `openTrash`。事件只限具名事件，例如 `scan-progress`、`library-changed`。 | 主进程测试：渲染层拿不到 `ipcRenderer` 或 Node。`on` 拒绝未列出的事件名。 | 新增 |
| 6.3b | `invoke` 方法白名单与参数校验 | 计划举例：`roots.list/add/preflight/update/remove/rescan`、`items.search/get/trash`、`system.clearCache/openTrash`。「如」表示例子，不是把现行能力收窄为这份名单。现行路由还包括排序、选文件夹、reveal、系列列表、document/original/asset/source/download、扫描状态、增量/全量扫描、启用开关。 | 白名单覆盖现行用户可见操作，参数有类型和长度校验。只实现例子名单会丢 4.5 和 4.6 的能力，本矩阵不把例子当成删减清单。 | 新增 |
| 6.3c | 调用方必须是 `pageshelf://app`，源文档 iframe 不能调用 preload | 现行靠同源 CSP 与 iframe `sandbox=""`。没有 `senderFrame` 检查。 | 主进程测试：`event.senderFrame` 不是 `pageshelf://app` 时拒绝。源 iframe 中没有 bridge。 | 新增 |
| 6.4a | `pageshelf://` 只接受 `app/` 与 `source/` | 现行静态文件在 `/assets/` 下，源文件在 `/api/items/...`。`serveStatic` 拒绝跑出 `public/`。node:test：`history deep links use shell while missing assets and unknown API stay 404`、`serves the unified library app shell`。 | 其他协议路径拒绝。不注册 `file://` 处理器，不 `bypassCSP`。方案注册 `standard, secure, supportFetchAPI`，且不 `bypassCSP`（§3）。 | 替换 |
| 6.4b | `source/` 只返回已索引条目及其边界内的本地图片 | 现行 `readSafeFile` / `validateSourceFile`：规范化路径、真实路径在来源根内、必须是普通文件、拒绝符号链接。见 4.11b。 | 协议处理先规范化再做同一边界检查。穿越和越界有主进程测试。 | 保留 |
| 6.4c | 源响应带现行 `SOURCE_CSP` 与 `nosniff` | 常量在 `src/routes/items.js`。original、source、download、asset 都设置。document 正文是 `text/plain`，不把抽取 HTML 当可执行页面返回。测试见 4.6a。 | 字节响应的 CSP 字符串与现行 `SOURCE_CSP` 一致，并带 `nosniff`。 | 保留 |
| 6.4d | `app/` 使用计划给出的主 CSP | 计划字符串：`default-src 'self'; script-src 'self'; frame-src pageshelf:; connect-src 'none'; object-src 'none'`。现行 `MAIN_CSP` 更宽：`frame-src 'self'`、`connect-src 'self'`，并含 img、style、base-uri、form-action。二者不是同一字符串。计划 §3 称「MAIN_CSP 等价策略」，§6 给出上面的目标串。 | 主进程测试断言 §6 这串，而不是把现行 HTTP CSP 原样抄上。`connect-src 'none'` 与「无 API 端口」一致。 | 替换 |
| 6.5a | `setWindowOpenHandler` 拒绝新窗口 | 现行列表按住 meta/ctrl 点击、列表右键菜单和阅读区文章菜单都通过 `window.open` 打开同源 `/original`（`public/js/views/list.js`、`reader.js`）。抽取后的正文外链使用 `target=_blank`。没有 Electron 钩子。计划要求 deny；这三个原文打开入口的替代方式未说明，见文末未决问题。 | 新窗口请求被拒绝。测试覆盖 Electron 拒绝未授权的 `window.open`，并按未决问题验证原文打开入口。 | 新增 |
| 6.5b | `will-navigate` / `will-frame-navigate` 只允许 `pageshelf://` | 现行导航是同一来源的 History API 与 iframe 源 URL。 | 主帧和子帧离开 `pageshelf://` 都被取消。 | 新增 |
| 6.5c | 正文链接经确认后 `shell.openExternal`，仅 http/https | 现行外链没有确认步骤，由浏览器打开。计划把确认后的外部打开限制为 http/https。 | 主进程测试：`javascript:`、`file:`、`pageshelf:` 和其他方案被拒绝；http 与 https 在确认后才打开。 | 替换 |
| 6.6 | 权限请求全部拒绝；禁用 `webview` | 现行页面未注册权限处理器，也没有 `webview` 标签。 | `setPermissionRequestHandler` 对所有权限调用 deny。窗口没有 `webviewTag`。 | 新增 |
| 6.7 | 不新增外连；只有确认移入废纸篓才移动文件；从不 unlink 源文件 | 外连见 4.11c。移动文件见 4.T1–4.T6。vendor 从本地路径加载，`npm run check` 不访问网络。 | 打包后的应用没有新的运行时网络依赖。未确认的废纸篓调用不改磁盘。 | 保留 |

## §8 测试义务

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 8.1 | 点名的 node:test 保持不改并全部通过 | 计划点名：`cache`、`config`、`formats`、`html-scan`、`library`、`markdown`、`metadata`、`root-recovery`、`roots`、`scheduler`、`search`、`trash`。本次基线 77/77 包含它们，也包含将迁移或删除的文件。例外：`test/root-recovery.test.js` 被计划称作纯模块测试，但文件导入 `createServer`、监听 `127.0.0.1` 并用 `fetch`。见文末未决问题。 | 这些文件在后续里程碑仍通过。在未决问题回答之前，不要为了删 HTTP 而改写 `root-recovery.test.js`，也不要把它当成已经与服务器无关。 | 保留 |
| 8.2a | `server.test.js`、`router.test.js`、`e2e-smoke.test.js` 迁到服务层和 worker IPC，原断言保留 | 现行 `server.test.js` 与 `e2e-smoke.test.js` 启动 HTTP。`router.test.js` 不走 HTTP，只测 `public/js/router.js` 与 `store.js`（往返、store 不可变、取消订阅）。计划要求保留的断言类别写明为：错误码、CSP header、来源边界拒绝、图片类型校验、废纸篓部分成功。对应现行测试名已在 §4 和 §6 各行引用。 | M1/M2：上述类别在服务层和 IPC 适配层各有直接调用测试。状态码变为错误码时，现行错误码字符串保持可识别。`router.test.js` 的路由往返不要在迁移时丢掉。 | 替换 |
| 8.2b | `ui.test.js` 与 `service.test.js` 随旧 UI 和 launchd 删除 | `ui.test.js` 只断言三栏 id、theme-boot 顺序、模块脚本入口、无内联脚本。`service.test.js`：`creates a local-only LaunchAgent plist with stable paths`、`installs a LaunchAgent by writing its plist and bootstrapping launchctl`、`reports LaunchAgent status from launchctl success or failure`、`uninstalls a LaunchAgent and removes its plist`。标签 `com.local.html-conversation-library`。M9 才删除，并要求覆盖点迁到 vitest 或说明为何不再适用。 | M9 删除前，三栏与无白闪主题仍有测试；launchd 测试随服务脚本删除，并在汇报里说明不再适用于无端口桌面版。M0 不删。 | 删除 |
| 8.3 | 新增 vitest（Testing Library、jsdom） | 仓库没有 vitest。计划用例：搜索语法、路由往返、快捷键（含输入框屏蔽和 `g` 前缀 1 秒）、菜单 Esc/外部点击/路由变化关闭、确认对话框 Promise、分隔条 clamp 与双击复位、主题三态、分场景空态。现行空态至少有：无来源、选择一篇资料、过滤无结果并提供重置、连接错误重试（浏览器用例 `empty filters offer a working reset and connection errors have retry`）。 | 上述每一项都有 vitest，而不是只在手工清单里勾选。路由变化关闭菜单是计划新增的断言，见 4.K2a。 | 新增 |
| 8.4 | 新增主进程测试 | 计划项：preload/invoke 白名单、参数校验、`pageshelf://` 穿越与越界、CSP header、`openExternal` 方案过滤、worker 崩溃重启与退出清理。现行均无。 | M2 这些测试存在且针对主进程代码，不靠渲染层单测代替。 | 新增 |
| 8.5 | Playwright `_electron` 冒烟代替 `browser-test.mjs` | 现行 `scripts/browser-test.mjs` 使用本机 Chrome。缺 Chrome 时退出码 2，README 规定这不算通过。`--force-failure` 应以退出码 1 失败。冒烟目标：启动、添加夹具目录、搜索、打开 HTML/MHTML/MD、用替身移入废纸篓、退出；另含恶意脚本不执行。M9 删除 `browser-test.mjs`。本次未运行该脚本。 | M8/M10 前 Playwright 冒烟通过，并保留恶意脚本来源不执行的断言。旧浏览器脚本在 M9 之前仍可运行。 | 替换 |
| 8.6 | `npm run benchmark:search` 保留，并在 worker 中运行、与基线对比 | 脚本是 `scripts/benchmark-search.mjs`。现行在主 Node 进程里测 `searchItems`。本次文档没有运行它，也没有把任何性能数字当作基线。仓库另有历史记录 `docs/verification/search-performance-2026-10-05.json`，那不是本次任务提供的基线。 | 桌面版在 worker 环境跑同一脚本，汇报与基线的对比。M0 不记录虚构的基线数字。 | 保留 |

## §9 Git 与发布约束

| ID | 验收项 | 现有行为与证据 | 目标侧验证 | 状态 |
|---|---|---|---|---|
| 9.1 | 在 `electron-react` 上工作，从当时的 `main` 切出；小步提交 | 本文件编写时分支为 `electron-react`，HEAD 为 `a556edb7fe7b732698907e1bbe0302cc9a8af2c7`。M0 按任务要求不提交。 | 后续提交都在该分支。汇报使用 `git log --oneline main..electron-react`（§10）。 | 过程 |
| 9.2 | 提交作者使用仓库 local 配置 | 计划指定 `user.name` `WYgao29`、`user.email` `171554485+WYgao29@users.noreply.github.com`，并写明不要用 `weisengao@wayneMac.local`。M0 没有读取或修改 git 配置，也没有提交。 | Codex 提交前核对本仓库 local 配置。不要改全局 git 配置。 | 过程 |
| 9.3 | 不 push、不改 tag、不 rebase、不改写 `main` | 计划要求旧 Web UI 的删除只发生在 `electron-react` 的 M9。`main` 保持到使用者自行合并。M0 没有 push、rebase、reset 或切换分支。 | 验收时 `main` 未被本分支改写。远程没有新的推送。 | 过程 |
| 9.4 | 不提交 `node_modules`、`dist*`、`release/`；更新 `.gitignore` | 工作树根目录没有 `.gitignore`（`test -e` 未找到该文件）。现行也没有这些构建产物的忽略规则。计划把更新 `.gitignore` 放在后续打包里程碑，不是 M0。 | M8 之前忽略规则覆盖 `node_modules`、`dist*`、`release/`。M0 不新增该文件，避免超出文档范围。 | 过程 |
| 9.5 | `ELECTRON_PLAN.md` 可留在工作区且不必提交 | 该文件在派发时为未跟踪文件。M0 没有修改它。本矩阵是唯一新增的跟踪候选文件。 | 后续提交不把计划书的修改混进功能提交。计划书若仍未跟踪，保持不加入提交。 | 过程 |

## 追踪索引

用计划 §4 的复选框对照子行，避免漏项。

| 计划位置 | 子行 |
|---|---|
| §4 来源目录，复选框 1 | 4.1a–4.1h |
| §4 来源目录，复选框 2 | 4.2a–4.2c |
| §4 来源目录，复选框 3 | 4.3a–4.3d |
| §4 来源目录，复选框 4 | 4.4a–4.4d |
| §4 来源目录，复选框 5 | 4.5a–4.5m |
| §4 阅读，复选框 6 | 4.6a–4.6f |
| §4 阅读，复选框 7 | 4.7a–4.7k |
| §4 阅读，复选框 8 | 4.8a–4.8c |
| §4 阅读，复选框 9 | 4.9a–4.9b |
| §4 阅读，复选框 10 | 4.10a–4.10g |
| §4 阅读，复选框 11 | 4.11a–4.11c |
| §4 快捷键总则与 11 个复选框 | `4.K0`; `4.K1a–4.K1b`; `4.K2a–4.K2c`; `4.K3a–4.K3c`; `4.K4a–4.K4b`; `4.K5`; `4.K6a–4.K6b`; `4.K7a–4.K7b`; `4.K8a–4.K8b`; `4.K9a–4.K9c`; `4.K10` |
| §4 废纸篓复选框 | 4.T1–4.T7 |
| §4 配置与缓存复选框 | 4.C1–4.C6 |
| §6 各安全条款 | 6.1–6.7 |
| §8 各测试条款 | 8.1–8.6 |
| §9 各 Git 条款 | 9.1–9.5 |

## 未决问题

本矩阵不替这些问题选行为。

1. `test/root-recovery.test.js` 在 §8 的「纯模块、保持不改」名单里，但实现依赖 `src/server.js` 的 HTTP 监听。M9 又要删除 HTTP 外壳。在决定「保持文件不改」还是「先脱离 HTTP 再删除外壳」之前，不改这个测试。
2. §8 要求迁移 `server.test.js` 时原断言逐条保留。该文件含令牌引导（`protected servers reject unauthenticated requests and support token bootstrap`）和端口占用退出（`occupied port exits successfully without repeated errors`）。§1、§6 和 M9 要求删除令牌、Cookie 和监听端口。M0 不把这两项当成桌面版要保留的产品行为，也不删除测试。
3. 列表行的 ⌘/Ctrl 点击、列表右键菜单和阅读区文章菜单都提供「在新标签页打开原网页」（`public/js/views/list.js`、`reader.js`），目前通过 `window.open` 打开本地 `/original`。§6 要求 `setWindowOpenHandler` 默认拒绝，并且只允许导航到 `pageshelf://`，但没有说明这三个入口应改成应用内次窗口、当前阅读区打开原文，还是取消。正文里的 http/https 链接另有明确规则：确认后通过 `shell.openExternal` 打开。
