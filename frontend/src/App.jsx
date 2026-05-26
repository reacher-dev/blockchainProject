import { useState, useEffect, useRef } from "react";
import { connectWallet, signAsOracle, ROOM_NAMES, CONTRACT_ADDRESS, fmt } from "./web3.js";

const C = { bg: "#fdfbf7", text: "#433d3c", sage: "#6b705c", border: "#e8e5df", card: "#ffffff", muted: "#9b9590" };
const SENSOR_API_URL = import.meta.env.VITE_SENSOR_API_URL || "http://127.0.0.1:8000";

function sensorDb(data) {
  if (!data) return null;
  const value = data.estimatedDb ?? data.estimated_db ?? data.decibels;
  return Number(value);
}

export default function App() {
  const [contract, setContract] = useState(null);
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("dashboard");

  const [rooms, setRooms] = useState([]);
  const [violations, setViolations] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [logs, setLogs] = useState([]);

  const [mockRoom, setMockRoom] = useState(2);
  const [mockDb, setMockDb] = useState(75);
  const [flashRoom, setFlashRoom] = useState(null);

  const [dbHistory, setDbHistory] = useState(Array(30).fill(42));
  const [backendNoise, setBackendNoise] = useState(null);
  const lastBackendTimestamp = useRef(null);
  const lastChainSyncTimestamp = useRef(null);
  const contractRef = useRef(null);
  const providerRef = useRef(null);
  const accountRef = useRef(null);

  const [appealVid, setAppealVid] = useState("");
  const [appealReason, setAppealReason] = useState("");
  const [regRoom, setRegRoom] = useState(0);
  const [regAddr, setRegAddr] = useState("");
  const [depAmt, setDepAmt] = useState("0.1");

  useEffect(() => {
    const id = setInterval(() => {
      if (!backendNoise) setDbHistory(h => [...h.slice(1), 38 + Math.random() * 9]);
    }, 1200);
    return () => clearInterval(id);
  }, [backendNoise]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendNoise() {
      try {
        const res = await fetch(`${SENSOR_API_URL}/noise/latest`);
        if (!res.ok) return;

        const json = await res.json();
        const data = json.data;
        if (cancelled || !data) return;

        setBackendNoise(data);

        const currentDb = sensorDb(data);

        if (data.timestamp !== lastBackendTimestamp.current) {
          lastBackendTimestamp.current = data.timestamp;
          if (Number.isFinite(currentDb)) setDbHistory(h => [...h.slice(1), currentDb]);
          if (data.reportAllowed) {
            setFlashRoom(Number(data.roomIndex));
            setTimeout(() => setFlashRoom(null), 2000);
          }

          if (
            data.onchain?.submitted &&
            data.timestamp !== lastChainSyncTimestamp.current &&
            contractRef.current
          ) {
            lastChainSyncTimestamp.current = data.timestamp;
            setTimeout(() => {
              loadAll(contractRef.current, providerRef.current, accountRef.current);
            }, 900);
          }
        }
      } catch {
        if (!cancelled) setBackendNoise(null);
      }
    }

    loadBackendNoise();
    const id = setInterval(loadBackendNoise, 200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    contractRef.current = contract;
    providerRef.current = provider;
    accountRef.current = account;
  }, [contract, provider, account]);

  async function handleConnect() {
    try {
      const w = await connectWallet();
      if (w.chainId !== 31337n) { setMsg("⚠ 請切換到 Anvil（Chain ID: 31337）"); return; }
      setContract(w.contract); setProvider(w.provider);
      setAccount(w.address); setChainId(w.chainId);
      await loadAll(w.contract, w.provider, w.address);
      setMsg("");
    } catch (e) { setMsg("❌ " + e.message); }
  }

  async function loadAll(c, p, address) {
    const ct = c || contract; const pv = p || provider;
    if (!ct) return;
    await Promise.all([loadRooms(ct), loadViolations(ct), loadProposals(ct, address), loadLogs(ct, pv)]);
  }

  async function loadRooms(ct) {
    const list = await Promise.all(ROOM_NAMES.map(async (name, i) => {
      const t = await ct.tenants(i);
      const [free, locked] = await ct.getDeposit(i);
      return { i, name, registered: t.registered, free, locked };
    }));
    setRooms(list);
  }

  async function loadViolations(ct) {
    const count = Number(await ct.violationCount());
    const list = [];
    for (let i = count - 1; i >= Math.max(0, count - 8); i--) {
      const v = await ct.violations(i);
      list.push({ id: i, room: Number(v.roomIndex), db: Number(v.decibels), penalty: v.penaltyPaid, appealed: v.appealed });
    }
    setViolations(list);
  }

  async function loadProposals(ct, address) {
    const count = Number(await ct.proposalCount());
    const list = [];
    for (let i = count - 1; i >= 0; i--) {
      const p = await ct.proposals(i);
      const [yes, no] = await ct.getVotes(i);
      const voter = address || account;
      const voted = voter ? await ct.hasVoted(i, voter) : false;
      list.push({ id: i, violationId: Number(p.violationId), appellant: p.appellant, yesVotes: Number(yes), noVotes: Number(no), executed: p.executed, passed: p.passed, hasVoted: voted });
    }
    setProposals(list);
  }

  async function loadLogs(ct, pv) {
    if (!pv) return;
    try {
      const raw = await pv.getLogs({ address: ct.target, fromBlock: 0, toBlock: "latest" });
      const parsed = raw.map(log => {
        try { const p = ct.interface.parseLog(log); return { name: p.name, args: p.args, block: log.blockNumber, tx: log.transactionHash }; }
        catch { return null; }
      }).filter(Boolean).reverse().slice(0, 8);
      setLogs(parsed);
    } catch { }
  }

  async function handleTrigger() {
    setLoading(true); setMsg("🔏 簽章中...");
    try {
      const nonce = await contract.reportNonce();
      const sig = await signAsOracle(CONTRACT_ADDRESS, chainId, mockRoom, mockDb, nonce);
      setMsg("📡 送出交易...");
      const tx = await contract.reportNoise(mockRoom, BigInt(mockDb), nonce, sig);
      setFlashRoom(mockRoom);
      setDbHistory(h => [...h.slice(1), mockDb]);
      await tx.wait();
      setTimeout(() => setFlashRoom(null), 2000);
      setMsg(`✅ Room ${ROOM_NAMES[mockRoom]} 違規上鏈`);
      await loadAll();
    } catch (e) { setMsg("❌ " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function handleRegister() {
    setLoading(true);
    try { const tx = await contract.registerTenant(regRoom, regAddr); await tx.wait(); setMsg(`✅ Room ${ROOM_NAMES[regRoom]} 已登記`); await loadRooms(contract); }
    catch (e) { setMsg("❌ " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function handleDeposit() {
    setLoading(true);
    try { const { ethers } = await import("ethers"); const tx = await contract.deposit({ value: ethers.parseEther(depAmt) }); await tx.wait(); setMsg("✅ 存入成功"); await loadRooms(contract); }
    catch (e) { setMsg("❌ " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function handleAppeal() {
    setLoading(true);
    try { const tx = await contract.createAppeal(BigInt(appealVid), appealReason); await tx.wait(); setMsg("✅ 申訴成立"); await loadAll(); }
    catch (e) { setMsg("❌ " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function handleVote(pid, approve) {
    setLoading(true);
    try { const tx = await contract.vote(BigInt(pid), approve); await tx.wait(); setMsg("✅ 投票成功"); await loadProposals(contract); }
    catch (e) { setMsg("❌ " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function handleExecute(pid) {
    setLoading(true);
    try { const tx = await contract.executeProposal(BigInt(pid)); await tx.wait(); setMsg("✅ 結案完成"); await loadAll(); }
    catch (e) { setMsg("❌ " + (e.reason || e.message)); }
    setLoading(false);
  }

  function logDesc(log) {
    const { name, args } = log;
    if (name === "NoiseReported") return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 噪音 ${args.decibels} dB`, c: "#dc2626" };
    if (name === "PenaltyApplied") return { t: `Room ${ROOM_NAMES[Number(args.offenderRoom)]} 扣款 ${fmt(args.penaltyAmount)} ETH`, c: "#ea580c" };
    if (name === "Deposited") return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 存入 ${fmt(args.amount)} ETH`, c: "#16a34a" };
    if (name === "TenantRegistered") return { t: `Room ${ROOM_NAMES[Number(args.roomIndex)]} 入住`, c: "#0891b2" };
    if (name === "AppealCreated") return { t: `Proposal #${args.proposalId} 申訴成立`, c: "#9333ea" };
    if (name === "VoteCast") return { t: `Proposal #${args.proposalId} 投票`, c: "#7c3aed" };
    if (name === "ProposalExecuted") return { t: `Proposal #${args.proposalId} ${args.passed ? "通過" : "否決"}`, c: args.passed ? "#16a34a" : "#dc2626" };
    return { t: name, c: C.muted };
  }

  // SVG 分貝折線圖
  const dbMax = 110, dbMin = 30, svgW = 500, svgH = 80;
  const pts = dbHistory.map((v, i) => `${(i / (dbHistory.length - 1)) * svgW},${svgH - ((v - dbMin) / (dbMax - dbMin)) * svgH}`).join(" ");
  const threshold70y = svgH - ((70 - dbMin) / (dbMax - dbMin)) * svgH;
  const liveDb = sensorDb(backendNoise);
  const lastDb = Number.isFinite(liveDb) ? liveDb : dbHistory[dbHistory.length - 1];

  const inp = { padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.card, color: C.text, width: "100%", boxSizing: "border-box" };
  const btn = (bg = "#433d3c") => ({ padding: "10px 18px", background: bg, color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 });

  const displayRooms = rooms.length ? rooms : ROOM_NAMES.map((name, i) => ({ i, name, registered: false, free: 0n, locked: 0n }));

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Noto Sans TC', system-ui, sans-serif" }}>

      {/* Navbar */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(253,251,247,0.9)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}`, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58 }}>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.3px" }}>
          🏘️ DePIN <span style={{ fontWeight: 300, color: C.muted }}>NoiseGov</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["dashboard", "儀表板"], ["dao", "DAO 申訴"], ["admin", "管理"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: tab === k ? 700 : 400, background: tab === k ? "#433d3c" : "transparent", color: tab === k ? "#fff" : C.muted, fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <button onClick={handleConnect} style={{ padding: "8px 18px", borderRadius: 999, border: account ? "1px solid #86efac" : "none", background: account ? "#f0fdf4" : "#433d3c", color: account ? "#15803d" : "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          {account ? `✓ ${account.slice(0, 6)}...${account.slice(-4)}` : "連接 MetaMask"}
        </button>
      </nav>

      {msg && (
        <div style={{ padding: "9px 32px", fontSize: 13, borderBottom: `1px solid ${C.border}`, background: msg.startsWith("✅") ? "#f0fdf4" : msg.startsWith("❌") ? "#fef2f2" : "#fefce8" }}>
          {msg}
        </div>
      )}

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── 儀表板 ── */}
        {tab === "dashboard" && (
          <>
            {/* 房間狀態 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 28 }}>
              {displayRooms.map(r => (
                <div key={r.i} style={{ background: flashRoom === r.i ? "#fef2f2" : C.card, border: `1px solid ${flashRoom === r.i ? "#fca5a5" : C.border}`, borderRadius: 14, padding: "16px 14px", transition: "all 0.3s", transform: flashRoom === r.i ? "scale(1.03)" : "scale(1)" }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>ROOM {["A", "B", "C", "D", "E"][r.i]}</div>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>{r.name}</div>
                  {r.registered ? (
                    <>
                      <div style={{ fontSize: 13, color: C.sage, fontWeight: 700 }}>{fmt(r.free)} ETH</div>
                      {r.locked > 0n && <div style={{ fontSize: 11, color: "#ea580c", marginTop: 3 }}>🔒 {fmt(r.locked)}</div>}
                    </>
                  ) : <div style={{ fontSize: 11, color: C.muted }}>空房</div>}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
              {/* MockControl */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
                <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>⚡ 噪音觸發</div>
                <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>違規房間</label>
                <select value={mockRoom} onChange={e => setMockRoom(Number(e.target.value))} style={{ ...inp, marginBottom: 14 }}>
                  {ROOM_NAMES.map((n, i) => <option key={i} value={i}>Room {["A", "B", "C", "D", "E"][i]} — {n}</option>)}
                </select>
                <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>分貝數：<strong style={{ color: mockDb >= 86 ? "#dc2626" : mockDb >= 71 ? "#ea580c" : C.sage }}>{mockDb} dB</strong></label>
                <input type="range" min={40} max={120} value={mockDb} onChange={e => setMockDb(Number(e.target.value))} style={{ width: "100%", accentColor: C.sage, marginBottom: 18 }} />
                <button onClick={handleTrigger} disabled={loading || !contract} style={btn("#dc2626")}>
                  {loading ? "處理中..." : "發送違規報告"}
                </button>
              </div>

              {/* 分貝圖 */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>📊 即時分貝</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: lastDb > 70 ? "#dc2626" : C.sage }}>{lastDb.toFixed(0)} dB</span>
                </div>
                <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", height: 80, display: "block" }}>
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.sage} stopOpacity="0.25" />
                      <stop offset="100%" stopColor={C.sage} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1={threshold70y} x2={svgW} y2={threshold70y} stroke="#dc2626" strokeWidth="1" strokeDasharray="5,4" opacity="0.4" />
                  <polyline fill="none" stroke={C.sage} strokeWidth="2.5" strokeLinejoin="round" points={pts} />
                </svg>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                  <span style={{ color: "#dc2626" }}>— </span>噪音門檻 70 dB
                </div>
                {backendNoise && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>Backend Sensor</span>
                    <span style={{ color: backendNoise.reportAllowed ? "#dc2626" : C.sage, fontWeight: 700 }}>
                      {backendNoise.roomLabel} · {sensorDb(backendNoise)?.toFixed(0)} dB · level {backendNoise.noiseLevel ?? "--"} · {backendNoise.eventType ?? "event"} · {backendNoise.source}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Event Log */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>📋 Event Logs</span>
                {account && <button onClick={() => loadAll()} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: C.sage }}>🔄 刷新</button>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8f6f2" }}>
                  {["Block", "事件", "TX"].map(h => <th key={h} style={{ padding: "9px 20px", textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: 28, textAlign: "center", color: C.muted, fontSize: 13 }}>{account ? "尚無紀錄" : "連接錢包後顯示"}</td></tr>
                  ) : logs.map((log, i) => {
                    const { t, c } = logDesc(log);
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "10px 20px", color: C.muted }}>#{log.block}</td>
                        <td style={{ padding: "10px 20px", color: c, fontWeight: 500 }}>{t}</td>
                        <td style={{ padding: "10px 20px", fontFamily: "monospace", fontSize: 11, color: "#6366f1" }}>{log.tx.slice(0, 10)}...</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 違規紀錄 */}
            {violations.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>⚠ 違規紀錄</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {violations.map(v => (
                    <div key={v.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                      <span><strong style={{ color: "#dc2626" }}>#{v.id}</strong> · Room {ROOM_NAMES[v.room]} · {v.db} dB · 罰款 {fmt(v.penalty)} ETH</span>
                      <span style={{ fontSize: 11, color: v.appealed ? "#9333ea" : C.muted }}>{v.appealed ? "申訴中" : "已結案"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── DAO 申訴 ── */}
        {tab === "dao" && (
          <>
            {account && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, marginBottom: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📝 發起申訴</div>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 10, alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>Violation ID</label>
                    <input style={inp} value={appealVid} onChange={e => setAppealVid(e.target.value)} placeholder="例：1" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>申訴原因</label>
                    <input style={inp} value={appealReason} onChange={e => setAppealReason(e.target.value)} placeholder="例：當晚是貓咪打翻東西" />
                  </div>
                  <button onClick={handleAppeal} disabled={loading || !appealVid || !appealReason} style={btn("#9333ea")}>提交</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {proposals.length === 0 ? (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 40, textAlign: "center", color: C.muted, fontSize: 14 }}>
                  目前無申訴提案
                </div>
              ) : proposals.map(p => {
                const total = p.yesVotes + p.noVotes;
                const pct = total > 0 ? Math.round(p.yesVotes / total * 100) : 0;
                return (
                  <div key={p.id} style={{ background: C.card, border: `1px solid ${p.executed ? C.border : "#c4b5fd"}`, borderRadius: 16, padding: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontWeight: 700 }}>Proposal #{p.id} <span style={{ fontWeight: 400, fontSize: 13, color: C.muted }}>· Violation #{p.violationId}</span></span>
                      <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, fontWeight: 700, background: p.executed ? (p.passed ? "#f0fdf4" : "#fef2f2") : "#faf5ff", color: p.executed ? (p.passed ? "#15803d" : "#dc2626") : "#9333ea" }}>
                        {p.executed ? (p.passed ? "✅ 通過" : "❌ 否決") : "⏳ 投票中"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>申訴者 {p.appellant.slice(0, 10)}...</div>
                    <div style={{ background: "#f1f5f9", borderRadius: 6, height: 8, marginBottom: 8, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#22c55e", transition: "width 0.4s" }} />
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>贊成 {p.yesVotes} 票 · 反對 {p.noVotes} 票</div>
                    {!p.executed && (
                      <div style={{ display: "flex", gap: 8 }}>
                        {!p.hasVoted && account?.toLowerCase() !== p.appellant.toLowerCase() ? (
                          <>
                            <button onClick={() => handleVote(p.id, true)} disabled={loading} style={{ ...btn("#22c55e"), flex: 1 }}>👍 贊成</button>
                            <button onClick={() => handleVote(p.id, false)} disabled={loading} style={{ ...btn("#dc2626"), flex: 1 }}>👎 反對</button>
                          </>
                        ) : <span style={{ fontSize: 12, color: C.muted }}>✓ 已投票</span>}
                        <button onClick={() => handleExecute(p.id)} disabled={loading} style={btn()}>結案</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── 管理 ── */}
        {tab === "admin" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>🏠 登記房客</div>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>房間</label>
              <select value={regRoom} onChange={e => setRegRoom(Number(e.target.value))} style={{ ...inp, marginBottom: 14 }}>
                {ROOM_NAMES.map((n, i) => <option key={i} value={i}>Room {["A", "B", "C", "D", "E"][i]} — {n}</option>)}
              </select>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>房客錢包地址</label>
              <input style={{ ...inp, marginBottom: 16 }} value={regAddr} onChange={e => setRegAddr(e.target.value)} placeholder="0x..." />
              <button onClick={handleRegister} disabled={loading || !regAddr || !contract} style={btn(C.sage)}>Register Tenant</button>
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>💰 存入保證金</div>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 6 }}>金額（ETH）</label>
              <input type="number" step="0.01" style={{ ...inp, marginBottom: 16 }} value={depAmt} onChange={e => setDepAmt(e.target.value)} />
              <button onClick={handleDeposit} disabled={loading || !contract} style={btn("#22c55e")}>Deposit</button>
            </div>
          </div>
        )}

      </div>

      <footer style={{ marginTop: 48, borderTop: `1px solid ${C.border}`, textAlign: "center", padding: "24px", fontSize: 12, color: C.muted }}>
        DePIN · DeFi · DAO — 去中心化租屋噪音治理系統
      </footer>
    </div>
  );
}
