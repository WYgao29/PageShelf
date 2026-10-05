# v2 发布与回退清单

本轮仅在独立 worktree 实现和验收，生产后台服务未切换。本清单供获准发布时执行，未勾选项不代表已经完成。`ui-v2-p0` 至 `ui-v2-p4` 是本地实现快照。

## 发布前

- [x] 核心实现、自动化回归、真实 ID/源文件只读检查、Chrome/Safari 及布局证据齐备，见 [验证记录](html-library-v2.md)。
- [ ] 在 Edge 中完成测试与布局检查。本机未安装，不能计为通过。
- [ ] 复测 Finder 回退。本机脚本编译通过，原生调用两次超时；CLI 和「放回原处」已通过。只用专用文件，不操作真实文章。
- [ ] 选择长期保留的 checkout。LaunchAgent 记录绝对项目路径，投入后台使用后不要归档或移动该 worktree。
- [ ] 保存当前配置原始字节、已安装 plist、`service:status` 输出和日志大小/修改时间到独立发布备份目录。记录配置版本、完整目录及升级后的变更。
- [ ] 在待发布 checkout 跑必要回归：`npm test`、`npm run check`、`npm run test:browser`、`git diff --check`。有新失败再扩大相关检查。

手工浏览器入口使用临时合成资料，不接触生产配置和真实文章：

```sh
npm run test:browser -- --serve
```

在 Safari/Edge 打开输出的随机 loopback URL，等待明确结果，核对 pass/fail/skip 和 UA。结果保存为 `docs/verification/browser-浏览器-日期.json`。`Ctrl+C` 停止并清理临时环境。

## 切换服务

以下步骤更换已安装后台服务，仅在发布获授权后执行。

1. 从选定 checkout 停止旧服务并安装新服务：

   ```sh
   npm run service:stop
   npm run service:install
   npm run service:status
   ```

2. 核对新 plist 的 Node/项目路径及 `KeepAlive.SuccessfulExit=false`，确认 `4321` 只有一个监听进程，首页与 roots/items 可用。
3. 对照备份检查 48 条旧 ID、目录与系列。正常旧配置只读加载不写入；首次目录配置修改前必须产生字节一致的 `config.v1.bak.json`，不要为验收迁移而修改真实文章。
4. 同 checkout 再运行 `npm start`，确认只提示已运行、退出码 0。记录至少 60 秒日志增量，确认没有重启循环；保留原日志。
5. 检查旧 Markdown 阅读链接安全 302、阅读、搜索、目录管理及纯 Markdown 源文本；移除来源应保留文件。
6. 在用户下一次正常登录或重启后检查自动启动、单监听和日志。机器重启由用户安排，不在本轮自动执行。

## 回退

保留阶段 tag、配置备份、目录变更和源文章。回退使用独立 checkout 或明确切换到选定阶段，再从该路径安装服务；不用强制清理工作区。

| 场景 | 操作与核对 |
|---|---|
| 只回退三栏界面 | 选 P2 或后续阶段；停止服务、保留 v2 配置，再从回退 checkout 安装并验收 |
| 回到 P0 / 旧配置代码 | 停止服务，另存完整 v2 配置与新增目录清单，再恢复发布前 v1 备份；旧代码不得直接写回 v2 配置 |
| 升级后新增或重新定位的目录 | 对照另存清单人工恢复；v1 备份不包含这些变更 |
| 文件已移入废纸篓 | Finder「放回原处」后重扫；代码回退不会自动恢复文件 |

P0 及后续阶段保留可恢复废纸篓实现，不恢复旧版的源文件直接 `unlink` 删除流程。
