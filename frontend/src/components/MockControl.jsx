import { ROOM_NAMES } from "../Web3.js";

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff", sage: "#6b705c" };

function sensorDb(data) {
  if (!data) return null;
  const value = data.estimatedDb ?? data.estimated_db ?? data.decibels;
  return Number(value);
}

export default function MockControl({ contract, loading, mockRoom, setMockRoom, mockDb, setMockDb, handleTrigger, dbHistory, backendNoise, lastDb }) {
  const dbMax = 110, dbMin = 30, svgW = 500, svgH = 80;
  const pts = dbHistory
    .map((v, i) => `${(i / (dbHistory.length - 1)) * svgW},${svgH - ((v - dbMin) / (dbMax - dbMin)) * svgH}`)
    .join(" ");
  const threshold70y = svgH - ((70 - dbMin) / (dbMax - dbMin)) * svgH;

  const inp = { padding: "10px 14px", border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 17, background: S.card, color: S.text, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
      {/* Left — trigger controls */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 26, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ fontWeight: 700, marginBottom: 20, fontSize: 20 }}>噪音觸發（模擬）</div>

        <label style={{ fontSize: 16, color: S.muted, display: "block", marginBottom: 6 }}>違規房間</label>
        <select value={mockRoom} onChange={e => setMockRoom(Number(e.target.value))} style={{ ...inp, marginBottom: 18 }}>
          {ROOM_NAMES.map((n, i) => (
            <option key={i} value={i}>Room {["A", "B", "C", "D", "E"][i]} — {n}</option>
          ))}
        </select>

        <label style={{ fontSize: 16, color: S.muted, display: "block", marginBottom: 6 }}>
          分貝數：<strong style={{ color: mockDb >= 86 ? "#dc2626" : mockDb >= 71 ? "#ea580c" : S.sage }}>{mockDb} dB</strong>
        </label>
        <input
          type="range" min={40} max={120} value={mockDb}
          onChange={e => setMockDb(Number(e.target.value))}
          style={{ width: "100%", accentColor: S.sage, marginBottom: 22 }}
        />
        <button
          onClick={handleTrigger}
          disabled={loading || !contract}
          style={{ padding: "12px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 17, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, width: "100%" }}
        >
          {loading ? "處理中..." : "發送違規報告"}
        </button>
      </div>

      {/* Right — dB chart */}
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 26, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 20 }}>即時分貝</span>
          <span style={{ fontSize: 30, fontWeight: 900, color: lastDb > 70 ? "#dc2626" : S.sage }}>
            {lastDb.toFixed(0)} dB
          </span>
        </div>

        <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", height: 80, display: "block" }}>
          <line x1="0" y1={threshold70y} x2={svgW} y2={threshold70y} stroke="#dc2626" strokeWidth="1" strokeDasharray="5,4" opacity="0.4" />
          <polyline fill="none" stroke={S.sage} strokeWidth="2.5" strokeLinejoin="round" points={pts} />
        </svg>

        <div style={{ fontSize: 15, color: S.muted, marginTop: 8 }}>
          <span style={{ color: "#dc2626" }}>— </span>噪音門檻 70 dB
        </div>

        {backendNoise && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${S.border}`, display: "flex", justifyContent: "space-between", gap: 12, fontSize: 16 }}>
            <span style={{ color: S.muted }}>Backend Sensor</span>
            <span style={{ color: backendNoise.reportAllowed ? "#dc2626" : S.sage, fontWeight: 700 }}>
              {backendNoise.roomLabel} · {sensorDb(backendNoise)?.toFixed(0)} dB · {backendNoise.eventType ?? "event"} · {backendNoise.source}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
