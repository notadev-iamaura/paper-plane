"""
build_kid.py - 종이비행기 대회의 주인공 아이를 코드만으로 만들어 src/app/assets/kid.glb(기본 차림 + 뼈대 + 동작)와
               kid-wardrobe.glb(갈아입는 머리 모양, 모자, 옷)로 내보낸다.

실행(프로젝트 루트에서):
    /home/claude/bpy-lab/venv/bin/python tools/character/build_kid.py

만드는 순서는 wardrobe.py(갈아입는 부분을 따로 내보내는 주인공 전용 순서), 생김새(비율, 색, 그늘)는 chars/kid.py,
갈아입는 부분의 모양은 wardrobe_parts.py, 동작은 clips_kid.py 에 있다.
같은 순서로 심판 선생님(build_referee.py)과 관중(build_audience.py)도 만든다. 한꺼번에: build_all.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wardrobe  # noqa: E402

if __name__ == '__main__':
    wardrobe.build()
