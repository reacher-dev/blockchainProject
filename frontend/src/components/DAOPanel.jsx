const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff" };

const VOTING_WINDOW_SEC = 300; // must match APPEAL_WINDOW in RentEscrow.sol

const mkBtn = (bg, loading) => ({
  padding: "11px 20px", background: bg, color: "#fff", border: "none",
  borderRadius: 9, fontWeight: 700, fontSize: 17,
  cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
});

function Placeholder({ text }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 52, textAlign: "center", color: S.muted, fontSize: 18 }}>
      {text}
    </div>
  );
}

export default function DAOPanel({ account, loading, proposals, handleVote, handleExecute, qvCounts, setQvCounts }) {
  if (!account) return <Placeholder text="請先連接 MetaMask" />;

  const now = Math.floor(Date.now() / 1000);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 24, color: S.text }}>申訴提案</div>
      </div>

      {/* QV rules */}
      <div style={{ background: "#f8fafc", border: `1px solid ${S.border}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, fontSize: 15, color: S.muted, lineHeight: 1.8 }}>
        <strong style={{ color: S.text }}>投票規則（二次方投票 QV）</strong>
        <span style={{ marginLeft: 12 }}>
          yesVotes &gt; noVotes 即通過 · 每人 9 credits · 投 1 票花 1、投 2 票花 4、投 3 票花 9
        </span>
        <span style={{ marginLeft: 12 }}>· 投票窗口：{VOTING_WINDOW_SEC / 60} 分鐘</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {proposals.length === 0 ? (
          <Placeholder text="目前無申訴提案" />
        ) : proposals.map(p => {
          const total = p.yesVotes + p.noVotes;
          const pct   = total > 0 ? Math.round(p.yesVotes / total * 100) : 0;
          const vc    = qvCounts[p.id] ?? 1;
          const cost  = vc * vc;
          const canVote = !p.hasVoted && account?.toLowerCase() !== p.appellant.toLowerCase();

          // canExecute: voting window expired OR all eligible voters have voted
          const windowExpired  = p.createdAt > 0 && now > p.createdAt + VOTING_WINDOW_SEC;
          const allVoted       = p.totalEligibleVoters > 0 && p.voterCount >= p.totalEligibleVoters;
          const canExecute     = !p.executed && (windowExpired || allVoted);
          const executeReason  = allVoted ? "所有人已投票" : windowExpired ? "投票窗口已結束" : "";

          return (
            <div key={p.id} style={{ background: S.card, border: `1px solid ${p.executed ? S.border : canExecute ? "#3b82f6" : "#c4b5fd"}`, borderRadius: 16, padding: 28, boxShadow: canExecute && !p.executed ? "0 0 0 3px rgba(59,130,246,0.15)" : "0 1px 3px rgba(0,0,0,0.04)", transition: "box-shadow 0.2s" }}>

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>
                  提案 #{p.id}
                  <span style={{ fontWeight: 400, fontSize: 17, color: S.muted }}> · 違規 #{p.violationId}</span>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {canExecute && !p.executed && (
                    <span style={{ fontSize: 13, color: "#3b82f6", fontWeight: 600, background: "#eff6ff", padding: "3px 10px", borderRadius: 999 }}>
                      可結案
                    </span>
                  )}
                  <span style={{ fontSize: 16, padding: "4px 14px", borderRadius: 999, fontWeight: 700, background: p.executed ? (p.passed ? "#f0fdf4" : "#fef2f2") : "#faf5ff", color: p.executed ? (p.passed ? "#15803d" : "#dc2626") : "#9333ea" }}>
                    {p.executed ? (p.passed ? "通過" : "否決") : "投票中"}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 15, color: S.muted, marginBottom: 8 }}>
                申訴者 {p.appellant.slice(0, 10)}...
                {p.createdAt > 0 && (
                  <span style={{ marginLeft: 12 }}>
                    · 截止 {new Date((p.createdAt + VOTING_WINDOW_SEC) * 1000).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {p.totalEligibleVoters > 0 && (
                  <span style={{ marginLeft: 12 }}>· 已投 {p.voterCount} / {p.totalEligibleVoters} 人</span>
                )}
              </div>

              {/* Progress bar */}
              <div style={{ background: "#f1f5f9", borderRadius: 6, height: 8, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "#22c55e", transition: "width 0.4s" }} />
              </div>
              <div style={{ fontSize: 16, color: S.muted, marginBottom: 18 }}>
                贊成 {p.yesVotes} 票 · 反對 {p.noVotes} 票
              </div>

              {/* Vote controls */}
              {!p.executed && (
                <div>
                  {canVote ? (
                    <div>
                      <div style={{ fontSize: 16, color: S.muted, marginBottom: 10 }}>
                        剩餘 credits：
                        <strong style={{ color: (9 - (p.usedCredits || 0)) < cost ? "#dc2626" : S.text }}>
                          {9 - (p.usedCredits || 0)}
                        </strong>
                        {" / 9 · 投 "}
                        <strong>{vc}</strong>
                        {" 票，花費 "}
                        <strong>{cost}</strong>
                        {" credits"}
                      </div>
                      <input
                        type="range" min={1} max={3} step={1}
                        value={vc}
                        onChange={e => setQvCounts(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                        style={{ width: "100%", accentColor: "#6b705c", marginBottom: 14 }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => handleVote(p.id, true,  vc)} disabled={loading} style={{ ...mkBtn("#22c55e", loading), flex: 1 }}>贊成 {vc} 票</button>
                        <button onClick={() => handleVote(p.id, false, vc)} disabled={loading} style={{ ...mkBtn("#dc2626", loading), flex: 1 }}>反對 {vc} 票</button>
                        <button
                          onClick={() => handleExecute(p.id)}
                          disabled={loading}
                          style={{
                            ...mkBtn(canExecute ? "#3b82f6" : "#475569", loading),
                            fontWeight: canExecute ? 900 : 700,
                            outline: canExecute ? "2px solid #93c5fd" : "none",
                            outlineOffset: 2,
                          }}
                          title={executeReason}
                        >
                          結案
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 16, color: S.muted, flex: 1 }}>
                        {p.hasVoted ? `已投票（花費 ${p.usedCredits} credits）` : "申訴者不可投票"}
                      </span>
                      <button
                        onClick={() => handleExecute(p.id)}
                        disabled={loading}
                        style={{
                          ...mkBtn(canExecute ? "#3b82f6" : "#475569", loading),
                          fontWeight: canExecute ? 900 : 700,
                          outline: canExecute ? "2px solid #93c5fd" : "none",
                          outlineOffset: 2,
                        }}
                        title={executeReason}
                      >
                        結案
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
