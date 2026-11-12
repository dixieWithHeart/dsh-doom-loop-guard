"""Generate short, urgent alert WAVs for dsh-doom-loop-guard.

风格约束：短音型（< 0.35 s）+ 硬起音 + 高频，按固定周期重复到约 6 秒——
命中推理死循环属于严重事故，一声提示容易被漏掉。

加法合成 + 指数包络，与 dsh-notify-chime 的 make_sounds.py 同一套思路，
无外部采样素材，随包以 MIT 分发。

用法：
  python tools/make_alerts.py            # 生成全部
  python tools/make_alerts.py ticks      # 只生成一个
"""

import math
import os
import struct
import sys
import wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
# 循环参数：每 0.8 s 响一次，共 7 次 → 5.6 s
PERIOD = 0.80
REPEAT = 7


def midi(note: float) -> float:
    """MIDI note -> frequency."""
    return 440.0 * (2.0 ** ((note - 69) / 12.0))


def render(notes, length, gain=0.50, decay=20.0, attack=0.0015, harmonics=(1.0,), sr=SR):
    """notes: [(midi, start_s, dur_s, scale), ...]；attack 越小越硬。"""
    total = int(sr * length)
    buf = [0.0] * total
    for note, start, dur, scale in notes:
        f0 = midi(note)
        i0 = int(start * sr)
        n = int(dur * sr)
        for i in range(n):
            idx = i0 + i
            if idx >= total:
                break
            t = i / sr
            env = (1.0 - math.exp(-t / attack)) * math.exp(-decay * t)
            phase = 2.0 * math.pi * f0 * t
            s = 0.0
            for k, weight in enumerate(harmonics, start=1):
                if weight:
                    s += weight * math.sin(k * phase)
            buf[idx] += s * env * scale
    return normalize(buf, gain)


def normalize(buf, gain):
    peak = max((abs(v) for v in buf), default=0.0) or 1.0
    norm = gain / peak
    frames = bytearray()
    for v in buf:
        x = max(-1.0, min(1.0, v * norm))
        frames += struct.pack("<h", int(x * 32767))
    return bytes(frames)


def repeat_notes(notes, period, times):
    """把一个音型按固定周期平铺 times 次。"""
    out = []
    for i in range(times):
        offset = i * period
        out.extend((note, start + offset, dur, scale) for note, start, dur, scale in notes)
    return out


def write(name, data, sr=SR):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data)
    print(f"{name:18} {len(data) // 2 / sr:5.2f}s  {len(data) + 44:>7} bytes")


# ── 候选定义 ────────────────────────────────────────────────────────────────
# 写这些时只盯三个问题：是否够短、起音是否够硬、重复是否够急。
SETS = {
    # 双脉冲：最直接的“滴滴”，两声之间几乎不留缝
    "pulse": dict(
        gain=0.55, decay=24.0, attack=0.0012,
        harmonics=(1.0, 0.30, 0.08),
        notes=[(88, 0.00, 0.055, 1.00), (88, 0.075, 0.055, 1.00)],
    ),
    # 三连方波：8-bit 味，密集三下
    "triple": dict(
        gain=0.50, decay=28.0, attack=0.0010,
        harmonics=(1.0, 0.0, 0.40, 0.0, 0.20),
        notes=[(91, 0.00, 0.040, 1.00), (91, 0.060, 0.040, 1.00), (91, 0.120, 0.040, 1.00)],
    ),
    # 急升三音：音高一级级抬起来，像催
    "rise": dict(
        gain=0.52, decay=22.0, attack=0.0012,
        harmonics=(1.0, 0.22, 0.06),
        notes=[(83, 0.00, 0.050, 0.85), (88, 0.060, 0.050, 0.95), (93, 0.120, 0.090, 1.00)],
    ),
    # 刺音：一下极短的高音钉住，再补一个下行短尾
    "sting": dict(
        gain=0.55, decay=18.0, attack=0.0010,
        harmonics=(1.0, 0.18, 0.05),
        notes=[(96, 0.00, 0.030, 1.00), (88, 0.050, 0.140, 0.90)],
    ),
    # 五连滴答：最急的一组，适合“必须马上停”
    "ticks": dict(
        gain=0.50, decay=34.0, attack=0.0008,
        harmonics=(1.0, 0.10),
        notes=[(96, 0.00, 0.016, 1.00), (96, 0.050, 0.016, 0.95), (96, 0.100, 0.016, 0.95),
               (96, 0.150, 0.016, 1.00), (96, 0.200, 0.024, 1.00)],
    ),
    # 交替双音：高低交替四声，警报告警感
    "alarm": dict(
        gain=0.52, decay=20.0, attack=0.0012,
        harmonics=(1.0, 0.25, 0.08),
        notes=[(92, 0.00, 0.045, 1.00), (85, 0.060, 0.045, 0.95),
               (92, 0.120, 0.045, 1.00), (85, 0.180, 0.070, 0.95)],
    ),
}


def main(argv):
    wanted = [name for name in argv[1:] if name in SETS]
    unknown = [name for name in argv[1:] if name not in SETS]
    if unknown:
        print(f"unknown set: {', '.join(unknown)}（可用：{', '.join(SETS)}）")
        return 2
    for name in (wanted or list(SETS)):
        spec = dict(SETS[name])
        notes = repeat_notes(spec.pop("notes"), PERIOD, REPEAT)
        length = PERIOD * REPEAT
        data = render(notes, length, sr=spec.pop("sr", SR), **spec)
        write(f"{name}.wav", data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
