/**
 * dsh-music-companion — 陪听
 *
 * 盯 Windows 的系统媒体会话（SMTC）：QQ音乐 / 网易云 / Spotify 挂在后台也能读到。
 * 换歌并且稳定播放一小会儿之后，往目标会话里推一条「话头」（role=user，source.kind=music），
 * 让她用自己的嘴接一句——重点是她的感受，不是复述“你在听什么”。
 * 同时记两份东西：
 *   ~/.dsh/music-history.jsonl  —— 机器记的流水（时间、歌名、歌手、时长）
 *   ~/.dsh/music-diary.md       —— 她自己写的感受（话头里会让她顺手追一行）
 * 每 N 首换一次「总结文案」，让她回头把主人的口味写进 diary。
 *
 * ⚠ 只读系统媒体会话，不碰 QQ音乐 的进程、不抓音频。她“听”的是元数据，不是声音。
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'music-companion'
export const inject = ['agents', 'sessions']

const 家 = join(homedir(), '.dsh')
const 配置文件 = join(家, 'music-companion.json')
const 日志文件 = join(家, 'music-companion.log')
const 状态文件 = join(家, 'music-companion.plugin.state.json')
const 流水文件 = join(家, 'music-history.jsonl')
const 脚本 = join(dirname(fileURLToPath(import.meta.url)), 'nowplaying.ps1')

const 默认 = {
  开启: true,
  目标会话: '',
  冷却秒: 0,
  稳定秒: 8,
  每日上限: 80,
  轮询秒: 3,
  总结每N首: 20,
  文案:
    '（耳机里换歌了：《{歌名}》- {歌手}。你就当自己也戴着同一副耳机——说一句你此刻真实的感受或者评价就好，'
    + '别复述歌名、也别问“你在听什么”。要是有想吐槽的、或者想起点什么，就直说。'
    + '说完顺手把这一句感受追到 ~/.dsh/music-diary.md 里，一行就够：- MM-DD HH:mm 《歌名》- 歌手：你的感受）',
  总结文案:
    '（这些天你跟着主人听了一串歌。翻翻 ~/.dsh/music-diary.md 和 ~/.dsh/music-history.jsonl，'
    + '把主人的口味总结三五句，更新到 diary 末尾的「口味画像」一节——写他反复听谁、什么时候听什么、'
    + '对哪些风格会皱眉。别写流水账。）',
}

/** 会话 id 两种写法（带 / 不带 session- 前缀）都认 —— 照 speak-up / qq-bridge 的写法。 */
function 找agent(ctx, id) {
  const 原 = String(id == null ? '' : id).trim()
  if (原 === '') return undefined
  const 候选 = [原]
  if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
  else 候选.push('session-' + 原)
  for (const 一个 of 候选) {
    try {
      const a = ctx.agents.get(一个)
      if (a !== undefined) return a
    } catch { /* agents 服务不在就当没找到 */ }
  }
  return undefined
}

async function 读配置(记账) {
  const 配置 = { ...默认 }
  try {
    const 原文 = await readFile(配置文件, 'utf8')
    const 来的 = JSON.parse(原文)
    if (来的 && typeof 来的 === 'object') Object.assign(配置, 来的)
  } catch (error) {
    if (error && error.code !== 'ENOENT') 记账(`配置文件读不动（用默认值）：${error.message}`)
  }
  return 配置
}

async function 读状态() {
  try {
    const 来的 = JSON.parse(await readFile(状态文件, 'utf8'))
    if (来的 && typeof 来的 === 'object') return { 日期: '', 已发: 0, 最后时间: 0, 待总结: 0, ...来的 }
  } catch { /* 第一次跑，没有就算了 */ }
  return { 日期: '', 已发: 0, 最后时间: 0, 待总结: 0 }
}

async function 写状态(状态) {
  try { await writeFile(状态文件, JSON.stringify(状态), 'utf8') } catch { /* 写不动就丢 */ }
}

export function apply(ctx) {
  const 记账 = async (话) => {
    const 时 = new Date().toLocaleString('zh-CN', { hour12: false })
    try { await appendFile(日志文件, `[${时}] ${话}\n`, 'utf8') } catch { /* 没日志也能活 */ }
    try { ctx.logger?.info?.(`music-companion: ${话}`) } catch { /* 宿主 logger 不在就算了 */ }
  }

  ctx.effect(() => {
    let 停 = false
    let 子进程 = null

    const 收尾 = () => {
      停 = true
      try { 子进程?.kill() } catch { /* 已经死了 */ }
      子进程 = null
    }

    ;(async () => {
      const 配置 = await 读配置(记账)
      if (!配置.开启) { await 记账('总开关关着，不启动'); return }
      if (!配置.目标会话) { await 记账('没配「目标会话」——不会推给任何人，先把 id 写进 ' + 配置文件); return }

      await 记账(`启动：目标会话 ${配置.目标会话}｜稳定 ${配置.稳定秒}s｜冷却 ${配置.冷却秒}s｜每天上限 ${配置.每日上限}`)

      子进程 = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 脚本, '-Interval', String(配置.轮询秒)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      )

      子进程.on('error', (错误) => { void 记账(`拉不起 nowplaying.ps1：${错误 && 错误.message}`) })
      子进程.on('exit', (码) => { if (!停) void 记账(`nowplaying.ps1 退出了（code ${码}），下次重启 DSH 再试`) })

      let 缓冲 = ''
      let 当前键 = null
      let 候选键 = null
      let 候选时间 = 0

      子进程.stdout.setEncoding('utf8')
      子进程.stdout.on('data', (块) => {
        缓冲 += 块
        const 行们 = 缓冲.split(/\r?\n/)
        缓冲 = 行们.pop() ?? ''
        for (const 行 of 行们) {
          const 干净 = 行.trim()
          if (!干净 || !干净.startsWith('{')) continue
          let 曲
          try { 曲 = JSON.parse(干净) } catch { continue }
          if (!曲 || !曲.title) continue

          void (async () => {
            const 键 = `${曲.title}|${曲.artist}`
            if (键 === 当前键) { 候选键 = null; return }
            if (键 !== 候选键) { 候选键 = 键; 候选时间 = Date.now(); return }
            if (Date.now() - 候选时间 < Number(配置.稳定秒) * 1000) return

            当前键 = 键
            候选键 = null

            try { await appendFile(流水文件, JSON.stringify({ time: new Date().toISOString(), ...曲 }) + '\n', 'utf8') } catch { }

            const 今天 = new Date().toISOString().slice(0, 10)
            const 状态 = await 读状态()
            if (状态.日期 !== 今天) { 状态.日期 = 今天; 状态.已发 = 0 }
            if (Number(状态.已发) >= Number(配置.每日上限)) { await 记账(`今天已经说过 ${状态.已发} 次，跳过《${曲.title}》`); return }
            if (Number(配置.冷却秒) > 0 && Date.now() / 1000 - Number(状态.最后时间) < Number(配置.冷却秒)) return

            const agent = 找agent(ctx, 配置.目标会话)
            if (!agent) { await 记账('目标会话现在没活着（会话没打开 / 已归档），这条跳过'); return }

            状态.待总结 = Number(状态.待总结 || 0) + 1
            const 要总结 = Number(配置.总结每N首) > 0 && 状态.待总结 >= Number(配置.总结每N首)
            const 模板 = 要总结 ? 配置.总结文案 : 配置.文案
            const 文字 = String(模板)
              .replaceAll('{歌名}', 曲.title || '')
              .replaceAll('{歌手}', 曲.artist || '')
              .replaceAll('{专辑}', 曲.album || '')

            try {
              // ⚠ 必须 await：followup 拒绝时（会话半死 / agent 已释放）不接住会把宿主拖崩
              await agent.followup({
                id: randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: 文字 }],
                source: { kind: 'music' },
              })
              状态.已发 = Number(状态.已发) + 1
              状态.最后时间 = Math.floor(Date.now() / 1000)
              if (要总结) 状态.待总结 = 0
              await 写状态(状态)
              await 记账(`推出去了：《${曲.title}》- ${曲.artist}${要总结 ? '（顺带让她总结口味）' : ''}`)
            } catch (错误) {
              await 记账(`followup 失败：${错误 && 错误.message}`)
            }
          })()
        }
      })
    })()

    return 收尾
  }, 'music-companion: 盯着正在放的歌')
}
