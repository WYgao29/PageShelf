# PageShelf Electron 交付验收

本页保留 M0–M10 的阶段记录。后续图片修复见 [mhtml-images-fix.md](mhtml-images-fix.md)，界面与动效调整见 [design-polish.md](design-polish.md)；最新复查修复、完整测试和交付包指纹见 [design-review-fixes.md](design-review-fixes.md)。

日期：2026-10-22。分支：`electron-react`。桌面功能开发、旧网页版删除和 arm64 打包已完成。功能清单 23/23 通过；设计清单 20/21 通过，剩余的是 Dock 图标的独立目视检查，详见第 20 项。本次继续开发没有调用 Grok，也没有使用子 Agent。

交付应用：`release/PageShelf-darwin-arm64/PageShelf.app`，bundle id `com.wayne.pageshelf`，版本 `0.1.0`。在 Finder 中打开该目录后双击应用；未签名、未公证，首次启动可右键选择“打开”。适用于 Apple Silicon Mac。

`main` 仍是 `a556edb7fe7b732698907e1bbe0302cc9a8af2c7`；没有 push、修改 tag、rebase 或改写 main。

## 提交与阶段验证

早期结果来自引用聊天和 [功能保留矩阵](feature-matrix.md)；M10 的提交是 `d0348f9`。完整提交可用 `git log --oneline main..electron-react` 查询。

| 阶段 | 提交 | 结果与验证 |
|---|---|---|
| M0 | `de057c9` | 功能与安全验收矩阵；改造前 Node 基线 77 passed、0 failed，不把文档编写本身算成重新运行测试。 |
| M1 | `363aa45` | 提取不依赖 HTTP 的服务；Node 83 passed、0 failed。 |
| M2 | `d4b696f` | Electron、受限 preload、协议与独立后台进程；Node 91 passed、0 failed，构建与无监听 smoke 通过。 |
| M3 | `32f4a96` | 主题、字体、品牌、窗格和分隔条；Node 94/94、UI 修复后 17/17，六组布局检查通过。 |
| M4 | `720bcaa` | 目录管理、预检、排序和扫描状态；Node 94/94、UI 33/33；2200 文件扫描中移动窗口和滚动侧栏。 |
| M5 | `e56e9bf` | 搜索、资料列表与可恢复路由；Node 94/94、UI 40/40；扫描中真实搜索约 180 ms 返回。 |
| M6 | `66c3da4` | 三种阅读视图、TOC、Markdown、命中导航；Node 94/94、UI 71/71、真实 Electron E2E 7/7。 |
| M7 | `68af498` | 快捷键、应用菜单、外链确认、保存与废纸篓；Node 97/97、UI 79/79、E2E 11/11。 |
| M8 | `be4258e` | 可独立启动的 macOS 应用；Node 97/97，图标 10 尺寸、许可证、六组打包布局和进程退出检查通过。 |
| M9 | `72566cb` | 删除浏览器运行入口、HTTP、launchd 与旧脚本；Node 91/91、UI 79/79、E2E 11/11。退役项目和用户批准的导入路径变更见下文。 |
| M10 | `d0348f9` | Node 92/92、UI 87/87、主进程专项 17/17、真实 Electron E2E 17/17；重建交付包并复验系统启动、六组布局、无端口和进程退出。 |

## 最终验证原文与复现

| 命令 | 原文结果 | 记录 |
|---|---|---|
| `npm test` | `ℹ tests 92`、`ℹ pass 92`、`ℹ fail 0`；`Tests 87 passed (87)`；`ELECTRON_E2E 17 passed, 0 failed` | [完整套件](validation/test.log) |
| `npx vitest run` | `Test Files 8 passed (8)`、`Tests 87 passed (87)` | [UI 复验](validation/ui.log) |
| `node --test test/desktop-shell.test.js test/desktop-commands.test.js` | `ℹ tests 17`、`ℹ pass 17`、`ℹ fail 0` | [主进程专项](validation/main-tests.log)，已计入上面的 92 项 |
| `node scripts/electron-e2e.mjs` | `ELECTRON_E2E 17 passed, 0 failed` | [最终生产构建 E2E](validation/e2e.log) |
| `npm run package:mac` | `ICON_VERIFIED 10 sizes (16–1024 px)`、`PACKAGED …/PageShelf.app` | [构建与打包](validation/package.log) |
| `node scripts/package-smoke.mjs` | `PACKAGE_SMOKE_OK 6 layouts; bundle com.wayne.pageshelf; 5 processes without listeners; all exited; no screenshots` | [打包复验](validation/package-smoke.log) |
| `node scripts/package-smoke.mjs --launch-services` | `LAUNCH_SERVICES_SMOKE_OK 6 layouts; bundle com.wayne.pageshelf; 5 processes without listeners; all exited; no screenshots` | [macOS 系统启动复验](validation/launch-services.log) |
| `node scripts/desktop-scan-smoke.mjs` | `SCAN_SMOKE_OK`、`LSOF_MAIN empty`、`LSOF_WORKER empty`、`WORKER_GONE`、`NO_SCREENSHOTS` | [扫描中交互](validation/scan.log) |
| `npm run check` | 三个 `Verified`，marked/DOMPurify/Readability 的固定 SHA-256 全部通过 | [vendor 校验](validation/vendor.log) |

扫描交互使用 2200 个 HTML：查询 192 ms 返回已有结果，扫描从 464/2200 继续到 1045/2200；窗口位置从 `[240,30]` 变为 `[276,54]`，侧栏滚动从 0 到 2601。标题条计算样式为 `drag`。这不是生产应用监听端口：开发期只有 Vite 固定监听 5173，Electron 主进程和后台进程均无监听；生产包的全部 5 个进程也逐个检查无监听。

搜索性能对照见 [search-benchmark.json](search-benchmark.json)：500 条、每条 1500 字、20 次，Node 对照 p95 23.315 ms，Electron utilityProcess p95 19.375 ms，比值 0.831。M0 没有采集性能数字，故这是同语料的当前 Node 对照，不冒充历史 M0 基线。

M10 交付包的 UI、主进程、worker、preload 与 M10 当时构建逐文件 SHA-256 相同；图标与生成的 `.icns` 相同。该阶段指纹与包内容见 [build-manifest.json](validation/build-manifest.json)，后续更新的指纹见本页开头链接。

## 计划 §4：23 项功能

表内测试路径相对仓库。复合条款的逐子项说明仍保留在 [功能矩阵](feature-matrix.md)。静态检查和真实运行的证据分别注明，避免把代码检查写成用户手动操作。

| # | 验收项 | 结果与证据 |
|---|---|---|
| 1 | 添加/管理目录、原生选择或路径、1–40 字显示名、添加前预检，不通过不保存 | ✅ `library-ui.test.tsx` 覆盖入口、取消、校验、变更影响重确认；服务 roots 测试；UI 覆盖原生选择器返回/取消，E2E 通过填写路径完成实际添加与预检。 |
| 2 | 五种扩展、同主干格式合并、HTML 筛选含 MHTML | ✅ `formats`、`library`、`server` 与 UI `items`；E2E HTML/MHTML/Markdown 阅读。 |
| 3 | 父子最深归属、停用/失效/移除后父目录回收、移除不删源文件、同名来源路径 | ✅ `roots`、`library`、`root-recovery` 和 `library-ui`，保留旧归属与恢复断言。 |
| 4 | 目录 ID 与路径分离，改名排序不读文件，重新定位与归属变化保持条目规则 | ✅ `root-recovery` 保留 rename/order 不入队、恢复子目录两项；`library` 保留 NFC/NFD 与迁移 ID 断言；`library-ui` 验证重新定位预检。 |
| 5 | 全部目录动作、拖动和 Alt 排序、并发 2、进度/问题、扫描期间可浏览与交互 | ✅ `scheduler`、`roots`、`library-ui`；扫描 smoke 的移动/滚动/真实搜索记录；M10 新增首目录未扫完时 host 已能响应的回归测试，worker 不等待首扫描才报告就绪。 |
| 6 | sandbox 原网页、Markdown 源文本、抽取正文，短 HTML 回退、短 Markdown 笔记 | ✅ `reader.test.tsx`、保留的阅读纯逻辑测试与 E2E 三视图、短文 iframe、MHTML；对失效的 Markdown 路由自动选择可用阅读视图。 |
| 7 | 多字段语法、范围/格式/类型/排序、高亮与命中、6 篇分组、每批 100 | ✅ `search.test.js`、`items.test.tsx`、`reader.test.tsx` 和 E2E 查询/正文命中；扫描刷新保留旧结果和已展开分组。 |
| 8 | 路由包含导航各字段，原生后退前进、重启恢复 | ✅ `router.test.js`、`items.test.tsx`；E2E 原生菜单往返恢复筛选，真实退出重启恢复路由和本地偏好。 |
| 9 | TOC 跟随、完整系列上一篇/下一篇 | ✅ `reader/toc.js` 保留 scroll/IntersectionObserver 跟随逻辑并由 Reader 挂载；UI 测试 TOC 与完整系列邻居，E2E 显示正文标题和 TOC。没有把 E2E 标题检查写成实际滚动跟随测试。 |
| 10 | 三主题、四档字号、两分隔条拖动/键盘/复位、偏好持久化，不存已读进度 | ✅ `preferences`、`theme-boot`、`App`、`reader` 测试；E2E 偏好恢复；分隔条按用户决定 16px 步进、默认 252/384，滚动位置仅当前会话内存。 |
| 11 | 外图占位、本地图边界及真实 MIME、UI/正文不自动外连 | ✅ 服务测试越界/符号链接/MIME；阅读净化测试；E2E 嵌套/来源内相邻图片成功、逃出来源的路径拒绝、恶意脚本不执行、UI 与来源零外连。 |
| 12 | ⌘K / / 搜索 | ✅ `shortcuts.test.tsx`；输入/编辑区域与弹窗屏蔽单字母，Mac 原生组合键由主进程分发。 |
| 13 | Esc 关闭菜单/弹窗或清搜索 | ✅ `shortcuts`、`overlays`；菜单 Esc、外点、路由、失焦关闭并归还焦点。 |
| 14 | j / k / Enter | ✅ `shortcuts`、`items` 验证焦点移动和打开选择项。 |
| 15 | [ / ] 完整系列前后篇 | ✅ `shortcuts`、`reader`，邻居来自完整系列结果。 |
| 16 | v 切换阅读视图 | ✅ `shortcuts` 与 `reader`，仅循环条目实际支持的视图。 |
| 17 | n / Shift+N 命中导航 | ✅ 正文 find 纯逻辑、`shortcuts`、`reader`；E2E 实际命中与跳转控件。 |
| 18 | g a / g 1–9、1 秒前缀 | ✅ `shortcuts` 覆盖目录跳转与前缀超时；弹窗、编辑区域不触发。 |
| 19 | Shift+R / Shift+M | ✅ `shortcuts` 验证重扫与目录管理，主进程命令表有对应项。 |
| 20 | t / ⌘\\ / ? | ✅ `shortcuts` 验证主题、侧栏、帮助；窄窗来源弹窗与宽窗折叠由 App 测试覆盖。 |
| 21 | View/Go 列出命令且不重复触发 | ✅ `desktop-commands`、`desktop-shell`；E2E 原生菜单与键盘各执行一次。 |
| 22 | 危险确认列出全部源文件、系统废纸篓、部分/全部失败和重试、打开废纸篓 | ✅ 原 `trash` 测试及 UI 确认/重试；E2E 取消和全部关联格式的测试替身。生产继续使用系统 trash/Finder，从不以 unlink 删除文章；替身仅显式测试模式且 realpath 位于本次临时测试树才可用，测试未删除真实资料。 |
| 23 | 配置迁移/备份/损坏/未来版本只读、串行原子写、500 MiB LRU、清缓存 | ✅ 原 `config`/`cache`/服务测试；UI 只读与清缓存动作。真实数据目录继续是 `~/.html-library` 或环境变量覆盖。 |

## 设计规范 §9：21 项

| # | 检查项 | 结果与证据 |
|---|---|---|
| 1 | 全交互焦点可见 | ✅ 全局 `:focus-visible`；分隔条、主题单选组、菜单方向键和对话框焦点测试；真实布局测得可见 2px 焦点环。 |
| 2 | 所有浮层使用 overlay 阴影 | ✅ 菜单、对话框、Toast、来源弹层、TOC/Aa 均使用 `--shadow-overlay`，样式检查。 |
| 3 | 本地字体、标题字体 token | ✅ Inter/Space Grotesk 随包，`--font-heading` 用于标题/对话框/空态；打包字体许可证齐全。 |
| 4 | 导航项 16px 图标 | ✅ `sidebar.tsx` 的线性图标和图标尺寸 token；UI 导航用例。 |
| 5 | 非 token 定义处无裸字号/字重/间距 | ✅ 规范正则扫描样式目录零匹配；字标 700 也改用 `--fw-brand`，符合字标专用字重规则。 |
| 6 | 按钮圆角 8 | ✅ 通用按钮及资料行使用 `--radius`；三视图内部选项仍按分段控件使用小圆角。 |
| 7 | 内容顶栏 48、macOS 标题条 52 | ✅ 六组真实计算样式与几何断言；窄窗标题条进入列表栏。 |
| 8 | 无原生 confirm/alert/prompt | ✅ 没有 `window.confirm/alert/prompt`；广义 `confirm(` 搜索匹配的是自有 `library.confirm`，实际渲染应用危险对话框，取消焦点和每个 Promise 完成均有测试。 |
| 9 | 空态分场景 | ✅ 首次/无结果/目录空/停用或失效/来源失败重试/未选中/扫描中；首次有亮暗品牌图，UI 测试验证错误重试。 |
| 10 | 列表和详情骨架 | ✅ 200ms 持续加载后出现骨架；`overlays` 断言延迟和成功移除，Reader 有等价延迟加载状态。 |
| 11 | 状态胶囊语义映射 | ✅ `data-status` 对应 `--status-*`，包括文字与扫描进度；`library-ui` 与样式检查。 |
| 12 | 暗色选中项清晰 | ✅ 六组生产计算样式检查；激活导航与选中行使用 selected/accent token。按用户要求不留截图。 |
| 13 | 1280 搜索至少 240px | ✅ 有真实文章的 E2E 和空库打包 smoke 均测量搜索宽度。 |
| 14 | 960 阅读主体无覆盖 | ✅ 960 隐藏侧栏、来源经按钮弹层；详情宽度与工具栏边界断言。 |
| 15 | 菜单四种关闭与归还焦点 | ✅ `overlays.test.tsx` 覆盖 Esc/外点/路由/失焦，菜单卸载恢复触发器焦点。 |
| 16 | 工具栏不换行，额外项进入菜单 | ✅ 真实三视图 × 三宽度 × 两主题测量按钮单行及边界；TOC/Aa/文章操作使用菜单。 |
| 17 | 标题条可拖、logo 不挡红绿灯、控件 no-drag | ✅ 六组几何断言；扫描 smoke 测得 drag；品牌行位于 52px 标题条下，交互控件 no-drag。 |
| 18 | 三主题首帧与暗色 logo | ✅ `theme-boot`、`preferences`、主进程首帧背景和六组生产主题 token；亮暗 logo 地址实际不同。 |
| 19 | 渲染进程隔离与具名 preload | ✅ 主进程测试和真实 E2E：contextIsolation/sandbox 开启、无 Node；来源 iframe 和原网页窗口没有桌面 bridge，任意 window.open 拒绝。 |
| 20 | 图标尺寸、Finder/Dock 目视、应用系统启动 | ❌ 部分完成：10 个图标尺寸、plist 与包图标 SHA-256 一致，Finder 已目视正确蓝色品牌图形；系统启动测试通过。Dock 的两次自动化读取均返回 `Computer Use server error -10005: timeoutReached`，未独立目视，不能标成全通过。 |
| 21 | 三宽度 × 两主题截图存档 | ✅ 按用户明确“不需要截图”的决定，替换为六组 DOM/计算样式/几何断言；没有生成截图文件。 |

## 删除与旧服务清理

删除路径完整清单：[removed-web-files.txt](removed-web-files.txt)。包括旧 `public/`、HTTP `src/server.js` 与路由、launchd 安装和服务脚本、浏览器专用脚本/夹具，以及已迁移纯模块的旧路径。需要继续使用的纯函数、原始 vendor 和字体/品牌资源都位于新的共享或 UI 目录。

旧 LaunchAgent 已卸载，而不是仅删除仓库中的安装脚本：

- 已执行 `launchctl bootout gui/501/com.local.html-conversation-library`。
- 已删除 `/Users/weisengao/Library/LaunchAgents/com.local.html-conversation-library.plist`。
- 复查 `launchctl print` 返回找不到服务，plist 不存在，旧服务 PID 25682 已消失；见 [本机清理验证](validation/cleanup.log)。

没有删除真实源文章或 `~/.html-library` 配置。协作历史与本地计划保留在原位置且不进入应用包或提交。

## M10 修复、偏离与限制

- 修复合法本地图片被协议入口误拒：只对 URL 的地址部分执行编码穿越检查；查询中的相对资源路径仍由来源边界、realpath 与真实 MIME 检查处理。嵌套/根内相邻图片可显示，逃出来源的路径仍拒绝，真实 E2E 和主进程测试通过。
- 扫描刷新保留已有列表与分组展开状态；来源读取失败提供真正的重试；正常空目录的“管理”不再误触发重新定位；失效的 Markdown 视图恢复到支持的视图。补充品牌空态、分段控件尺寸、行圆角、随字号计算的阅读宽度与字标字重 token。
- worker 初始化不再等待首目录扫描结束；扫描仍由原调度器执行，窗口可先创建，状态随后更新。新增真实 host 回归测试；E2E 实际杀掉 utilityProcess 后自动重建资料库且原窗口保留。
- 经用户批准，`formats.test.js`、`markdown.test.js`、`search.test.js` 只改导入路径，断言不变。`root-recovery` 服务迁移、原网页三个入口改为受限应用窗口、分隔条 16px 步进均沿用前次确认。
- M9 退役四项旧 launchd API 测试、旧网页壳测试与旧 store 订阅测试；对应桌面生命周期、主题/布局与路由由当前 Node/UI/E2E 覆盖。旧 HTTP 令牌与端口测试按用户确认改为桌面无令牌/无监听验证。
- 产品代码 `AUTH_TOKEN|127\.0\.0\.1:4321|createServer|public/` 扫描零匹配。测试负向断言和历史文档仍有这些文字，用于证明旧运行能力已经不存在，不把全仓文本匹配说成零。
- 完整测试后最后的字重调整是等值 token 替换；最终生产 E2E、重建包与两种启动路径的六组布局复验均在此后通过。
- vendor 引用上游未提供的 source map，开发 Vite 会提示缺 map；为保持固定 SHA-256 没有修改 vendor 字节，不影响测试、构建或运行。打包器会提示可选新版 `.icon` 不存在；实际 `.icns` 已反解、比对并写入应用。
- 未完成项仅为 Dock 图标的独立目视验证。应用未签名/未公证；当前只有 arm64 交付包。没有待用户决定的产品问题。
