"""Check the generated alert WAVs: duration, peak, and that every repeat is audible.

用法：python tools/check_alerts.py
退出码：0 = 全部正常；1 = 有文件不符合预期。
"""

import os
import struct
import sys
import wave

# 循环参数与音色名单从生成脚本导入，避免两处各写一份（改生成参数后本检查自动跟随）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_alerts import PERIOD, REPEAT, SETS  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(HERE, "assets")
EXPECTED = PERIOD * REPEAT


def peak_of(frames, start, end):
    best = 0
    for i in range(start, min(end, len(frames))):
        value = abs(struct.unpack_from("<h", frames, i * 2)[0])
        if value > best:
            best = value
    return best


def check(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        frames = w.readframes(w.getnframes())
        n = w.getnframes()
    duration = n / sr
    overall = peak_of(frames, 0, n)
    per_cycle = []
    for i in range(REPEAT):
        start = int(i * PERIOD * sr)
        end = int((i * PERIOD + 0.35) * sr)
        per_cycle.append(peak_of(frames, start, end))
    return sr, duration, overall, per_cycle


def main():
    failed = 0
    for name in SETS:
        path = os.path.join(ASSETS, f"{name}.wav")
        if not os.path.exists(path):
            print(f"FAIL {name}: 文件不存在")
            failed += 1
            continue
        sr, duration, overall, per_cycle = check(path)
        ok = (
            sr == 22050
            and abs(duration - EXPECTED) <= 0.03
            and 0.40 <= overall / 32767 <= 0.60
            and all(p > 0 for p in per_cycle)
        )
        status = "ok  " if ok else "FAIL"
        print(f"{status} {name:7} {duration:4.2f}s  peak {overall / 32767:4.0%}  每段峰值 "
              + " ".join(f"{p // 1000}k" for p in per_cycle))
        if not ok:
            failed += 1
    print(f"\n{len(SETS) - failed}/{len(SETS)} 通过")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
