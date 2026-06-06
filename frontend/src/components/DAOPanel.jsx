const M = {
  surface: '#f5f4f1', surface2: '#dddcda',
  border: 'rgba(0,0,0,0.08)', borderStrong: 'rgba(0,0,0,0.2)',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};
const VOTING_WINDOW_SEC = 300;

function OutlineBtn({ onClick, disabled, children, variant = 'default', title }) {
  const colors = {
    default: { border: M.borderStrong, color: M.heading, hover: '#0a0a0a' },
    danger:  { border: 'rgba(192,57,43,0.5)', color: '#c0392b', hover: '#c0392b' },
    active:  { border: M.heading, color: M.heading, hover: '#0a0a0a' },
  };
  const c = colors[variant] || colors.default;
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ flex: 1, padding: '11px 14px', background: 'transparent', border: `1px solid ${disabled ? M.border : c.border}`, color: disabled ? '#bbb' : c.color, fontSize: 11, letterSpacing: '0.13em', textTransform: 'uppercase', cursor: disabled ? 'default' : 'pointer', transition: 'all 0.2s' }}
      onMouseEnter={e => { if (!disabled) { e.target.style.background = c.hover; e.target.style.color = '#fff'; e.target.style.borderColor = c.hover; }}}
      onMouseLeave={e => { if (!disabled) { e.target.style.background = 'transparent'; e.target.style.color = c.color; e.target.style.borderColor = c.border; }}}>
      {children}
    </button>
  );
}

export default function DAOPanel({ account, loading, proposals, handleVote, handleExecute, qvCounts, setQvCounts }) {
  if (!account) return <div style={{ background: M.surface, border: `1px solid ${M.border}`, padding: 52, textAlign: 'center', color: M.muted, fontSize: 15 }}>請先連接 MetaMask</div>;

  const now = Math.floor(Date.now() / 1000);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase' }}>申訴提案</div>
      </div>

      <div style={{ border: `1px solid ${M.border}`, padding: '18px 24px', marginBottom: 24, background: M.surface2 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, textTransform: 'uppercase', marginBottom: 14 }}>投票規則 · Quadratic Voting</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: M.border }}>
          {[
            { label: '通過條件', value: '贊成 > 反對' },
            { label: '每人 Credits', value: '9 分' },
            { label: '投票費用', value: '1票=1分  2票=4分  3票=9分' },
            { label: '投票窗口', value: `${VOTING_WINDOW_SEC / 60} 分鐘` },
          ].map(item => (
            <div key={item.label} style={{ background: M.surface2, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: M.muted, marginBottom: 5, letterSpacing: '0.05em' }}>{item.label}</div>
              <div style={{ fontSize: 13, color: M.heading, fontWeight: 500 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {proposals.length === 0 ? (
        <div style={{ background: M.surface, border: `1px solid ${M.border}`, padding: 52, textAlign: 'center', color: M.muted, fontSize: 14 }}>目前無申訴提案</div>
      ) : proposals.map(p => {
        const total = p.yesVotes + p.noVotes;
        const pct   = total > 0 ? Math.round(p.yesVotes / total * 100) : 0;
        const vc    = qvCounts[p.id] ?? 1;
        const cost  = vc * vc;
        const canVote = !p.hasVoted && account?.toLowerCase() !== p.appellant.toLowerCase();
        const windowExpired = p.createdAt > 0 && now > p.createdAt + VOTING_WINDOW_SEC;
        const allVoted      = p.totalEligibleVoters > 0 && p.voterCount >= p.totalEligibleVoters;
        const canExecute    = !p.executed && (windowExpired || allVoted);
        const executeReason = allVoted ? '所有人已投票' : windowExpired ? '投票窗口已結束' : '';
        const statusLabel   = p.executed ? (p.passed ? '通過' : '否決') : '投票中';
        const statusColor   = p.executed ? (p.passed ? '#15803d' : '#c0392b') : M.muted;

        return (
          <div key={p.id} style={{ border: `1px solid ${canExecute && !p.executed ? M.borderStrong : M.border}`, background: M.surface, marginBottom: 14 }}>
            {/* Header */}
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${M.border}`, background: M.surface2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, color: M.heading }}>
                提案 <span style={{ fontFamily: 'monospace' }}>#{p.id}</span>
                <span style={{ color: M.muted, fontSize: 13, marginLeft: 10 }}>違規 #{p.violationId}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {canExecute && !p.executed && <span style={{ fontSize: 11, color: M.heading, letterSpacing: '0.1em', textTransform: 'uppercase' }}>可結案</span>}
                <span style={{ fontSize: 11, color: statusColor, letterSpacing: '0.13em', textTransform: 'uppercase' }}>{statusLabel}</span>
              </div>
            </div>

            {/* Info + progress */}
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${M.border}` }}>
              <div style={{ fontSize: 13, color: M.muted, marginBottom: 12 }}>
                申訴者 <span style={{ fontFamily: 'monospace', color: M.body }}>{p.appellant.slice(0, 10)}...</span>
                {p.createdAt > 0 && <span style={{ marginLeft: 14 }}>截止 {new Date((p.createdAt + VOTING_WINDOW_SEC) * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</span>}
                {p.totalEligibleVoters > 0 && <span style={{ marginLeft: 14 }}>已投 {p.voterCount} / {p.totalEligibleVoters} 人</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 2, background: 'rgba(0,0,0,0.06)' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#15803d', transition: 'width 0.4s' }} />
                </div>
                <div style={{ fontSize: 13, color: M.body, whiteSpace: 'nowrap' }}>贊成 {p.yesVotes} · 反對 {p.noVotes}</div>
              </div>
            </div>

            {/* Actions */}
            {!p.executed && (
              <div style={{ padding: '18px 22px' }}>
                {canVote ? (
                  <>
                    <div style={{ fontSize: 13, color: M.body, marginBottom: 12 }}>
                      剩餘 <span style={{ fontWeight: 500 }}>{9 - (p.usedCredits || 0)}</span> / 9 credits
                      <span style={{ color: M.muted, marginLeft: 12 }}>· 投 {vc} 票，花費 {cost} credits</span>
                    </div>
                    <input type="range" min={1} max={3} step={1} value={vc}
                      onChange={e => setQvCounts(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                      style={{ width: '100%', marginBottom: 14 }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <OutlineBtn onClick={() => handleVote(p.id, true, vc)} disabled={loading}>贊成 {vc} 票</OutlineBtn>
                      <OutlineBtn onClick={() => handleVote(p.id, false, vc)} disabled={loading} variant="danger">反對 {vc} 票</OutlineBtn>
                      <OutlineBtn onClick={() => handleExecute(p.id)} disabled={loading} variant={canExecute ? 'active' : 'default'} title={executeReason}>結案</OutlineBtn>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ flex: 1, fontSize: 13, color: M.muted }}>{p.hasVoted ? `已投票（花費 ${p.usedCredits} credits）` : '申訴者不可投票'}</div>
                    <OutlineBtn onClick={() => handleExecute(p.id)} disabled={loading} variant={canExecute ? 'active' : 'default'} title={executeReason}>結案</OutlineBtn>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
