"""
build_all.py - 등장인물 모델을 모두 다시 만든다: 아이(kid.glb + 옷장 kid-wardrobe.glb), 심판(referee.glb, referee-lite.glb), 관중(audience.glb).

실행(프로젝트 루트에서):
    /home/claude/bpy-lab/venv/bin/python tools/character/build_all.py

한 프로세스에서 차례로 만든다(만들 때마다 블렌더 장면을 비운다). 끝에 파일 크기를 한데 모아 보여 준다.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import builder  # noqa: E402
import build_audience  # noqa: E402
import wardrobe  # noqa: E402
from chars import referee  # noqa: E402

if __name__ == '__main__':
    wardrobe.build()
    builder.build(referee.SPEC)
    builder.build(referee.SPEC_LITE)
    build_audience.main()
    assets = os.path.join(HERE, '..', '..', 'src', 'app', 'assets')
    print('---------------- 파일 크기')
    for name in ('kid.glb', 'kid-wardrobe.glb', 'referee.glb', 'referee-lite.glb', 'audience.glb'):
        print(f'  {name:18s} {os.path.getsize(os.path.join(assets, name)) / 1000:7.1f} kB')
