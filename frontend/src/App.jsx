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
const S = { bg: "#e8e7e4", text: "#0a0a0a", muted: "#8a8a8a", border: "rgba(0,0,0,0.08)", borderStrong: "rgba(0,0,0,0.2)" };

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
  success: { bg: "rgba(21,128,61,0.06)",  color: "#15803d" },
  warning: { bg: "rgba(180,83,9,0.06)",   color: "#b45309" },
  info:    { bg: "rgba(0,0,0,0.03)",      color: "#6a6a6a" },
};

const landlordKey = (addr) => `depin_landlord_${addr.toLowerCase()}`;

function sensorDb(data) {
  if (!data) return null;
  return Number(data.estimatedDb ?? data.estimated_db ?? data.decibels);
}

function mergeInstantNoise(noiseData, instantData) {
  if (!instantData) return noiseData;
  const base = noiseData || instantData.noise || null;
  if (!base) return null;
  if (!instantData.fft_fresh || !instantData.sound_type) {
    return {
      ...base,
      soundType: "background",
      soundTypeConfidence: null,
      modelSoundType: null,
      fftFresh: false,
      fftAgeSeconds: instantData.fft_age_seconds,
      peakFrequencyHz: null,
    };
  }

  return {
    ...base,
    soundType: instantData.sound_type,
    soundTypeConfidence: instantData.sound_type_confidence,
    modelSoundType: instantData.model_sound_type,
    fftFresh: instantData.fft_fresh,
    fftAgeSeconds: instantData.fft_age_seconds,
    peakFrequencyHz: instantData.peak_frequency_hz,
  };
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
        const [noiseRes, instantRes] = await Promise.all([
          fetch(`${SENSOR_API_URL}/noise/latest`, { cache: "no-store" }),
          fetch(`${SENSOR_API_URL}/api/instant/latest`, { cache: "no-store" }),
        ]);
        if (!noiseRes.ok) return;
        const noiseJson = await noiseRes.json();
        const instantJson = instantRes.ok ? await instantRes.json() : null;
        const data = mergeInstantNoise(noiseJson.data, instantJson?.data);
        if (cancelled || !data) return;
        setBackendNoise(data);
        const currentDb = sensorDb(data);
        // 用 receivedAt（Oracle 設的時間）比對，避免 Pico W USB 模式時間戳不準的問題
        const eventKey = data.receivedAt ?? data.timestamp;
        if (eventKey !== lastBackendTimestamp.current) {
          lastBackendTimestamp.current = eventKey;
          if (Number.isFinite(currentDb)) setDbHistory(h => [...h.slice(1), currentDb]);
          if (data.reportAllowed) {
            setFlashRoom(Number(data.roomIndex));
            setTimeout(() => setFlashRoom(null), 2000);
          }
          if (data.onchain?.submitted && eventKey !== lastChainSyncTimestamp.current && contractRef.current) {
            lastChainSyncTimestamp.current = eventKey;
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

  // ── Auto-execute expired proposals + 定期同步提案狀態 ────────────────────
  useEffect(() => {
    if (!contract) return;
    const timer = setInterval(async () => {
      try {
        const count = Number(await contract.proposalCount());
        let anyExecuted = false;
        for (let i = 0; i < count; i++) {
          try {
            const tx = await contract.executeProposal(i);
            await tx.wait();
            anyExecuted = true;
          } catch { }
        }
        // 不管有沒有新結案，每次都重載提案與違規清單，讓房客看到最新狀態
        await Promise.all([
          loadProposals(contractRef.current, accountRef.current),
          loadViolations(contractRef.current),
        ]);
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
          if (shouldNavigate) setTab("admin");
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
    setTab("admin");
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
    try {
      const { ethers } = await import("ethers");
      const addr = ethers.getAddress(regAddr.trim());
      const tx = await contract.registerTenant(regRoom, addr);
      await tx.wait();
      flash("success", `${ROOM_NAMES[regRoom]} 已登記`);
      await loadRooms(contract);
    } catch (e) {
      const reason = e?.reason || e?.shortMessage || e?.message || "未知錯誤";
      flash("warning", `登記失敗：${reason.slice(0, 100)}`);
    }
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
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "#1a1a1a", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 48px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <div style={{ fontSize: 15, fontWeight: 300, letterSpacing: "0.08em", color: "#ffffff" }}>
          DePIN <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 200 }}>NoiseGov</span>
        </div>

        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{
              position: "relative", padding: "0 20px", paddingBottom: 6, height: 60,
              border: "none", cursor: "pointer", background: "transparent",
              color: tab === key ? "#ffffff" : "rgba(255,255,255,0.4)",
              fontSize: 11, fontWeight: 400,
              letterSpacing: "0.15em", textTransform: "uppercase",
              transition: "color 0.15s",
            }}>
              {label}
              {tab === key && (
                <span style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 28, height: 2, background: "rgba(255,255,255,0.75)" }} />
              )}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {isLandlord && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{landlordName}</span>
                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>·</span>
                <span style={{ fontSize: 10, color: "#98A2B3" }}>房東</span>
              </div>
              <button onClick={handleLogout}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.4)", padding: "6px 16px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={e => { e.target.style.borderColor = "rgba(255,255,255,0.6)"; e.target.style.color = "#ffffff"; }}
                onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.2)"; e.target.style.color = "rgba(255,255,255,0.4)"; }}>
                登出
              </button>
            </>
          )}
          {!isLandlord && myRoom !== null && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{ROOM_NAMES[myRoom]}</span>
                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>·</span>
                <span style={{ fontSize: 10, color: "#98A2B3" }}>房客</span>
              </div>
              <button onClick={handleLogout}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.4)", padding: "6px 16px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={e => { e.target.style.borderColor = "rgba(255,255,255,0.6)"; e.target.style.color = "#ffffff"; }}
                onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.2)"; e.target.style.color = "rgba(255,255,255,0.4)"; }}>
                登出
              </button>
            </>
          )}
          {isUnknown && (
            <>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
                {account.slice(0, 6)}...{account.slice(-4)}
              </div>
              <button onClick={handleLogout}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.4)", padding: "6px 16px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={e => { e.target.style.borderColor = "rgba(255,255,255,0.6)"; e.target.style.color = "#ffffff"; }}
                onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.2)"; e.target.style.color = "rgba(255,255,255,0.4)"; }}>
                登出
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Message bar */}
      {msg && (
        <div style={{ padding: "12px 48px", fontSize: 13, borderBottom: `1px solid ${S.border}`, background: (MSG_STYLE[msgType] || MSG_STYLE.info).bg, color: (MSG_STYLE[msgType] || MSG_STYLE.info).color, letterSpacing: "0.03em" }}>
          {msg}
        </div>
      )}

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px" }}>
        {isUnknown && (
          <div style={{ border: `1px solid ${S.border}`, padding: "14px 24px", marginBottom: 28, color: S.muted, fontSize: 13, letterSpacing: "0.03em" }}>
            您尚未入住，請聯繫房東登記後再使用完整功能。目前僅供唯讀瀏覽。
          </div>
        )}

        {tab === "myroom"   && <MyRoom account={account} myRoom={myRoom} rooms={rooms} violations={violations} proposals={proposals} loading={loading} handleAppeal={handleAppeal} depAmt={depAmt} setDepAmt={setDepAmt} handleDeposit={handleDeposit} dbHistory={dbHistory} backendNoise={backendNoise} lastDb={lastDb} onRefresh={() => loadAll()} />}
        {tab === "dao"      && <DAOPanel account={account} loading={loading} proposals={proposals} handleVote={handleVote} handleExecute={handleExecute} qvCounts={qvCounts} setQvCounts={setQvCounts} />}
        {tab === "overview" && <Dashboard account={account} isLandlord={isLandlord} isUnknown={isUnknown} rooms={rooms} violations={violations} logs={logs} flashRoom={flashRoom} loadAll={() => loadAll()} />}
        {tab === "admin"    && <AdminPanel account={account} isLandlord={isLandlord} contract={contract} loading={loading} rooms={rooms} regRoom={regRoom} setRegRoom={setRegRoom} regAddr={regAddr} setRegAddr={setRegAddr} depAmt={depAmt} setDepAmt={setDepAmt} handleRegister={handleRegister} handleDeposit={handleDeposit} mockControlProps={mockControlProps} />}
      </div>

      <footer style={{ marginTop: 80, borderTop: `1px solid ${S.border}`, textAlign: "center", padding: "28px 48px", fontSize: 11, color: S.muted, letterSpacing: "0.18em", textTransform: "uppercase" }}>
        DePIN · DeFi · DAO — 去中心化租屋噪音治理系統
      </footer>
    </div>
  );
}
