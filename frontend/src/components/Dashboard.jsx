import { ROOM_NAMES, fmt } from "../Web3.js";

const ROOM_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const ROOM_LABELS = ["A", "B", "C", "D", "E"];

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff" };

const SUMMARY_ITEMS = [
  { label: "最低保證金",   value: "0.4 ETH",  color: "#3b82f6" },
  { label: "噪音門檻",     value: "70 dB",    color: "#ef4444" },
  { label: "申訴費用",     value: "0.01 ETH", color: "#f59e0b" },
  { label: "最低票數門檻", value: "3 票",     color: "#10b981" },
];

function logDesc(log) {
  const { name, args } = log;
  if (name === "NoiseReported")    return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 噪音 ${args.decibels} dB`, c: "#dc2626" };
  if (name === "PenaltyApplied")   return { t: `Room ${ROOM_NAMES[Number(args.offenderRoom)]} 扣款 ${fmt(args.penaltyAmount)} ETH`, c: "#ea580c" };
  if (name === "Deposited")        return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 存入 ${fmt(args.amount)} ETH`, c: "#16a34a" };
  if (name === "TenantRegistered") return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 入住`, c: "#0891b2" };
  if (name === "AppealCreated")    return { t: `提案 #${args.proposalId} 申訴成立`, c: "#9333ea" };
  if (name === "VoteCast")         return { t: `提案 #${args.proposalId} 投票`, c: "#7c3aed" };
  if (name === "ProposalExecuted") return { t: `提案 #${args.proposalId} ${args.passed ? "通過" : "否決"}`, c: args.passed ? "#16a34a" : "#dc2626" };
  return { t: name, c: S.muted };
}

export default function Dashboard({ account, isLandlord, rooms, violations, logs, flashRoom, loadAll }) {
  if (!account) {
    return (
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 52, textAlign: "center", color: S.muted, fontSize: 18 }}>
        請先連接 MetaMask
      </div>
    );
  }

  if (!isLandlord) {
    return (
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 52, textAlign: "center", fontSize: 18 }}>
        <div style={{ fontWeight: 700, color: S.text, marginBottom: 8 }}>僅房東可查看系統總覽</div>
        <div style={{ color: S.muted }}>請使用房東帳號連接</div>
      </div>
    );
  }

  const displayRooms = rooms.length
    ? rooms
    : ROOM_NAMES.map((name, i) => ({ i, name, registered: false, free: 0n, locked: 0n }));

  return (
    <>
      {/* Contract constants summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        {SUMMARY_ITEMS.map(item => (
          <div key={item.label} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: "18px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 15, color: S.muted, marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Room cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 28 }}>
        {displayRooms.map(r => (
          <div key={r.i} style={{
            background: flashRoom === r.i ? "#fff5f5" : S.card,
            border: `1px solid ${flashRoom === r.i ? "#fca5a5" : S.border}`,
            borderRadius: 14,
            overflow: "hidden",
            transition: "all 0.3s",
            transform: flashRoom === r.i ? "scale(1.04)" : "scale(1)",
            boxShadow: flashRoom === r.i ? "0 4px 18px rgba(239,68,68,0.18)" : "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            <div style={{ height: 5, background: ROOM_COLORS[r.i] }} />
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 15, color: S.muted, fontWeight: 700, letterSpacing: 1.2, marginBottom: 4 }}>
                ROOM {ROOM_LABELS[r.i]}
              </div>
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10, color: S.text }}>{r.name}</div>
              {r.registered ? (
                <>
                  <div style={{ fontSize: 18, color: ROOM_COLORS[r.i], fontWeight: 700 }}>{fmt(r.free)} ETH</div>
                  {r.locked > 0n && (
                    <div style={{ fontSize: 15, color: "#ea580c", marginTop: 4 }}>鎖定 {fmt(r.locked)} ETH</div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 16, color: S.muted }}>空房</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Event log */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, overflow: "hidden", marginBottom: violations.length > 0 ? 24 : 0, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${S.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 20 }}>Event Log</span>
          <button onClick={loadAll} style={{ background: "none", border: `1px solid ${S.border}`, borderRadius: 8, padding: "6px 14px", fontSize: 16, cursor: "pointer", color: S.muted }}>
            重新整理
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["BLOCK", "事件", "TX HASH"].map(h => (
                <th key={h} style={{ padding: "10px 24px", textAlign: "left", fontSize: 15, color: S.muted, fontWeight: 600, letterSpacing: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 36, textAlign: "center", color: S.muted, fontSize: 18 }}>尚無紀錄</td>
              </tr>
            ) : logs.map((log, i) => {
              const { t, c } = logDesc(log);
              return (
                <tr key={i} style={{ borderTop: `1px solid ${S.border}` }}>
                  <td style={{ padding: "12px 24px", color: S.muted, fontSize: 17 }}>#{log.block}</td>
                  <td style={{ padding: "12px 24px", color: c, fontWeight: 500, fontSize: 17 }}>{t}</td>
                  <td style={{ padding: "12px 24px", fontFamily: "monospace", fontSize: 15, color: "#6366f1" }}>{log.tx.slice(0, 12)}...</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* All violations */}
      {violations.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 14, color: S.text }}>違規紀錄</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {violations.map(v => (
              <div key={v.id} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 12, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <span style={{ fontSize: 18 }}>
                  <strong style={{ color: "#dc2626" }}>#{v.id}</strong>
                  {" · "}Room {ROOM_NAMES[v.room]} · {v.db} dB · 罰款 {fmt(v.penalty)} ETH
                </span>
                <span style={{ fontSize: 16, color: v.appealed ? "#9333ea" : S.muted, fontWeight: 600 }}>
                  {v.appealed ? "申訴中" : "已結案"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
