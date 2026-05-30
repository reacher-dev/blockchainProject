import { useState } from "react";
import { ROOM_NAMES, fmt } from "../Web3.js";

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff" };
const ROOM_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const ROOM_LABELS = ["A", "B", "C", "D", "E"];

function Placeholder({ text }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 52, textAlign: "center", color: S.muted, fontSize: 18 }}>
      {text}
    </div>
  );
}

export default function MyRoom({ account, myRoom, rooms, violations, loading, handleAppeal }) {
  const [appealReasons, setAppealReasons] = useState({});
  const [openAppeal,    setOpenAppeal]    = useState(null);

  if (!account) return <Placeholder text="請先連接 MetaMask" />;
  if (myRoom === null) return <Placeholder text="您尚未入住任何房間" />;

  const roomData = rooms.find(r => r.i === myRoom);
  const myViolations = violations.filter(v => v.room === myRoom);
  const unappealed   = myViolations.filter(v => !v.appealed);

  const inp = { padding: "10px 14px", border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 17, background: S.card, color: S.text, width: "100%", boxSizing: "border-box" };
  const btn = (bg) => ({ padding: "10px 18px", background: bg, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 17, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 });

  function submitAppeal(vid) {
    const reason = appealReasons[vid] || "";
    if (!reason.trim()) return;
    handleAppeal(vid, reason);
    setOpenAppeal(null);
    setAppealReasons(prev => ({ ...prev, [vid]: "" }));
  }

  return (
    <>
      {/* Room info card */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, overflow: "hidden", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ height: 6, background: roomData ? ROOM_COLORS[myRoom] : "#cbd5e1" }} />
        <div style={{ padding: 28 }}>
          <div style={{ fontSize: 15, color: S.muted, fontWeight: 700, letterSpacing: 1.2, marginBottom: 4 }}>
            ROOM {ROOM_LABELS[myRoom]}
          </div>
          <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 20 }}>
            {ROOM_NAMES[myRoom]}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "#f8fafc", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 15, color: S.muted, marginBottom: 4 }}>可用餘額</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b" }}>
                {roomData ? fmt(roomData.free) : "—"} ETH
              </div>
            </div>
            <div style={{ background: "#f8fafc", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 15, color: S.muted, marginBottom: 4 }}>鎖定金額</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: roomData?.locked > 0n ? "#ea580c" : "#64748b" }}>
                {roomData ? fmt(roomData.locked) : "—"} ETH
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Unappealed violations warning */}
      {unappealed.length > 0 && (
        <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 12, padding: "14px 20px", marginBottom: 24, fontSize: 17, color: "#854d0e", fontWeight: 500 }}>
          您有 {unappealed.length} 筆未申訴的違規紀錄，申訴期限為違規後 24 小時內。
        </div>
      )}

      {/* Violations list */}
      {myViolations.length > 0 ? (
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 14, color: S.text }}>違規紀錄</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {myViolations.map(v => (
              <div key={v.id} style={{ background: S.card, border: `1px solid ${v.appealed ? S.border : "#fde047"}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontWeight: 700, color: "#dc2626", marginRight: 10 }}>#{v.id}</span>
                    <span style={{ fontSize: 17, color: S.text }}>{v.db} dB · 罰款 {fmt(v.penalty)} ETH</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 16, color: v.appealed ? "#9333ea" : "#854d0e", fontWeight: 600, background: v.appealed ? "#faf5ff" : "#fef9c3", padding: "3px 10px", borderRadius: 999 }}>
                      {v.appealed ? "申訴中" : "未申訴"}
                    </span>
                    {!v.appealed && (
                      <button
                        onClick={() => setOpenAppeal(openAppeal === v.id ? null : v.id)}
                        style={{ ...btn("#6366f1"), padding: "7px 16px", fontSize: 16 }}
                      >
                        {openAppeal === v.id ? "取消" : "提出申訴"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline appeal form */}
                {openAppeal === v.id && !v.appealed && (
                  <div style={{ padding: "0 20px 18px", borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>
                    <label style={{ fontSize: 16, color: S.muted, display: "block", marginBottom: 6 }}>申訴原因</label>
                    <div style={{ display: "flex", gap: 10 }}>
                      <input
                        style={{ ...inp, flex: 1 }}
                        value={appealReasons[v.id] || ""}
                        onChange={e => setAppealReasons(prev => ({ ...prev, [v.id]: e.target.value }))}
                        placeholder="說明申訴理由，例如：當晚是貓咪打翻東西"
                      />
                      <button
                        onClick={() => submitAppeal(v.id)}
                        disabled={loading || !(appealReasons[v.id] || "").trim()}
                        style={{ ...btn("#9333ea"), whiteSpace: "nowrap" }}
                      >
                        提交
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, padding: 36, textAlign: "center", color: S.muted, fontSize: 18 }}>
          目前無違規紀錄
        </div>
      )}
    </>
  );
}
