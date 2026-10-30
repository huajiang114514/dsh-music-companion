# dsh-music-companion ｜ 陪听

> QQ 音乐还挂在后台，她那边已经换了一首歌的心情。

`dsh-music-companion` 是 DeepSeek Harness（DSH）的一个插件：读 Windows 的系统媒体会话（SMTC），
检测到你换歌之后，往目标会话里推一句"话头"，让 DSH 里的她用自己的嘴接一句。
推的是**她的感受**，不是"你正在听《xx》"这种复读。

只听元数据（歌名 / 歌手 / 专辑 / 进度 / 播放状态），**不抓音频**——她"听"的是歌名，
不是声音；但她可以就着这首歌聊天、吐槽、讲自己想到的事。

## 效果

```
[10-30 11:47:23] 推出去了：《逍遥仙》- 三无Marblue
```

她收到的不是"用户说：我在听逍遥仙"，而是：

> （耳机里换歌了：《逍遥仙》- 三无Marblue。你就当自己也戴着同一副耳机——说一句你此刻真实的感受或者评价就好，
> 别复述歌名、也别问"你在听什么"。要是有想吐槽的、或者想起点什么，就直说。说完顺手把这一句感受追到
> ~/.dsh/music-diary.md 里……）

## 安装

```bash
# 直接从 GitHub 装（推荐，不需要 npm）
dsh plugin --profile desktop add "github:huajiang114514/dsh-music-companion"

# 或者用 Release 里的 tgz
dsh plugin --profile desktop add "file:C:\path\dsh-music-companion-0.1.0.tgz"

# 本地改代码用 link
dsh plugin --profile desktop add "link:C:\path\to\dsh-music-companion"
```

装完在 `~/.dsh/music-companion.json` 里写配置（不写也能跑，用默认值），重启 DSH 生效。

> 这个包没有发到 npm，所以 `add dsh-music-companion` 会 404，用上面的 GitHub / tgz 写法。

## 配置

`~/.dsh/music-companion.json`，所有字段都可省略：

| 字段 | 默认 | 说明 |
|---|---|---|
| `开启` | `true` | 总开关 |
| `目标会话` | `""` | **必填**。`session-xxxxxxxx-...`，带不带 `session-` 前缀都行 |
| `稳定秒` | `8` | 换歌后稳定放这么多秒才开口（防止快速切歌时连环轰炸） |
| `冷却秒` | `0` | 两次开口之间的最小间隔；0 = 每首都聊 |
| `每日上限` | `80` | 一天最多开口几次（省钱 + 防吵） |
| `轮询秒` | `3` | 多久看一眼播放器 |
| `总结每N首` | `20` | 每 N 首换成"总结口味"的文案；0 = 关闭 |
| `文案` | 见源码 | 单首的话头，占位符 `{歌名}` `{歌手}` `{专辑}` |
| `总结文案` | 见源码 | 每 N 首用一次的话头 |

会话 id 从哪来：DSH 设置里打开会话，地址栏 / 会话信息里有 `session-...`；
或者看 `~/.dsh/sessions/` 下的目录名。

## 它会写出什么

| 文件 | 谁写的 | 内容 |
|---|---|---|
| `~/.dsh/music-history.jsonl` | 插件 | 每条：ISO 时间、歌名、歌手、专辑、时长、播放器 |
| `~/.dsh/music-diary.md` | **她自己** | 每首歌一句感受；末尾一节「口味画像」 |
| `~/.dsh/music-companion.log` | 插件 | 推没推、为什么没推、报错 |

## 注意

- **仅 Windows**：用的是 WinRT 的 `Windows.Media.Control`，靠 `powershell.exe` 读。
- 播放器要支持系统媒体控制（QQ音乐、网易云、Spotify、Windows 媒体播放器都支持；
  某些老播放器 / 网页播放器可能读不到，读不到就安静地什么都不做）。
- 她在那个会话里说的话，如果同时装了 QQ 桥一类的转发插件，**也会被转去 QQ**。
  不想要那条线的话，在转发插件里关掉这个会话，或者让音乐话题走另一个会话。
- 成本：按 DeepSeek 的价格，一次开口大约一分钱（上下文绝大部分命中缓存）。

## 分享 / 发布

这个目录本身就是一个 DSH 插件包，三种分发方式都行：

```bash
# 1. Git 仓库（当前用的）
dsh plugin --profile desktop add "github:huajiang114514/dsh-music-companion"

# 2. 打成 tgz 发给别人
npm pack
dsh plugin --profile desktop add "file:C:\path\dsh-music-companion-0.1.0.tgz"

# 3. 以后想发 npm 也行（需要账号开 2FA）
npm publish --access public
```

如果哪天发了 npm，别人就可以直接 `dsh plugin --profile desktop add dsh-music-companion`。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-music-companion
```

`~/.dsh/music-history.jsonl` 和 `music-diary.md` 不会被删——那是你的听歌史，留着吧。
