import { useState } from "react";

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0" };

export default function IdentitySetup({ address, onConfirm }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function handleConfirm() {
    if (!name.trim()) { setError("請輸入名字"); return; }
    onConfirm(name.trim());
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Noto Sans TC', system-ui, sans-serif", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 20, padding: "44px 48px",
        maxWidth: 400, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 24, color: S.text, marginBottom: 4 }}>
          歡迎，您是房東
        </div>
        <div style={{ color: S.muted, fontSize: 13, marginBottom: 32, fontFamily: "monospace" }}>
          {address.slice(0, 10)}...{address.slice(-8)}
        </div>

        <label style={{ display: "block", fontSize: 14, color: S.muted, fontWeight: 600, marginBottom: 6 }}>
          請輸入您的名字
        </label>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setError(""); }}
          placeholder="例：Frank"
          autoFocus
          onKeyDown={e => e.key === "Enter" && handleConfirm()}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 10,
            border: `1.5px solid ${S.border}`, fontSize: 16, color: S.text,
            background: "#f8fafc", boxSizing: "border-box",
            outline: "none", fontFamily: "inherit", marginBottom: 20,
          }}
        />

        {error && (
          <div style={{ color: "#dc2626", fontSize: 14, marginBottom: 14 }}>{error}</div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          style={{
            width: "100%", padding: "13px", borderRadius: 10, border: "none",
            background: name.trim() ? "#3b82f6" : "#e2e8f0",
            color: name.trim() ? "#fff" : S.muted,
            fontWeight: 700, fontSize: 17,
            cursor: name.trim() ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          確認進入
        </button>
      </div>
    </div>
  );
}
