# PageShelf 界面复查修复

日期：2026-10-22。修复对 `7f2cf3d` 审查确认的三处问题，并更新 `release/PageShelf-darwin-arm64/PageShelf.app`。

| Before | After | Why |
|---|---|---|
| `p > img:only-child` 也匹配图片前后有文字的段落，导致文字换行 | [pipeline.js](../../src-ui/src/reader/pipeline.js) 在净化后的正文中识别没有文字、只有一张图片的段落；[polish.css](../../src-ui/src/styles/polish.css) 只把这些图片及 figure 中的图片设为块布局 | 图文混排保留行内布局，独立图片继续居中 |
| 320px 列表、三种格式和四位命中数时，来源文字宽度变为 0 | 元数据允许换行，来源保留至少 64px，长名称仍可省略并悬停查看 | 来源、格式、日期和命中数均保持可见，不越出内容区域 |
| 窗口已失焦时新建的提示没有暂停计时 | [toast.tsx](../../src-ui/src/components/toast.tsx) 初始化时读取当前文档焦点，把失焦加入暂停原因 | 用户返回后才开始消费五秒阅读时间；隐藏和失焦的暂停状态分别解除 |

## 定向回归

- `design-polish.test.tsx` 新增两项行为测试：可见但已失焦时创建提示；初始隐藏且失焦时，恢复可见后仍等待焦点。原有正常计时测试明确设置窗口为聚焦状态。
- `electron-e2e.mjs` 新增两项真实渲染检查：图文混排不换行且独立图片保持居中；最小列表宽度下，亮暗主题的三格式条目保留来源且元数据无溢出。新增夹具的总数由同一个常量供首次加载和删除后的后台重启检查使用。
- 修复前新增提示测试 `2 failed, 8 passed`；图片 E2E 在预期的 `block !== inline` 断言处失败。对应记录分别是[提示失败记录](validation/review-fix-toast-before.log)和[图片失败记录](validation/review-fix-images-before.log)，这些是修复前预期的失败。

同一隔离夹具的[修复前测量](validation/review-fix-layout-before.log)与[修复后测量](validation/review-fix-layout-after.log)：混排段落从 60.5px 恢复为 29.75px，前后文字位于同一行；来源宽度从 0 恢复为约 66.7px，元数据所需宽度从 283px 变为与 269px 内容区相同。

## 最终验证

| 检查 | 结果 | 记录 |
|---|---|---|
| `npm test` | Node 99/99；UI 97/97；Electron E2E 22/22 | [完整日志](validation/review-fix-test.log) |
| `npm run package:mac` | arm64 应用构建完成，图标 10 个尺寸通过 | [打包](validation/review-fix-package.log) |
| macOS 系统启动 | 六组宽度/主题布局通过；5 个进程无监听，退出后全部结束 | [系统启动](validation/review-fix-launch-services.log) |
| 实际应用与实际 MHTML 副本 | 阅读视图 14/14、原网页 19/19 图片加载；旧缓存自动更新；外连 0，原文件未变 | [图片验证](validation/review-fix-mhtml.log) |
| `npm run check` | 三个固定 vendor SHA-256 通过 | [vendor](validation/review-fix-vendor.log) |
| 编译产物与交付包 | 20 个生产文件逐个 SHA-256 一致，图标一致 | [包指纹](validation/review-fix-build.json) |

没有保存截图文件。修改保留在 `electron-react`，没有 push 或修改 `main`。之前的界面调整见 [design-polish.md](design-polish.md)。
