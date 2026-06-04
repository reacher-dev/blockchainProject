const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0" };

export default function DeployPage({ address, onDeploy, deploying, error }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Noto Sans TC', system-ui, sans-serif", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 20, padding: "48px 52px",
        maxWidth: 460, width: "100%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        textAlign: "center",
      }}>
        <div style={{ fontWeight: 800, fontSize: 26, color: S.text, marginBottom: 6 }}>
          建立公寓
        </div>
        <div style={{ color: S.muted, fontSize: 13, marginBottom: 28, fontFamily: "monospace" }}>
          {address.slice(0, 10)}...{address.slice(-8)}
        </div>

        <div style={{
          background: "#f8fafc", borderRadius: 12, padding: "18px 22px",
          marginBottom: 32, textAlign: "left",
        }}>
          {[
            "目前尚無公寓合約",
            "部署後您將成為房東，可登記房客與管理合約",
            "合約地址將記錄在瀏覽器 localStorage 中",
          ].map((line, i) => (
            <div key={i} style={{ fontSize: 14, color: S.muted, lineHeight: 1.9 }}>
              · {line}
            </div>
          ))}
        </div>

        <button
          onClick={onDeploy}
          disabled={deploying}
          style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none",
            background: deploying ? "rgba(59,130,246,0.5)" : "#3b82f6",
            color: "#fff", fontWeight: 700, fontSize: 18,
            cursor: deploying ? "default" : "pointer",
            fontFamily: "inherit", transition: "background 0.2s",
          }}
        >
          {deploying ? "部署中，請稍候..." : "建立我的公寓"}
        </button>

        {error && (
          <div style={{ marginTop: 16, color: "#dc2626", fontSize: 14 }}>{error}</div>
        )}

        <div style={{ marginTop: 22, color: "rgba(0,0,0,0.25)", fontSize: 12 }}>
          部署需要支付少量 gas 費用（本地測試網絡費用幾乎為零）
        </div>
      </div>
    </div>
  );
}
