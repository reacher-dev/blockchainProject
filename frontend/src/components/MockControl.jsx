const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff", sage: "#6b705c" };

function sensorDb(data) {
  if (!data) return null;
  return Number(data.estimatedDb ?? data.estimated_db ?? data.decibels);
}

export default function MockControl({ dbHistory, backendNoise, lastDb }) {
  const dbMax = 110, dbMin = 30, svgW = 500, svgH = 80;
  const pts = dbHistory
    .map((v, i) => `${(i / (dbHistory.length - 1)) * svgW},${svgH - ((v - dbMin) / (dbMax - dbMin)) * svgH}`)
    .join(" ");
  const threshold70y = svgH - ((70 - dbMin) / (dbMax - dbMin)) * svgH;

  return (
    <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 26, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }}>即時分貝監測</span>
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
          <span style={{ color: S.muted }}>Sensor</span>
          <span style={{ color: backendNoise.reportAllowed ? "#dc2626" : S.sage, fontWeight: 700 }}>
            {backendNoise.roomLabel} · {sensorDb(backendNoise)?.toFixed(0)} dB · {backendNoise.eventType ?? "monitoring"} · {backendNoise.source}
          </span>
        </div>
      )}
    </div>
  );
}
