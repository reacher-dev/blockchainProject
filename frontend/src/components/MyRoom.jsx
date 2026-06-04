import { useState } from "react";
import { ROOM_NAMES, fmt } from "../Web3.js";

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff" };
const ROOM_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const ROOM_LABELS = ["A", "B", "C", "D", "E"];
const PAGE_SIZE   = 5;
const DB_MAX = 110, DB_MIN = 30, SVG_W = 500, SVG_H = 72;

function Placeholder({ text }) {
  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 52, textAlign: "center", color: S.muted, fontSize: 18 }}>
      {text}
    </div>
  );
}

function DbChart({ dbHistory, backendNoise, lastDb }) {
  const pts = dbHistory
    .map((v, i) => `${(i / (dbHistory.length - 1)) * SVG_W},${SVG_H - ((Math.min(Math.max(v, DB_MIN), DB_MAX) - DB_MIN) / (DB_MAX - DB_MIN)) * SVG_H}`)
    .join(" ");
  const threshold70y = SVG_H - ((70 - DB_MIN) / (DB_MAX - DB_MIN)) * SVG_H;
  const db = Number.isFinite(lastDb) ? lastDb : 0;
  const isAlert = db > 70;

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: "20px 24px", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>即時分貝</span>
        <span style={{ fontSize: 28, fontWeight: 900, color: isAlert ? "#dc2626" : "#6b705c" }}>
          {db.toFixed(0)} dB
        </span>
      </div>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: "100%", height: SVG_H, display: "block" }}>
        <line x1="0" y1={threshold70y} x2={SVG_W} y2={threshold70y} stroke="#dc2626" strokeWidth="1" strokeDasharray="5,4" opacity="0.4" />
        <polyline fill="none" stroke="#6b705c" strokeWidth="2.5" strokeLinejoin="round" points={pts} />
      </svg>
      <div style={{ fontSize: 14, color: S.muted, marginTop: 6 }}>
        <span style={{ color: "#dc2626" }}>— </span>噪音門檻 70 dB
        {backendNoise && (
          <span style={{ marginLeft: 16, color: backendNoise.reportAllowed ? "#dc2626" : S.muted }}>
            {backendNoise.roomLabel} · {backendNoise.source} · {backendNoise.eventType ?? "monitoring"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MyRoom({ account, myRoom, rooms, violations, loading, handleAppeal,
  depAmt, setDepAmt, handleDeposit, dbHistory = Array(30).fill(42), backendNoise = null, lastDb = 42 }) {

  const [appealReasons, setAppealReasons] = useState({});
  const [openAppeal,    setOpenAppeal]    = useState(null);
  const [expandedVid,   setExpandedVid]   = useState(null);
  const [page,          setPage]          = useState(0);

  if (!account) return <Placeholder text="請先連接 MetaMask" />;
  if (myRoom === null) return <Placeholder text="您尚未入住任何房間" />;

  const roomData    = rooms.find(r => r.i === myRoom);
  const myViolations= violations.filter(v => v.room === myRoom);
  const unappealed  = myViolations.filter(v => !v.appealed);
  const totalPages  = Math.ceil(myViolations.length / PAGE_SIZE);
  const pageSlice   = myViolations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const inp = { padding: "10px 14px", border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 17, background: S.card, color: S.text, width: "100%", boxSizing: "border-box" };
  const btn = (bg) => ({ padding: "10px 18px", background: bg, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 17, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 });

  function submitAppeal(vid) {
    const reason = (appealReasons[vid] || "").trim();
    if (!reason) return;
    handleAppeal(vid, reason);
    setOpenAppeal(null);
    setAppealReasons(prev => ({ ...prev, [vid]: "" }));
  }

  return (
    <>
      {/* Real-time dB chart */}
      <DbChart dbHistory={dbHistory} backendNoise={backendNoise} lastDb={lastDb} />

      {/* Room info */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, overflow: "hidden", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ height: 6, background: roomData ? ROOM_COLORS[myRoom] : "#cbd5e1" }} />
        <div style={{ padding: 28 }}>
          <div style={{ fontSize: 15, color: S.muted, fontWeight: 700, letterSpacing: 1.2, marginBottom: 4 }}>ROOM {ROOM_LABELS[myRoom]}</div>
          <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 20 }}>{ROOM_NAMES[myRoom]}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "#f8fafc", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 15, color: S.muted, marginBottom: 4 }}>可用餘額</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{roomData ? fmt(roomData.free) : "—"} ETH</div>
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

      {/* Deposit */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 12 }}>補充押金</div>
        <div style={{ display: "flex", gap: 12 }}>
          <input style={inp} value={depAmt} onChange={e => setDepAmt(e.target.value)} placeholder="0.1" />
          <button onClick={handleDeposit} disabled={loading} style={btn("#10b981")}>存入 ETH</button>
        </div>
      </div>

      {/* Unappealed warning */}
      {unappealed.length > 0 && (
        <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 12, padding: "14px 20px", marginBottom: 24, fontSize: 17, color: "#854d0e", fontWeight: 500 }}>
          您有 {unappealed.length} 筆未申訴的違規紀錄，申訴期限為違規後 5 分鐘內。
        </div>
      )}

      {/* Violations list */}
      {myViolations.length > 0 ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: S.text }}>違規紀錄（共 {myViolations.length} 筆）</div>
            {totalPages > 1 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${S.border}`, background: page === 0 ? "#f8fafc" : S.card, color: page === 0 ? S.muted : S.text, cursor: page === 0 ? "default" : "pointer", fontSize: 15 }}>
                  上一頁
                </button>
                <span style={{ fontSize: 15, color: S.muted }}>{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                  style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${S.border}`, background: page === totalPages - 1 ? "#f8fafc" : S.card, color: page === totalPages - 1 ? S.muted : S.text, cursor: page === totalPages - 1 ? "default" : "pointer", fontSize: 15 }}>
                  下一頁
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pageSlice.map(v => (
              <div key={v.id} style={{ background: S.card, border: `1px solid ${v.appealed ? S.border : "#fde047"}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

                {/* Row */}
                <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, color: "#dc2626" }}>#{v.id}</span>
                    <span style={{ fontSize: 16, color: S.text }}>{v.db} dB · {fmt(v.penalty)} ETH</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, color: v.appealed ? "#9333ea" : "#854d0e", fontWeight: 600, background: v.appealed ? "#faf5ff" : "#fef9c3", padding: "3px 10px", borderRadius: 999 }}>
                      {v.appealed ? "申訴中" : "未申訴"}
                    </span>
                    <button
                      onClick={() => setExpandedVid(expandedVid === v.id ? null : v.id)}
                      style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${S.border}`, background: "transparent", color: S.muted, cursor: "pointer", fontSize: 14 }}
                    >
                      {expandedVid === v.id ? "收起" : "查看詳情"}
                    </button>
                    {!v.appealed && (
                      <button
                        onClick={() => setOpenAppeal(openAppeal === v.id ? null : v.id)}
                        style={{ ...btn("#6366f1"), padding: "6px 14px", fontSize: 15 }}
                      >
                        {openAppeal === v.id ? "取消" : "提出申訴"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expand: details */}
                {expandedVid === v.id && (
                  <div style={{ padding: "12px 20px 16px", borderTop: `1px solid ${S.border}`, background: "#f8fafc", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, color: S.muted, marginBottom: 2 }}>違規 ID</div>
                      <div style={{ fontWeight: 700 }}>#{v.id}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: S.muted, marginBottom: 2 }}>分貝</div>
                      <div style={{ fontWeight: 700, color: "#dc2626" }}>{v.db} dB</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: S.muted, marginBottom: 2 }}>罰款金額</div>
                      <div style={{ fontWeight: 700 }}>{fmt(v.penalty)} ETH</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: S.muted, marginBottom: 2 }}>申訴狀態</div>
                      <div style={{ fontWeight: 700, color: v.appealed ? "#9333ea" : "#854d0e" }}>
                        {v.appealed ? "申訴中" : "未申訴"}
                      </div>
                    </div>
                    {v.reportedAt > 0 && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: 13, color: S.muted, marginBottom: 2 }}>違規時間</div>
                        <div style={{ fontWeight: 600 }}>
                          {new Date(v.reportedAt * 1000).toLocaleString("zh-TW")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Appeal form */}
                {openAppeal === v.id && !v.appealed && (
                  <div style={{ padding: "0 20px 18px", borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>
                    <label style={{ fontSize: 15, color: S.muted, display: "block", marginBottom: 6 }}>申訴原因</label>
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
