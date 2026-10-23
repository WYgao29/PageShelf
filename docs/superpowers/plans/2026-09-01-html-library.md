# HTML/Markdown 对话统一入口 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: 构建一个本机常驻、可从电脑和手机浏览器访问的个人 HTML/Markdown 对话统一入口。

Architecture: Node.js 内置 HTTP 服务负责目录配置、递归扫描、双格式配对、内存索引、搜索和安全文件读取；原生 HTML/CSS/JS 提供响应式单页入口。源文件保持原位，配置持久化到用户数据目录。

Tech Stack: Node.js 20+、node:http、node:fs/promises、node:path、原生浏览器 API、node:test。

Spec: docs/superpowers/specs/2026-09-01-html-library-design.md

## Global Constraints

- 只扫描显式配置的目录，不复制或改写源文件。
- HTML 与 Markdown 按扫描目录和相对路径 stem 合并为一条记录。
- 搜索覆盖文件名、目录、标题和正文。
- 源文件读取必须通过目录边界校验，统一入口不直接注入源 HTML。
- 不引入第三方运行时依赖或云端服务。

---

### Task 1: 项目脚手架与扫描索引核心

Files:
- Create: package.json
- Create: src/library.js
- Test: test/library.test.js

Interfaces:
- createLibrary(options) 返回 { scan, search, getItem, addRoot, removeRoot, getSettings, readSource }。
- scan() 返回 { items, stats, errors }。
- search(query, filters) 返回合并后的内容记录数组。

- [ ] 写测试：临时目录中放置同 stem 的 .html/.md、无配对文件和嵌套文件，断言扫描结果、标题提取和配对行为。
- [ ] 运行 npm test -- --test-name-pattern="scan"，确认因 src/library.js 不存在而失败。
- [ ] 实现目录扫描、配对、元数据提取、内存索引和安全路径解析。
- [ ] 写搜索测试，断言标题、路径和正文均可命中且不区分大小写。
- [ ] 运行 npm test，确认核心测试通过。
- [ ] 提交 feat: add local library scanner and search index。

### Task 2: 配置持久化与 HTTP API

Files:
- Create: src/server.js
- Modify: src/library.js
- Test: test/server.test.js

Interfaces:
- createServer({ dataDir, library }) 返回 Node HTTP server。
- API 使用规格中定义的 /api/settings、/api/settings/roots、/api/scan、/api/library 和源文件路由。

- [ ] 写 API 测试：添加临时根目录、扫描、搜索、读取 HTML/Markdown，并断言非法路径返回 400/404。
- [ ] 运行 npm test -- --test-name-pattern="API"，确认测试因服务端缺失而失败。
- [ ] 实现 JSON 配置读写、请求路由、错误响应和安全源文件响应。
- [ ] 运行 API 测试并修复到全绿。
- [ ] 添加 start、test、dev 脚本并提交 feat: expose library management api。

### Task 3: 统一入口界面

Files:
- Create: public/index.html
- Create: public/styles.css
- Create: public/app.js

Interfaces:
- 页面调用 /api/library、/api/settings、/api/scan、/api/settings/roots 和源文件路由。
- public/app.js 维护搜索、格式筛选、列表、详情和设置视图状态。

- [ ] 先补充一个静态资源冒烟测试，断言 / 返回入口 HTML 且包含主要导航文案。
- [ ] 运行测试确认资源尚未提供时失败。
- [ ] 实现桌面双栏、移动端单栏、内容卡片、详情视图、空状态和设置表单。
- [ ] 为源 HTML 使用 iframe/独立导航，为 Markdown 使用转义后的轻量渲染，避免将源 HTML 注入应用 DOM。
- [ ] 运行全部测试并用浏览器/HTTP 冒烟检查主要交互。
- [ ] 提交 feat: build unified conversation library interface。

### Task 4: 文档与最终验证

Files:
- Create: README.md
- Modify: src/server.js
- Test: test/e2e-smoke.test.js

- [ ] 编写启动、配置扫描目录、局域网访问和数据目录说明。
- [ ] 写端到端测试：临时目录 → 添加根目录 → 扫描 → 搜索 → 读取源文件。
- [ ] 运行 npm test、node --check src/server.js、node --check public/app.js。
- [ ] 检查 git diff --check 和 git status --short，确认只包含本功能文件。
- [ ] 提交 docs: document local library usage and verification。
