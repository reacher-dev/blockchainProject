import { useState } from 'react';
import { ROOM_NAMES, fmt } from '../Web3.js';

const ROOM_LABELS = ['A', 'B', 'C', 'D', 'E'];
const PAGE_SIZE   = 5;
const DB_MAX = 110, DB_MIN = 30, SVG_W = 500, SVG_H = 72;
const M = {
  surface: '#f5f4f1', surface2: '#dddcda',
  border: 'rgba(0,0,0,0.08)', borderStrong: 'rgba(0,0,0,0.2)',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};

const VOTING_WINDOW_SEC = 5;

const SOUND_TYPE_LABELS = {
  human_voice: { label: '人為噪音', color: '#c0392b', note: '可能違規' },
  music:       { label: '人為噪音', color: '#c0392b', note: '可能違規' },
  car:         { label: '環境聲響', color: '#0369a1', note: '不影響違規' },
  rain:        { label: '環境聲響', color: '#0369a1', note: '不影響違規' },
  background:  { label: '背景音',   color: '#888888', note: '' },
};

const TOOLTIP_CONTENT = [
  { label: '人為噪音', color: '#c0392b', desc: '包含人聲、對話、音樂、樂器等人為製造的聲音。持續超過分貝門檻可能觸發違規罰款。' },
  { label: '環境聲響', color: '#0369a1', desc: '包含車聲、雨聲、風聲等不可避免的外部環境音。不計入違規判斷。' },
  { label: '背景音',   color: '#888888', desc: '安靜環境中的底層背景音量，通常為環境底噪。' },
];

const DISPLAY_SOUND_TYPE_LABELS = {
  ...SOUND_TYPE_LABELS,
  human_created_noise: { label: '人為噪音', color: '#c0392b', note: '可能為人聲、音樂或敲擊聲' },
  human_voice: { label: '人聲', color: '#c0392b', note: '可能違規' },
  music: { label: '音樂', color: '#b45309', note: '可能違規' },
  impact_noise: { label: '敲擊聲', color: '#9333ea', note: '可能違規' },
  environment_noise: { label: '環境噪音', color: '#0369a1', note: '不直接判定違規' },
  car: { label: '車聲', color: '#0369a1', note: '環境噪音' },
  rain: { label: '雨聲', color: '#0284c7', note: '環境噪音' },
  background: { label: '背景音', color: '#888888', note: '' },
  other_noise: { label: '其他噪音', color: '#64748b', note: '不確定' },
};

const DISPLAY_TOOLTIP_CONTENT = [
  { label: '人聲 / 音樂 / 敲擊聲', color: '#c0392b', desc: '可能由住戶或訪客造成，包含說話、播放音樂、敲牆或撞擊聲，可作為違規判斷的輔助依據。' },
  { label: '雨聲 / 車聲', color: '#0369a1', desc: '非住戶直接產生的環境聲，通常不應直接納入違規。' },
  { label: '背景音 / 其他噪音', color: '#888888', desc: '一般環境底噪、未知聲音，或模型信心不足的聲音。' },
];

function SoundTooltip() {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ fontSize: 12, color: M.muted, cursor: 'default', userSelect: 'none', borderBottom: '1px dashed rgba(0,0,0,0.15)' }}
      >
        說明
      </span>
      {show && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 100,
          background: '#ffffff', border: `1px solid rgba(0,0,0,0.1)`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          padding: '16px 18px', width: 260,
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: M.muted, textTransform: 'uppercase', marginBottom: 12 }}>聲音分類說明</div>
          {(DISPLAY_TOOLTIP_CONTENT.length ? DISPLAY_TOOLTIP_CONTENT : TOOLTIP_CONTENT).map(item => (
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

function appealStatus(v, proposals) {
  if (!v.appealed) return { label: '未申訴', color: '#b45309' };
  const proposal = proposals.find(p => p.violationId === v.id);
  if (proposal?.executed) return proposal.passed ? { label: '申訴通過', color: '#15803d' } : { label: '申訴否決', color: '#c0392b' };
  return { label: '申訴中', color: M.muted };
}

function DbChart({ dbHistory, backendNoise, lastDb }) {
  const pts = dbHistory
    .map((v, i) => `${(i / (dbHistory.length - 1)) * SVG_W},${SVG_H - ((Math.min(Math.max(v, DB_MIN), DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN)) * SVG_H}`)
    .join(' ');
  const threshold75y = SVG_H - ((75 - DB_MIN) / (DB_MAX - DB_MIN)) * SVG_H;
  const db = Number.isFinite(lastDb) ? lastDb : 0;
  const isAlert = db > 70;

  const soundType = backendNoise?.soundType;
  const confidence = backendNoise?.soundTypeConfidence;
  const soundMeta = soundType ? (DISPLAY_SOUND_TYPE_LABELS[soundType] ?? { label: soundType, color: M.muted, note: '' }) : null;
  const modelSoundType = backendNoise?.modelSoundType;
  const fftFresh = backendNoise?.fftFresh;

  return (
    <div style={{ border: `1px solid ${M.border}`, background: M.surface, padding: '22px 24px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>即時分貝</div>
            <SoundTooltip />
          </div>
          {soundMeta ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block', padding: '3px 10px',
                background: `${soundMeta.color}14`,
                border: `1px solid ${soundMeta.color}40`,
                color: soundMeta.color, fontSize: 12, fontWeight: 500,
              }}>
                {soundMeta.label}
              </span>
              {confidence != null && <span style={{ fontSize: 12, color: M.muted }}>{(confidence * 100).toFixed(0)}%</span>}
              {soundMeta.note && <span style={{ fontSize: 11, color: soundMeta.color, opacity: 0.7 }}>{soundMeta.note}</span>}
              {modelSoundType && <span style={{ fontSize: 11, color: M.muted }}>fine: {modelSoundType}</span>}
              {fftFresh && <span style={{ fontSize: 11, color: '#15803d' }}>live</span>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: M.muted }}>聲音類型：待分析</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 30, fontWeight: 200, color: isAlert ? '#c0392b' : M.heading, letterSpacing: '-0.5px' }}>
            {db.toFixed(0)} <span style={{ fontSize: 13, fontWeight: 400, color: M.muted }}>dB</span>
          </div>
          {backendNoise?.avgDb != null && (
            <div style={{ fontSize: 12, color: M.muted, marginTop: 3 }}>
              {VOTING_WINDOW_SEC}s 均值{' '}
              <span style={{ color: backendNoise.avgDb > 70 ? '#c0392b' : M.body, fontWeight: 500 }}>
                {backendNoise.avgDb.toFixed(1)} dB
              </span>
            </div>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: '100%', height: SVG_H, display: 'block' }}>
        <line x1="0" y1={threshold75y} x2={SVG_W} y2={threshold75y} stroke="#c0392b" strokeWidth="1" strokeDasharray="4,6" opacity="0.35" />
        <polyline fill="none" stroke={isAlert ? '#c0392b' : '#bbbbbb'} strokeWidth="1.5" strokeLinejoin="round" points={pts} />
      </svg>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: M.muted }}>
        <span><span style={{ color: '#c0392b' }}>—</span> 門檻 75 dB</span>
        {backendNoise && <span style={{ color: backendNoise.reportAllowed ? '#c0392b' : M.muted }}>{backendNoise.roomLabel} · {backendNoise.source}</span>}
      </div>
    </div>
  );
}

export default function MyRoom({ account, myRoom, rooms, violations, proposals = [], loading, handleAppeal,
  depAmt, setDepAmt, handleDeposit, dbHistory = Array(30).fill(42), backendNoise = null, lastDb = 42, onRefresh }) {

  const [appealReasons, setAppealReasons] = useState({});
  const [openAppeal,    setOpenAppeal]    = useState(null);
  const [expandedVid,   setExpandedVid]   = useState(null);
  const [page,          setPage]          = useState(0);

  if (!account) return <div style={{ background: M.surface, border: `1px solid ${M.border}`, padding: 52, textAlign: 'center', color: M.muted }}>請先連接 MetaMask</div>;
  if (myRoom === null) return <div style={{ background: M.surface, border: `1px solid ${M.border}`, padding: 52, textAlign: 'center', color: M.muted }}>您尚未入住任何房間</div>;

  const roomData     = rooms.find(r => r.i === myRoom);
  const myViolations = violations.filter(v => v.room === myRoom);
  const unappealed   = myViolations.filter(v => !v.appealed);
  const totalPages   = Math.ceil(myViolations.length / PAGE_SIZE);
  const pageSlice    = myViolations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function submitAppeal(vid) {
    const reason = (appealReasons[vid] || '').trim();
    if (!reason) return;
    handleAppeal(vid, reason);
    setOpenAppeal(null);
    setAppealReasons(prev => ({ ...prev, [vid]: '' }));
  }

  return (
    <>
      <DbChart dbHistory={dbHistory} backendNoise={backendNoise} lastDb={lastDb} />

      {/* Room info */}
      <div style={{ border: `1px solid ${M.border}`, background: M.surface, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 20 }}>
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${M.border}`, background: M.surface2 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', color: M.muted, marginBottom: 2, textTransform: 'uppercase' }}>Room {ROOM_LABELS[myRoom]}</div>
          <div style={{ fontSize: 20, fontWeight: 300, color: M.heading }}>{ROOM_NAMES[myRoom]}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ padding: '20px 22px', borderRight: `1px solid ${M.border}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: M.muted, marginBottom: 8, textTransform: 'uppercase' }}>可用餘額</div>
            <div style={{ fontSize: 26, fontWeight: 200, color: M.heading }}>
              {roomData ? fmt(roomData.free) : '—'} <span style={{ fontSize: 13, color: M.muted }}>ETH</span>
            </div>
          </div>
          <div style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: M.muted, marginBottom: 8, textTransform: 'uppercase' }}>鎖定金額</div>
            <div style={{ fontSize: 26, fontWeight: 200, color: roomData?.locked > 0n ? '#b45309' : M.muted }}>
              {roomData ? fmt(roomData.locked) : '—'} <span style={{ fontSize: 13, color: M.muted }}>ETH</span>
            </div>
          </div>
        </div>
      </div>

      {/* Deposit */}
      <div style={{ border: `1px solid ${M.border}`, background: M.surface, padding: '20px 22px', marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, marginBottom: 16, textTransform: 'uppercase' }}>補充押金</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
          <input value={depAmt} onChange={e => setDepAmt(e.target.value)} placeholder="0.1"
            style={{ flex: 1, padding: '10px 0', background: 'transparent', border: 'none', borderBottom: `1px solid ${M.border}`, color: M.heading, fontSize: 15, outline: 'none' }} />
          <button onClick={handleDeposit} disabled={loading}
            style={{ background: 'transparent', border: `1px solid ${loading ? M.border : M.borderStrong}`, color: loading ? '#bbb' : M.heading, padding: '10px 22px', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: loading ? 'default' : 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => { if (!loading) { e.target.style.background = '#0a0a0a'; e.target.style.color = '#fff'; }}}
            onMouseLeave={e => { if (!loading) { e.target.style.background = 'transparent'; e.target.style.color = M.heading; }}}>
            存入 ETH
          </button>
        </div>
      </div>

      {/* Warning */}
      {unappealed.length > 0 && (
        <div style={{ border: '1px solid rgba(180,83,9,0.25)', background: 'rgba(180,83,9,0.04)', padding: '12px 20px', marginBottom: 20, fontSize: 13, color: '#b45309' }}>
          您有 {unappealed.length} 筆未申訴的違規紀錄，申訴期限為違規後 5 分鐘內。
        </div>
      )}

      {/* Violations */}
      {myViolations.length > 0 ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>違規紀錄（共 {myViolations.length} 筆）</div>
              {onRefresh && (
                <button onClick={onRefresh}
                  style={{ background: 'transparent', border: `1px solid ${M.border}`, color: M.muted, padding: '3px 12px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.target.style.borderColor = M.borderStrong; e.target.style.color = M.heading; }}
                  onMouseLeave={e => { e.target.style.borderColor = M.border; e.target.style.color = M.muted; }}>
                  重新整理
                </button>
              )}
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ padding: '4px 12px', background: 'transparent', border: `1px solid ${M.border}`, color: page === 0 ? '#ccc' : M.muted, cursor: page === 0 ? 'default' : 'pointer', fontSize: 12 }}>←</button>
                <span style={{ fontSize: 12, color: M.muted }}>{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                  style={{ padding: '4px 12px', background: 'transparent', border: `1px solid ${M.border}`, color: page === totalPages - 1 ? '#ccc' : M.muted, cursor: page === totalPages - 1 ? 'default' : 'pointer', fontSize: 12 }}>→</button>
              </div>
            )}
          </div>
          <div style={{ border: `1px solid ${M.border}`, background: M.surface }}>
            {pageSlice.map((v, idx) => {
              const status = appealStatus(v, proposals);
              return (
                <div key={v.id} style={{ borderTop: idx > 0 ? `1px solid ${M.border}` : 'none' }}>
                  <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: M.muted }}>#{v.id}</span>
                      <span style={{ fontSize: 14, color: M.body }}>{v.db} dB · {fmt(v.penalty)} ETH</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: status.color, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{status.label}</span>
                      <button onClick={() => setExpandedVid(expandedVid === v.id ? null : v.id)}
                        style={{ padding: '4px 12px', background: 'transparent', border: `1px solid ${M.border}`, color: M.muted, cursor: 'pointer', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {expandedVid === v.id ? '收起' : '詳情'}
                      </button>
                      {!v.appealed && (
                        <button onClick={() => setOpenAppeal(openAppeal === v.id ? null : v.id)}
                          style={{ padding: '4px 14px', background: 'transparent', border: `1px solid ${M.borderStrong}`, color: M.heading, cursor: 'pointer', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', transition: 'all 0.2s' }}
                          onMouseEnter={e => { e.target.style.background = '#0a0a0a'; e.target.style.color = '#fff'; }}
                          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = M.heading; }}>
                          {openAppeal === v.id ? '取消' : '提出申訴'}
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedVid === v.id && (
                    <div style={{ padding: '14px 20px 18px', borderTop: `1px solid ${M.border}`, background: M.surface2, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                      {[
                        { label: '違規 ID', value: `#${v.id}`, mono: true },
                        { label: '分貝', value: `${v.db} dB`, color: '#c0392b' },
                        { label: '罰款', value: `${fmt(v.penalty)} ETH` },
                        { label: '申訴狀態', value: status.label, color: status.color },
                      ].map(item => (
                        <div key={item.label}>
                          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: M.muted, marginBottom: 5, textTransform: 'uppercase' }}>{item.label}</div>
                          <div style={{ fontSize: 14, color: item.color || M.body, fontFamily: item.mono ? 'monospace' : 'inherit' }}>{item.value}</div>
                        </div>
                      ))}
                      {v.reportedAt > 0 && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: M.muted, marginBottom: 5, textTransform: 'uppercase' }}>違規時間</div>
                          <div style={{ fontSize: 14, color: M.body }}>{new Date(v.reportedAt * 1000).toLocaleString('zh-TW')}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {openAppeal === v.id && !v.appealed && (
                    <div style={{ padding: '14px 20px 18px', borderTop: `1px solid ${M.border}` }}>
                      <div style={{ fontSize: 11, letterSpacing: '0.12em', color: M.muted, marginBottom: 10, textTransform: 'uppercase' }}>申訴原因</div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        <input style={{ flex: 1, padding: '9px 0', background: 'transparent', border: 'none', borderBottom: `1px solid ${M.border}`, color: M.heading, fontSize: 14, outline: 'none' }}
                          value={appealReasons[v.id] || ''}
                          onChange={e => setAppealReasons(prev => ({ ...prev, [v.id]: e.target.value }))}
                          placeholder="說明申訴理由" />
                        <button onClick={() => submitAppeal(v.id)} disabled={loading || !(appealReasons[v.id] || '').trim()}
                          style={{ background: 'transparent', border: `1px solid ${(appealReasons[v.id] || '').trim() ? M.borderStrong : M.border}`, color: (appealReasons[v.id] || '').trim() ? M.heading : '#bbb', padding: '9px 20px', fontSize: 11, letterSpacing: '0.13em', textTransform: 'uppercase', cursor: (appealReasons[v.id] || '').trim() ? 'pointer' : 'default', transition: 'all 0.2s' }}
                          onMouseEnter={e => { if ((appealReasons[v.id] || '').trim()) { e.target.style.background = '#0a0a0a'; e.target.style.color = '#fff'; }}}
                          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = (appealReasons[v.id] || '').trim() ? M.heading : '#bbb'; }}>
                          提交
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ border: `1px solid ${M.border}`, background: M.surface, padding: 40, textAlign: 'center', color: M.muted, fontSize: 14 }}>目前無違規紀錄</div>
      )}
    </>
  );
}
