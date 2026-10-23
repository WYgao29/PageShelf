# HTML/Markdown 对话统一入口设计

## 目标

为散落在多个本地文件夹中的对话 HTML 和 Markdown 文件提供一个统一的浏览器入口。系统在本机常驻运行，支持电脑和同一网络中的手机访问；用户可以配置多个扫描目录，系统递归扫描并将同名 HTML/Markdown 识别为同一条知识记录。

## 第一阶段范围

- 提供 Node.js 本地 HTTP 服务和单页统一入口。
- 支持配置、添加、删除多个扫描目录。
- 递归发现 .html、.htm、.md 文件。
- 按“扫描目录 + 相对路径去掉扩展名”配对 HTML 和 Markdown，避免双格式重复展示。
- 搜索文件名、目录、标题和正文内容。
- 列表展示标题、来源目录、格式状态、更新时间和正文摘要。
- HTML 用独立页面阅读；Markdown 在统一界面中以安全的文本/轻量 Markdown 视图阅读，并可下载原文件。
- 提供手动刷新；服务启动时加载配置并首次扫描。

## 非目标

- 不把源文件复制、移动或改写。
- 不实现公网部署、账号系统、云同步或多人权限。
- 不依赖第三方数据库或前端框架。
- 不执行扫描目录中的脚本，不将 HTML 源码直接注入统一入口。

## 架构

配置文件 → 目录扫描器 → 文件配对和元数据提取 → 内存索引 → HTTP JSON API → 原生 HTML/CSS/JS 单页入口。

服务端使用 Node.js 内置 http、fs/promises、path 和 node:test。索引驻留内存，配置单独持久化；重启后从配置重新扫描。扫描目录是显式白名单，文件读取前必须验证目标真实路径仍位于对应根目录内，并禁止跟随最终符号链接。服务默认监听 loopback；启用局域网监听时必须用 AUTH_TOKEN 保护请求。

## 数据与接口

扫描根目录配置为 { id, path, label, addedAt }。内容记录为 { id, title, relativePath, directory, html, markdown, updatedAt, size, snippet, searchText }，其中 html 和 markdown 是可选源文件信息，不存在的格式为 null。

接口：

- GET /api/library?q=&rootId=&format=：返回筛选后的合并记录。
- POST /api/scan：立即重新扫描全部根目录并返回统计。
- GET /api/settings：返回扫描根目录和最近扫描状态。
- POST /api/settings/roots：添加一个目录，写入配置并扫描。
- DELETE /api/settings/roots/:id：删除目录并重建索引。
- GET /api/items/:id/source/:format：在白名单校验后返回 HTML/Markdown 源文件。
- GET /api/items/:id/download/:format：以附件形式下载源文件。
- GET / 和 /assets/*：提供统一入口静态资源。

## 界面

统一入口采用“左侧导航 + 主内容区”的布局：左侧显示知识库名称、全部内容、仅 HTML、仅 Markdown 和设置入口；主区域显示搜索框、刷新按钮、统计信息、内容卡片列表。内容卡片不因双格式重复，只显示 HTML/Markdown 状态徽标。点击卡片进入详情抽屉/详情页，提供 HTML 阅读、Markdown 阅读和下载操作。移动端折叠左栏，卡片改为单列。

## 错误处理

- 不存在、不可读或不是目录的路径不能加入配置，并返回可理解的错误。
- 某个根目录扫描失败不应阻塞其他根目录；扫描状态记录错误信息。
- 不支持的扩展名忽略。
- 无效的记录 ID、格式、缺失源文件或越权文件路径返回 404。
- 非本机请求没有有效访问令牌时返回 401；带令牌访问根页面后使用 HttpOnly Cookie。
- 配置写入失败返回 500，并保留当前内存配置。
- 空库、空搜索结果和无 Markdown/HTML 配对都要有明确的空状态。

## 测试与验收

- 单元测试覆盖文件发现、HTML/Markdown 配对、标题提取、正文搜索和目录边界校验。
- API 测试覆盖设置 CRUD、扫描、搜索和源文件读取。
- 使用临时目录构造 HTML/Markdown 样例，验证双格式只出现一条记录，并验证符号链接、重复 stem 和扫描竞态。
- 启动服务后用 Node 内置 fetch 执行一次端到端冒烟：添加根目录 → 扫描 → 搜索 → 读取源文件。
