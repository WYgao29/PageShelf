# HTML 知识库 v2 开工方案（Implementation Plan）

> **For agentic workers:** 实施时使用 `superpowers:executing-plans`，由当前 Agent 按任务顺序执行；步骤用复选框跟踪。子 Agent 只在用户明确要求时启用。先完成本方案审阅，再开始实施。

**Goal:** 在保留现有本机服务、源文件与既有链接的基础上，完成多目录管理、统一阅读、三栏界面和可恢复删除。

**Architecture:** 保留 Node.js HTTP 服务和原生 ES Module，按职责拆出配置、目录归属、扫描调度、格式解析、元数据、搜索与缓存。服务端保存每个目录的索引快照，浏览器负责正文抽取、清洗和阅读；P0–P2 保持旧界面可用，P3 验收后切换新界面。

**Tech Stack:** Node.js ≥ 20、`node:test`、原生 HTML/CSS/JavaScript、History API、macOS launchd；仓库内嵌 marked 18.0.14、DOMPurify 3.4.16、Readability 0.6.0，不增加 npm 运行时依赖或构建步骤。

**Spec:** [完整需求 v3（原样归档）](../specs/2026-10-04-html-library-v3/HTML知识库_完整改造方案.md)。[交互效果图](../specs/2026-10-04-html-library-v3/HTML知识库_效果图.html)及同目录三张 PNG 是视觉参考。原始文件位于 `/Users/weisengao/Downloads/`，保持不动；前置 v1/v2 文档仍在该目录。

**状态:** 2026-10-05，P0–P4 核心实现已在独立 worktree 完成，T19 的 Edge、Finder 原生回退及生产启动验收仍有待项。原始需求归档不变；实施授权来自“新建一个 worktree，按照方案进行修改”。详情见 [验证记录](../../verification/html-library-v2.md)。

- [x] T00：隔离、基线和迁移资料。
- [x] P0 / T01–T03：可恢复废纸篓、端口、服务和反馈修复。
- [x] P1 / T04–T07：配置、多目录、归属、调度与 API。
- [x] P2 / T08–T13：格式、标题、系列、搜索、缓存与安全阅读。
- [x] P3 / T14–T17：三栏、管理、页内阅读与快捷键。
- [x] P4 / T18：TOC、命中、系列导航、字号；T19 文档和自动化验收。
- [ ] T19：Edge 本机未安装；Finder 原生回退两次超时；生产 plist、日志与登录/重启验收尚未执行。

任务步骤按实际证据勾选。含未完成人工验收的混合步骤保留未勾选，即使其中实现与自动化已完成；早期旧界面未单独留存人工验收，最终新界面结果不能代替历史真机记录。按阶段合并自洽提交，实际 commit/tag 见验证记录。

## 1. 开工结论

建议沿用需求的 **P0 → P1 → P2 → P3 → P4** 顺序，先落实废纸篓与服务修复，再改数据层，最后替换界面。按一名熟悉 Node.js 和原生前端的实施者估算，需求原估算为 **13 人日**；建议另留 **2 人日机动，总安排 15 人日**。这不是日历承诺，起始日以方案通过为准。可选文件夹树 B5 另计 0.5 人日。

本次已确认代码与需求描述基本一致，主要补充点是：launchd 的重启条件必须一起修；异步扫描必须衔接旧前端；迁移与扫描结果不能互相覆盖；废纸篓部分成功要单独处理。阶段 P0 的“快速修复”不是完整 v2 首版，完整三栏体验在 P3 验收后形成。

## 2. 已核对的基线

| 项目 | 2026-10-04 查询结果 | 对计划的影响 |
|---|---|---|
| 工作区 | `main`，HEAD `f5a148ffd101303308020c2455f714d3b1160e41`；开始规划时工作区干净 | 实施前重新检查，不能把本次基线当作未来状态 |
| 运行环境 | Node.js `v26.8.1`，npm `11.19.0`，macOS `26.6.2`；`/usr/bin/trash` 存在 | 可以在本机验证两种废纸篓路径；尚未执行真实移入与恢复验证 |
| 测试 | `npm test`：31 tests / 31 pass / 0 fail / 0 skipped | 是旧行为基线，其中直接删除和新标签阅读的测试将随需求改写 |
| 真实配置 | 无 `version`，只有 `roots`；目录 ID 为 `root-2e61579df9d2` | 必须保留旧 ID；首次修改前备份原始配置 |
| 当前服务 | 只读 GET 得到 48 条、48 文件、1 目录；12 条共享知识星球通用标题 | 与需求一致；没有触发生产扫描或修改配置 |
| Unicode | 当前 API 返回的 48 个 `relativePath` 做 NFC 后都不变 | 支持本次迁移预期，但还要测合成的 NFD 文件名 |
| 服务扫描时间 | 返回的 `completedAt` 是 `2026-10-02T06:04:34.494Z` | 这是已有扫描快照，不是本次性能测试 |
| launchd | 代码与已安装 plist 都是 `KeepAlive: true` | 退出码 0 不能单独解决自动重启；P0 需要改 `src/service.js` |
| 错误日志 | `stderr.log` 647,703 字节；最后修改于 2026-09-21 | 单次读取不能证明“不再增长”；发布后要做持续观察 |
| 内嵌库 | 从需求指定 npm tarball 读取文件，三个 SHA-256 均匹配，许可证文件均存在 | 可以按指定版本接入；本次只核验，没有安装或写入 `public/vendor/` |
| 解析与 CSP 探针 | 用独立临时 Chrome profile、两个随机本机端口验证：需求 CSP 下 DOMParser 解析成功，跨源 img/iframe 的目标服务收到 0 次请求 | Chrome 的此项探针通过；Safari/Edge 和完整阅读流水线仍要在实施阶段验证 |
| 视觉材料 | 交互 HTML 和亮色、暗色、目录管理三张 PNG 均存在，已查看 | 归档副本保留相对图片链接，实施者无需依赖 Downloads 中的文件 |

基线测试使用本次专用临时目录作为 `TMPDIR`；现有测试的删除操作只作用于测试生成的文件。未安装、停止或重新加载真实后台服务。

## 3. Global Constraints

- 应用名称保持“我的对话库”；默认阅读视图；沿用米色纸张、衬线标题、橙红强调色。
- 只索引 `.md / .html / .htm / .mhtml / .mht`；不增加视频、txt、PDF 或图片条目。
- 桌面设计宽度 `1440×900`，最小支持 `1024px`；Chrome / Safari / Edge 近两个大版本。
- Node.js ≥ 20；运行时没有 npm 依赖；不打包；浏览器直接加载原生 ES Module。
- 服务默认监听 `127.0.0.1:4321`；现有 `AUTH_TOKEN` 和 Cookie 机制保留，不扩展远程访问。
- 源文件只读；唯一改变源文件位置的操作是“移入 macOS 废纸篓”；源文件删除路径永远不调用 `unlink`。
- 配置、备份、缓存只放在 `~/.html-library/`，支持 `HTML_LIBRARY_DATA_DIR` 覆盖；索引不持久化。
- 保留目录白名单、realpath 边界校验、`O_NOFOLLOW`、源网页响应的 sandbox CSP。
- 主页面 CSP 按需求 §9.1；运行时不加载外部脚本、字体、图片或数据。
- 最深的可用目录拥有文件；跨目录同名条目独立；系列不跨目录或相对文件夹合并。
- 首屏三栏默认 `252 / 384 / 1fr`；正文 `17px / 1.85`、标题 `28px`、行宽 ≤ `600px`；最小字号 `12px`。
- 搜索去抖 `150ms`，目录预检去抖 `300ms`，扫描状态轮询 `500ms`；骨架屏延迟 `300ms`。
- 全局最多 `2` 个目录同时扫描；每个目录串行；重复请求合并成一次 rerun。
- 超过 `200` 条分批渲染，先 `100` 条，再每批 `100`；分组默认展示 `6` 条。
- 摘要 ≤ `120` 字；标题 ≤ `120` 字；目录名 trim 后 `1–40` 字；系列至少 `2` 篇。
- 阅读抽取正文少于 `200` 字或 Readability 返回 null 时回退；本期不保存已读、收藏或阅读进度。
- 测试使用临时目录与脱敏 fixture；真实库只做人工只读验收，废纸篓验证用专门的测试文件。
- 修改步骤和必要检查通过后才推进下一阶段；样式与文案等低影响改动不新写复述实现的测试。

## 4. 开工前需要审阅的补充口径

这些是代码核对后发现的衔接问题。建议采用下表口径；涉及需求修订的项，实施前同步写入项目内的需求补充记录，原始归档保持原样。

| 编号 | 问题与依据 | 建议口径 | 所属任务 |
|---|---|---|---|
| A | F2 要求端口占用时退出码 0，但 §11 又说 plist 不变；现有 `KeepAlive=true` 会无条件重启 | 改为 `KeepAlive: { SuccessfulExit: false }`，保留 `RunAtLoad=true`；非零异常退出仍重启。既有 plist 在 P0 发布时用现有安装命令更新 | T02 |
| B | `/api/scan` 在 P1 改为 202，旧 `refresh()` 却直接读取 `result.items`；所有写接口要求 JSON，但旧选择器/扫描/移除没有 JSON 请求头 | P1 对旧 `app.js` 做最小适配：JSON 空对象、轮询进度、扫描完成后重新 GET。旧 settings/roots 写接口保留原响应语义，旧 GET 形状不变 | T07 |
| C | §10.3 说首次修改时备份，阶段验收却可能被理解为启动立即生成备份 | 只读启动不写配置；首次修改前生成一次 `config.v1.bak.json`。验收增加一次临时配置修改，不为生成备份偷偷改生产配置 | T04 |
| D | “移入失败文件保持原样”与多源文件可能部分成功并存；批量 CLI 失败也可能已经移动了一部分 | 校验全部路径后执行；命令失败先核对哪些文件已经移走，只对剩余文件回退。全部成功 200、部分成功 207、全部失败 500；207 不显示“文件没有被改动” | T01、T17 |
| E | §8.3 的 R2 在根目录不算系列，但添加课程子目录后效果图承诺“系列随之移到新目录” | 严格保留 R2 规则：条目迁移后按新相对路径重算，课程文件直接位于新根时可能变为单篇。预检说明写成“受影响系列将重新计算”，不承诺系列键/名称保持。若必须保留该系列，先修订 R2 再实施 | T05、T09、T16 |
| F | B5 可选，但重叠面板的“不添加”会跳到文件夹路由 | 核心版选择“不添加”后回父目录，不出现尚未实现的文件夹树或路由入口。启用 B5 后才使用 §5.6 的子文件夹跳转 | T16、T20 |
| G | 原缓存和 ETag 仅含 mtime、size，重新定位或替换文件可能保持二者相同 | 缓存键及 ETag 加入真实源路径、格式、ino 的身份摘要；重新定位/移入废纸篓/源文件变化清理相关缓存。防止读到旧正文或错误 304 | T11 |
| H | “DOMParser 惰性文档不加载资源”不能作为不联网保证 | 保留 DOMParser，但主页面与测试页在首次解析前就使用需求 CSP；抽取后清除外部资源引用。验证解析与插入两阶段的外部请求均为 0，不能只在插入后检查外图 | T13 |

H 的依据：MDN 说明 `DOMParser.parseFromString(..., 'text/html')` 的文档仍可能加载 img/iframe 资源，因此不能只靠“不执行脚本”的假设。[DOMParser 文档](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString)。A 的依据为本机 `man launchd.plist` 的 KeepAlive / SuccessfulExit 条目。

其他细化按以下统一口径执行：新写接口没有 Origin 或 Origin 不同源都返回 403，测试/CLI 显式带 Origin；正常浏览器同源请求不受影响。搜索高亮区间使用原始展示文本的 UTF-16 半开区间，NFKC 匹配必须映射回原文。纯 Markdown 小于 200 字仍正常渲染，200 字阈值只用于 HTML 正文抽取。文中外链保留为用户主动跳转链接，应用加载与渲染不主动外连。高版本配置的只读模式禁止目录配置变更和移入废纸篓，浏览、重扫、选择器、reveal 和缓存维护仍可用。

D13 停用/启用虽然标为可选，已被状态机、管理菜单和 API 规格共同引用，建议纳入 P1/P3 核心实现。V7 四档字号安排在 P4；如需压缩工期，可以延后并移除 Aa 入口。B5 默认后置。

## 5. 文件边界与接口约定

不为缩短文件而改变现有行为；按需求 §11 拆分。以下签名是实施约定，以 JavaScript/JSDoc 实现，不引入 TypeScript 工具链。

| 文件 | 单一职责与对外接口 |
|---|---|
| `src/config.js` | `createConfigStore({dataDir})` → `{load(), update(mutator)}`；两者返回 Promise；`ConfigLoad={config,readOnly,startupWarning,legacyRootIds}`，legacyRootIds 默认空数组。update 串行、原子写盘、保留未知字段 |
| `src/roots.js` | `createRootRegistry({configStore, inspectPath})` → `{load(), list(), get(id), preview(input,{excludeId}), applyChange(change), revision(id), resolveIdAlgorithm(id,{nfcChanges})}`；变更返回 `{root,affected}`，算法核对方法同步返回 `'v1'` 或 `'nfc'`，只改内存标记。inspectPath 可注入，供权限/卷大小写测试 |
| `src/scheduler.js` | `createScheduler({scanRoot,concurrency:2})` → `{enqueue(rootId,{full,subtree}), status(), waitForIdle()}`；入队返回 `{queued,position}` |
| `src/library.js` | `createLibrary({roots,rootRegistry,scanFile,trashService})`；新方法 `scanRoot(rootId,options)`、`getSnapshot()`、`trashItem(id)`、`refreshItem(id)`、`invalidateRoot(id)`；旧方法在兼容期保留 |
| `src/formats/*` | `parseHtml(text)`、`parseMarkdown(text)`、`parseMhtml(buffer)`、`renderMhtml(buffer)`；不读配置、不修改文件。Markdown 解析的纯函数由浏览器复用 |
| `public/js/shared/markdown-source.js` | 新增共享纯函数 `parseMarkdownSource(text)` → `{frontMatter,body,tags,title}`；只支持需求实际使用的简单 front-matter，不依赖完整 YAML 引擎 |
| `src/html-scan.js` | `findElement(html,selector)` → `{innerHTML,text}` 或 null；仅支持 `{tag?,cls?,id?}`，正确跳过注释/script 文本 |
| `src/metadata.js` | `extractCandidates(source)`、`finalizeRootMetadata(items,{rootId,seriesMode,idAlgo})`；后者完成目录级通用标题剔除、系列聚合与排序 |
| `src/search.js` | `searchItems(snapshot,query,{now})` → `{total,tookMs,roots,items,groups}`；query 对应 §9.3 参数 |
| `public/js/shared/text-search.js` | `parseQuery(q)` → `{include,exclude}`，`normalizeWithMap(text)` → `{normalized,offsets}`；服务端搜索与浏览器文内查找共用，offsets 映射 UTF-16 原文区间 |
| `src/cache.js` | `createDocumentCache({directory,maxBytes:500*1024*1024})` → `{getOrCreate(key,producer),invalidateItem(id),clear()}`；读取前验证实际源文件身份 |
| `src/source-files.js` | 新增共享路径校验，`validateSourceFile(rootPath,absolutePath)` → `Promise<{path,stat}>`，`readSafeFile(rootPath,absolutePath)` → `Promise<{path,stat,buffer}>`；读取、图片资源和废纸篓共用同一边界判断 |
| `src/trash.js` | `createTrashService({execFile,fsOps})` → `{trashFiles({rootPath,paths})}`；`TrashResult={trashed,failed,method}`，退出码不足以判断部分成功 |
| `src/routes/{roots,items,system}.js` | `handle(context)` → `Promise<boolean>`，true 表示已处理；context 包含 request、response、url、各服务和 JSON/错误响应函数 |
| `public/js/{router,store,api}.js` | `parseRoute(url)` / `serializeRoute(route)`；`createStore(initialState)` → `{getState,set,subscribe}`；`request(path,{method,body,signal})` / `pollScan(onUpdate,{signal})` |
| `public/js/views/*` | `mount(container,store)` 返回 `{update(state),unmount()}`；每个视图只订阅自己的状态，unmount 释放事件、observer 和请求 |
| `public/js/reader/*` | `buildReader({item,html,markdown,query})` → `Promise<{article,toc,find,status}>`；HTML/Markdown 最终 DOM 均来自清洗流水线；find 是可执行next/destroy的控制器 |

`RootIndex` 固定为 `{items:Map,series:Map,files:Map,state}`；`FileMeta` 保留 `size,mtimeMs,ino,meta`，不保留源 HTML/MHTML/Markdown 的 content 或 Buffer。搜索用的规范化纯文本属于索引数据，需要保留以支持正文搜索；“不保留全文”按“不保留原始文档与资源”验收，不误删 `searchText`。

registry.load/preview/applyChange 是异步方法，list/get/revision 是同步只读方法。legacyRootIds 标记迁移目录，供首次扫描前选择旧算法、扫描时核对 NFC；不保存到config.json。GET `/api/roots` 除需求字段外返回 `readOnly` 和 `startupWarning`，用于全局横幅与禁用状态；两者来自 ConfigLoad。createLibrary 的注入参数有默认值，旧测试传 `{roots}` 仍可构造内存库，不自动访问真实配置。

Root 的配置、运行状态与扫描 revision 分开。一次目录配置/归属变更递增 revision；扫描仅在 revision 仍匹配时发布快照。配置保存失败时不发布内存变更；修改 config 的并发请求串行。一个条目的移入废纸篓和相关扫描也要用 revision 防止旧扫描把条目加回来。

新增 `source-files.js` 和共享 Markdown 模块用于避免服务端/浏览器重复解析、三个源文件入口重复实现边界判断，属于本次改造所需拆分。

## 6. Review Focus

1. 扫描未结束就移除、停用、重新定位或移入废纸篓：旧结果不能重新出现；测试归 T06。
2. 旧 ID 使用 NFD 文件名、目录处于不同大小写规则的卷：旧链接保持，父子比较不误判；测试归 T04/T05。
3. 双源条目批量移入废纸篓只成功一个，随后 Finder 回退也失败：返回真实的 207，保留仍存在的格式；测试归 T01/T17。
4. 文件在同一路径被替换，或目录重新定位，mtime 与 size 不变：正文与 ETag 都必须更新；测试归 T11。
5. 搜索归一化后的文字与展示文字长度不同，且慢请求晚于新条目请求返回：高亮位置正确，阅读区仍显示新选择；测试归 T10/T15/T17。

## 7. 阶段安排与退出条件

| 阶段 | 工作日顺序 | 任务 | 预算 | 阶段结束可交付的结果 |
|---|---|---|---|---|
| 准备 | 第 1 日开始 | T00 | 含在 P0 | 临时环境、旧 ID 快照、脱敏 fixture、验收记录模板 |
| P0 快速修复 | 第 1 日 | T01–T03 | 1 人日 | 旧界面仍能使用；删除可恢复；提示/焦点/扫描状态修复；端口冲突和 launchd 一起处理 |
| P1 多目录数据层 | 第 2–4 日 | T04–T07 | 3 人日 | v2 配置、稳定 ID、目录状态/重叠、增量扫描、异步 roots API；旧界面通过兼容层可用 |
| P2 内容与阅读数据 | 第 5–7 日 | T08–T13 | 3 人日 | 7 个系列、正确标题/摘要、相关度搜索、文档/资源缓存、浏览器阅读流水线及 XSS 验证 |
| P3 三栏与管理 | 第 8–11 日 | T14–T17 | 4 人日 | 三栏、亮暗主题、URL 状态、目录管理、页内阅读、快捷键；验收后移除过渡接口 |
| P4 阅读与收尾 | 第 12–13 日 | T18–T19 | 2 人日 | TOC/命中跳转/系列导航、Aa、错误状态、README、性能与真机验收完成 |
| 机动 | 第 14–15 日 | 针对实际失败 | 2 人日 | 消化抽取规则差异、浏览器差异、Finder 授权与发布问题；不预先增加功能 |
| 可选 B5 | 核心结束后 | T20 | +0.5 人日 | 子文件夹树与相应路由/接口 |

日序不是具体日期。阶段内相互依赖，默认顺序执行。每个任务提交一次自洽的改动；阶段结束记录通过证据，再打 `ui-v2-p0` … `ui-v2-p4` tag。可发布表示经过独立验收，不表示每阶段都必须更新真实后台服务。

## 8. 可执行任务

以下路径均相对项目根目录。行为新增/变化按“失败测试 → 实现 → 通过”执行；断言代码中的变量由对应测试的临时 fixture 或注入桩产生。无需为纯样式新增字面量断言。

### T00：建立实施隔离与迁移验收材料

**Files:** 新增 `test/helpers/fixture.js`、`test/fixtures/legacy/config-v1.json`、`docs/verification/html-library-v2.md`。

**Interfaces:** `withTempFixture(callback)` 创建并清理临时目录；`createLegacyFixture(parentDir)` 返回 `{dataDir,rootPath,rootId,expectedItemIds}`，构造 48 条/48 文件、36 MHTML/8 HTML/4 MD 的合成布局，沿用旧哈希算法产生 expectedItemIds。

- [x] 检查当时的 Git 状态，复用适用工作区；需要代码隔离时按 `using-git-worktrees` 创建工作树，开发默认端口 4322。写明基线 HEAD，不覆盖他人改动。
- [x] 创建合成旧配置/文件 fixture 和知识星球、newtype、课程 HTML、bloom-learn 的脱敏最小片段；记录每个片段用于验证什么，不复制整篇私人文章。
- [x] 只读导出真实库的 `rootId / itemId / relativePath / formats` 验收快照至本机隔离数据目录，不提交真实文章或完整路径列表到仓库；读取前后不重扫生产服务。实施实际保存于被 Git 忽略的 worktree ledger，避免写生产数据目录。
- [x] 运行 `npm test`，把结果、环境、日期写入 verification 文档；本次规划的历史基线是 31/31，实施基线以当时结果为准。
- [x] 提交 fixture 和验收模板：`test: establish v2 migration fixtures`。

### T01：把旧删除流程改为废纸篓

**Files:** 新增 `src/trash.js`、`src/source-files.js`、`test/trash.test.js`；修改 `src/library.js:447`、`src/server.js:223`、`test/library.test.js`、`test/server.test.js`。

**Interfaces:** 产出 §5 的 `trashFiles({rootPath,paths})` 与 `validateSourceFile()`；P0 的 `deleteItem(id)` 保留名称并调用 trashService；新增内部 `trashItem(id)` 返回 TrashResult，不再执行源文件 unlink。

- [x] 新增 `trash uses cli then Finder only for remaining files`、`partial trash preserves surviving source`、`rejects symlink before any trash command`。注入命令桩、文件系统桩，显式拦截源文件 unlink，并检查 argv 中含空格、引号、前导 `-` 的路径未被解释成命令。

```js
assert.deepEqual(result.trashed, [htmlPath]);
assert.deepEqual(result.failed.map(x => x.path), [markdownPath]);
assert.equal(unlinkCalls, 0);
assert.equal(finderCalls.some(args => args.includes(htmlPath)), false);
```

- [x] 运行 `node --test test/trash.test.js test/library.test.js test/server.test.js`，确认新行为测试因尚未实现而失败。
- [x] 先校验整组源路径；使用 `execFile('/usr/bin/trash',['--',...paths])`；失败后核对文件存续再回退。Finder 脚本固定、路径由 argv 传入；先探测 `trash` 的参数格式，禁止 shell 拼接。全部失败保持索引，部分成功调用 `refreshItem(id)` 更新剩余格式。
- [ ] 同一测试命令全部通过；兼容 DELETE 的 200 保留旧 `{item,scan}` 形状，207 明确携带成功/失败文件，旧前端可展示未完成提示。用专门测试文件在真机确认移入和“放回原处”，记录两种方法的实测结果，不操作真实库文章。
- [x] 提交：`fix: move source files to macOS Trash`。

### T02：修端口冲突与 launchd 重启条件

**Files:** 修改 `src/server.js:313`、`src/service.js:47`、`test/service.test.js`、`test/server.test.js`、`README.md`。

**Interfaces:** `createServer()` 仍可 import；仅 CLI 启动入口处理 listen 错误。`createLaunchAgentPlist(options)` 保留签名，KeepAlive 改为 SuccessfulExit=false；CLI 读取 `HTML_LIBRARY_DATA_DIR`。

- [x] 新增 `occupied port exits successfully without repeated errors`：临时监听端口，子进程使用临时 dataDir；断言退出码 0、stdout 包含动态端口提示、stderr 无堆栈。服务测试验证生成并解析的 plist 有 `SuccessfulExit:false`，不继续锁定旧字符串布局。
- [x] 运行 `node --test test/service.test.js test/server.test.js`，确认上述测试失败。
- [x] 在 listen 前注册 error handler；EADDRINUSE 输出“服务已在运行（端口 {port}）”，正常退出；其他错误保持非零退出。最小修改服务生成器和安装说明，不扩展服务功能。
- [x] 同一命令通过；`node --check src/server.js` 通过。README 说明后台服务安装后无需再 npm start，开发用 `PORT=4322 npm run dev`；已安装 plist 要在发布时更新。
- [x] 提交：`fix: avoid launchd restart loops on port conflicts`。

### T03：修旧界面的基础反馈和可访问性

**Files:** 修改 `public/app.js:78`、`public/styles.css`、必要的 `public/index.html`；记录验收结果到 `docs/verification/html-library-v2.md`。

**Interfaces:** 旧路由和 DOM ID 保留，P1 继续适配；不在此任务重写 UI。

- [x] 列出可复现检查：首屏扫描时间、toast、重复点扫描、目录选中态/标题、Tab 焦点、最小字号和对比度。此任务不新增匹配 CSS 或文案的测试。
- [x] 补 `.toast.show`、`.is-refreshing`、button disabled、首次加载更新时间、目录高亮与标题；采用需求颜色值，移除死弹窗 CSS，修 `outline:0` 和过小文字。
- [ ] 运行 `node --check public/app.js` 与 `npm test`；预期全部通过，再用浏览器完成上述手工检查。
- [ ] 确认旧界面添加、搜索、阅读、移除和废纸篓反馈均可用；记录 P0 阶段结果。
- [x] 提交：`fix: restore library feedback and keyboard focus`。

### T04：config v2 迁移与串行原子写入

**Files:** 新增 `src/config.js`、`test/config.test.js`；修改 `src/server.js:67`、`src/library.js:17`。

**Interfaces:** 产出 §5 的 configStore。`load()` 读取/迁移为内存 v2；`update(mutator)` 在校验与备份成功后写入新配置，再返回 ConfigLoad；高版本 update 抛 `CONFIG_READ_ONLY`。

- [x] 编写 `migration preserves ids and unknown fields`、`first mutation creates backup once`、`NFD legacy stems retain v1 ids`、`concurrent updates do not lose a root`、`broken config boots empty with warning`、`future config is read only`。

```js
assert.equal(loaded.config.roots[0].id, 'root-2e61579df9d2');
assert.deepEqual(afterIds, beforeIds);
assert.equal(saved.customField, original.customField);
assert.equal((await readdir(dataDir)).filter(x => x === 'config.v1.bak.json').length, 1);
assert.deepEqual(await readFile(backupPath), originalBytes);
```

- [x] 运行 `node --test test/config.test.js`，确认因缺少新模块/行为而失败。
- [x] 按 §10.3 保留未知顶层/root/options 字段；旧无 ID 条目沿用 `path.resolve()` 的旧哈希。迁移保留待核对状态，由 library 的首次目录扫描比较 raw 与 NFC 条目 ID，并调用 registry.resolveIdAlgorithm 反馈；有变化才在下一次配置修改时保存 `options.idAlgo:'v1'`。无法读取的旧目录先使用 v1 算法，不臆断迁移安全。只读 load 不写正常配置；损坏配置按需求备份。
- [x] 同一命令通过；在合成 48 条 fixture 比较排序后的全部 ID 集合。修改失败不丢旧配置，备份始终是原始字节，order 连续编号。
- [x] 提交：`feat: migrate root configuration without changing legacy ids`。

### T05：目录状态、重叠预检和归属变更

**Files:** 新增 `src/roots.js`、`test/roots.test.js`；修改 `src/config.js` 的调用集成。

**Interfaces:** 产出 rootRegistry；`preview(input,{excludeId})` 返回 §9.3 的 valid/checks/duplicateOf/overlap；`applyChange(change)` 支持 add/patch/remove/order，保存后返回受影响的根与子树扫描计划，不自行读全文。

- [x] 写测试覆盖相同路径、父子/三层嵌套、`..` 与根符号链接别名、同一卷大小写策略、不同卷策略、不可读/文件路径、失效子目录和停用/启用；dryRun 前后配置与源文件的数量/mtime 必须一致。

```js
assert.deepEqual(parent.excludes, [directChild.realPath]);
assert.equal(preview.overlap.moved, 8);
assert.equal(preview.overlap.parentAfter, 40);
assert.deepEqual(configAfterPreview, configBeforePreview);
```

- [x] 运行 `node --test test/roots.test.js test/config.test.js`，确认新增行为失败。
- [x] 按路径段比较真实路径，避免 `/a` 与 `/ab` 混淆；大小写策略按 root 所在卷判断，测试用 inspectPath 注入，不能全局一律 toLowerCase。新根 ID 使用 `crypto.randomBytes(6)`，迁移根 ID 保留；状态包含 ok/warning/scanning/missing/denied/not_directory/error/disabled。
- [x] 实现 labels trim 及 1–40 Unicode 字符校验，排序校验 IDs 恰好覆盖全部根；preview 的文件数与条目移动数分开，多个格式合并后不把文件数当条目数。受影响系列按新归属重算。
- [x] 同一命令通过；真实结构的合成 fixture 验证 48 → 40+8 → 48。提交：`feat: manage root state and deepest-root ownership`。

### T06：增量索引、扫描队列与过期结果隔离

**Files:** 新增 `src/scheduler.js`、`test/scheduler.test.js`；重构 `src/library.js:286`；扩展 `test/library.test.js`。

**Interfaces:** 消费 rootRegistry.revision；产出 scheduler、RootIndex 与 `scanRoot(rootId,{full,subtree})`。临时复用原提取逻辑为 scanFile，T08/T09 替换；`getSnapshot()` 始终返回完整已发布快照。

- [x] 写 `same root scans serially with one merged rerun`、`global concurrency never exceeds two`、`unchanged files are not read`、`stale scan cannot resurrect removed or trashed items`、`other roots remain readable while one scans`；使用可控 Promise 和 readFile spy，不依赖固定 sleep。

```js
assert.equal(maxRunningRoots, 2);
assert.equal(runsForBusyRoot, 2);
assert.equal(unchangedReadCount, 0);
assert.equal(snapshot.items.some(x => x.id === removedId), false);
```

- [x] 运行 `node --test test/scheduler.test.js test/library.test.js test/roots.test.js`，确认失败。
- [x] files 以 size+mtimeMs+ino 判断复用；目录扫描在局部构造新 RootIndex 后一次性发布，原始 content/Buffer 在提取后释放。配置/归属变动及 trash 操作递增 revision；过期任务不能覆盖索引。合并请求时 full 取 OR、subtree 合并覆盖范围；同根多次重扫只保留一次 rerun。子目录退出时只扫父目录回收子树，不无条件全量扫描其他根。
- [x] 启动时按 order 入队，第一目录扫描完成或失败后解除 server.ready，其余继续；0 目录立即 ready。失效目录保留配置、隐藏自身条目，父目录尝试回收可读内容，仍不可读就显示 issue。
- [x] 同一命令通过，验证全量 `full=1` 确实重读；检查索引对象没有原始 content/Buffer。提交：`feat: scan roots incrementally with consistent snapshots`。

### T07：roots API、Origin 检查与旧前端兼容

**Files:** 新增 `src/routes/roots.js`、`src/routes/system.js`；修改 `src/server.js:180`、`public/app.js:90`、`test/server.test.js`、`test/e2e-smoke.test.js`。

**Interfaces:** routes.handle(context)；实现 §9.2 roots、scan/status、choose-folder 接口；POST /api/scan 返回 202。旧 `/api/settings*`、`/api/library` 和 DELETE item 使用兼容适配器，旧错误仍是字符串。

- [x] 先写 API 流程测试：预检→添加→改名→排序→停用→启用→失效→重新定位→移除。每步检查 config 与源文件 mtime；同源通过，跨站/缺 Origin 返回 403，非 JSON 返回 415，null/数组 body 返回 400。令牌与 Cookie 回归保留。
- [x] 运行 `node --test test/server.test.js test/e2e-smoke.test.js`，确认新 API 行为失败。
- [x] 路由顺序先处理 `/api/roots/order` 再匹配 `/:id`；统一新错误对象；按实际请求 Host/Origin 比较，禁止宽松的后缀域名判断。扫描只入队，不在 HTTP 请求里等待整库重扫。
- [x] 旧界面 refresh 改为 POST `{}`→每 500ms GET status→完成后刷新 settings/library；添加/移除保留旧完成响应，选择器与删除请求补 JSON body/header。扫描失败也解除按钮禁用；高版本配置界面展示只读提醒。
- [ ] 同一命令和 `npm test` 通过，浏览器验证旧界面仍可扫描/添加/移除。提交：`feat: expose async root APIs with legacy UI compatibility`。

### T08：拆出格式解析和共用站点规则

**Files:** 新增 `src/formats/{html,mhtml,markdown}.js`、`src/html-scan.js`、`public/js/shared/{site-rules,markdown-source}.js`、`test/html-scan.test.js`、`test/formats.test.js`；调整 `src/library.js:48`。

**Interfaces:** 产出 §5 的格式纯函数和 findElement；SITE_RULES 仅包含数据和简单 selector，不使用 DOM/Node API；parseMarkdownSource 服务端与浏览器共用。

- [x] 为 MHTML MIME boundary、base64/quoted-printable、charset 与资源引用增加行为 fixture；html-scan 覆盖嵌套同名标签、自闭合、class 多值、注释/script 假标签；Markdown 覆盖缺少结束分隔符、简单 tags 数组和 front-matter title。
- [x] 运行 `node --test test/formats.test.js test/html-scan.test.js test/library.test.js`，确认新增能力的测试失败；纯搬移既有行为的测试保持通过。
- [x] 从 library 拆出既有 MHTML 能力，保持下载原始字节；scanFile 调用新模块只返回 metadata/纯文本。front-matter 仅在文档起始且闭合时解析，未知/不支持结构保留为正文或记录问题，不能静默吃掉内容。
- [x] 同一命令通过；五种扩展名之外不索引，Markdown 图片不当独立条目。提交：`refactor: isolate document formats and shared site rules`。

### T09：智能标题、正文摘要与目录级系列

**Files:** 新增 `src/metadata.js`、`test/metadata.test.js`、`test/fixtures/sites/*`；修改 `src/library.js`、`public/js/shared/site-rules.js`。

**Interfaces:** extractCandidates 输出有序标题候选及正文纯文本；finalizeRootMetadata 在完整目录范围统计通用 title，生成 item.series 与 series Map；options.series='off' 只重算内存，不扫描。

- [x] 覆盖 §8.2 全部七级优先级、重复 title≥3、emoji/站点后缀、标题重复署名摘要、R1/R2、同序号自然排序、少于两篇、不同根/文件夹不合并、根下 R2 不识别。

```js
assert.equal(zsxqItem.title, '唯有中间层值得长期投入');
assert.equal(result.series.size, 7);
assert.equal([...result.items.values()].every(x => [...x.excerpt].length <= 120), true);
assert.equal(rootLevelNumberedItem.series, null);
```

- [x] 运行 `node --test test/metadata.test.js test/library.test.js`，确认新行为失败。
- [x] 两轮处理：每源候选提取→目录级统一定标题；seriesKey 按 `sha1(rootId+'\n'+folder+'\n'+name).slice(0,10)`。保留 titleRaw；从正文生成 excerpt、阅读分钟估计和 h2/h3 预览，避免把导航当摘要。
- [x] 同一命令通过；用合成 fixture 验证 7 系列篇数 `10/9/6/6/4/3/2`、课程迁移后重新聚合。真实数据的无重复标题与导航移除留作 P2 人工验收。
- [x] 提交：`feat: identify article titles and ordered local series`。

### T10：搜索评分、片段和服务端分组

**Files:** 新增 `src/search.js`、`public/js/shared/text-search.js`、`test/search.test.js`；修改 `src/library.js` 的 search 兼容适配。

**Interfaces:** searchItems(snapshot,query,{now}) 返回 §9.3 形状；snapshot 为已发布 RootIndex 的只读聚合；列表输出不暴露内部 searchText。

- [x] 写测试覆盖 AND、完整短语、排除词、纯排除查询、NFKC/大小写、各字段权重、题名全等加15、新鲜度固定 now、全部过滤/排序、组内序号与目录 order、分页一致性。增加 ligature/fullwidth/emoji 文本的原文高亮区间测试。

```js
assert.equal(result.items[0].id, titleHitId);
assert.equal(highlight.text.slice(...highlight.ranges[0]), originalMatchedText);
assert.equal(result.groups.flatMap(x => x.itemIds).every(id => pageIds.has(id)), true);
```

- [x] 运行 `node --test test/search.test.js`，确认失败。
- [x] 按 §8.7 权重实现，共享模块保留归一化文本到原文的位置映射与查询语法，供T13文内查找复用；只高亮正向词，排除词不计 hits；groups 只引用本页 items，total 是过滤后未分页总数。跨分页展开由前端追加结果，不引用不存在的 ID。
- [x] 默认 limit100、最大500，offset≥0；无 q 的 relevance 归一为 updated；无效枚举返回 400。相同评分用 updatedAt 再 id 稳定排序。
- [x] 同一命令通过；用500条合成数据测 warm search 的20次中位数与P95，目标 <50ms，记录数据量/正文长度/机器；不把生产旧扫描时间当此项证据。提交：`feat: search and group articles with accurate highlights`。

### T11：items 接口、文档缓存与图片资源边界

**Files:** 新增 `src/routes/items.js`、`src/cache.js`、`test/cache.test.js`；修改 `src/routes/system.js`、`src/source-files.js`、`src/server.js`、`test/server.test.js`。

**Interfaces:** 实现 list/detail/document/original/source/download/asset/cache；document 返回 text/plain 与 x-source-format/x-site-rule；cache 的 key 为 itemId+格式+源身份摘要+mtimeMs+size，ETag 使用同一身份摘要。

- [x] 写 API 测试：分页/分组、prev/next、document 非 HTML MIME、原网页 sandbox、304、资源 `..`/编码路径/符号链接/非图片拒绝、下载保留原始 MHTML；cache 测试覆盖同 mtime/size 的换 inode与重新定位、500MiB淘汰和 clear。

```js
assert.equal(documentResponse.headers.get('content-type'), 'text/plain; charset=utf-8');
assert.notEqual(newEtag, oldEtag);
assert.match(await newDocument.text(), /replacement body/);
assert.equal(outsideAsset.status, 404);
```

- [x] 运行 `node --test test/cache.test.js test/server.test.js`，确认新行为失败。
- [x] 返回文件前再次安全打开并检查身份；缓存并发生成使用临时文件+rename，失效后迟到 producer 不能恢复旧缓存。资源路径相对该 Markdown 文件所在目录解析，最终仍必须在 root 边界内；仅允许验证过的图片类型，不能把任意文件通过 asset 返回。
- [x] detail 中 files 列出该条目关联的全部源文件，包括重复格式被选用之外的文件，trash 不漏删；正文首选 html，再 mhtml，纯 MD 走 Markdown source。original 原始页面只在 sandbox 下显示。
- [x] 同一命令通过；读取失效目录/源文件给出 404/结构化错误，不吐出通用500。提交：`feat: serve cached documents and safe local assets`。

### T12：内嵌库和独立浏览器测试入口

**Files:** 新增 `public/vendor/*`、`scripts/check-vendor.mjs`、`scripts/browser-test.mjs`、`test/browser/{run.html,run.js}`、`test/fixtures/xss/*`；修改 `package.json`。

**Interfaces:** `npm run check` → vendor哈希校验，脚本支持 `--vendor-dir` 指向临时校验目录；`npm run test:browser` → Chrome测试；浏览器结果写入 `#test-result` 的 textContent JSON，含 `{status,passed,failed,skipped,failures}`。缺Chrome时明确 SKIP，不能记录为验收通过。

- [x] 准备至少20个 XSS fixture，覆盖需求 §13.4；编写哈希校验脚本，篡改一个临时副本时失败，正确副本时通过。测试服务器仅绑定随机 loopback 端口，只服务白名单测试/静态资源，不把测试页加入生产静态目录。
- [x] 取需求固定 tarball中的原始单文件和 LICENSE，放进带版本号目录；VENDOR.md 记录来源、版本、SHA-256、许可证、日期。三个库代码均不改；Readability只按需经典脚本加载。
- [x] 实现 browser-test：找到本机Chrome后 headless运行，等待明确的结果标记并设超时；非零失败或结果缺失使命令失败。测试服务器的主页面使用同生产 CSP；测试脚本都是同源独立文件。
- [x] `npm run check` 通过；用入口自检验证浏览器结果能完成并被脚本读取，再注入一次失败验证进程退出码非零。本任务只验收测试入口，明确标注阅读/XSS用例尚未接入，T13接入后才能验收阅读安全；新增 scripts 不引入 dependencies/devDependencies，不把浏览器脚本混入 npm test。
- [x] 提交：`build: vendor reader libraries and add browser checks`。

### T13：HTML/Markdown 阅读流水线与 XSS 防护

**Files:** 新增 `public/js/reader/{pipeline,markdown,find}.js`、`test/markdown.test.js`；修改 `test/browser/run.js`、`test/fixtures/sites/*`；需要时调整 shared site rules。

**Interfaces:** buildReader({item,html,markdown,query}) 异步返回安全 article/TOC/headings 与状态；`createFind({article,query})` 返回 `{next(direction),destroy()}`，在本任务实现基础高亮/跳转，T18完善边界与计数。Markdown解析复用 parseMarkdownSource；wikilink resolver 使用同root条目，不以任意路径查询系统文件。

- [x] 写浏览器行为用例：四种站点/格式正文与TOC、外图占位、相对图片、本地双链、短MD不回退、抽取失败、GFM表格/任务列表/嵌套列表/h1–h6/软换行。XSS解析前后均监测脚本执行与资源请求。
- [x] 运行 `node --test test/markdown.test.js` 与 `npm run test:browser`，确认新行为失败。
- [x] 在需求CSP已生效的页面调用DOMParser，保留站点选择器需要的class直到抽取；按口径H监测首次解析，不只监测最终DOM插入。站点规则→Readability兜底→需求PURIFY_CONFIG→后处理；Readability加载Promise只建一次，失败显示原网页回退。禁止用未清洗的用户文本写innerHTML。
- [x] 以DOMPurify输出作为唯一HTML插入来源；再强制checkbox disabled、清除外图/srcset、链接noopener、唯一标题id、lazy图片；双链先同文件夹精确匹配，再同root唯一匹配，歧义或缺失灰色不可点。
- [x] 两个测试命令通过；至少20个XSS用例全部通过、主动外部资源请求为0；44篇HTML/MHTML真实只读验收至少42篇成功，MHTML36篇子集至少35篇成功，结果记录成功/失败标题及原因。提交：`feat: extract and sanitize unified reading views`。

### T14：三栏骨架、主题、路由与状态容器

**Files:** 重写 `public/index.html`；新增 `public/css/{tokens,base,layout,components,sidebar,list,reader,manager}.css`、`public/js/{theme-boot,main,router,store,api,dom}.js`、`public/js/components/{splitter,toast,dialog,menu,segmented,skeleton}.js`、`test/router.test.js`；改 `src/server.js` 静态/CSP与 `test/ui.test.js`。

**Interfaces:** 实现§5前端接口，store结构按需求§11.2；router路由和query按§5.2，纯MD的original视图展示源文本；theme-boot是head里同步外部脚本。

- [x] 先改写锁定旧卡片/新标签的UI测试，增加路由parse/serialize行为测试，覆盖编码itemId、q/scope/fmt/kind/sort/view、后退、直接打开settings。服务测试断言深链回退、静态MIME、缺失assets仍404、未知api仍404。
- [x] 运行 `node --test test/router.test.js test/ui.test.js test/server.test.js`，确认新骨架/路由行为失败。
- [x] 按§6完整定义tokens，无组件硬编码颜色；Grid列min-width:0，≥1280显示TOC，1024–1279收进目录下拉；分隔线宽度200–320/320–520、双击复位、localStorage记偏好。对存储不可用/脏值回到默认值。
- [x] q使用replaceState，目录/系列/条目使用pushState；直接settings链接没有历史背景时使用 `/`，一般弹窗关闭返回打开前路由。主页面带需求CSP，assets/vendor版本目录immutable，其余no-cache；所有动态DOM用h/textContent。
- [x] 同一测试命令通过；浏览器检查首屏不闪白、1440/1280/1024布局、三栏独立滚动、分隔线恢复。提交：`feat: build themed three-pane application shell`。

### T15：目录侧栏与可搜索分组列表

**Files:** 新增 `public/js/views/{sidebar,list}.js`；修改 `public/js/{main,api,store}.js` 与CSS；浏览器测试增加 `test/browser/library-ui.js`。

**Interfaces:** 两个视图mount/update/unmount；api.request支持 AbortSignal；路由root/scope控制 roots参数，format=html含MHTML；series列表从 `/api/roots/:id/series` 读取，服务端实现该接口。

- [x] 写行为用例：目录选中/计数/状态、全目录标签、系列顺序、搜索150ms去抖、范围切换、chips单选、分组6条展开、目录>12系列展开、1000条追加渲染；慢旧搜索返回后不得覆盖新结果。
- [x] 运行 `npm run test:browser`，确认用例失败；series API测试先在 `node --test test/server.test.js` 中失败。
- [x] 侧栏实现点击/展开、重命名入口、右键与悬停菜单、状态tooltip；列表使用服务端groups与原文ranges创建mark节点，不拼HTML。请求序号加AbortController，路由切换清掉旧批次/observer。
- [x] 1000条分页到完整结果：每页limit≤500，按需续取，超过200先100再每批100；序号与回收逻辑避免页面混入上次筛选结果。普通点击页内打开，⌘点击与显式菜单才开原网页新标签。
- [ ] 两个测试命令通过；用performance.measure记录首100条DOM插入与首帧，目标<100ms，区分网络等待；人工滚动检查帧率。提交：`feat: browse roots and grouped search results`。

### T16：目录管理弹窗与可恢复变更

**Files:** 新增 `public/js/views/manager.js`；修改 sidebar、dialog、manager.css；扩展 `test/browser/library-ui.js`。

**Interfaces:** manager消费rootRegistry API，不直接修改本机文件；open/close由router管理；扫描轮询共用api.pollScan，不为每行建立独立定时器。

- [x] 写行为用例：添加300ms预检、失效重新定位、label Enter/Esc、拖动与Alt+↑/↓、全量/单根扫描、停用/启用、移除确认、重复路径禁用、重叠影响、预检结果迟到不得覆盖新路径。
- [x] `npm run test:browser` 先失败；真实源文件未改变由T07的API测试继续保证，不在浏览器里操作真实目录。
- [x] 按§5.6做原生dialog、1040px最大宽度且不超viewport、错误行/进度/问题列表；不通过的预检不能写配置。正式提交前再次预检，若影响数字已变就展示新结果，留待再次确认；服务端写入时独立校验路径有效性与当前目录归属，不盲用旧预检数字。
- [x] 按口径E/F处理系列重算与“不添加”；文件数、条目数独立显示。高版本配置禁用写操作，仍允许只读浏览；关闭还原焦点和原URL。
- [x] `npm run test:browser` 通过，管理界面与亮/暗效果图对照，至少检查正常、扫描、重名、失效、重叠五种状态。提交：`feat: manage source roots with previews and scan feedback`。

### T17：页内阅读、废纸篓确认、系统操作与全局快捷键

**Files:** 新增 `public/js/views/reader.js`、`public/js/shortcuts.js`、`public/js/reader/toc.js` 的基础目录控制器；修改 `src/routes/{items,system}.js`、`public/js/main.js`、组件与reader.css；扩展 server/browser测试。验收后删除 `public/app.js`、`public/styles.css`、`public/markdown-viewer.*`。

**Interfaces:** ReaderView消费detail/document/source与buildReader；`createToc({article,scrollContainer,onActive})` 返回 `{destroy()}`，本任务实现目录渲染/点击跳转，T18补滚动跟踪。实现POST trash `{confirm:true}`、POST reveal `{itemId}`/`{rootId}`/`{trash:true}`，固定argv执行open，不接受客户端任意路径。shortcuts.register调用统一route/view动作。

- [x] 写行为用例：点条目不开新标签、三种视图/纯MD源文本、300ms骨架屏、抽取失败、A慢响应晚于B仍显示B、菜单下载/复制/reveal、垃圾桶确认列全部源文件、200/207/500三种结果；输入框/可编辑区/弹窗不触发单字母快捷键。
- [x] `node --test test/server.test.js test/e2e-smoke.test.js` 与 `npm run test:browser` 先失败。
- [x] reader请求使用独立serial与AbortController；旧响应不得改标题、正文、TOC或loading。iframe保留sandbox；页面状态按URL恢复。垃圾桶确认关闭前保持失败列表，207保留幸存格式并刷新详情；全部成功打开同系列下一篇，无则清空。
- [x] 接入§5.7所有快捷键；`[/]`直接使用detail.prev/next，`n/Shift+N`调用T13的find控制器，不能以空动作占位。g前缀只在1秒内有效，Esc优先关闭顶层菜单/弹窗或取消编辑，再处理搜索。toast遵守3.2s/带操作6s、最多3条和status/alert；T18再完善滚动跟踪、系列卡片、计数与字号。
- [x] 新界面验收通过后移除兼容settings/library/DELETE接口，保留source/download及旧choose-folder别名；旧Markdown viewer链接严格解析同源source URL后302到新reader，非法source返回400。API测试相应改为新接口；旧兼容验收证据留在阶段记录。
- [x] 两个命令和 `npm test` 通过；对应需求人工清单1/2/3/5/6/8/9验收，尤其逐项验证快捷键已有真实动作。提交：`feat: read articles in place and retire the legacy UI`。

### T18：TOC、命中跳转、系列导航与字号

**Files:** 完善 `public/js/reader/{toc,find}.js`；修改 `public/js/views/reader.js`、shortcuts.js、reader.css、浏览器测试。

**Interfaces:** `createToc({article,scrollContainer,onActive})`、`createFind({article,query})`均返回destroy；find提供next(direction)；series prev/next使用服务端detail，进度仅表示当前第几篇。

- [x] 写行为用例：重复标题生成唯一id、h2/h3目录、无标题隐藏、滚动与点击跟踪、减少动效、正文多处命中及反向环绕、`[`/`]`边界、15/17/19/21字号恢复和localStorage坏值。
- [x] `npm run test:browser` 先失败；不要通过匹配CSS源码验证滚动与布局。
- [x] observer的root设为阅读区滚动容器；清理旧observer；顶部30%以内最后标题作为当前小节。文本节点包mark，跳过代码/非正文UI及原有mark，避免重复包装；切query与view重建索引。
- [x] 系列导航独立于列表筛选，按完整系列序列计算，不把“命中结果数量”当系列total；Aa只存界面偏好，不新增用户阅读状态。
- [ ] `npm run test:browser` 通过；人工第一讲9项TOC、第3/10篇导航、`n/Shift+N`和`[/]`完整验收。提交：`feat: navigate sections search hits and series`。

### T19：最终验收、文档与发布准备

**Files:** 修改 `README.md`、`docs/verification/html-library-v2.md`；必要修复回到所属文件/任务，不新加无关重构。

**Interfaces:** 交付现有启动/服务命令、npm test/check/test:browser、v2配置和完整验收记录；不存在新部署系统。

- [ ] 按需求§5.8逐个核对空库、空目录、失效、无权限、搜索无结果、筛选为空、服务断连、损坏/高版本配置、trash失败与部分成功、扫描issue。错误状态的“重试”必须完成真实对应动作。
- [x] 运行 `npm test`、`npm run check`、`npm run test:browser`、相关JS `node --check` 与 `git diff --check`；记录实际pass/fail/skip，不伪造全部通过。Chrome缺失时浏览器验收保持未完成。
- [ ] 在独立dataDir的人工验收服务中读取真实源目录，验证48条ID集合、48个标题、7个系列篇数、抽取≥95%、第一讲9节TOC、证据搜索及快捷键；添加/移除课程子根只修改该临时配置，验证48→40+8→48，源文章保持只读。目录迁移/失效和废纸篓恢复用专用测试目录。与三张效果图比对亮/暗1440×900，人工检验Safari/Edge布局与核心流程和解析时不外连。
- [x] 跑Lighthouse，可访问性≥95、最佳实践≥95；搜索500条<50ms、1000条首屏<100ms，附测量方式。若失败只修对应问题后重复相关检查，不无条件扩大测试。
- [x] README补多目录/最深优先/稳定ID、废纸篓恢复与权限、快捷键、三库版本/许可证、清缓存、开发端口、plist更新与回滚；更正旧“删除无法恢复”和“每次新标签阅读”的描述。
- [x] 提交：`docs: document v2 operations and verified acceptance`。生成阶段tag和发布清单；当前Agent自审本次diff与验收证据，独立审查仅在用户明确要求后委派。

### T20（可选）：子文件夹浏览 B5

**Files:** 新增 `public/js/views/folders.js`、`test/folders.test.js`；修改 `src/routes/roots.js`、sidebar/router/list与浏览器测试。

**Interfaces:** GET `/api/roots/:id/folders?path=`返回当前可用目录的已索引文件夹树；`/r/:rootId/f/:path*`映射items的folder过滤。不重新遍历未经配置的路径。

- [ ] 只有用户选择纳入B5时执行；补编码中文/多层路径、`..`拒绝、父根排除子根、不越界的测试，先运行 `node --test test/folders.test.js` 确认失败。
- [ ] 从RootIndex生成文件夹树，支持折叠/展开与相对路径过滤；按§5.6恢复“不添加，改用父目录里的子文件夹浏览”入口。
- [ ] `node --test test/folders.test.js` 与 `npm run test:browser`通过；人工刷新/后退还原folder。提交：`feat: browse indexed folders within a root`。

## 9. 需求覆盖表

需求编号的P0/P1/P2是优先级，实施阶段的P0–P4是排期；不能混同。

| 需求 | 实施任务 | 核心验收 |
|---|---|---|
| D1/D2 添加、移除 | T05/T06/T07/T16 | 校验后提交，只扫受影响目录；移除不改源文件 |
| D3/D4 命名、排序 | T04/T05/T07/T16 | ID不变，不扫描，刷新顺序保持；键盘可排序 |
| D5/D6 目录浏览与范围 | T07/T10/T15 | 可用根计数正确，URL和roots查询一致 |
| D7/D14 扫描与详情 | T06/T07/T15/T16 | 每根串行/全局2、旧快照可读、进度/时间/问题可见 |
| D8/D9 失效与重叠 | T05/T06/T07/T16 | 重新定位ID不变，48→40+8→48，预检无副作用 |
| D10/D11 同名与系列 | T09/T10/T15 | 跨根独立、相对路径区分、每根可关闭系列 |
| D12 迁移 | T00/T04/T19 | 全部旧ID集合一致，备份一次，未知字段保留 |
| D13 停用 | T05/T06/T16 | 不计数/搜索，父根回收，启用后重扫 |
| C1/C2/C3 标题摘要系列 | T08/T09/T19 | 48标题、无导航、7系列及正确篇数 |
| C4/C5 Markdown与格式 | T08/T13 | front-matter/双链正确，只认5扩展名 |
| B1/B4 页内三栏与URL | T14/T15/T17 | 默认252/384、后退/刷新/深链还原 |
| B2/B3 搜索筛选排序 | T10/T15 | 评分/分组/原文高亮，150ms去抖，范围无旧响应覆盖 |
| B5 文件夹 | T20 可选 | 未纳入时不出现未实现入口 |
| V1/V2/V3 阅读与回退 | T11/T12/T13/T17 | 抽取≥95%、统一排版、sandbox、GFM能力 |
| V4/V5/V6 TOC/系列/命中 | T18 | 9节样例、滚动高亮、上一篇下一篇、命中跳转 |
| V7 字号 | T18 | 4档界面偏好，不保存阅读状态 |
| S1/S2 废纸篓与入口 | T01/T17 | 不调用源文件unlink，207正确，列表无删除按钮 |
| S3 双重防护 | T11/T12/T13/T14 | CSP、清洗、20个XSS、渲染不外连 |
| F1/F2 反馈与后台服务 | T02/T03/T07/T17/T19 | toast/禁用/恢复，退出码0和plist共同验证 |
| F3/F4/F5 主题快捷键可访问性 | T03/T14/T17/T18/T19 | 不闪白、完整快捷键、对比度≥4.5:1、Lighthouse≥95 |
| F6 性能 | T10/T15/T19 | 500条搜索<50ms、1000条首屏<100ms，附测量记录 |

## 10. 发布、回退与接续执行

实施在独立开发端口和测试dataDir验证；真实后台服务继续使用4321。每个阶段的验收记录至少包括 commit、命令、结果、手工检查、未完成项；不能把“浏览器检查跳过”写成通过。

P0发布先保存既有plist与日志大小/时间，再用 `npm run service:install` 更新该项目的LaunchAgent；确认4321仅一个监听进程，做端口冲突测试后观察至少60秒日志增量，并在一次重新登录/重启后确认自动启动。需要用户重启Mac时把它保留为人工待验项，不自行重启机器。P1首次生产配置修改前必须有v1备份；P3替换后验证旧阅读链接302。阶段发布是否执行由后续实施授权范围决定，本次规划没有更新运行服务。

回退使用上一个验收通过的tag，不使用工作区强制清理。P0及后续版本必须保持废纸篓实现，不能为回退界面恢复直接unlink。P1之后若回到旧配置代码，先停止相关服务、另存当前v2配置和变更记录，再由明确的迁移回退步骤恢复v1备份；旧代码会丢未知字段，不能直接对v2配置写回。恢复的v1配置也不包含升级后新增的目录，必须在回退记录中列明。源文章不受代码回退影响；已移入废纸篓的测试文件由Finder恢复。

接续开工的首个范围建议为 **T00–T03 / P0**，完成并验收后再进入P1。默认当前Agent执行，自审与验证随每阶段完成；本方案不要求额外选择子Agent模式。新增需求或要偏离本方案时先更新项目内补充记录，保留原始需求归档和已通过的验收证据。
