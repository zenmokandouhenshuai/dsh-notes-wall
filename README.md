# 便签墙 · Sticky Notes for DeepSeek Harness

一个给 [DeepSeek Harness](https://github.com/)（DSH）用的便签墙插件：左侧栏一个入口，随手记灵感与待办，六种纸色，一键置顶/重点/删除；**可以把单张便签固定到 Windows 桌面上，始终压在所有窗口之上，最小化 DSH 也还在**。

> 这是一个 DSH bundle 插件（Host + Client 两半），不是独立应用。

## 功能

- **左侧栏入口**：便签墙作为主面板，和「插件」「自动化任务」并列。
- **随手记**：回车即存，Shift+Enter 换行；输入框里先挑底色，输入框会跟着变色。
- **六种纸色**：奶油黄 / 米白 / 薄荷 / 天蓝 / 蜜桃 / 薰衣草，已存在便签可随时换色。
- **置顶 / 重点 / 一键删除**：置顶排最前，重点高亮，删除不弹确认。
- **桌面便签（Windows）**：点卡片上的「屏幕」图标，弹出一个无边框、始终置顶的独立小窗；可拖动、可拖边角改大小、可滚轮/拖滑轨滚动；右上角 `×` 取消固定。
- **持久化**：所有便签写入 `$DSH_HOME/dsh-notes/notes.json`，重启、换浏览器都在。

## 安装

需要已经装好 DSH（本插件在 DSH 0.2.x 上开发）。

1. 把本仓库放到一个**不含空格**的路径下，例如 `D:\.dsh-plugins\dsh-notes`；
2. 在 DSH 的「插件」页用「添加」指向该目录，或命令行：

   ```bash
   dsh plugin --profile <你的 profile> add "link:D:/.dsh-plugins/dsh-notes"
   ```

3. 重启 DSH，左侧栏出现便签图标。

> 桌面便签部分依赖 Windows 的 PowerShell + WinForms；面板本身跨平台，非 Windows 上固定便签会退化为「窗口内的浮动卡片」。

## 使用

| 操作 | 位置 |
| --- | --- |
| 新建便签 | 顶部输入框，回车或点「添加到墙上」 |
| 换底色 | 输入框底部圆点（新便签）／卡片上的调色盘图标（已有便签） |
| 置顶 | 卡片上的图钉 |
| 标重点 | 卡片上的星标 |
| 删除 | 卡片上的垃圾桶（立即删除） |
| 固定到桌面 | 卡片上的屏幕图标；桌面小窗右上角 `×` 取消 |

## 数据与文件

- 便签数据：`$DSH_HOME/dsh-notes/notes.json`
- 桌面小窗的位置与大小：`$DSH_HOME/dsh-notes/widget-pos.json`
- 挂件进程 PID：`$DSH_HOME/dsh-notes/widget.pid`（用于避免重复实例）
- 包里还有 `widget.ps1`（桌面小窗）与 `test/smoke.mjs`（Host 存储逻辑的自测）

## 目录结构

```
index.js            Host 半：笔记存储 + JSON 路由 + 拉起/停止桌面挂件
client.js           Client 半：侧栏图标、便签墙面板、窗内浮动卡片
widget.ps1          Windows 桌面便签（WinForms，无边框置顶窗口）
cordis.patch.yml    bundle 补丁：插入一行插件
locale/{zh,en}.json 插件管理页显示的标题与描述
icon.svg            插件图标
test/smoke.mjs      Host 路由与存储的自测（node test/smoke.mjs）
```

## 自测

```bash
node test/smoke.mjs
```

覆盖：空状态读取、写入往返、空白便签丢弃、颜色白名单、缺失 `notes[]`、非法方法、2000 条上限、磁盘落盘、坏文件降级。

## License

MIT，见 [LICENSE](LICENSE)。
