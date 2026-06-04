export default function Login({ onConnect, connecting, errorMsg }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Noto Sans TC', system-ui, sans-serif",
      padding: 24,
    }}>
      <div style={{
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 24,
        padding: "52px 56px",
        maxWidth: 460,
        width: "100%",
        textAlign: "center",
        boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 34, color: "#fff", marginBottom: 6, letterSpacing: "-0.5px" }}>
          DePIN <span style={{ fontWeight: 300, color: "rgba(255,255,255,0.4)" }}>NoiseGov</span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, marginBottom: 36 }}>
          去中心化租屋噪音治理系統
        </div>

        <div style={{
          background: "rgba(255,255,255,0.05)",
          borderRadius: 12,
          padding: "18px 22px",
          marginBottom: 32,
          textAlign: "left",
        }}>
          {[
            "連接後自動偵測身份（房東 / 房客）",
            "房東可管理合約、登記房客、審核申訴",
            "房客可查看房間狀態與提出申訴",
          ].map((line, i) => (
            <div key={i} style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 1.9 }}>
              · {line}
            </div>
          ))}
        </div>

        <button
          onClick={onConnect}
          disabled={connecting}
          style={{
            width: "100%",
            padding: "15px 24px",
            borderRadius: 12,
            border: "none",
            background: connecting ? "rgba(59,130,246,0.5)" : "#3b82f6",
            color: "#fff",
            fontWeight: 700,
            fontSize: 18,
            cursor: connecting ? "default" : "pointer",
            letterSpacing: "0.3px",
            transition: "background 0.2s",
          }}
        >
          {connecting ? "偵測身份中..." : "連接 MetaMask"}
        </button>

        {errorMsg && (
          <div style={{ marginTop: 16, color: "#fca5a5", fontSize: 14 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ marginTop: 22, color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
          需要安裝 MetaMask 瀏覽器擴充功能
        </div>
      </div>
    </div>
  );
}
