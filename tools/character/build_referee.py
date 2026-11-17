"""
build_referee.py - 심판 선생님을 코드만으로 만들어 src/app/assets/referee.glb (와 가벼운 벌 referee-lite.glb)로 내보낸다.

실행(프로젝트 루트에서):
    /home/claude/bpy-lab/venv/bin/python tools/character/build_referee.py

만드는 순서는 builder.py(아이와 같다), 생김새는 chars/referee.py, 동작은 clips_referee.py 에 있다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import builder  # noqa: E402
from chars import referee  # noqa: E402

if __name__ == '__main__':
    builder.build(referee.SPEC)
    # 낮은 화질 단계용의 가벼운 벌(referee-lite.glb). 메시와 뼈, 동작의 이름은 같다.
    builder.build(referee.SPEC_LITE)
