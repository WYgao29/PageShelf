# MHTML 归档图片修复

日期：2026-10-22。已更新 `release/PageShelf-darwin-arm64/PageShelf.app`。重新打开应用后，旧 MHTML 正文缓存会自动重新生成，无需重新添加目录或手动清缓存。

## 原因与修改

本地实际归档包含 45 个 MIME 子段；网页引用的 19 张图片均有归档资源。HTML 属性把图片 URL 查询参数中的 `&` 写成 `&amp;`，而 MIME 的 `Content-Location` 保存原 URL。旧渲染器没有还原属性中的 HTML 字符实体，导致只有 1/19 张匹配成功。

- `src/formats/mhtml.js`：匹配前解码 HTML 属性中的字符实体，支持 `&amp;`、十进制和十六进制写法；内联背景图片也先解码，再正确转义生成的引号。没有归档的远程资源保持原行为，不放开联网权限。
- `src/services/items.js`：为 MHTML 生成结果的缓存键和 ETag 加入渲染版本，避免更新后继续读取旧的错误 HTML。配置格式、500 MiB LRU 和源文件身份检查不变。
- `test/mhtml-images.test.js`：新增 7 项回归；`scripts/electron-e2e.mjs` 现在实际验证阅读视图与 sandbox 原网页中的归档图片解码尺寸。
- `scripts/mhtml-image-smoke.mjs`：可使用合成归档或指定本地归档，在临时资料库与临时 UI 配置中启动生产应用；预先放入旧缓存，再检查图片加载/可见性、外连次数和原文件 SHA-256。真实归档及其内容没有加入仓库。

完整回归还发现 M10 的字重 token 替换后，一条源码测试仍检查裸 `700`。已修正 `test/design-foundation.test.js`，同时断言 token 的引用和值仍为 700。M10 的全套日志产生于该 token 替换前；本次完整套件已包含此修正，不以之前的日志替代当前结果。

## 验证

| 检查 | 结果 | 记录 |
|---|---|---|
| 实际归档对照 M10 旧渲染器与当前渲染器 | 19 张引用图片，归档匹配从 1/19 变为 19/19 | [diagnostic](validation/mhtml-images-diagnostic.log) |
| `npm test` | Node `99 passed, 0 failed`；Vitest `87 passed (87)`；`ELECTRON_E2E 17 passed, 0 failed` | [完整日志](validation/mhtml-images-test.log) |
| 实际 `.app` + 实际归档副本 + 旧缓存 | 阅读视图 14/14 张加载；原网页 19/19 张加载且可见；外连 0；原文件未变；没有截图 | [真实应用验证](validation/mhtml-images-real.log) |
| `npm run package:mac` | arm64 构建完成，图标 10 个尺寸通过 | [打包](validation/mhtml-images-package.log) |
| macOS LaunchServices 启动 | 六组布局通过，5 个进程无监听，退出后全部结束 | [系统启动](validation/mhtml-images-launch-services.log) |
| `npm run check` | 三个固定 vendor SHA-256 校验通过 | [vendor](validation/mhtml-images-vendor.log) |
| 修复时的编译产物与应用包 | UI、主进程、worker、preload 逐个 SHA-256 相同 | [修复包指纹](validation/mhtml-images-build.json) |

实际归档验证使用 `node scripts/mhtml-image-smoke.mjs <本地归档路径> --packaged`。不传路径时使用合成测试归档；指定 `--packaged` 时运行交付 `.app`，否则运行当前开发构建。

当前分支仍为 `electron-react`，没有 push 或修改 `main`。M0–M10 的历史记录见 [acceptance.md](acceptance.md)；本次修复的包指纹见上表，后续界面调整与最新交付包记录见 [design-polish.md](design-polish.md)。
