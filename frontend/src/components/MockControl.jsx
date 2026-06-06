import { useState } from 'react';

const M = { surface: '#f5f4f1', border: '#E4E7EC', heading: '#0a0a0a', body: '#555555', muted: '#999999' };

// 聲音分類對應到三個使用者標籤
const SOUND_TYPE_LABELS = {
  human_voice: { label: '人為噪音', color: '#c0392b', note: '可能違規' },
  music:       { label: '人為噪音', color: '#c0392b', note: '可能違規' },
  car:         { label: '環境聲響', color: '#0369a1', note: '不影響違規' },
  rain:        { label: '環境聲響', color: '#0369a1', note: '不影響違規' },
  background:  { label: '背景音',   color: '#888888', note: ''           },
};

const TOOLTIP_CONTENT = [
  {
    label: '人為噪音', color: '#c0392b',
    desc: '包含人聲、對話、音樂、樂器等人為製造的聲音。持續超過分貝門檻可能觸發違規罰款。',
  },
  {
    label: '環境聲響', color: '#0369a1',
    desc: '包含車聲、雨聲、風聲等不可避免的外部環境音。不計入違規判斷。',
  },
  {
    label: '背景音',   color: '#888888',
    desc: '安靜環境中的底層背景音量，通常為環境底噪。',
  },
];

function SoundTooltip() {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ fontSize: 12, color: M.muted, cursor: 'default', userSelect: 'none', borderBottom: `1px dashed ${M.border}` }}
      >
        說明
      </span>
      {show && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 100,
          background: '#ffffff', border: `1px solid ${M.border}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          padding: '16px 18px', width: 260,
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: M.muted, textTransform: 'uppercase', marginBottom: 12 }}>
            聲音分類說明
          </div>
          {TOOLTIP_CONTENT.map(item => (
            <div key={item.label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: item.color, marginBottom: 3 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: M.body, lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function sensorDb(data) {
  if (!data) return null;
  return Number(data.estimatedDb ?? data.estimated_db ?? data.decibels);
}

export default function MockControl({ dbHistory, backendNoise, lastDb }) {
  const dbMax = 110, dbMin = 30, svgW = 500, svgH = 80;
  const toX = (i) => (i / (dbHistory.length - 1)) * svgW;
  const toY = (v) => svgH - ((Math.min(Math.max(v, dbMin), dbMax) - dbMin) / (dbMax - dbMin)) * svgH;

  const linePts = dbHistory.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const areaPts = [
    ...dbHistory.map((v, i) => `${toX(i)},${toY(v)}`),
    `${svgW},${svgH}`, `0,${svgH}`,
  ].join(' ');

  const threshold70y = toY(70);
  const db = Number.isFinite(lastDb) ? lastDb : 0;
  const isAlert = db > 70;
  const lineColor = isAlert ? '#c0392b' : '#3B82F6';
  const gradId = isAlert ? 'areaRed' : 'areaBlue';

  const soundType = backendNoise?.soundType;
  const confidence = backendNoise?.soundTypeConfidence;
  const soundMeta = soundType ? (SOUND_TYPE_LABELS[soundType] ?? { label: soundType, color: M.muted }) : null;

  return (
    <div style={{ background: M.surface, border: `1px solid ${M.border}`, padding: '24px 28px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>即時分貝監測</div>
            <SoundTooltip />
          </div>
          {/* 聲音類型 badge */}
          {soundMeta ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block', padding: '3px 10px',
                background: `${soundMeta.color}14`,
                border: `1px solid ${soundMeta.color}40`,
                color: soundMeta.color, fontSize: 12, fontWeight: 500,
                letterSpacing: '0.05em',
              }}>
                {soundMeta.label}
              </span>
              {confidence != null && (
                <span style={{ fontSize: 12, color: M.muted }}>
                  {(confidence * 100).toFixed(0)}%
                </span>
              )}
              {soundMeta.note && (
                <span style={{ fontSize: 11, color: soundMeta.color, opacity: 0.7 }}>
                  {soundMeta.note}
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: M.muted }}>聲音類型：待分析</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 48, fontWeight: 700, color: isAlert ? '#c0392b' : M.heading, lineHeight: 1, letterSpacing: '-2px' }}>
            {db.toFixed(0)}
          </div>
          <div style={{ fontSize: 12, color: M.muted, marginTop: 2 }}>dB</div>
        </div>
      </div>

      <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: svgH, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="areaRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c0392b" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#c0392b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPts} fill={`url(#${gradId})`} />
        <line x1="0" y1={threshold70y} x2={svgW} y2={threshold70y}
          stroke="#c0392b" strokeWidth="1" strokeDasharray="4,6" opacity="0.2" />
        <polyline fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={linePts} />
      </svg>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M.muted }}>
        <span><span style={{ color: '#c0392b', opacity: 0.5 }}>—</span> 門檻 70 dB</span>
        {backendNoise && (
          <span style={{ color: backendNoise.reportAllowed ? '#c0392b' : M.muted }}>
            {backendNoise.roomLabel} · {sensorDb(backendNoise)?.toFixed(0)} dB · {backendNoise.source}
          </span>
        )}
      </div>
    </div>
  );
}
