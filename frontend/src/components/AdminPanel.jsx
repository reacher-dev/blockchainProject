import { ROOM_NAMES } from "../Web3.js";
import MockControl from "./MockControl.jsx";

const S = { text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff" };
const ROOM_LABELS = ["A", "B", "C", "D", "E"];

export default function AdminPanel({
  account, isLandlord, contract, loading,
  rooms, regRoom, setRegRoom, regAddr, setRegAddr, handleRegister, mockControlProps,
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
  const displayRooms = rooms?.length
    ? rooms
    : ROOM_NAMES.map((name, i) => ({ i, name, tenant: null, registered: false }));

  return (
    <>
      {/* Register tenant */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 20,
          marginBottom: 28
        }}
      >
        <div
          style={{
            background: S.card,
            border: `1px solid ${S.border}`,
            borderRadius: 16,
            padding: 28,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 22 }}>
            登記房客
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 150px", gap: 12, alignItems: "end", marginBottom: 22 }}>
            <label>
              <div style={{ fontSize: 15, color: S.muted, marginBottom: 6 }}>房間</div>
              <select
                value={regRoom}
                onChange={(e) => setRegRoom(Number(e.target.value))}
                style={inp}
              >
                {ROOM_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    Room {ROOM_LABELS[i]} - {name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div style={{ fontSize: 15, color: S.muted, marginBottom: 6 }}>房客錢包地址</div>
              <input
                value={regAddr}
                onChange={(e) => setRegAddr(e.target.value)}
                placeholder="0x..."
                style={inp}
              />
            </label>

            <button
              onClick={handleRegister}
              disabled={loading || !contract || !regAddr.trim()}
              style={btn("#3b82f6")}
            >
              登記
            </button>
          </div>

          <div style={{ border: `1px solid ${S.border}`, borderRadius: 12, overflow: "hidden" }}>
            {displayRooms.map((room, idx) => (
              <div
                key={room.i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr",
                  gap: 12,
                  padding: "12px 14px",
                  borderTop: idx === 0 ? "none" : `1px solid ${S.border}`,
                  background: room.registered ? "#f8fafc" : "#fff",
                }}
              >
                <div style={{ fontWeight: 700, color: S.text }}>
                  Room {ROOM_LABELS[room.i]}
                </div>
                <div style={{ color: room.registered ? S.text : S.muted, fontFamily: room.registered ? "monospace" : "inherit", wordBreak: "break-all" }}>
                  {room.registered ? room.tenant : "尚未登記"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Noise trigger panel */}
      <div
        style={{
          fontWeight: 700,
          fontSize: 20,
          marginBottom: 14,
          color: S.text
        }}
      >
        噪音模擬與即時監測
      </div>

      <MockControl {...mockControlProps} />
    </>
  );
}
