import { ROOM_NAMES } from "../Web3.js";
import MockControl from "./MockControl.jsx";

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff" };
const ROOM_LABELS = ["A", "B", "C", "D", "E"];

export default function AdminPanel({
  account, isLandlord, contract, loading,
  regRoom, setRegRoom, regAddr, setRegAddr,
  depAmt, setDepAmt,
  handleRegister, handleDeposit,
  mockControlProps,
}) {
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
        <div style={{ fontWeight: 700, color: S.text, marginBottom: 8 }}>僅房東可操作管理功能</div>
        <div style={{ color: S.muted }}>請使用房東帳號連接</div>
      </div>
    );
  }

  const inp = { padding: "10px 14px", border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 17, background: S.card, color: S.text, width: "100%", boxSizing: "border-box" };
  const btn = (bg) => ({ padding: "12px 20px", background: bg, color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 17, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, width: "100%" });

  return (
    <>
      {/* Register + Deposit */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
        {/* Register tenant */}
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 22 }}>登記房客</div>

          <label style={{ fontSize: 16, color: S.muted, display: "block", marginBottom: 6 }}>房間</label>
          <select value={regRoom} onChange={e => setRegRoom(Number(e.target.value))} style={{ ...inp, marginBottom: 18 }}>
            {ROOM_NAMES.map((n, i) => (
              <option key={i} value={i}>Room {ROOM_LABELS[i]} — {n}</option>
            ))}
          </select>

          <label style={{ fontSize: 16, color: S.muted, display: "block", marginBottom: 6 }}>房客錢包地址</label>
          <input style={{ ...inp, marginBottom: 22 }} value={regAddr} onChange={e => setRegAddr(e.target.value)} placeholder="0x..." />

          <button onClick={handleRegister} disabled={loading || !regAddr || !contract} style={btn("#6b705c")}>
            Register Tenant
          </button>
        </div>

        {/* Deposit */}
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 22 }}>存入保證金</div>

          <label style={{ fontSize: 16, color: S.muted, display: "block", marginBottom: 6 }}>金額（ETH）</label>
          <input
            type="number" step="0.01"
            style={{ ...inp, marginBottom: 22 }}
            value={depAmt}
            onChange={e => setDepAmt(e.target.value)}
          />

          <button onClick={handleDeposit} disabled={loading || !contract} style={btn("#22c55e")}>
            Deposit
          </button>
        </div>
      </div>

      {/* Noise trigger panel */}
      <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 14, color: S.text }}>噪音模擬與即時監測</div>
      <MockControl {...mockControlProps} />
    </>
  );
}
