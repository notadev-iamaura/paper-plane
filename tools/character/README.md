# 등장인물 만들기 (코드로 하는 3D 모델링)

종이비행기 대회의 주인공 아이, 심판 선생님, 관람석 아이들을 **파이썬 코드만으로** 만들어 `src/app/assets/*.glb` 로 내보냅니다.
그림 파일도, 사람이 손으로 만든 모델 파일도 없습니다. 블렌더(Blender)를 "파이썬 모듈"로 불러 써서
화면 없이(headless) 모델링, 뼈대, 스키닝, 그늘 굽기, 동작, 내보내기까지 한 번에 합니다.

## 1. 준비: 블렌더를 파이썬 모듈로 설치

블렌더 프로그램을 따로 깔 필요가 없습니다. `bpy` 라는 파이썬 패키지가 곧 블렌더입니다.

```bash
# 파이썬 3.13 이 필요합니다(bpy 5.x 기준. bpy 판마다 맞는 파이썬 판이 정해져 있습니다)
python3.13 -m venv ~/bpy-lab/venv
~/bpy-lab/venv/bin/pip install bpy numpy
~/bpy-lab/venv/bin/python -c "import bpy; print(bpy.app.version_string)"   # 5.3.0 이 나오면 준비 끝
```

- 이 프로젝트를 만든 환경: `/home/claude/bpy-lab/venv` (bpy 5.3.0, Python 3.13, numpy 2.x)
- 그래픽 카드와 모니터가 없어도 됩니다. 그늘 굽기(Cycles)도 CPU 로 돕니다.
- 시작할 때 `Draco / MeshOptimizer is not available` 이라는 줄이 나와도 괜찮습니다(쓰지 않는 기능입니다).

## 2. 모델 다시 만들기

프로젝트 루트에서:

```bash
/home/claude/bpy-lab/venv/bin/python tools/character/build_kid.py        # 주인공 아이      -> src/app/assets/kid.glb + kid-wardrobe.glb(갈아입는 부분)
/home/claude/bpy-lab/venv/bin/python tools/character/build_referee.py    # 심판 선생님      -> referee.glb + referee-lite.glb(낮은 화질용)
/home/claude/bpy-lab/venv/bin/python tools/character/build_audience.py   # 관람석 아이 6 종 -> audience.glb(한 파일에 12 벌)
/home/claude/bpy-lab/venv/bin/python tools/character/build_all.py        # 전부 + 파일 크기 요약
```

하나에 3~6 초쯤(주인공은 갈아입는 부분마다 그늘을 따로 구워서 20 초쯤) 걸리고, 끝에 삼각형 수, 뼈 수, 클립 목록, 파일 크기가 찍힙니다.
중간에 `검사 ...` 줄은 동작마다 "팔이 몸통이나 머리를 파고드는지, 팔꿈치와 무릎이 얼마나 접히는지"를 잰 값입니다(음수가 크면 자세를 손봐야 합니다).
결과 파일은 게임을 빌드할 때 함께 묶입니다.

## 3. 파일 구성

만드는 순서는 하나(`builder.py`)이고, 캐릭터마다 다른 것은 "생김새 파일"(`chars/*.py`)과 "동작 파일"(`clips_*.py`)뿐입니다.

| 파일 | 하는 일 |
| --- | --- |
| `builder.py` | 공통 순서: 부분 만들기 -> 합치기 -> 그늘 굽기 -> 뼈대와 스키닝 -> 동작 -> 내보내기(심판, 관중) |
| `wardrobe.py` | 주인공 전용 순서: 갈아입는 부분을 이름 붙은 메시로 따로 내보낸다(9 절) |
| `wardrobe_parts.py` | 갈아입는 부분의 모양: 머리 모양 8 가지, 썬캡, 머리띠, 비니, 벙거지, 치마, 멜빵, 후드, 지퍼 |
| `chars/kid.py` | 주인공의 생김새. **맨 위의 `P`(비율)와 `COLORS`(색), `AO`(그늘)만 고치면 모양이 바뀝니다.** |
| `chars/referee.py` | 심판 선생님의 생김새(3 등신 비율, 단발, 안경, 운동복, 호루라기, 기록판, 깃발) + 가벼운 벌 |
| `chars/audience.py` | 관람석 아이 6 종(머리 모양, 몸집, 옷)과 두 벌(lod0, lod1)의 촘촘함 |
| `clips_kid.py` / `clips_referee.py` / `clips_audience.py` | 동작(자세 함수) |
| `build_kid.py` / `build_referee.py` / `build_audience.py` / `build_all.py` | 실행 파일(얇은 껍데기) |
| `meshkit.py` | 모델링 도구: 고리 쌓기(loft), 사각형 공, 세분화, 조각 붓, 메시 점검 |
| `parts.py` | 부분 함수: 머리, 윗옷, 팔과 손, 바지, 다리, 신발, 모자, 머리카락, 안경, 띠(지퍼, 목걸이 줄), 판(기록판, 깃발) |
| `rig.py` | 뼈대, 부분 합치기, 가중치 정리(꼭짓점당 최대 4 개. 관중은 2 개) |
| `shading.py` | 틈새 그늘(AO)을 구워 꼭짓점 색에 넣기. 관중은 색 대신 "부분 번호"를 적는다 |
| `anim.py` | 자세 -> IK 풀이 -> 키프레임(캐릭터 공통). 손에 쥔 소품의 방향도 여기서 푼다 |
| `glbpack.py` | 내보낸 GLB 의 용량 줄이기 |
| `wire_view.py` | 면 흐름(사각형 그대로)을 SVG 그림으로 남기기 |

### 같은 부분 함수로 다른 캐릭터를 만드는 손잡이

- `P['zmap']` : 아이의 고리 높이를 다른 비율의 몸으로 옮기는 표(발목, 무릎, 가랑이, 엉덩이, 밑단, 어깨, 목). 심판은 이것으로 다리와 몸이 길어집니다.
- `P['torso_w']`, `neck_w`, `leg_w` : 몸통, 목, 다리의 둘레 배율.
- `P['top']` : `long`(긴소매 + 소매 끝 고무단), `band`(소매 띠), `hem_band`(밑단 고무단), `collar_up`(세운 깃).
- `P['bottom']` : `long`(긴바지 + 바짓단).
- `P['cap']`(모자를 쓰는지), `P['hairline']`(머리선. `flare` = 단발의 뻗침, `ear_from`/`ear_to` = 옆머리가 귀를 덮는 구간), `P['hair_extras']`(양 갈래, 똥머리 같은 덩이).
- `P['glasses']`, `P['clipboard']`, `P['flag']` : 있으면 안경, 기록판(`prop.L` 뼈), 손깃발(`prop.R`, `flag` 뼈)을 만든다.
- `P['detail']` : 촘촘함. `levels`(세분화 횟수), 고리의 점 수, `folds`(옷 끝단의 속 접힘), `thumb`, `shoe`, `lite`. 관중과 가벼운 심판은 이것만 낮춘 것이다.

## 4. 만드는 방법(단계별)

1. **틀 만들기**: 단면 고리를 차례로 쌓아 관 모양의 거친 틀을 만듭니다(예: 윗옷은 16 각 고리 14 개).
   소매와 엄지는 옆면의 칸 몇 개를 열고 새 고리를 이어 붙여 "한 장으로 이어진 면"으로 뽑아냅니다.
   반바지는 엉덩이 고리를 가랑이 점 하나로 좌우 두 고리로 가릅니다.
2. **세분화**: Subdivision Surface(Catmull-Clark)를 실제로 적용해 매끈하게 만듭니다. 전부 사각형입니다.
3. **조각**: 넘파이로 꼭짓점을 직접 밉니다. 볼과 코는 부풀리기 붓, 턱은 끌기 붓, 얼굴 면은 살짝 평평하게.
4. **옷의 끝단은 진짜 모양**: 밑단, 소매 띠, 바지 끝, 양말 목, 신발 밑창은 색만 바꾼 것이 아니라 한 겹 접혀 들어간 턱입니다.
   팔, 다리, 목은 그 안으로 들어가 있습니다(게임 캐릭터를 만들 때 흔히 쓰는 "옷 속의 몸은 지운다" 방식).
5. **머리카락**: 머리 둘레를 따라 세로 띠 64 줄을 세워 만든 껍데기입니다. 맨 아래 고리가 곧 머리선(`hairline`)이라
   앞머리의 둥근 가닥, 귀 앞머리, 목덜미가 톱니 없이 또렷합니다. 끝은 두피 쪽으로 말려 들어가 실제 두께가 보이고 그 밑에 그늘이 집니다.
   가닥 수, 길이, 두께는 `P['hairline']` 숫자로 정합니다. 머리카락과 모자에 가려진 머리 면은 지웁니다.
6. **모자**: 뒤로 젖힌 평면으로 머리를 자른 단면을 계산해 그 타원을 모자 테로 씁니다. 그래서 테가 머리에 딱 맞습니다.
7. **그늘 굽기(AO)**: Cycles 로 꼭짓점 색에 굽습니다(안 되면 광선을 직접 쏘는 방법으로 자동 전환).
   옅은 그늘은 버리고 진짜 틈새만 남긴 뒤, 살은 복숭아빛, 흰 옷은 연보라 쪽으로 물들여 바탕색에 곱합니다.
8. **뼈대와 가중치**: 틀을 만들 때 고리마다 "이 고리는 위팔 50% + 아래팔 50%" 처럼 적어 둔 값이 세분화를 거치며 부드럽게 퍼집니다.
   자동 가중치보다 결과가 일정하고, 팔이 가슴을 끌고 가는 일이 없습니다.
9. **동작**: `clips_*.py` 의 자세 함수가 "몸을 얼마나 틀었나, 손과 발이 어디 있나"를 내놓으면 풀이기가 뼈 회전으로 바꿉니다.
   손과 발은 두 마디 IK 로 풀어서 발이 바닥에서 미끄러지지 않습니다. 초당 20 프레임으로 키를 찍습니다.
10. **내보내기**: glTF(GLB)로 내보낸 뒤 색, 가중치, 법선, 회전을 작은 정수로 바꿔 용량을 줄입니다.

## 5. 자주 하는 수정

- **색 바꾸기**: `chars/*.py` 의 `TOK` 는 `src/app/tokens.css` 와 같은 값이어야 합니다. 토큰을 바꾸면 여기도 바꾸고 다시 실행하세요.
- **비율 바꾸기**: `P` 의 `head_r`(머리 크기), `arm_r`/`hand_r`(팔 굵기, 손 크기), `tummy`/`butt`(배, 엉덩이), `crotch_z`(바지 길이) 등.
  관절 높이(`hip_z`, `knee_z` 등)를 바꾸면 뼈대도 같이 바뀝니다. 관중은 뼈대를 함께 쓰므로 관절 높이를 변형마다 바꾸면 안 됩니다.
- **머리 모양**: `P['hairline']` 의 `fringe_z`(앞머리 길이), `fringe_wave`(가닥 깊이), `fringe_width`(가닥 폭), `burn_z`(귀 앞머리 길이), `nape_z`(뒷머리 길이).
- **모자**: `cap_tilt`(젖힌 각도), `cap_h0`(얼마나 깊이 쓰나), `brim_len`(챙 길이).
- **얼굴**: 눈, 입, 볼 빨강은 게임이 그린다(`src/app/three/faceAtlas.ts`). 모델 쪽은 볼(`cheek`, `cheek_z`), 코(`nose_z`), 눈자리(`eye_socket`, `eye_px`)의 굴곡만 만든다.
  만들 때 `얼굴 그림에서의 자리` 줄이 찍힌다: 조각한 볼과 코가 얼굴 그림(256 x 192 칸)의 어디에 오는지다. 그림의 볼 빨강과 코 그늘을 그 자리에 맞춘다.
- **동작 고치기/추가**: `clips_*.py` 의 자세 함수를 고치거나 더하고, 맨 아래 목록에 `(이름, 함수, 길이, 되풀이, 지연)` 을 넣습니다.
  게임 쪽(`kidGlb.ts`, `refGlb.ts`, `crowdGlb.ts`)의 클립 목록과 이름이 같아야 합니다.
  조준할 때 비행기를 드는 자리는 `clips_kid.py` 의 `HA`, `HP` 와 `GymStage.ts` 의 `HOLD_AT`, `HOLD_PULL` 이 같은 값이어야 합니다.
- **외곽선이 지저분한 곳**: 좁은 틈(엄지와 손바닥 사이, 겨드랑이, 소매 속의 팔)은 `Part.set_thin(꼭짓점들, 0~1)` 로 외곽선을 얇게 합니다.
  이 값은 꼭짓점 색의 알파에 실려 가고, 게임의 외곽선 셰이더가 두께에 곱합니다.
- **그늘이 얼굴을 어둡게 할 때**: 그늘을 구울 때는 그 몸만 보이게 한다(`builder.make_body`). 얼굴 그림판이 얼굴을 가린 채로 구우면 얼굴 전체가 어두워진다.
  재질마다의 세기와 문턱은 `AO['by_color']` 의 `(세기, 물들이는 색, lo, hi)`.

## 6. 게임에서 쓰는 약속

### 아이(kid.glb, kid-wardrobe.glb)
- 메시 이름: `kid_face`(얼굴 그림판, UV 0~1), `kid_tag`(이름표 판, UV 0~1), 그리고 갈아입는 조각들(9 절의 표). 게임이 고른 조각을 `kid_body` 한 메시로 합쳐 그린다.
- 뼈 이름: `root, hips, spine, chest, neck, head, cap, shoulder.L/R, upper_arm.L/R, forearm.L/R, hand.L/R, thumb.L/R, hand_grip.L/R, upper_leg.L/R, lower_leg.L/R, foot.L/R`
  - `hand_grip.R` 이 종이비행기를 쥐는 점입니다.
- 클립: `Idle, Home, AimLow, AimMid, AimHigh, WindUp, Throw, Watch, Cheer, CheerHold, Nod, Slump`
  - `AimLow/Mid/High` 는 조준 각도 -20 / 20 / 60 도의 멈춘 자세(게임이 각도에 맞춰 섞습니다).
  - `WindUp` 은 0~1 초 = 당긴 정도 0~1 (게임이 시간을 직접 넣습니다).
  - `Throw` 는 0~1 초 뒤로 젖힘, 1~2 초 휘두름, 2~3 초 마무리(게임이 던지기 진행도에 맞춰 시간을 넣습니다. 실제로는 약 1 초에 지나갑니다).
- 얼굴 표정은 모델에 들어 있지 않습니다. 게임이 캔버스에 그린 표정 묶음(`faceAtlas.ts` 의 `makeFaceAtlas2`)을 `kid_face` 에 붙입니다.
- 좌표: 모델은 glTF 관례대로 +Y 위, +Z 앞. 게임은 +X 가 앞이라 불러올 때 90 도 돌립니다. 크기는 키 = 1 (게임이 1.64 배로 키웁니다).

### 심판(referee.glb, referee-lite.glb)
- 메시 이름: `referee_body`, `referee_face`. 뼈는 아이와 같고(모자 뼈 없음) `prop.L`(기록판), `prop.R`(깃발), `flag`(깃발 천)가 더 있다.
- 클립: `Idle, WatchPlane, RaiseFlag, PointToLanding, Clap, WalkCycle`
  - `RaiseFlag`, `PointToLanding` 은 0~0.5 초가 한 번 하는 동작이고 0.5~1.5 초를 되풀이한다(게임이 시간을 넣는다).
  - `PointToLanding` 은 정면을 가리킨다. 착지 지점 쪽으로는 게임이 허리와 팔을 돌려 맞춘다.
  - `WalkCycle` 은 제자리 걷기다. 지금 게임에서는 쓰지 않는다(심판은 제자리에 서 있다).
- 두 파일은 이름과 뼈, 동작이 같고 촘촘함만 다르다. 낮은 화질 단계는 가벼운 벌만 내려받는다.

### 관중(audience.glb)
- 메시 이름: `aud_<short|pigtails|bob|cap|bun|spiky>_lod<0|1>`. 뼈 21 개, 클립 `SeatedIdle, CheerSmall, CheerBig`.
- 표준 스킨 메시가 아니다(용량을 줄이려고 바꿔 적었다). 게임의 `crowdGlb.ts` 만 읽을 수 있다.
  - 위치는 16 비트 정수(노드의 scale, translation 으로 되돌린다), 뼈는 `_JW` = (뼈 1, 뼈 2, 뼈 1 의 가중치 0~255), 뼈 순서는 `asset.extras.joints`.
  - 꼭짓점 색의 rgb = 그늘, 알파 = 부분 번호 x 32 + 외곽선 두께(0~31). 부분: 1 살, 2 윗옷, 3 바지, 4 머리카락, 5 깃발, 6 포인트 색, 7 깃대, 0 = 정해진 색.
  - 머리의 살 면에는 얼굴 그림의 UV, 그 밖에는 그림의 흰 여백을 가리키는 UV 가 적혀 있다.
- 뿌리(root)는 앉는 면이다. 얼굴은 +Z 를 본다.

## 7. 게임에서 켜고 끄기

새 모델이 기본입니다. 불러오는 동안에는 그 자리를 비워 두고, 불러오지 못하면(또는 몇 초 안에 안 오면) 예전 도형 인물이 대신 섭니다.

- 아이를 예전 도형으로: `localStorage['pp-kid'] = 'prim'` 또는 주소 끝에 `#kid-prim`
- 심판과 관중을 예전 도형으로: `localStorage['pp-cast'] = 'prim'` 또는 `#cast-prim` (`'ref'` = 심판만 새 모델, `'crowd'` = 관중만 새 모델)
- 실행 중에 아이 바꾸기: `window.__ppStage.debug.setKid('glb')` / `setKid('prim')`

## 8. 비교 그림 다시 찍기

```bash
npx vite build --outDir dist-cast
node scripts/shots-cast.mjs                    # screenshots/v5-cast/ 에 "이전 / 이후" 를 나란히 붙인 그림이 생깁니다
node scripts/shots-cast.mjs --only=face,aim --which=after     # 일부만, 이후 빌드만
node scripts/perf-cast.mjs --dir=dist-cast --label=after      # 단계마다 그리기 호출, 삼각형, 프레임 시간
node scripts/chk-kid-hold.mjs slow             # 모델이 늦게 올 때(자리를 비워 뒀다가 도형 아이 -> 모델) / fail = 불러오기 실패
```

"이전" 은 작업 전의 빌드(`dist-v4`)입니다. 예전 비교(도형 아이와 새 아이)는 `node scripts/shots-kid.mjs`.

## 9. 내 캐릭터 꾸미기: 갈아입는 주인공(wardrobe.py)

주인공은 머리 모양, 모자, 옷을 게임 안에서 바꿀 수 있다. 그래서 몸을 한 덩어리로 굽지 않고 **조각으로 나눠** 내보내고,
색은 굽지 않고 **게임이 입힌다**. 뼈대와 동작은 하나를 함께 쓴다.

### 파일 둘

| 파일 | 내용 | 언제 받나 |
| --- | --- | --- |
| `kid.glb` | 기본 차림(짧은 머리, 노란 학교 모자, 체육복) + 뼈대 + 동작 12 개 | 처음부터 |
| `kid-wardrobe.glb` | 나머지 머리 모양 7, 모자 4, 긴소매 윗옷, 긴바지, 치마, 멜빵, 후드, 지퍼, 멜빵용 이름표 판 | 꾸미기 화면을 열거나 기본이 아닌 차림일 때만 |

### 조각(메시) 이름

| 메시 | 무엇 | 뼈 |
| --- | --- | --- |
| `kid_head`, `kid_ears` | 머리(살), 귀 | head 하나 |
| `kid_core` | 목, 운동화 | 여러 뼈 |
| `kid_top_tee` / `kid_top_long` | 반소매 윗옷 + 맨팔 / 긴소매 윗옷 + 소매 팔 | 여러 뼈 |
| `kid_bot_short` / `kid_bot_long` | 반바지 + 다리 + 양말 / 긴바지 | 여러 뼈 |
| `kid_x_zip`, `kid_x_hood`, `kid_x_skirt`, `kid_x_bib` | 지퍼, 후드(+ 끈, 앞주머니), 치마, 멜빵(가슴판 + 멜빵 + 단추) | 여러 뼈 |
| `kid_hair_<short|bowl|spiky|bob|pigtails|ponytail|bun|long>` | 머리카락(덧붙임 포함) | head 하나 |
| `kid_hat_<cap|visor|band|beanie|bucket>` | 모자 | cap 또는 head 하나 |
| `kid_tag`, `kid_tag_bib` | 이름표 판(윗옷 위, 멜빵 가슴판 위) | chest |

뼈 하나에만 붙은 메시는 뼈 번호와 가중치를 빼고 내보낸다(용량). 어느 뼈인지는 `asset.extras.rigid` 에 적혀 있고 게임이 합칠 때 되살린다.
위치는 16 비트 정수로 줄여 적고(`kid_face`, `kid_tag*` 는 빼고), 메시 노드의 scale / translation 으로 되돌린다.

### 꼭짓점 색에 적는 것(색이 아니다)

| 채널 | 뜻 |
| --- | --- |
| R | 틈새 그늘 k. 게임이 계산하는 색 = 고른 색 x (1 - k + k x 그 부분의 그늘 색) |
| G | "덮는 것"이 있을 때만 더하는 그늘. 머리와 머리카락 <- 정수리를 덮는 모자, 반바지와 다리 <- 치마, 긴소매 윗옷 <- 후드 |
| B | 부분 번호(0~31) + 32("정수리" 표시: 정수리를 덮는 모자를 쓰면 게임이 그 면을 그리지 않는다) |
| A | 외곽선 두께(예전과 같다) |

- 부분 번호의 이름과 그늘 색은 `asset.extras.kid.slots` 에 적혀 있다(`wardrobe.py` 의 `SLOTS`, 게임의 `characterLook.ts` 의 `SlotName` 과 같아야 한다).
- `kid_head` 에는 색 묶음이 둘 더 있다(COLOR_1, COLOR_2): 머리 모양마다 앞머리가 이마에 드리우는 그늘이 달라서, 머리 모양 1~4 번의 k 는 COLOR_1 의 R, G, B, A, 5~7 번은 COLOR_2 의 R, G, B 에 적는다(순서는 `HAIR_ORDER`).

### 그늘을 굽는 방법(검은 자국이 남지 않게)

- 조각마다 **제 차림 속에서** 굽는다: 윗옷과 바지는 기본 몸 + 서로를 본 채로, 머리카락은 머리와 윗옷을 본 채로, 모자는 머리와 기본 머리카락을 본 채로.
- 머리는 **모자 없이** 굽는다(머리 모양마다 한 번씩). 모자가 드리우는 그늘은 G 채널에 따로 적어 두었다가 모자를 썼을 때만 더한다. 모자를 벗으면 그늘도 사라진다.
- 모자, 치마, 멜빵, 후드는 제 안쪽 면(챙 밑, 치마 속)에 스스로 그늘을 갖고 있다.
- 기본 차림(짧은 머리 + 학교 모자)은 k + G 가 "모자를 쓴 채로 구운 값"과 같아서 예전 주인공과 똑같이 보인다.

### 머리 모양과 모자가 만났을 때

- 정수리를 덮는 모자(학교 모자, 비니, 벙거지)를 쓰면 모자 테 평면보다 `CROWN_ABOVE`(2.2 cm) 넘게 위에 있는 머리카락 면은 그리지 않는다.
  똥머리와 삐죽 가닥은 정수리에 있어서 함께 모자 속으로 들어간다. 양 갈래와 묶은 머리는 테보다 아래에 달려 있어 모자 밑으로 나온다.
- 썬캡과 머리띠는 정수리가 열려 있어 머리카락이 그대로 보인다.
- 단발과 긴 머리는 귀를 덮으므로 귀를 그리지 않는다.
- 짝마다의 규칙은 게임의 `src/app/lib/characterLook.ts` 의 `HAIR_HAT` 표에 있다. 머리 모양이나 모자를 더하면 그 표와 `tests/characterLook.test.ts` 가 빠진 짝을 잡는다.

### 선택지를 더하려면

1. 머리 모양: `wardrobe_parts.hair_styles` 에 머리선 숫자와 덧붙임을 더하고 `wardrobe.HAIR_ORDER` 끝에 이름을 넣는다(여덟 가지를 넘으면 머리의 색 묶음을 하나 더 써야 한다).
2. 모자: `wardrobe_parts.py` 에 만드는 함수를 더하고 `wardrobe.build` 와 `HAT_ORDER` 에 넣는다. 정수리를 덮는 모자는 `cap` 뼈에, 열린 모자는 `head` 뼈에 붙인다.
3. 옷: 새 덧붙임 조각은 `kid_x_<이름>` 으로 내보내고, 게임의 `OUTFITS` 에 `extras` 로 적는다. 색 조합은 게임 쪽 표만 고치면 된다(모델을 다시 만들 필요가 없다).
4. 게임 쪽: `characterLook.ts` 의 목록에 같은 id 를 더한다. 눈 모양은 `faceAtlas.ts` 가 그린다(모델과 무관).
5. `build_kid.py` 를 다시 실행하고 `node scripts/shots-character.mjs` 로 모든 짝을 눈으로 확인한다.

### 꾸미기 갈무리와 검사

```bash
npx vite build --outDir dist-char
node scripts/shots-character.mjs          # screenshots/v7-character/ : 머리 x 모자, 옷, 눈, 피부색, 아무거나 12 번, 실제 놀이, 꾸미기 화면
node scripts/e2e-character.mjs            # 꾸미기 끝에서 끝까지(저장, 저장소 막힘, 모델 실패, 던지기)
npx vitest run tests/characterLook.test.ts
```

