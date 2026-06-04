import { useState, useEffect, useRef } from "react";
import {
  connectWallet, createContractInstance, deployContract,
  getStoredContractAddress, clearStoredContract,
  ROOM_NAMES,
} from "./Web3.js";
import Login        from "./components/Login.jsx";
import DeployPage   from "./components/DeployPage.jsx";
import IdentitySetup from "./components/IdentitySetup.jsx";
import MyRoom       from "./components/MyRoom.jsx";
import DAOPanel     from "./components/DAOPanel.jsx";
import Dashboard    from "./components/Dashboard.jsx";
import AdminPanel   from "./components/AdminPanel.jsx";

const SENSOR_API_URL = import.meta.env.VITE_SENSOR_API_URL || "http://127.0.0.1:8000";
const S = { bg: "#f8fafc", text: "#1e293b", muted: "#64748b", border: "#e2e8f0", blue: "#3b82f6" };

const TABS_LANDLORD = [
  { key: "myroom",   label: "我的房間" },
  { key: "dao",      label: "DAO 投票" },
  { key: "overview", label: "系統總覽" },
  { key: "admin",    label: "管理" },
];
const TABS_TENANT = [
  { key: "myroom", label: "我的房間" },
  { key: "dao",    label: "DAO 投票" },
];
const TABS_UNKNOWN = [
  { key: "overview", label: "系統總覽" },
];

const MSG_STYLE = {
  success: { bg: "#f0fdf4", color: "#15803d" },
  warning: { bg: "#fefce8", color: "#854d0e" },
  info:    { bg: "#f1f5f9", color: "#475569" },
};

const landlordKey = (addr) => `depin_landlord_${addr.toLowerCase()}`;

function sensorDb(data) {
  if (!data) return null;
  return Number(data.estimatedDb ?? data.estimated_db ?? data.decibels);
}

export default function App() {
  // ── Wallet & identity ─────────────────────────────────────────────────────
  const [provider,      setProvider]      = useState(null);
  const [signer,        setSigner]        = useState(null);
  const [contract,      setContract]      = useState(null);
  const [account,       setAccount]       = useState(null);
  const [chainId,       setChainId]       = useState(null);
  const [isLandlord,    setIsLandlord]    = useState(false);
  const [myRoom,        setMyRoom]        = useState(null);
  const [landlordName,  setLandlordName]  = useState(null);
  const [needsDeploy,   setNeedsDeploy]   = useState(false);   // no contract address found
  const [needsNameSetup,setNeedsNameSetup]= useState(false);   // landlord, first time
  const [loading,       setLoading]       = useState(false);
  const [connecting,    setConnecting]    = useState(false);
  const [deploying,     setDeploying]     = useState(false);
  const [loginError,    setLoginError]    = useState("");
  const [deployError,   setDeployError]   = useState("");
  const [tab,           setTab]           = useState("myroom");

  // ── Message bar ───────────────────────────────────────────────────────────
  const [msg, setMsg]         = useState("");
  const [msgType, setMsgType] = useState("info");
  const msgTimerRef = useRef(null);
  const flash = (type, text) => {
    setMsg(text);
    setMsgType(type);
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    // success / info 3 秒後自動消失；warning 常駐直到下一個動作
    if (type !== "warning") {
      msgTimerRef.current = setTimeout(() => setMsg(""), 3000);
    }
  };
  const clearMsg = () => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setMsg("");
  };

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

  // ── Admin / DAO state ─────────────────────────────────────────────────────
  const [regRoom,  setRegRoom]  = useState(0);
  const [regAddr,  setRegAddr]  = useState("");
  const [depAmt,   setDepAmt]   = useState("0.1");
  const [qvCounts, setQvCounts] = useState({});

  // ── Refs ──────────────────────────────────────────────────────────────────
  const lastBackendTimestamp   = useRef(null);
  const lastChainSyncTimestamp = useRef(null);
  const contractRef = useRef(null);
  const providerRef = useRef(null);
  const accountRef  = useRef(null);

  useEffect(() => {
    contractRef.current = contract;
    providerRef.current = provider;
    accountRef.current  = account;
  }, [contract, provider, account]);

  // ── Simulated dB ─────────────────────────────────────────────────────────
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
        const res  = await fetch(`${SENSOR_API_URL}/noise/latest`);
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

  // ── Auto-execute expired proposals ───────────────────────────────────────
  useEffect(() => {
    if (!contract) return;
    const timer = setInterval(async () => {
      try {
        const count = Number(await contract.proposalCount());
        for (let i = 0; i < count; i++) {
          try { const tx = await contract.executeProposal(i); await tx.wait(); await loadAll(); } catch { }
        }
      } catch (err) { console.error(err); }
    }, 10000);
    return () => clearInterval(timer);
  }, [contract]);

  // ── Core: apply wallet state after connect ────────────────────────────────
  async function applyWalletState(w, shouldNavigate = true) {
    if (w.chainId !== 31337n) {
      setLoginError("請將 MetaMask 切換到 Anvil 本地鏈（Chain ID: 31337，RPC: http://127.0.0.1:8545）");
      return;
    }

    setProvider(w.provider);
    setSigner(w.signer);
    setAccount(w.address);
    setChainId(w.chainId);

    // Check for stored contract address
    const storedAddr = getStoredContractAddress();
    if (!storedAddr) {
      setNeedsDeploy(true);
      return;
    }

    await _initContract(storedAddr, w.signer, w.provider, w.address, shouldNavigate);
    clearMsg();
  }

  // 通知後端合約地址（fire-and-forget，失敗不影響主流程）
  function syncAddressToBackend(address) {
    fetch(`${SENSOR_API_URL}/contract/address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch((e) => console.warn("[sync] 無法通知後端合約地址：", e.message));
  }

  // Create contract instance and detect role
  async function _initContract(contractAddr, sgn, prov, addr, shouldNavigate = true) {
    // 確認合約是否真的存在（Anvil 重啟後舊地址會失效）
    const code = await prov.getCode(contractAddr);
    if (code === "0x") {
      clearStoredContract();
      setNeedsDeploy(true);
      flash("warning", "合約已失效（Anvil 可能已重啟），請重新建立公寓");
      return;
    }

    // 每次確認合約有效後同步給後端（確保後端重啟後也能取得地址）
    syncAddressToBackend(contractAddr);

    const ct = createContractInstance(contractAddr, sgn);
    setContract(ct);

    const landAddr = await ct.landlord();
    const isLand   = landAddr.toLowerCase() === addr.toLowerCase();
    setIsLandlord(isLand);

    let roomIdx = null;
    if (!isLand) {
      const isTen = await ct.isTenant(addr);
      if (isTen) roomIdx = Number(await ct.addressToRoom(addr));
    }
    setMyRoom(roomIdx);

    if (isLand) {
      const stored = localStorage.getItem(landlordKey(addr));
      if (stored) {
        try {
          const data = JSON.parse(stored);
          setLandlordName(data.name);
          setNeedsNameSetup(false);
          if (shouldNavigate) setTab("overview");
        } catch {
          localStorage.removeItem(landlordKey(addr));
          setNeedsNameSetup(true);
        }
      } else {
        setNeedsNameSetup(true);
      }
    } else {
      setLandlordName(null);
      setNeedsNameSetup(false);
      if (shouldNavigate) setTab(roomIdx !== null ? "myroom" : "overview");
    }

    await loadAll(ct, prov, addr);
  }

  // ── Connect wallet ────────────────────────────────────────────────────────
  async function handleConnect(shouldNavigate = true, selectedAddress = null) {
    setConnecting(true);
    setLoginError("");
    try {
      const w = await connectWallet(selectedAddress);
      await applyWalletState(w, shouldNavigate);
    } catch {
      if (!window.ethereum) {
        setLoginError("請安裝 MetaMask 瀏覽器擴充功能");
      } else {
        const cur = window.ethereum?.chainId;
        setLoginError(cur && cur !== "0x7a69"
          ? "請將 MetaMask 切換到 Anvil 本地鏈（Chain ID: 31337）"
          : "連線取消，請重新點擊連接");
      }
    } finally {
      setConnecting(false);
    }
  }

  // ── Deploy contract (from DeployPage) ────────────────────────────────────
  async function handleDeploy() {
    if (!signer) return;
    setDeploying(true);
    setDeployError("");
    try {
      flash("info", "部署合約中，請在 MetaMask 確認交易...");
      const { contract: ct, address } = await deployContract(signer);
      setContract(ct);
      setNeedsDeploy(false);
      setIsLandlord(true);
      setMyRoom(null);
      setNeedsNameSetup(true); // landlord needs to enter name

      syncAddressToBackend(address);

      await loadAll(ct, provider, account);
      clearMsg();
    } catch (e) {
      const msg = e?.reason || e?.message || "部署失敗，請重試";
      setDeployError(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      clearMsg();
    } finally {
      setDeploying(false);
    }
  }

  // ── Landlord: set name after first deploy / login ─────────────────────────
  function handleNameConfirm(name) {
    const data = { address: account, name };
    localStorage.setItem(landlordKey(account), JSON.stringify(data));
    setLandlordName(name);
    setNeedsNameSetup(false);
    setTab("overview");
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  function handleLogout() {
    // Clear landlord name session (contract address stays — it's infrastructure)
    if (account) localStorage.removeItem(landlordKey(account));
    _resetSession();
  }

  function _resetSession() {
    setProvider(null); setSigner(null); setContract(null);
    setAccount(null);  setChainId(null);
    setIsLandlord(false); setMyRoom(null);
    setLandlordName(null); setNeedsNameSetup(false); setNeedsDeploy(false);
    setRooms([]); setViolations([]); setProposals([]); setLogs([]);
    setTab("myroom");
    clearMsg();
  }

  // ── MetaMask event listeners ──────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum?.on) return;

    const onAccountsChanged = (accounts) => {
      if (!accounts.length) {
        if (accountRef.current) localStorage.removeItem(landlordKey(accountRef.current));
        _resetSession();
        flash("info", "MetaMask 已中斷連線");
        return;
      }
      handleConnect(true, accounts[0]);
    };
    const onChainChanged = () => handleConnect(true);

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged",    onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged",    onChainChanged);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      return { i, name, tenant: t.addr, registered: t.registered, free, locked };
    }));
    setRooms(list);
  }

  async function loadViolations(ct) {
    const count = Number(await ct.violationCount());
    const list  = [];
    for (let i = count - 1; i >= Math.max(0, count - 20); i--) {
      const v = await ct.violations(i);
      list.push({ id: i, room: Number(v.roomIndex), db: Number(v.decibels), penalty: v.penaltyPaid, appealed: v.appealed, reportedAt: Number(v.reportedAt) });
    }
    setViolations(list);
  }

  async function loadProposals(ct, address) {
    const count = Number(await ct.proposalCount());
    const tc    = Number(await ct.tenantCount());
    const list  = [];
    for (let i = count - 1; i >= 0; i--) {
      const p   = await ct.proposals(i);
      const [yes, no] = await ct.getVotes(i);
      const voter = address || account;
      const voted = voter ? await ct.hasVoted(i, voter) : false;
      const usedCredits = (voter && voted) ? Number(await ct.creditsUsed(i, voter)) : 0;
      const appellantIsTenant  = await ct.isTenant(p.appellant);
      const totalEligibleVoters = tc + 1 - (appellantIsTenant ? 1 : 0);
      list.push({ id: i, violationId: Number(p.violationId), appellant: p.appellant, yesVotes: Number(yes), noVotes: Number(no), voterCount: Number(p.voterCount), executed: p.executed, passed: p.passed, hasVoted: voted, usedCredits, createdAt: Number(p.createdAt), totalEligibleVoters });
    }
    setProposals(list);
  }

  async function loadLogs(ct, pv) {
    if (!pv) return;
    try {
      const raw    = await pv.getLogs({ address: ct.target, fromBlock: 0, toBlock: "latest" });
      const parsed = raw.map(log => {
        try { const p = ct.interface.parseLog(log); return { name: p.name, args: p.args, block: log.blockNumber, tx: log.transactionHash }; }
        catch { return null; }
      }).filter(Boolean).reverse().slice(0, 8);
      setLogs(parsed);
    } catch { }
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  async function handleTrigger() {
    setLoading(true); flash("info", "送出噪音違規...");
    try {
      const res  = await fetch(`${SENSOR_API_URL}/noise/mock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: mockRoom, decibels: mockDb }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.message || "失敗");
      setFlashRoom(mockRoom);
      setDbHistory(h => [...h.slice(1), mockDb]);
      setTimeout(() => setFlashRoom(null), 2000);
      flash("success", `${ROOM_NAMES[mockRoom]} 違規已上鏈`);
      await loadAll();
    } catch (e) { flash("warning", `操作失敗：${e.message || "請確認 Oracle 是否啟動"}`); }
    setLoading(false);
  }

  async function handleRegister() {
    setLoading(true);
    try { const tx = await contract.registerTenant(regRoom, regAddr); await tx.wait(); flash("success", `${ROOM_NAMES[regRoom]} 已登記`); await loadRooms(contract); }
    catch { flash("warning", "登記失敗，請確認帳號與地址是否正確"); }
    setLoading(false);
  }

  async function handleDeposit() {
    setLoading(true);
    try {
      const { ethers } = await import("ethers");
      const tx = await contract.deposit({ value: ethers.parseEther(depAmt) });
      await tx.wait();
      flash("success", `已存入 ${depAmt} ETH`);
      setDepAmt("");
      await loadAll();
    } catch { flash("warning", "存款失敗，請確認帳號與金額是否正確"); }
    setLoading(false);
  }

  async function handleAppeal(vid, reason) {
    setLoading(true);
    try { const tx = await contract.createAppeal(BigInt(vid), reason); await tx.wait(); flash("success", "申訴已提交"); await loadAll(); }
    catch { flash("warning", "申訴失敗，請確認申訴資料是否正確"); }
    setLoading(false);
  }

  async function handleVote(pid, approve, voteCount) {
    setLoading(true);
    try { const tx = await contract.vote(BigInt(pid), approve, BigInt(voteCount)); await tx.wait(); flash("success", "投票成功"); await loadProposals(contract); }
    catch { flash("warning", "投票失敗，請確認錢包帳號是否正確"); }
    setLoading(false);
  }

  async function handleExecute(pid) {
    setLoading(true);
    try { const tx = await contract.executeProposal(BigInt(pid)); await tx.wait(); flash("success", "結案完成"); await loadAll(); }
    catch { flash("warning", "結案失敗，請確認提案狀態是否正確"); }
    setLoading(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const isUnknown = !isLandlord && myRoom === null;
  const TABS      = isLandlord ? TABS_LANDLORD : myRoom !== null ? TABS_TENANT : TABS_UNKNOWN;
  const liveDb    = sensorDb(backendNoise);
  const lastDb    = Number.isFinite(liveDb) ? liveDb : dbHistory[dbHistory.length - 1];
  const mockControlProps = { dbHistory, backendNoise, lastDb };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!account) {
    return <Login onConnect={() => handleConnect()} connecting={connecting} errorMsg={loginError} />;
  }

  if (needsDeploy) {
    return (
      <DeployPage
        address={account}
        onDeploy={handleDeploy}
        deploying={deploying}
        error={deployError}
      />
    );
  }

  if (needsNameSetup) {
    return <IdentitySetup address={account} onConfirm={handleNameConfirm} />;
  }

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

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isLandlord && (
            <>
              <div style={{ padding: "8px 18px", borderRadius: 999, border: "1.5px solid #86efac", background: "#f0fdf4", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: "#15803d" }}>{landlordName}</span>
                <span style={{ fontSize: 13, color: "#4ade80", fontWeight: 500 }}>房東</span>
              </div>
              <button onClick={handleLogout} style={{ padding: "8px 16px", borderRadius: 999, border: `1.5px solid ${S.border}`, background: "transparent", color: S.muted, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                登出
              </button>
            </>
          )}

          {!isLandlord && myRoom !== null && (
            <>
              <div style={{ padding: "8px 18px", borderRadius: 999, border: "1.5px solid #86efac", background: "#f0fdf4", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: "#15803d" }}>{ROOM_NAMES[myRoom]}</span>
                <span style={{ fontSize: 13, color: "#4ade80", fontWeight: 500 }}>房客</span>
              </div>
              <button onClick={handleLogout} style={{ padding: "8px 16px", borderRadius: 999, border: `1.5px solid ${S.border}`, background: "transparent", color: S.muted, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                登出
              </button>
            </>
          )}

          {isUnknown && (
            <>
              <div style={{ padding: "8px 18px", borderRadius: 999, border: `1.5px solid ${S.border}`, background: "#f8fafc", color: S.muted, fontSize: 15, fontFamily: "monospace" }}>
                {account.slice(0, 6)}...{account.slice(-4)}
              </div>
              <button onClick={handleLogout} style={{ padding: "8px 16px", borderRadius: 999, border: `1.5px solid ${S.border}`, background: "transparent", color: S.muted, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                登出
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Message bar */}
      {msg && (
        <div style={{ padding: "11px 36px", fontSize: 17, borderBottom: `1px solid ${S.border}`, background: (MSG_STYLE[msgType] || MSG_STYLE.info).bg, color: (MSG_STYLE[msgType] || MSG_STYLE.info).color }}>
          {msg}
        </div>
      )}

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "32px 24px" }}>
        {isUnknown && (
          <div style={{ background: "#fff", border: `1px solid ${S.border}`, borderRadius: 12, padding: "16px 22px", marginBottom: 24, color: S.muted, fontSize: 16 }}>
            您尚未入住，請聯繫房東登記後再使用完整功能。目前僅供唯讀瀏覽。
          </div>
        )}

        {tab === "myroom"   && <MyRoom account={account} myRoom={myRoom} rooms={rooms} violations={violations} loading={loading} handleAppeal={handleAppeal} depAmt={depAmt} setDepAmt={setDepAmt} handleDeposit={handleDeposit} dbHistory={dbHistory} backendNoise={backendNoise} lastDb={lastDb} />}
        {tab === "dao"      && <DAOPanel account={account} loading={loading} proposals={proposals} handleVote={handleVote} handleExecute={handleExecute} qvCounts={qvCounts} setQvCounts={setQvCounts} />}
        {tab === "overview" && <Dashboard account={account} isLandlord={isLandlord} isUnknown={isUnknown} rooms={rooms} violations={violations} logs={logs} flashRoom={flashRoom} loadAll={() => loadAll()} />}
        {tab === "admin"    && <AdminPanel account={account} isLandlord={isLandlord} contract={contract} loading={loading} rooms={rooms} regRoom={regRoom} setRegRoom={setRegRoom} regAddr={regAddr} setRegAddr={setRegAddr} depAmt={depAmt} setDepAmt={setDepAmt} handleRegister={handleRegister} handleDeposit={handleDeposit} mockControlProps={mockControlProps} />}
      </div>

      <footer style={{ marginTop: 56, borderTop: `1px solid ${S.border}`, textAlign: "center", padding: "24px", fontSize: 16, color: S.muted }}>
        DePIN · DeFi · DAO — 去中心化租屋噪音治理系統
      </footer>
    </div>
  );
}
