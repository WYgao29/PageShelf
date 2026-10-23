# PageShelf 整体审查修复

日期：2026-10-23。针对整体审查确认的 10 项问题完成修复，并更新 `release/PageShelf-darwin-arm64/PageShelf.app`。

## 修改与原因

| 问题 | 修改 | 验证 |
|---|---|---|
| 保存非 UTF-8 HTML 时原字节被替换 | `src/services/items.js` 的下载分支返回 `source.buffer`，保留原文件编码 | Windows-1252、GBK 服务回归；真实保存对话框导出 Windows-1252 文件并逐字节比较 |
| 访达入口经两层参数校验后失败 | `shared/pageshelf-contract.js` 保持 reveal 参数为同一结构，`electron/backend/host.js` 在服务边界传入 body | renderer → IPC gate → 真实 host 验证来源、文章、废纸篓三种目标；拒绝非法嵌套参数 |
| Markdown 代码和原词无法检索 | `src/formats/markdown.js` 使用已有 Marked 语法解析器提取可见文字，保留代码内容及标点 | 围栏、缩进和行内代码、API_KEY、release-notes、链接与双链；真实应用检索代码正文 |
| 行内图片使前后文字断行 | `src-ui/src/styles/polish.css` 恢复使用 `standalone-image`，仅独立图片使用块布局 | 真实 Electron 检查行内图片前后文字同一行，独立图片居中 |
| 窄列表的来源名称被压为零宽 | 同一 CSS 恢复元数据换行和来源最小宽度 | 320px 列表、多格式、四位命中数，在亮暗主题下测量名称宽度和边界 |
| 含空格文件名的 Markdown 本地图无法显示 | `reader/pipeline.js` 分离 URL 查询和片段，仅解码一次再构造 asset 请求；保留来源边界校验 | 空格、中文、字面百分号、编码字符、查询和片段、相邻图片；拒绝绝对路径，真实应用加载图片 |
| 关闭主窗口后无法重新进入资料库 | `electron/main.ts` 共用主窗口恢复函数，在初始化完成后响应 activate、second-instance；关闭时清理窗口记录 | 原网页窗口保留，关闭主窗口后分别发出两个 Electron 生命周期事件，确认资料库窗口恢复 |
| 后退或重启后系列标题过期 | `library-context.tsx` 按当前来源和系列 key 解析名称，取消过期请求，目录更新后重新读取 | 后退、前进、重启恢复、相同 key 的不同来源、扫描后名称更新 |
| 正文章节和脚注链接丢失目标 | `reader/pipeline.js` 为原始 ID 和命名锚点建立安全 ID 映射并同步链接；`reader/toc.js` 支持跳到非标题目标 | 编码片段、脚注、命名锚点、原文标题、ID 冲突、TOC 和双链；真实正文链接跳转 |
| 选中来源不能收起 | `sidebar.tsx` 分开维护选中与展开状态，显式折叠不受目录刷新影响，重新导航时展开 | 显式折叠、目录刷新、重新选择和历史导航 |

两处 CSS 修改将审查开始时的未提交回归恢复为已有正确实现，因此它们相对 Git HEAD 没有新增差异。原有 README、示例、Node 版本声明和许可证脚本等其他工作未被覆盖。

## 验证结果

本轮使用 Node.js 26 执行验证。所有测试均使用隔离夹具；废纸篓测试使用受限替身，没有操作真实资料。

| 检查 | 结果 | 记录 |
|---|---|---|
| `npm test` | Node 104/104；UI 111/111；Electron E2E 23/23；两组类型检查和生产构建通过 | [完整日志](validation/project-review-test.log) |
| 新增后端回归 | 修复前 2 项预期失败，修复后相关 21 项全部通过 | [修复前](validation/project-review-backend-before.log)、[修复后](validation/project-review-backend-after.log) |
| 阅读器与导航定向回归 | 62/62 通过 | [UI 日志](validation/project-review-ui.log) |
| `npm run check` | marked、DOMPurify、Readability 固定 SHA-256 全部通过 | 固定版本见 `src-ui/vendor/VENDOR.md` |
| 重新打包 | 使用已验证的生产构建生成 arm64 应用 | [打包日志](validation/project-review-package.log) |
| 打包后运行 | 六组布局、5 个进程无 TCP 监听、退出后进程全部结束 | [运行检查](validation/project-review-package-smoke.log) |
| macOS 系统启动 | 六组布局、5 个进程无监听、退出清理通过 | [系统启动](validation/project-review-launch-services.log) |
| 编译产物与应用包 | 23 个生产文件逐字节一致；package.json 的运行字段一致 | [SHA-256 记录](validation/project-review-build.json) |

打包器会移除 package.json 的开发脚本、devDependencies 和 private 字段，因此只对其运行字段比较；实际前端、主进程、worker、preload、字体与许可证文件均比较原字节。没有修改 vendor 文件，也没有新增依赖。
