# HTML 知识库审查修复与定向复审

2026-10-05，分支 `codex/html-library-v2`，审查范围 `28a5cbf..5dfab04`。此前三个 P2 已修复，本轮定向自审未发现新的需修正问题。结论适用于这次修复，可接受本轮改动；完整 v2 发布仍按既有[发布清单](release-checklist.md)验收。

按照用户“sp 修复，完成之后针对修复进行 review”的授权，由当前 Agent 实现，提交后再单独审查差异、调用契约与回归证据。未委派独立审查，遵循全局 AGENTS.md。计划见[修复方案](../superpowers/plans/2026-10-05-html-library-review-fixes.md)，机器记录见[验证摘要](review-fixes-2026-10-05.json)。

## 三项发现闭环

| 原发现 | 最终修复 | 实际回归证据 |
|---|---|---|
| 恢复子根后，重命名会让文章消失 | `RootRegistry.applyChange` 比较可用性和 realPath；恢复的根全量扫描，排除范围变化的父根继续增量扫描；排序 API 同样消费 affected 并返回 scan.queued | 重命名、排序两个真实 API 场景原先均为 1 条而非 2 条，修复后 Parent/Child 各 1 条，源文件原字节不变 |
| 迟到的删除响应覆盖 B | `afterTrash` 刷新目录和索引后，再核对当前条目是否仍等于响应的 itemId，全部成功才导航 | 延迟真实临时 Trash 响应、延迟后续 roots 刷新两种场景原先都会覆盖 B，修复后 URL 和标题保持 B；仍选中 A 时进入下一篇，无下一篇时清空 |
| Enter 打开第一篇而不是聚焦按钮 | 全局 Enter 只处理 body，搜索框保留专用入口；列表按钮使用原生动作 | Chrome CDP：Tab 聚焦第 4 篇后 Enter 打开第 4 篇；展开按钮 Enter 从 6 篇变 10 篇且不改选文章；j/j/k 后 Enter 仍打开聚焦文章 |

业务代码限于 `src/roots.js`、`src/routes/roots.js`、`public/js/main.js`、`public/js/shortcuts.js`。没有新增依赖、变更配置 schema 或改写源文档的操作。

## RED 与 GREEN

| 检查 | 最终结果 |
|---|---|
| `npm test` | 77 pass / 0 fail / 0 skip |
| `npm run test:browser` | 54 pass / 0 fail / 0 skip，其中原生按键 3/3 |
| `npm run check` | 3 个 vendor SHA-256 匹配 |
| 自有改动的 `node --check` 与 `git diff --check` | 通过 |

新增 3 条 Node 用例、4 条浏览器 Trash 用例和 3 条 Chrome 原生按键用例。失败阶段分别确认恢复根 2 条、迟到删除 2 条、原生 Enter 2 条测试因对应旧行为失败，随后修复通过；正常重命名/排序、当前文章删除导航和 j/k 是正向控制。

按键测试初次仅发送不含字符文本的 keydown/up，未触发按钮默认点击。补齐 Enter 的 CR 字符事件后，再临时恢复原处理器，最终驱动仍准确报告两个 Enter 缺陷，j/k 用例通过；重新应用修复后 54/54。测试不会通过直接调用 click 来模拟本轮的原生 Enter 验收。

Chrome 外部资源探针为 0。最终运行保留原 48 条合成资料；Trash 使用独立的 4 篇临时文章、真实 API 和测试文件移动服务，浏览器仅延迟响应，不伪造操作结果。临时 root 在测试结束后移除，临时服务、Chrome profile 和源目录由 harness 清理。测试不调用真实 macOS 废纸篓，也不修改生产资料。

## 定向复审

- 根目录：确认恢复根进入 affected，排序结果触发既有前端轮询；`ok`、`warning`、`scanning` 都属于可用状态，正常改名/排序不新增扫描，lastScan 不变；原有 ID、重叠归属、扫描迟到保护继续通过 Node 套件。
- 删除：确认服务端成功与 207 均携带 itemId，导航判断位于异步刷新之后；用户换到 B、目录或其他选择时不会执行 A 的导航。207/500 的幸存格式和错误信息原有浏览器用例继续通过。
- 键盘：确认按钮 Enter 不再被全局 preventDefault，j/k 使用聚焦后的真实按钮动作；body 与搜索输入的 Enter、可编辑输入、弹窗及修饰键的原入口保持。读取了全部四个业务文件差异与新增测试/driver 变更。
- 测试：检查每个失败断言对应实际行为、异步 gate 在 finally 释放、mock 仅控制响应时间、Trash 只作用于专用临时源文件、失败仍返回非零；新增 Chrome 按键结果计入总数。

未评判范围：本轮不重新审查 v2 全部实现、不新增可选 B5 文件夹树；不执行生产发布。Safari 本轮未重新运行；Edge、Finder 原生回退与生产启动的既有人工待项仍见原[实施验证](html-library-v2.md)。这些项目未计入本轮通过结果。

审查结论：本轮修复范围内没有遗留 Critical/Important/Minor 发现，也没有延期的小修正。原三项发现均有 RED→GREEN 证据，新增测试随实现保留。工作保留在原 worktree，未合并或推送。

## 提交

- `e8f47d1`：恢复根扫描与排序 API。
- `ec7b0c1`：删除响应尊重当前选择及四条真实 API 浏览器回归。
- `5dfab04`：按钮原生 Enter、Chrome 按键回归与可用根状态控制。

完整本机日志保留在当前修复计划的 `.superpowers/sdd/2026-10-05-html-library-review-fixes/`，不纳入 Git。
