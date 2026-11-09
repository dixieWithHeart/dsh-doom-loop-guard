# dsh-doom-loop-guard

检测推理中的重复循环（doom loop），命中时提醒、截断或响铃，并生成历史报告。

## 能力

- **实时**：包装 `llm/stream`，检测破折号填充、括号嵌套、短句重复
- **处置**：`observe` 只记录 / `nudge` 注入提醒 / `cut` 截断并自动续跑
- **门槛**：上下文占用达到设定百分比后才生效
- **音效**：命中响铃，内置 `assets/loop-alert.mp3`
- **报告**：扫描会话存档，给出会话 doom 分与 14 天趋势

## 防护等级

| 等级 | 破折号 | 括号 | 短句重复 | 间隔 | 占比 |
| --- | --- | --- | --- | --- | --- |
| 宽松 | 1200 | 300 | 20 | 6 | 8% |
| 普通 | 800 | 200 | 15 | 8 | 5% |
| 敏感 | 500 | 120 | 10 | 12 | 3% |

普通档为校准值：1.4 万条真实推理上召回 100%、误报 0。

## 配置

写在 profile 的 `cordis.patch.yml`（id `dsh-doom-loop-guard`），或在设置页改；设置页写入 `~/.dsh/dsh-doom-loop-guard.json`。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `preset` | `standard` | `relaxed` / `standard` / `sensitive` |
| `intervention` | `nudge` | `observe` / `nudge` / `cut` |
| `warnAbovePercent` | `0` | 生效门槛，0 为全程 |
| `autoResume` | `true` | `cut` 后自动续跑 |
| `maxConsecutiveCuts` | `3` | 连续截断上限 |
| `soundEnabled` | `true` | 音效 |
| `soundPath` | `''` | 自定义音频，留空用内置 |
| `reportDays` / `reportLimit` | `7` / `20` | 历史扫描范围 |

阈值由等级决定，也可在 patch 里直接写 `maxDashRun` / `maxParenRun` / `shortSentenceRepeat` / `maxRepeatGap` / `shortRepeatRatio` 覆盖。

## 界面语言

设置页文案有中文与英文两套，跟随 DSH 界面语言（设置 → 常规 → 语言）即时切换，不需重启。插件清单里的名称与描述另由 `locale/zh.json` / `locale/en.json` 提供。

宿主若缺 locale 服务（精简组合），界面退回中文并在控制台留一条 warn。

## 安装

```powershell
dsh plugin --profile <profile> add dsh-doom-loop-guard
```

开发时用 `install_bundle` 指向本目录。

要求 DSH >= 0.2.1、Node >= 22.15（用到内置 zstd 解压）。

## 与 dsh-loop-rescue

同现象、不同检测器。1.4 万条样本上，本插件召回 100%、loop-rescue 60.5%，后者漏的主要是纯符号填充。

两者都包装 `llm/stream`：`cut` 与 loop-rescue 同时开会重复截断，二选一。

## 边界

- 只覆盖符号崩坏与低信息循环，不含语义打转
- `nudge` 的提醒落到下一步请求；`cut` 才能当场中断
