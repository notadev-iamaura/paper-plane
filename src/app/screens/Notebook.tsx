/**
 * 연구 노트: 모눈 공책에 적은 비행기 분석.
 * 무게, 무게중심, 날개 넓이처럼 "재어 본 값(정확한 값)"과, 공기 힘 모형으로 "어림한 값(모형 추정값)"을 나눠서 적는다.
 * 어려운 말은 여기에만 나오고, 낱말마다 쉬운 풀이를 붙인다.
 */
import type { ReactNode } from 'react';
import { LIMITS, PHYSICS_VERSION } from '../../core/index';
import type { AeroSummary, PlaneDesign, SimResult } from '../../core/index';
import type { Evaluated } from '../lib/evaluation';
import { paperOf } from '../lib/design';
import { cm, fmt, pct } from '../lib/format';
import { NEAR_MISS_RATIO, VERDICT_TECH } from '../lib/kidvoice';
import type { LabNote } from '../lib/lab/labMath';
import { Dialog } from '../components/Dialog';
import { CgBar, PolarCharts, TrajectoryPlot } from '../components/NotebookFigures';

interface Props {
  design: PlaneDesign;
  ev: Evaluated;
  /** 가장 최근에 던진 비행(없으면 null) */
  lastResult: SimResult | null;
  onClose: () => void;
  /** 바람 실험실에서 적은 쪽지(없으면 null) */
  lab?: LabNote | null;
  /** 이 비행기를 바람 실험실에 올린다(갈 수 있을 때만 준다) */
  onLab?: () => void;
}

const PITCH_LABEL: Record<AeroSummary['pitchStability'], string> = {
  tumble: '뒤집힘 위험',
  marginal: '아슬아슬함',
  stable: '안정 활공',
  'nose-heavy': '급강하 경향',
};
const PITCH_TONE: Record<AeroSummary['pitchStability'], string> = { tumble: 'bad', marginal: 'warn', stable: 'good', 'nose-heavy': 'warn' };
const LATERAL_LABEL: Record<AeroSummary['lateralStability'], string> = { unstable: '불안정', neutral: '보통', stable: '안정' };
const LATERAL_TONE: Record<AeroSummary['lateralStability'], string> = { unstable: 'bad', neutral: 'warn', stable: 'good' };

interface RowProps { id: string; name: string; value: ReactNode; unit?: string; explain: string }

/** 표의 한 줄: 이름, 값, 그리고 쉬운 풀이 */
function Row({ id, name, value, unit, explain }: RowProps): JSX.Element {
  return (
    <tr data-testid={`nb-${id}`}>
      <th scope="row">{name}<small>{explain}</small></th>
      <td><b className="num">{value}</b>{unit ? ` ${unit}` : ''}</td>
    </tr>
  );
}

export function Notebook({ design, ev, lastResult, onClose, lab, onLab }: Props): JSX.Element {
  const { geometry: g, summary: s } = ev;
  const st = g.stats;
  const paper = paperOf(design.paperId);
  const asym = Math.abs(st.asymmetry) * 100;
  const r = lastResult;
  // 종이가 버텼는지(구조): 한도까지 버티면 "한도 이상"이라고 적는다.
  const safeThrow = r ? (r.structure.safeThrowSpeedMps >= LIMITS.throwSpeedMax - 1e-9 ? `${fmt(LIMITS.throwSpeedMax, 1)} 이상` : fmt(r.structure.safeThrowSpeedMps, 1)) : '';
  const structLabel = r ? (r.structure.collapsedAtLaunch ? '던지는 순간 접힘' : r.structure.buckled ? '날다가 꺾임' : r.structure.peakLoadRatio >= NEAR_MISS_RATIO ? '아슬아슬하게 버팀' : '잘 버팀') : '';
  const structTone = r ? (r.structure.buckled || r.structure.collapsedAtLaunch ? 'bad' : r.structure.peakLoadRatio >= NEAR_MISS_RATIO ? 'warn' : 'good') : 'good';
  const lateral = r ? (Math.abs(r.lateralM) < 0.005 ? '없음' : `${r.lateralM > 0 ? '왼쪽' : '오른쪽'}으로 ${fmt(Math.abs(r.lateralM), 2)} m`) : '';

  return (
    <Dialog title="연구 노트" onClose={onClose} testId="notebook" variant="notebook">
      <div className="notebook">
        <p className="notebook__lead">
          내 비행기를 숫자로 살펴보는 공책이에요. {paper.nameKo}, {design.folds.length}번 접었어요{design.clip ? ', 클립을 끼웠어요' : ''}.
        </p>

        <h3 className="nb-h">한눈에 보기</h3>
        <ul className="nb-memo" data-testid="nb-notes">
          {s.notesKo.map((n, i) => <li key={i}>{n}</li>)}
        </ul>

        <h3 className="nb-h">무게중심과 균형</h3>
        <p className="nb-p">
          <b>무게중심</b>은 비행기를 손가락 하나로 받쳤을 때 기울지 않는 점이에요.
          <b> 중립점</b>은 공기가 비행기를 떠받치는 힘이 모이는 점이에요. 무게중심이 중립점보다 조금 앞에 있어야 똑바로 날아요.
        </p>
        <CgBar geometry={g} summary={s} />
        <p className="nb-p">
          지금 판정: <span className={`mark mark--${PITCH_TONE[s.pitchStability]}`} data-testid="nb-pitch">{PITCH_LABEL[s.pitchStability]}</span>{' '}
          정적 여유 {fmt(s.staticMargin * 100, 1)}% (무게중심이 중립점보다 평균 시위의 {fmt(Math.abs(s.staticMargin) * 100, 1)}% 만큼 {s.staticMargin >= 0 ? '앞' : '뒤'}에 있어요).
          색 구역은 정적 여유만으로 그린 대략적인 기준이고, 판정은 꼬리 올리기(뒷전 꺾기)까지 반영해요.
        </p>

        <h3 className="nb-h">재어 본 값 <span className="mark mark--exact">정확한 값</span></h3>
        <p className="nb-p">종이와 접은 모양에서 그대로 계산한 값이에요. 자와 저울로 재는 것과 같아요.</p>
        <table className="nb-table" data-testid="table-exact">
          <tbody>
            <Row id="mass" name="무게" value={fmt(g.massKg * 1000, 2)} unit="g" explain={design.clip ? '종이와 클립을 합친 무게예요.' : '접어도 종이 무게는 그대로예요.'} />
            <Row id="cg-length" name="무게중심 (전체 길이 대비)" value={`${pct(st.cgFracLength)}%`} explain="코끝을 0%, 꼬리 끝을 100%로 봤을 때의 자리예요." />
            <Row id="cg-mac" name="무게중심 (평균 시위 대비)" value={`${pct(st.cgFracMac)}%`} explain="날개의 평균 앞뒤 길이(MAC)에서 앞에서부터 몇 %인지예요." />
            <Row id="cg-x" name="무게중심 위치" value={cm(-g.cg.x)} unit="cm" explain="코끝에서 뒤로 잰 거리예요." />
            <Row id="length" name="전체 길이" value={cm(st.lengthM)} unit="cm" explain="코끝에서 꼬리 끝까지예요." />
            <Row id="wing-area" name="날개 면적" value={fmt(st.wingAreaM2 * 1e4, 1)} unit="cm²" explain="위에서 내려다본 양쪽 날개의 넓이예요. 넓을수록 천천히 떠요." />
            <Row id="span" name="날개 폭" value={cm(st.spanM)} unit="cm" explain="왼쪽 날개 끝에서 오른쪽 날개 끝까지예요." />
            <Row id="aspect" name="가로세로비" value={fmt(st.aspectRatio, 2)} explain="폭² ÷ 면적. 클수록 길쭉한 날개예요." />
            <Row id="mac" name="평균 시위 (MAC)" value={cm(st.macM)} unit="cm" explain="날개의 앞뒤 길이를 평균 낸 값이에요." />
            <Row id="wing-loading" name="날개 하중" value={fmt(st.wingLoadingNm2, 2)} unit="N/m²" explain="날개 넓이에 비해 얼마나 무거운지예요. 크면 빨리 날아야 떠요." />
            <Row id="layers" name="가장 두꺼운 곳" value={String(st.maxLayers)} unit="겹" explain="종이가 가장 많이 겹친 곳의 겹 수예요." />
            <Row id="asym" name="좌우 비대칭" value={fmt(asym, 1)} unit="%" explain={asym < 0.5 ? '양쪽 날개가 똑같아요.' : '양쪽 날개 넓이가 달라 한쪽으로 휠 수 있어요.'} />
          </tbody>
        </table>

        <h3 className="nb-h">어림한 값 <span className="mark mark--model">모형 추정값</span></h3>
        <p className="nb-p">공기 힘 모형으로 계산한 값이에요. 진짜 종이비행기와는 조금 다를 수 있어요.</p>
        <table className="nb-table" data-testid="table-model">
          <tbody>
            <Row id="pitch-stab" name="앞뒤 안정성" value={<span className={`mark mark--${PITCH_TONE[s.pitchStability]}`}>{PITCH_LABEL[s.pitchStability]}</span>} explain="코가 들리거나 숙여졌을 때 스스로 돌아오는지예요." />
            <Row id="lat-stab" name="좌우 안정성" value={<span className={`mark mark--${LATERAL_TONE[s.lateralStability]}`}>{LATERAL_LABEL[s.lateralStability]}</span>} explain="옆으로 기울었을 때 스스로 바로 서는지예요." />
            <Row id="trim-alpha" name="활공 받음각" value={fmt(s.trimAlphaDeg, 1)} unit="도" explain="받음각은 날개가 바람을 맞는 각도예요. 힘이 균형을 이루는 각도를 적었어요." />
            <Row id="trim-speed" name="활공 속도" value={fmt(s.trimSpeedMps, 1)} unit="m/s" explain="이 비행기가 가장 편하게 미끄러지듯 나는 빠르기예요." />
            <Row id="glide-ratio" name="활공비" value={fmt(s.glideRatio, 1)} explain="1 m 내려가는 동안 앞으로 나아가는 거리(m)예요." />
            <Row id="max-ld" name="최대 양항비" value={fmt(s.maxLD, 1)} explain="뜨는 힘(양력) ÷ 잡아당기는 힘(항력)의 가장 큰 값이에요." />
            <Row id="stall" name="실속 받음각" value={fmt(s.stallAlphaDeg, 0)} unit="도" explain="실속은 날개를 너무 세워 뜨는 힘이 갑자기 줄어드는 일이에요." />
            <Row id="reynolds" name="레이놀즈수" value={Math.round(s.reynolds).toLocaleString('ko-KR')} explain="공기가 얼마나 끈적하게 느껴지는지 나타내는 수예요. 종이비행기는 1만~10만쯤이에요." />
            <Row id="static-margin" name="정적 여유" value={fmt(s.staticMargin * 100, 1)} unit="% MAC" explain="무게중심이 중립점보다 얼마나 앞에 있는지예요. +면 안정이에요." />
            <Row id="neutral" name="중립점 위치" value={cm(-s.neutralPointX)} unit="cm" explain="코끝에서 뒤로 잰 거리예요." />
            <Row id="stiffness" name="날개 굽힘 강성" value={fmt(st.wingBendStiffnessNm * 1000, 2)} unit="mN·m" explain="날개가 얼마나 잘 안 휘는지예요. 겹친 종이가 서로 미끄러진다고 보고 어림했어요." />
          </tbody>
        </table>

        <h3 className="nb-h">바람 실험실 쪽지 <span className="mark mark--model">모형 추정값</span></h3>
        <p className="nb-p">
          바람 실험실(풍동)은 비행기를 받침대에 붙잡아 두고 바람을 불어 주는 실험 장치예요. 실험실에서 "뜨는 힘"이라고 부른 것이 <b>양력</b>,
          "막는 힘"이 <b>항력</b>, "고개 각도"가 <b>받음각</b>이에요.
        </p>
        {lab ? (
          <>
            <table className="nb-table" data-testid="table-lab">
              <tbody>
                <Row id="lab-fav" name="좋아하는 바람 속도" value={fmt(lab.favSpeedMps, 1)} unit={lab.favSpeedMps === null ? undefined : 'm/s'} explain="혼자 균형 잡은 받음각에서 양력이 딱 무게만큼 되는 바람 속도예요. 이 빠르기로 던지면 편하게 날아요." />
                <Row id="lab-trim" name="균형 받음각" value={fmt(lab.trimAlphaDeg, 1)} unit={lab.trimAlphaDeg === null ? undefined : '도'} explain="무게중심에 꽂은 축을 풀어 주면 비행기가 스스로 멈추는 받음각이에요. 없으면 균형을 못 잡는 비행기예요." />
                <Row id="lab-best" name="가장 알뜰한 받음각" value={lab.bestAlphaDeg === null ? '–' : `${fmt(lab.bestAlphaDeg, 0)}도 (양항비 ${fmt(lab.bestLiftToDrag, 1)})`} explain="양력 ÷ 항력(양항비)이 가장 큰 받음각이에요. 같은 힘으로 가장 멀리 가는 자세예요." />
                <Row id="lab-stall" name="실속이 시작되는 받음각" value={fmt(lab.stallAlphaDeg, 0)} unit={lab.stallAlphaDeg === null ? undefined : '도'} explain="이보다 고개를 더 들면 바람이 날개 윗면에서 떨어져 나가 양력이 줄어요. 이것이 실속이에요." />
                <Row id="lab-buckle" name="종이가 꺾이는 바람 속도" value={lab.buckleSpeedMps === null ? '안 꺾여요' : fmt(lab.buckleSpeedMps, 1)} unit={lab.buckleSpeedMps === null ? undefined : 'm/s'} explain="바람이 이보다 세면 날개가 버티지 못하고 꺾여요. 실험실 바람으로 안 꺾이면 '안 꺾여요'예요." />
              </tbody>
            </table>
            {lab.physics !== PHYSICS_VERSION && <p className="nb-p" data-testid="nb-lab-stale">대회 규칙이 바뀌기 전에 적은 쪽지예요. 실험실에서 다시 재면 새 값으로 바뀌어요.</p>}
          </>
        ) : (
          <p className="nb-p" data-testid="nb-lab-empty">아직 바람 실험실에서 적은 쪽지가 없어요. 실험실의 "쪽지"에서 "연구 노트에 적기"를 누르면 여기에 붙어요.</p>
        )}
        {onLab && <p className="nb-p"><button type="button" className="btn btn--small btn--note" onClick={onLab} data-testid="nb-open-lab">바람 실험실에 넣어 보기</button></p>}

        <h3 className="nb-h">받음각 곡선 <span className="mark mark--model">모형 추정값</span></h3>
        <p className="nb-p">받음각(날개가 바람을 맞는 각도)을 바꿔 가며 힘이 어떻게 달라지는지 그렸어요. 빨간 점은 활공할 때의 받음각, 점선은 실속이 시작되는 각도예요.</p>
        <PolarCharts summary={s} />

        {r && (
          <>
            <h3 className="nb-h">방금 던진 비행</h3>
            <table className="nb-table" data-testid="table-flight">
              <tbody>
                <Row id="f-distance" name="거리" value={fmt(r.distanceM, 2)} unit="m" explain="출발선에서 내려앉은 곳까지 똑바로 잰 거리예요." />
                <Row id="f-airtime" name="체공 시간" value={fmt(r.airtimeS, 2)} unit="초" explain="손을 떠나서 바닥에 닿을 때까지 걸린 시간이에요." />
                <Row id="f-height" name="최고 높이" value={fmt(r.maxHeightM, 2)} unit="m" explain="가장 높이 올라갔을 때의 높이예요." />
                <Row id="f-lateral" name="좌우로 벗어남" value={lateral} explain="똑바로 던진 방향에서 옆으로 얼마나 벗어났는지예요." />
                <Row id="f-verdict" name="비행 판정" value={VERDICT_TECH[r.verdict]} explain="비행이 어떤 종류였는지 궤적을 보고 정한 이름이에요." />
              </tbody>
            </table>
            <h3 className="nb-h">종이가 버텼을까 <span className="mark mark--model">모형 추정값</span></h3>
            <p className="nb-p">
              빠르게 던질수록 바람이 날개를 세게 밀어 올려요. 얇은 종이는 그 힘에 휘고, 너무 세면 날개 뿌리에서 꺾여요(이것을 <b>좌굴</b>이라고 해요).
              꺾인 날개는 펄럭거려서 비행기가 금방 느려져요.
            </p>
            <table className="nb-table" data-testid="table-structure">
              <tbody>
                <Row id="s-flex" name="최대 휨" value={fmt(r.structure.maxFlexDeg, 1)} unit="도" explain="날아가는 동안 날개 끝이 가장 많이 위로 휜 각도예요. 빳빳한 종이일수록 작아요." />
                <Row id="s-safe" name="버티는 던지기 속도" value={safeThrow} unit="m/s" explain={`이 비행기의 날개가 손 안에서 접히지 않고 버티는 가장 빠른 던지기예요. 던질 수 있는 가장 센 힘은 ${fmt(LIMITS.throwSpeedMax, 0)} m/s예요.`} />
                <Row id="s-load" name="하중 비율" value={fmt(r.structure.peakLoadRatio, 2)} explain="날개 뿌리에 걸린 힘 ÷ 종이가 버티는 한계의 가장 큰 값이에요. 1을 넘으면 꺾이고, 0.7을 넘으면 아슬아슬했던 거예요." />
                <Row id="s-result" name="결과" value={<span className={`mark mark--${structTone}`}>{structLabel}</span>} explain={r.structure.buckled && r.structure.buckledAtS !== null && !r.structure.collapsedAtLaunch ? `던지고 ${fmt(r.structure.buckledAtS, 2)}초 뒤에 꺾였어요.` : '던지는 순간부터 내려앉을 때까지 날개가 어땠는지예요.'} />
              </tbody>
            </table>
            {r.structure.noteKo && <p className="nb-quote" data-testid="nb-structure-note">{r.structure.noteKo}</p>}
            <p className="nb-quote" data-testid="nb-diagnosis">{r.diagnosisKo}</p>
            {r.tipsKo.length > 0 && <ul className="nb-memo" data-testid="nb-tips">{r.tipsKo.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            <TrajectoryPlot result={r} />
          </>
        )}

        <h3 className="nb-h">어떻게 계산하나요</h3>
        <div className="nb-how">
          <p><b>날개를 띠로 나눠 계산해요.</b> 날개와 몸통을 좁은 띠 여러 개로 나누고, 띠마다 받는 공기 힘을 더해요. 그래서 접는 모양이 바뀌면 결과도 바뀌어요.</p>
          <p><b>양력은 받음각에 단순히 비례하지 않아요.</b> 종이비행기처럼 짧고 넓은 날개는 날개 끝과 앞쪽 모서리에서 생기는 소용돌이가 뜨는 힘을 더해 줘요. 그래서 꽤 큰 받음각까지 버티다가 실속해요.</p>
          <p><b>힘이 걸리는 자리가 움직여요.</b> 얇은 판은 받음각이 커질수록 뜨는 힘이 걸리는 자리가 뒤로 옮겨 가요. 꼬리날개가 없어도 무게중심이 적당히 앞에 있으면 스스로 자세를 잡는 까닭이에요.</p>
          <p><b>종이가 휘는 정도는 어림이에요.</b> 얇은 종이는 세게 던지면 날개가 휘어요. 종이의 두께와 빳빳함, 바람의 세기로 어림해서 반영하지만 진짜 종이와는 차이가 날 수 있어요.</p>
          <p>무게, 무게중심, 날개 면적은 접은 모양에서 그대로 계산한 정확한 값이에요. 양력, 항력, 활공 속도 같은 값은 모형으로 구한 추정값이에요. 같은 값을 넣으면 언제나 같은 결과가 나와요. 던지는 높이는 {fmt(LIMITS.launchHeightM, 1)} m, 바람은 없다고 봐요.</p>
          <p><b>던지는 힘은 {fmt(LIMITS.throwSpeedMin, 0)}~{fmt(LIMITS.throwSpeedMax, 0)} m/s까지예요.</b> 종이비행기는 공처럼 온몸으로 던지지 않고 손끝으로 집어서 밀어 던져요. 초등학생이 그렇게 던지면 가장 세게 던져도 1초에 {fmt(LIMITS.throwSpeedMax, 0)} m쯤 가는 빠르기가 나와요.</p>
        </div>
      </div>
    </Dialog>
  );
}
