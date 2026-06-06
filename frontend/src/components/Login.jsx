const M = {
  bg: '#e8e7e4', surface: '#f5f4f1',
  border: 'rgba(0,0,0,0.1)', borderStrong: 'rgba(0,0,0,0.2)',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};

export default function Login({ onConnect, connecting, errorMsg }) {
  return (
    <div style={{ minHeight: '100vh', background: M.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>

      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.3em', color: M.muted, marginBottom: 14, textTransform: 'uppercase' }}>
          Decentralized Physical Infrastructure
        </div>
        <div style={{ fontSize: 40, fontWeight: 300, color: M.heading, letterSpacing: '-0.5px' }}>
          DePIN<span style={{ color: M.muted, fontWeight: 200 }}> NoiseGov</span>
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 420, background: M.surface, border: `1px solid ${M.border}`, padding: '44px 40px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, marginBottom: 28, textTransform: 'uppercase' }}>身份驗證</div>

        <div style={{ marginBottom: 36 }}>
          {[
            '連接後自動偵測身份（房東 / 房客）',
            '房東可管理合約、登記房客、審核申訴',
            '房客可查看房間狀態與提出申訴',
          ].map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, marginBottom: i < 2 ? 18 : 0 }}>
              <div style={{ width: 1, background: M.border, flexShrink: 0, alignSelf: 'stretch', minHeight: 20 }} />
              <div style={{ fontSize: 14, color: M.body, lineHeight: 1.65 }}>{line}</div>
            </div>
          ))}
        </div>

        <button
          onClick={onConnect}
          disabled={connecting}
          style={{
            width: '100%', padding: '14px 24px', background: 'transparent',
            border: `1px solid ${connecting ? M.border : M.borderStrong}`,
            color: connecting ? M.muted : M.heading,
            fontSize: 11, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase',
            cursor: connecting ? 'default' : 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { if (!connecting) { e.target.style.background = '#0a0a0a'; e.target.style.color = '#fff'; e.target.style.borderColor = '#0a0a0a'; }}}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = connecting ? M.muted : M.heading; e.target.style.borderColor = connecting ? M.border : M.borderStrong; }}
        >
          {connecting ? '偵測中...' : '連接 MetaMask'}
        </button>

        {errorMsg && <div style={{ marginTop: 18, fontSize: 13, color: '#c0392b', lineHeight: 1.6 }}>{errorMsg}</div>}

        <div style={{ marginTop: 24, fontSize: 12, color: M.muted }}>需要安裝 MetaMask 瀏覽器擴充功能</div>
      </div>

      <div style={{ marginTop: 44, fontSize: 11, color: M.muted, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        DePIN · DeFi · DAO
      </div>
    </div>
  );
}
