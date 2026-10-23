# HTML Library Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本地 HTML/Markdown 对话库的网络暴露、源文件隔离、扫描竞态、输入校验和前端异步状态问题，并补齐回归测试。

**Architecture:** 保持现有 Node 内置 HTTP + 内存索引 + 原生前端结构。服务端默认只信任 loopback 请求；非 loopback 请求必须通过一次性 token URL 建立 HttpOnly cookie。扫描通过串行 Promise 队列提交结果，源文件读取同时验证真实路径并使用禁止跟随最终符号链接的文件句柄。前端增加请求序号保护和统一统计更新。

**Tech Stack:** Node.js 20+、node:http、node:fs/promises、node:crypto、原生浏览器 API、node:test。

**Spec:** docs/superpowers/specs/2026-09-01-html-library-design.md

## Global Constraints

- 只扫描显式配置的目录，不复制或改写源文件。
- HTML 与 Markdown 按扫描目录和相对路径 stem 合并为一条记录。
- 搜索覆盖文件名、目录、标题和正文。
- 源文件读取必须通过真实目录边界校验，统一入口不直接执行源 HTML 脚本。
- 默认监听 loopback；需要局域网访问时必须配置 AUTH_TOKEN。
- 不引入第三方运行时依赖或云端服务。
- 每个修复先写回归测试并观察测试失败，再写最小实现。

---

### Task 1: 扫描索引安全与一致性

**Files:**
- Modify: `src/library.js`
- Test: `test/library.test.js`

**Interfaces:**
- 保持 `createLibrary({ roots })` 和现有公开方法签名不变。
- `readSource(id, format, requestedRelativePath)` 对未知格式、越权路径、缺失文件和符号链接目标统一返回 `SOURCE_NOT_FOUND`。
- `scan()` 的并发调用串行执行，后提交的配置变化不会被旧扫描覆盖。

- [ ] **Step 1: Write failing tests** for symlink replacement, unknown format, missing source, duplicate stem resolution, and concurrent scan serialization.
- [ ] **Step 2: Run `npm test -- test/library.test.js`** and confirm the new cases fail for the expected security/correctness reasons.
- [ ] **Step 3: Implement canonical root/source resolution, final-component no-follow reads, explicit format validation, deterministic duplicate handling, and a scan Promise queue.**
- [ ] **Step 4: Run the library tests and then the full suite.**
- [ ] **Step 5: Refactor only after green, preserving the public API.**

### Task 2: HTTP authentication, error handling, and safe source responses

**Files:**
- Modify: `src/server.js`
- Modify: `README.md`
- Test: `test/server.test.js`

**Interfaces:**
- `createServer({ dataDir, library, authToken })` accepts an optional token; when configured, requests require `Authorization: Bearer <token>` or an HttpOnly cookie established through `/?token=<token>`. The default local startup leaves `authToken` empty and listens only on loopback.
- Main startup defaults to `HOST=127.0.0.1`; `HOST=0.0.0.0` requires `AUTH_TOKEN` for remote access.
- Source HTML responses include CSP sandboxing and `X-Content-Type-Options: nosniff`; downloads remain attachments.
- Malformed JSON, malformed config, unknown source formats, and missing source files return 4xx responses instead of uncaught 500 errors.

- [ ] **Step 1: Write failing API tests** for remote authentication, token bootstrap, CSP headers, unknown format, null JSON, and malformed persisted config.
- [ ] **Step 2: Run the focused server tests and verify expected failures.**
- [ ] **Step 3: Implement request authentication, token cookie bootstrap, robust startup/config handling, input validation, safe response headers, and error mapping.**
- [ ] **Step 4: Run server tests and the full suite.**
- [ ] **Step 5: Update README startup instructions and security behavior.**

### Task 3: Frontend race safety and live statistics

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Test: `test/e2e-smoke.test.js`

**Interfaces:**
- Library counts update after initial load, add, remove, and refresh.
- Search responses and reader responses only update the UI if they still belong to the latest request/selection.
- Reader errors become visible toast/empty states instead of unhandled promise rejections.
- HTML source reading remains inside sandboxed iframe; direct source opening receives server-side CSP.

- [ ] **Step 1: Add an e2e assertion for safe source headers and scan error reporting where observable.**
- [ ] **Step 2: Run the e2e test and confirm the new assertion fails.**
- [ ] **Step 3: Add request sequence guards, count refresh helpers, safe reader error handling, and scan-result messaging.**
- [ ] **Step 4: Run the complete test suite and static checks.**

### Task 4: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-01-html-library-design.md`

- [ ] **Step 1: Document loopback default, AUTH_TOKEN LAN access, token URL bootstrap, and safe HTML reading.**
- [ ] **Step 2: Re-read the implementation plan and spec for gaps and placeholders.**
- [ ] **Step 3: Run `npm test`, Node syntax checks, `git diff --check`, and inspect `git status`.**
