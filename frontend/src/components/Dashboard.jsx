import { ROOM_NAMES, fmt } from '../Web3.js';

const ROOM_LABELS = ['A', 'B', 'C', 'D', 'E'];
const M = {
  bg: '#e8e7e4', surface: '#f5f4f1', surface2: '#dddcda',
  border: 'rgba(0,0,0,0.08)', borderStrong: 'rgba(0,0,0,0.15)',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};

const SUMMARY_ITEMS = [
  { label: '最低保證金',   value: '0.4 ETH'  },
  { label: '噪音門檻',     value: '70 dB'    },
  { label: '申訴費用',     value: '0.01 ETH' },
  { label: '最低票數門檻', value: '3 票'     },
];

function logDesc(log) {
  const { name, args } = log;
  if (name === 'NoiseReported')    return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 噪音 ${args.decibels} dB`, c: '#c0392b' };
  if (name === 'PenaltyApplied')   return { t: `Room ${ROOM_NAMES[Number(args.offenderRoom)]} 扣款 ${fmt(args.penaltyAmount)} ETH`, c: '#b45309' };
  if (name === 'Deposited')        return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 存入 ${fmt(args.amount)} ETH`, c: '#15803d' };
  if (name === 'TenantRegistered') return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 入住`, c: M.body };
  if (name === 'AppealCreated')    return { t: `提案 #${args.proposalId} 申訴成立`, c: M.body };
  if (name === 'VoteCast')         return { t: `提案 #${args.proposalId} 投票`, c: M.body };
  if (name === 'ProposalExecuted') return { t: `提案 #${args.proposalId} ${args.passed ? '通過' : '否決'}`, c: args.passed ? '#15803d' : '#c0392b' };
  return { t: name, c: M.muted };
}

export default function Dashboard({ account, isLandlord, isUnknown, rooms, violations, logs, flashRoom, loadAll }) {
  if (!account) return (
    <div style={{ background: M.surface, border: `1px solid ${M.border}`, padding: 52, textAlign: 'center', color: M.muted, fontSize: 15 }}>請先連接 MetaMask</div>
  );

  const displayRooms = rooms.length
    ? rooms
    : ROOM_NAMES.map((name, i) => ({ i, name, tenant: null, registered: false, free: 0n, locked: 0n }));

  return (
    <>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 28, border: `1px solid ${M.border}`, background: M.surface }}>
        {SUMMARY_ITEMS.map((item, idx) => (
          <div key={item.label} style={{ padding: '24px 22px', borderLeft: idx > 0 ? `1px solid ${M.border}` : 'none' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: M.muted, marginBottom: 10, textTransform: 'uppercase' }}>{item.label}</div>
            <div style={{ fontSize: 24, fontWeight: 300, color: M.heading }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Rooms */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 28, border: `1px solid ${M.border}`, background: M.surface }}>
        {displayRooms.map((r, idx) => (
          <div key={r.i} style={{
            padding: '20px 18px',
            borderLeft: idx > 0 ? `1px solid ${M.border}` : 'none',
            background: flashRoom === r.i ? '#fff5f5' : M.surface,
            transition: 'background 0.3s',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', color: M.muted, marginBottom: 6, textTransform: 'uppercase' }}>Room {ROOM_LABELS[r.i]}</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: M.heading, marginBottom: 10 }}>{r.name}</div>
            {r.registered ? (
              <>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: M.muted, marginBottom: 8, wordBreak: 'break-all' }}>{r.tenant?.slice(0, 8)}...</div>
                <div style={{ fontSize: 18, fontWeight: 300, color: flashRoom === r.i ? '#c0392b' : M.heading }}>
                  {fmt(r.free)} <span style={{ fontSize: 12, color: M.muted }}>ETH</span>
                </div>
                {r.locked > 0n && <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>鎖定 {fmt(r.locked)} ETH</div>}
              </>
            ) : (
              <div style={{ fontSize: 13, color: M.muted }}>空房</div>
            )}
          </div>
        ))}
      </div>

      {/* Event log */}
      <div style={{ border: `1px solid ${M.border}`, background: M.surface, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: violations.length > 0 ? 28 : 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${M.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: M.surface2 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>Event Log</div>
          <button onClick={loadAll}
            style={{ background: 'transparent', border: `1px solid ${M.border}`, color: M.muted, padding: '5px 14px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.target.style.borderColor = M.borderStrong; e.target.style.color = M.heading; }}
            onMouseLeave={e => { e.target.style.borderColor = M.border; e.target.style.color = M.muted; }}>
            重新整理
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: M.surface2 }}>
              {['Block', '事件', 'Tx Hash'].map(h => (
                <th key={h} style={{ padding: '10px 24px', textAlign: 'left', fontSize: 11, color: M.muted, fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: 36, textAlign: 'center', color: M.muted, fontSize: 14 }}>尚無紀錄</td></tr>
            ) : logs.map((log, i) => {
              const { t, c } = logDesc(log);
              return (
                <tr key={i} style={{ borderTop: `1px solid ${M.border}` }}>
                  <td style={{ padding: '12px 24px', color: M.muted, fontSize: 13, fontFamily: 'monospace' }}>#{log.block}</td>
                  <td style={{ padding: '12px 24px', color: c, fontSize: 14 }}>{t}</td>
                  <td style={{ padding: '12px 24px', fontFamily: 'monospace', fontSize: 12, color: M.muted }}>{log.tx.slice(0, 14)}...</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Violations */}
      {violations.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, marginBottom: 14, textTransform: 'uppercase' }}>違規紀錄</div>
          <div style={{ border: `1px solid ${M.border}`, background: M.surface }}>
            {violations.map((v, i) => (
              <div key={v.id} style={{ padding: '14px 24px', borderTop: i > 0 ? `1px solid ${M.border}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 14, color: M.body }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: M.muted, marginRight: 12 }}>#{v.id}</span>
                  Room {ROOM_NAMES[v.room]} · {v.db} dB · 罰款 {fmt(v.penalty)} ETH
                </div>
                <div style={{ fontSize: 11, color: v.appealed ? M.body : M.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {v.appealed ? '申訴中' : '已結案'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
