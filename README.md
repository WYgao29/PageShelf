# 我的对话库

一个本机运行的 HTML/Markdown 对话统一入口。它不会搬动或改写源文件，只会扫描你指定的目录，在浏览器中把散落的对话整理成可搜索的记录。

## 启动

需要 Node.js 20 或更高版本。

执行 npm start，然后在电脑上打开 http://127.0.0.1:4321。服务默认只监听本机；如果要让同一 Wi-Fi 下的手机访问，需要显式配置访问令牌：

    AUTH_TOKEN='请换成一段足够长的随机字符串' HOST=0.0.0.0 npm start

然后在手机打开 `http://这台 Mac 的局域网 IP:4321/?token=你的令牌`。首次访问会把令牌保存为仅 HTTP Cookie，并跳转到不带令牌的地址；之后所有 API 和源文件请求都需要这个 Cookie 或 Bearer 令牌。

可以通过 PORT 和 HOST 环境变量修改端口和监听地址。非本机监听地址必须同时设置 AUTH_TOKEN。

## macOS 后台运行

如果不想每次打开终端，可以只安装一次 macOS 后台服务。它会在登录后自动启动，并在服务异常退出后自动拉起：

    npm run service:install

安装后直接在浏览器打开 `http://127.0.0.1:4321` 即可，不需要再次执行 `npm start`。常用管理命令：

    npm run service:status
    npm run service:stop
    npm run service:uninstall

服务只监听本机，日志保存在 `~/Library/Logs/html-conversation-library/`。如果以后移动了这个项目文件夹，需要在新的项目位置重新执行一次 `npm run service:install`。

## 添加内容目录

打开页面右下角或侧栏的“设置”，点击“选择文件夹…”即可从 macOS 文件夹选择器中选择目录；选择后再点击“添加并扫描”。如果选择器不可用，也可以手动填写文件夹路径。系统会递归扫描以下扩展名：

- HTML：.html、.htm
- MHTML：.mhtml、.mht（包含内嵌图片和样式的离线网页）
- Markdown：.md

同一扫描目录中相同相对路径的 HTML、MHTML 和 Markdown 会合并成一条记录，例如：

    对话/项目规划.html
    对话/项目规划.md

源文件继续留在原来的位置。配置保存在用户目录下的 .html-library/config.json，索引在服务启动时从源文件重新建立。

## 常用操作

- 搜索框同时搜索标题、文件名、目录名和正文。
- “重新扫描”会立即读取所有已配置目录中的最新内容。
- 将鼠标移到文章卡片上，会出现网页打开、Markdown 打开和删除三个操作；网页来源是 MHTML 时会显示“MHTML 打开”，并在新的浏览器标签页中保留离线页面的内嵌资源。Markdown 会打开独立的渲染阅读页，源 HTML 不允许执行脚本。
- 点击“删除”后确认，会同时删除这条记录关联的 HTML / MHTML / Markdown 源文件和索引，删除后无法恢复。
- 移除目录只会停止扫描，不会删除目录或其中的文件。

## 开发与验证

    npm test
    node --check src/server.js
    node --check public/app.js
    git diff --check

API 只读取显式配置的目录；源文件路由会再次验证记录对应的真实目录边界，并禁止通过符号链接读取边界外的文件。默认只允许本机访问；启用局域网访问时，所有请求都需要 AUTH_TOKEN 建立的会话。
