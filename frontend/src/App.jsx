import { useState, useEffect, useRef } from "react";
import { connectWallet, signAsOracle, ROOM_NAMES, CONTRACT_ADDRESS } from "./Web3.js";
import MyRoom     from "./components/MyRoom.jsx";
import DAOPanel   from "./components/DAOPanel.jsx";
import Dashboard  from "./components/Dashboard.jsx";
import AdminPanel from "./components/AdminPanel.jsx";

const SENSOR_API_URL = import.meta.env.VITE_SENSOR_API_URL || "http://127.0.0.1:8000";

const S = { bg: "#f8fafc", text: "#1e293b", muted: "#64748b", border: "#e2e8f0", card: "#ffffff", blue: "#3b82f6" };

const TABS = [
  { key: "myroom",   label: "我的房間" },
  { key: "dao",      label: "DAO 投票" },
  { key: "overview", label: "系統總覽" },
  { key: "admin",    label: "管理"     },
];

function sensorDb(data) {
  if (!data) return null;
  const value = data.estimatedDb ?? data.estimated_db ?? data.decibels;
  return Number(value);
}

// Message bar styles by type
const MSG_STYLE = {
  success: { bg: "#f0fdf4", color: "#15803d" },
  warning: { bg: "#fefce8", color: "#854d0e" },
  info:    { bg: "#f1f5f9", color: "#475569" },
};

export default function App() {
  // ── Wallet & role ─────────────────────────────────────────────────────────
  const [contract,     setContract]     = useState(null);
  const [provider,     setProvider]     = useState(null);
  const [account,      setAccount]      = useState(null);
  const [chainId,      setChainId]      = useState(null);
  const [isLandlord,   setIsLandlord]   = useState(false);
  const [myRoom,       setMyRoom]       = useState(null); // null = not a tenant
  const [loading,      setLoading]      = useState(false);
  const [tab,          setTab]          = useState("myroom");

  // ── Message bar ───────────────────────────────────────────────────────────
  const [msg,     setMsg]     = useState("");
  const [msgType, setMsgType] = useState("info"); // 'success' | 'warning' | 'info'

  function flash(type, text) { setMsg(text); setMsgType(type); }
  function clearMsg()        { setMsg(""); }

  // ── Chain data ────────────────────────────────────────────────────────────
  const [rooms,      setRooms]      = useState([]);
  const [violations, setViolations] = useState([]);
  const [proposals,  setProposals]  = useState([]);
  const [logs,       setLogs]       = useState([]);

  // ── MockControl state ─────────────────────────────────────────────────────
  const [mockRoom,     setMockRoom]     = useState(2);
  const [mockDb,       setMockDb]       = useState(75);
  const [flashRoom,    setFlashRoom]    = useState(null);
  const [dbHistory,    setDbHistory]    = useState(Array(30).fill(42));
  const [backendNoise, setBackendNoise] = useState(null);

  // ── Admin state ───────────────────────────────────────────────────────────
  const [regRoom, setRegRoom] = useState(0);
  const [regAddr, setRegAddr] = useState("");
  const [depAmt,  setDepAmt]  = useState("0.1");

  // ── DAO state ─────────────────────────────────────────────────────────────
  const [qvCounts, setQvCounts] = useState({});

  // ── Refs ──────────────────────────────────────────────────────────────────
  const lastBackendTimestamp   = useRef(null);
  const lastChainSyncTimestamp = useRef(null);
  const contractRef = useRef(null);
  const providerRef = useRef(null);
  const accountRef  = useRef(null);

  // ── Simulated dB when no backend ─────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!backendNoise) setDbHistory(h => [...h.slice(1), 38 + Math.random() * 9]);
    }, 1200);
    return () => clearInterval(id);
  }, [backendNoise]);

  // ── Backend sensor polling ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function poll() {
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
          if (data.onchain?.submitted && data.timestamp !== lastChainSyncTimestamp.current && contractRef.current) {
            lastChainSyncTimestamp.current = data.timestamp;
            setTimeout(() => loadAll(contractRef.current, providerRef.current, accountRef.current), 900);
          }
        }
      } catch {
        if (!cancelled) setBackendNoise(null);
      }
    }
    poll();
    const id = setInterval(poll, 200);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    contractRef.current = contract;
    providerRef.current = provider;
    accountRef.current  = account;
  }, [contract, provider, account]);

  // ── Wallet connection & role detection ────────────────────────────────────
  async function handleConnect() {
    try {
      const w = await connectWallet();
      if (w.chainId !== 31337n) {
        flash('warning', '請將 MetaMask 切換到 Anvil 本地鏈（Chain ID: 31337，RPC: http://127.0.0.1:8545）');
        return;
      }
      setContract(w.contract); setProvider(w.provider);
      setAccount(w.address);   setChainId(w.chainId);

      // Detect role
      const landAddr  = await w.contract.landlord();
      const isLandAcc = landAddr.toLowerCase() === w.address.toLowerCase();
      setIsLandlord(isLandAcc);

      let roomIdx = null;
      if (!isLandAcc) {
        const isTen = await w.contract.isTenant(w.address);
        if (isTen) roomIdx = Number(await w.contract.addressToRoom(w.address));
      }
      setMyRoom(roomIdx);

      // Auto-navigate based on role
      if (isLandAcc) setTab("overview");
      else if (roomIdx !== null) setTab("myroom");

      await loadAll(w.contract, w.provider, w.address);
      clearMsg();
    } catch {
      const cur = window.ethereum?.chainId;
      if (cur && cur !== "0x7a69") {
        flash('warning', '請將 MetaMask 切換到 Anvil 本地鏈（Chain ID: 31337，RPC: http://127.0.0.1:8545）');
      } else {
        flash('warning', '連線取消，請重新點擊連接 MetaMask');
      }
    }
  }

  // ── Chain data loaders ────────────────────────────────────────────────────
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
      const usedCredits = (voter && voted) ? Number(await ct.creditsUsed(i, voter)) : 0;
      list.push({ id: i, violationId: Number(p.violationId), appellant: p.appellant, yesVotes: Number(yes), noVotes: Number(no), executed: p.executed, passed: p.passed, hasVoted: voted, usedCredits });
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
    } catch {}
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  async function handleTrigger() {
    setLoading(true); flash('info', '簽章中...');
    try {
      const nonce = await contract.reportNonce();
      const sig   = await signAsOracle(CONTRACT_ADDRESS, chainId, mockRoom, mockDb, nonce);
      flash('info', '送出交易...');
      const tx = await contract.reportNoise(mockRoom, BigInt(mockDb), nonce, sig);
      setFlashRoom(mockRoom);
      setDbHistory(h => [...h.slice(1), mockDb]);
      await tx.wait();
      setTimeout(() => setFlashRoom(null), 2000);
      flash('success', `Room ${ROOM_NAMES[mockRoom]} 違規已上鏈`);
      await loadAll();
    } catch { flash('warning', '操作失敗，請確認錢包帳號是否正確'); }
    setLoading(false);
  }

  async function handleRegister() {
    setLoading(true);
    try { const tx = await contract.registerTenant(regRoom, regAddr); await tx.wait(); flash('success', `Room ${ROOM_NAMES[regRoom]} 已登記`); await loadRooms(contract); }
    catch { flash('warning', '登記失敗，請確認帳號與地址是否正確'); }
    setLoading(false);
  }

  async function handleDeposit() {
    setLoading(true);
    try { const { ethers } = await import("ethers"); const tx = await contract.deposit({ value: ethers.parseEther(depAmt) }); await tx.wait(); flash('success', '存款成功'); await loadRooms(contract); }
    catch { flash('warning', '存款失敗，請確認帳號與金額是否正確'); }
    setLoading(false);
  }

  async function handleAppeal(vid, reason) {
    setLoading(true);
    try { const tx = await contract.createAppeal(BigInt(vid), reason); await tx.wait(); flash('success', '申訴已提交'); await loadAll(); }
    catch { flash('warning', '申訴失敗，請確認申訴資料是否正確'); }
    setLoading(false);
  }

  async function handleVote(pid, approve, voteCount) {
    setLoading(true);
    try { const tx = await contract.vote(BigInt(pid), approve, BigInt(voteCount)); await tx.wait(); flash('success', '投票成功'); await loadProposals(contract); }
    catch { flash('warning', '投票失敗，請確認錢包帳號是否正確'); }
    setLoading(false);
  }

  async function handleExecute(pid) {
    setLoading(true);
    try { const tx = await contract.executeProposal(BigInt(pid)); await tx.wait(); flash('success', '結案完成'); await loadAll(); }
    catch { flash('warning', '結案失敗，請確認提案狀態是否正確'); }
    setLoading(false);
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const liveDb = sensorDb(backendNoise);
  const lastDb = Number.isFinite(liveDb) ? liveDb : dbHistory[dbHistory.length - 1];

  const mockControlProps = { contract, loading, mockRoom, setMockRoom, mockDb, setMockDb, handleTrigger, dbHistory, backendNoise, lastDb };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: S.bg, minHeight: "100vh", color: S.text, fontFamily: "'Noto Sans TC', system-ui, sans-serif" }}>

      {/* Navbar */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${S.border}`, padding: "0 36px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
        <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-0.5px" }}>
          DePIN <span style={{ fontWeight: 300, color: S.muted }}>NoiseGov</span>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: "7px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: tab === key ? 700 : 400, background: tab === key ? S.text : "transparent", color: tab === key ? "#fff" : S.muted, fontSize: 17, transition: "all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>

        <button onClick={handleConnect} style={{ padding: "9px 22px", borderRadius: 999, border: account ? "1.5px solid #86efac" : "none", background: account ? "#f0fdf4" : S.blue, color: account ? "#15803d" : "#fff", fontWeight: 700, fontSize: 17, cursor: "pointer" }}>
          {account ? `${account.slice(0, 6)}...${account.slice(-4)}${isLandlord ? " (房東)" : myRoom !== null ? ` (房客)` : ""}` : "連接 MetaMask"}
        </button>
      </nav>

      {/* Message bar */}
      {msg && (
        <div style={{ padding: "11px 36px", fontSize: 17, borderBottom: `1px solid ${S.border}`, background: (MSG_STYLE[msgType] || MSG_STYLE.info).bg, color: (MSG_STYLE[msgType] || MSG_STYLE.info).color }}>
          {msg}
        </div>
      )}

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "32px 24px" }}>

        {tab === "myroom" && (
          <MyRoom
            account={account}
            myRoom={myRoom}
            rooms={rooms}
            violations={violations}
            loading={loading}
            handleAppeal={handleAppeal}
          />
        )}

        {tab === "dao" && (
          <DAOPanel
            account={account}
            loading={loading}
            proposals={proposals}
            handleVote={handleVote}
            handleExecute={handleExecute}
            qvCounts={qvCounts}
            setQvCounts={setQvCounts}
          />
        )}

        {tab === "overview" && (
          <Dashboard
            account={account}
            isLandlord={isLandlord}
            rooms={rooms}
            violations={violations}
            logs={logs}
            flashRoom={flashRoom}
            loadAll={() => loadAll()}
          />
        )}

        {tab === "admin" && (
          <AdminPanel
            account={account}
            isLandlord={isLandlord}
            contract={contract}
            loading={loading}
            regRoom={regRoom}   setRegRoom={setRegRoom}
            regAddr={regAddr}   setRegAddr={setRegAddr}
            depAmt={depAmt}     setDepAmt={setDepAmt}
            handleRegister={handleRegister}
            handleDeposit={handleDeposit}
            mockControlProps={mockControlProps}
          />
        )}

      </div>

      <footer style={{ marginTop: 56, borderTop: `1px solid ${S.border}`, textAlign: "center", padding: "24px", fontSize: 16, color: S.muted }}>
        DePIN · DeFi · DAO — 去中心化租屋噪音治理系統
      </footer>
    </div>
  );
}
