const M = {
  bg: '#e8e7e4', surface: '#f5f4f1',
  border: 'rgba(0,0,0,0.1)', borderStrong: 'rgba(0,0,0,0.2)',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};

export default function DeployPage({ address, onDeploy, deploying, error }) {
  return (
    <div style={{ minHeight: '100vh', background: M.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.3em', color: M.muted, marginBottom: 14, textTransform: 'uppercase' }}>DePIN NoiseGov</div>
        <div style={{ fontSize: 36, fontWeight: 300, color: M.heading }}>建立公寓</div>
      </div>

      <div style={{ width: '100%', maxWidth: 420, background: M.surface, border: `1px solid ${M.border}`, padding: '44px 40px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, marginBottom: 6, textTransform: 'uppercase' }}>錢包地址</div>
        <div style={{ fontSize: 13, color: M.muted, fontFamily: 'monospace', marginBottom: 36 }}>{address.slice(0, 10)}...{address.slice(-8)}</div>

        <div style={{ marginBottom: 36 }}>
          {['目前尚無公寓合約', '部署後您將成為房東，可登記房客與管理合約', '合約地址將記錄在瀏覽器 localStorage 中'].map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, marginBottom: i < 2 ? 18 : 0 }}>
              <div style={{ width: 1, background: M.border, flexShrink: 0, alignSelf: 'stretch', minHeight: 20 }} />
              <div style={{ fontSize: 14, color: M.body, lineHeight: 1.65 }}>{line}</div>
            </div>
          ))}
        </div>

        <button onClick={onDeploy} disabled={deploying}
          style={{ width: '100%', padding: '14px 24px', background: 'transparent', border: `1px solid ${deploying ? M.border : M.borderStrong}`, color: deploying ? M.muted : M.heading, fontSize: 11, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: deploying ? 'default' : 'pointer', transition: 'all 0.2s' }}
          onMouseEnter={e => { if (!deploying) { e.target.style.background = '#0a0a0a'; e.target.style.color = '#fff'; e.target.style.borderColor = '#0a0a0a'; }}}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = deploying ? M.muted : M.heading; e.target.style.borderColor = deploying ? M.border : M.borderStrong; }}>
          {deploying ? '部署中，請稍候...' : '建立我的公寓'}
        </button>

        {error && <div style={{ marginTop: 16, fontSize: 13, color: '#c0392b' }}>{error}</div>}
        <div style={{ marginTop: 20, fontSize: 12, color: M.muted }}>部署需要支付少量 gas 費用（本地測試費用幾乎為零）</div>
      </div>
    </div>
  );
}
