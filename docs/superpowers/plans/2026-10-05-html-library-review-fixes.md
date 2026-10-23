# HTML 知识库审查修复 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans，由当前 Agent 在已附加的 worktree 内执行；不委派。用户已授权修复此前确认的三处问题并在完成后 review。

**Goal:** 修复目录恢复遗漏扫描、迟到删除覆盖阅读选择和 Enter 拦截列表按钮，并保留正确的现有行为。

**Architecture:** 沿用 RootRegistry 的 affected 与 Scheduler；恢复可用或 canonical path 改变时安排对应根扫描，排序接口消费 affected。删除后的导航在刷新完成后核对被删除条目与当前选择。列表按钮使用原生 Enter，页面与搜索快捷键继续使用 openFocused。

**Tech Stack:** Node.js、原生 JavaScript ES modules、Chrome DevTools Protocol、node:test；不增加依赖。

**Spec:** 本轮审查的三项已复现发现；行为依据沿用 [开工方案](2026-10-04-html-library-v2-kickoff.md) T05/T07/T17。

## Global Constraints

- 基线 `28a5cbf`，分支 `codex/html-library-v2`，复用现有 worktree。
- 配置写入与废纸篓测试只使用临时资料，真实文章与生产 `4321` 不变。
- 不合并、不推送；保留回归测试和验证记录。
- 新增行为测试先 RED 后 GREEN；最终由当前 Agent 针对修复单独做自审。

## Review Focus

- 恢复子目录后重命名与排序都应重新建立该子目录索引。
- 正常重命名与排序，以及扫描中根的可用状态变化，不应无故触发全量扫描。
- 用户在删除响应或刷新根列表期间改选 B，完成响应应保留 B。
- 用户仍在被删除文章时应继续打开下一篇，无下一篇时清空；207 保留幸存格式。
- Tab/直接聚焦列表按钮与 j/k 聚焦文章都应正确响应 Enter，展开、载入更多和重试继续可用。

### Task 1: 恢复根目录索引

**Files:** `src/roots.js`、`src/routes/roots.js`、新增 `test/root-recovery.test.js`。

**Interfaces:** `registry.applyChange(change) -> {root,affected}`；所有配置变更 API 将 affected 入队，并返回 `scan.queued` 供前端轮询。

- [x] 编写实际 API 回归用例：失效子根恢复、父根先读到子目录资料，再重命名或排序；最终 Parent/Child 各一条，源文件原字节不变。正常重命名/排序 queued 为空。
- [x] `node --test test/root-recovery.test.js`：恢复用例 RED（2 条变 1 条），正常变更用例通过。
- [x] 比较根的可用性与 canonical path；恢复扫描与排序消费 affected，保持现有增量行为。
- [x] `npm test` 全通过，提交 `fix: rebuild restored root indexes after config changes`。

### Task 2: 删除响应尊重当前选择

**Files:** `public/js/main.js`、必要时 `public/js/views/reader.js`、`test/browser/library-ui.js`。

**Interfaces:** `afterTrash(result,nextId)` 始终更新资料状态；仅当前条目仍等于 `result.itemId` 且全部成功时导航。

- [x] 延迟真实临时 Trash 响应，关闭弹窗后打开 B；另延迟 Trash 完成后的 roots 刷新，刷新期间打开 B；断言响应处理后仍显示 B。补仍选中 A 时进入下一篇的正向用例。
- [x] `npm run test:browser`：迟到导航用例 RED，其他现有用例保留。
- [x] 刷新后核对当前条目，保持 207/500 的原处理路径。
- [x] `npm run test:browser` 全通过，提交 `fix: preserve reader selection after delayed trash responses`。

### Task 3: Enter 保留按钮行为

**Files:** `public/js/shortcuts.js`、`test/browser/library-ui.js`，必要的 Chrome 输入回归脚本放在 `test/browser/` 并由现有 driver 调用。

**Interfaces:** `register(actions)` 继续处理 body/search 的 Enter；列表中的交互控件保留浏览器默认动作。

- [x] 回归用例断言：聚焦第 4 篇按 Enter 打开第 4 篇；展开按钮按 Enter 将 6 篇展开为 10 篇且不改选文章；现有 j/k + Enter 继续工作。
- [x] 观察键盘用例 RED，确认由快捷键拦截导致。
- [x] 收窄全局 Enter 处理，保留按钮原生动作。
- [x] Node 与 Chrome 全套通过；vendor 与 diff 检查通过，提交 `fix: keep native Enter behavior for list buttons`。
- [x] 对 `28a5cbf..5dfab04` 做只读修复审查，记录问题闭环、测试证据、剩余限制与合并结论，见 [复审记录](../../verification/html-library-review-fixes-2026-10-05.md)。
