import { useState } from 'react';
import { ROOM_NAMES } from '../Web3.js';
import MockControl from './MockControl.jsx';

const ROOM_LABELS = ['A', 'B', 'C', 'D', 'E'];
const M = {
  surface: '#f5f4f1', surface2: '#dddcda',
  border: '#E4E7EC',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};
const CARD_SHADOW = '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)';

function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button onClick={handleCopy} title={text}
      style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#15803d' : '#aaa', fontSize: 13, padding: '0 2px', lineHeight: 1, verticalAlign: 'middle' }}>
      {copied ? '✓' : '⎘'}
    </button>
  );
}

const fieldStyle = {
  width: '100%', padding: '9px 12px', height: 40,
  background: '#ffffff', border: `1px solid ${M.border}`,
  color: M.heading, fontSize: 14, outline: 'none',
  boxSizing: 'border-box', transition: 'border-color 0.2s',
  fontFamily: 'inherit',
};

export default function AdminPanel({ account, isLandlord, contract, loading, rooms, regRoom, setRegRoom, regAddr, setRegAddr, handleRegister, mockControlProps }) {
  if (!account) return <div style={{ background: M.surface, border: `1px solid ${M.border}`, boxShadow: CARD_SHADOW, padding: 52, textAlign: 'center', color: M.muted, fontSize: 15 }}>請先連接 MetaMask</div>;
  if (!isLandlord) return (
    <div style={{ background: M.surface, border: `1px solid ${M.border}`, boxShadow: CARD_SHADOW, padding: 52, textAlign: 'center' }}>
      <div style={{ fontSize: 16, color: M.heading, marginBottom: 6 }}>僅房東可操作管理功能</div>
      <div style={{ fontSize: 13, color: M.muted }}>請使用房東帳號連接</div>
    </div>
  );

  const displayRooms = rooms?.length ? rooms : ROOM_NAMES.map((name, i) => ({ i, name, tenant: null, registered: false }));
  const btnDisabled = loading || !contract || !regAddr.trim();

  return (
    <>
      {/* Register */}
      <div style={{ border: `1px solid ${M.border}`, background: M.surface, boxShadow: CARD_SHADOW, marginBottom: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${M.border}`, background: M.surface2 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>登記房客</div>
        </div>
        <div style={{ padding: '28px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 16, alignItems: 'end', marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#667085', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>房間</div>
              <select value={regRoom} onChange={e => setRegRoom(Number(e.target.value))}
                style={{ ...fieldStyle, appearance: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}>
                {ROOM_NAMES.map((name, i) => <option key={name} value={i}>Room {ROOM_LABELS[i]} — {name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#667085', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>房客錢包地址</div>
              <input value={regAddr} onChange={e => setRegAddr(e.target.value)} placeholder="0x..."
                style={fieldStyle}
                onFocus={e => { e.target.style.borderColor = '#0a0a0a'; }}
                onBlur={e => { e.target.style.borderColor = M.border; }} />
            </div>
            <button onClick={handleRegister} disabled={btnDisabled}
              style={{
                height: 40, padding: '0 24px',
                background: btnDisabled ? '#d0d0d0' : '#0a0a0a',
                color: '#ffffff', border: 'none',
                fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
                cursor: btnDisabled ? 'default' : 'pointer',
                whiteSpace: 'nowrap', transition: 'background 0.2s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { if (!btnDisabled) e.target.style.background = '#333'; }}
              onMouseLeave={e => { if (!btnDisabled) e.target.style.background = '#0a0a0a'; }}>
              登記
            </button>
          </div>

          {/* Table */}
          <div style={{ border: `1px solid ${M.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', background: '#ffffff', borderBottom: `1px solid ${M.border}` }}>
              <div style={{ padding: '10px 16px', fontSize: 11, color: '#667085', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>房間</div>
              <div style={{ padding: '10px 16px', fontSize: 11, color: '#667085', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>地址</div>
            </div>
            {displayRooms.map((room, idx) => (
              <div key={room.i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr', borderTop: idx > 0 ? `1px solid ${M.border}` : 'none', background: '#ffffff' }}>
                <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: M.heading }}>Room {ROOM_LABELS[room.i]}</div>
                <div style={{ padding: '12px 16px', fontSize: 13, display: 'flex', alignItems: 'center' }}>
                  {room.registered ? (
                    <>
                      <span style={{ fontFamily: 'monospace', color: M.body }}>{shortAddr(room.tenant)}</span>
                      <CopyBtn text={room.tenant} />
                    </>
                  ) : (
                    <span style={{ display: 'inline-block', padding: '2px 8px', background: '#F9FAFB', border: `1px solid ${M.border}`, fontSize: 12, color: '#667085' }}>
                      尚未登記
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monitor */}
      <div style={{ border: `1px solid ${M.border}`, background: M.surface, boxShadow: CARD_SHADOW }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${M.border}`, background: M.surface2 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>即時監測</div>
        </div>
        <div style={{ padding: '4px 0 0' }}>
          <MockControl dbHistory={mockControlProps.dbHistory} backendNoise={mockControlProps.backendNoise} lastDb={mockControlProps.lastDb} />
        </div>
      </div>
    </>
  );
}
