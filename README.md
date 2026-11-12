# dsh-doom-loop-guard

检测推理中的重复循环（doom loop），命中时提醒、截断或响铃，并生成历史报告。

## 能力

- **实时**：包装 `llm/stream`，检测破折号填充、括号嵌套、短句重复；标点刷屏（连续感叹号/问号）作为弱信号只进报告
- **处置**：`observe` 只记录 / `nudge` 注入提醒 / `cut` 截断并自动续跑
- **门槛**：上下文占用达到设定百分比后才生效
- **音效**：命中响铃约 5.6 秒（六套短促音色重复 7 次，可切换试听），全部由 `tools/make_alerts.py` 合成
- **系统通知**：命中时弹桌面通知（可开关，Windows Toast / macOS / Linux）
- **报告**：扫描会话存档，给出会话 doom 分与 14 天趋势

## 防护等级

| 等级 | 破折号 | 括号 | 短句重复 | 间隔 | 占比 |
| --- | --- | --- | --- | --- | --- |
| 宽松 | 1200 | 300 | 20 | 6 | 8% |
| 普通 | 800 | 200 | 15 | 8 | 5% |
| 敏感 | 500 | 120 | 10 | 12 | 3% |

普通档为校准值：1.4 万条真实推理上召回 100%、误报 0。

> 弱信号：连续同一感叹号/问号 ≥ `weakPunctRun`（默认 20）只记入历史报告，不响铃、不注入。这类文本只有长度、没有语义，只作线索。

## 配置

写在 profile 的 `cordis.patch.yml`（id `dsh-doom-loop-guard`），或在设置页改；设置页写入 `~/.dsh/dsh-doom-loop-guard.json`。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `preset` | `standard` | `relaxed` / `standard` / `sensitive` |
| `intervention` | `nudge` | `observe` / `nudge` / `cut` |
| `warnAbovePercent` | `50` | 生效门槛，0 为全程 |
| `autoResume` | `true` | `cut` 后自动续跑 |
| `maxConsecutiveCuts` | `3` | 连续截断上限 |
| `soundEnabled` | `true` | 音效 |
| `soundset` | `rise` | 内置音色：`pulse` / `triple` / `rise` / `sting` / `ticks` / `alarm` |
| `soundPath` | `''` | 自定义音频，非空且存在时优先于 `soundset` |
| `notifyEnabled` | `true` | 命中时弹系统通知 |

### 音效

六套内置提示音都是「短音型 + 循环」：单次音型 0.20–0.32 s，每 0.8 s 响一次、共 7 次，总长 5.6 s（22.05 kHz 单声道 16-bit）。命中推理死循环属于严重事故，一声容易被漏掉。音频由 `tools/make_alerts.py` 合成，无外部素材：

```powershell
python tools/make_alerts.py          # 重新生成全部
python tools/make_alerts.py ticks    # 只生成一套
python tools/check_alerts.py         # 校验时长、峰值与每段可闻
```

| 音色 | 听感 |
|---|---|
| `pulse` | 双脉冲，最直接的「滴滴」 |
| `triple` | 三连方波，8-bit 味 |
| `rise` | 三音急升 |
| `sting` | 高音一钉 + 短尾 |
| `ticks` | 五连滴答，最急 |
| `alarm` | 高低交替四声 |

旧的 `assets/loop-alert.mp3` 保留仅作兜底（`soundset` 无效时才会用到）。

### 系统通知

命中时按当前处理方式弹一条通知：标题「推理死循环」，正文如「符号填充 · 已注入提醒」。与声音共用 `soundCooldownMs` 冷却，避免刷屏；`notifyEnabled: false` 只关通知，声音照常。宿主侧文案固定中文（不随界面语言切换）。
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
