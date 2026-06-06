import { useState } from 'react';

const M = {
  bg: '#e8e7e4', surface: '#f5f4f1',
  border: 'rgba(0,0,0,0.1)', borderStrong: 'rgba(0,0,0,0.2)',
  heading: '#0a0a0a', body: '#555555', muted: '#999999',
};

export default function IdentitySetup({ address, onConfirm }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function handleConfirm() {
    if (!name.trim()) { setError('請輸入名字'); return; }
    onConfirm(name.trim());
  }

  return (
    <div style={{ minHeight: '100vh', background: M.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.3em', color: M.muted, marginBottom: 14, textTransform: 'uppercase' }}>DePIN NoiseGov</div>
        <div style={{ fontSize: 36, fontWeight: 300, color: M.heading }}>房東驗證</div>
      </div>

      <div style={{ width: '100%', maxWidth: 400, background: M.surface, border: `1px solid ${M.border}`, padding: '44px 40px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, marginBottom: 6, textTransform: 'uppercase' }}>錢包地址</div>
        <div style={{ fontSize: 13, color: M.muted, fontFamily: 'monospace', marginBottom: 36 }}>{address.slice(0, 10)}...{address.slice(-8)}</div>

        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: M.muted, marginBottom: 10, textTransform: 'uppercase' }}>顯示名稱</div>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          placeholder="例：Frank"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          style={{
            width: '100%', padding: '10px 0', background: 'transparent',
            border: 'none', borderBottom: `1px solid ${name ? M.borderStrong : M.border}`,
            color: M.heading, fontSize: 15, outline: 'none', marginBottom: 8, transition: 'border-color 0.2s',
          }}
        />
        {error && <div style={{ fontSize: 13, color: '#c0392b', marginBottom: 4 }}>{error}</div>}

        <button onClick={handleConfirm} disabled={!name.trim()}
          style={{ width: '100%', marginTop: 28, padding: '14px 24px', background: 'transparent', border: `1px solid ${name.trim() ? M.borderStrong : M.border}`, color: name.trim() ? M.heading : M.muted, fontSize: 11, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: name.trim() ? 'pointer' : 'default', transition: 'all 0.2s' }}
          onMouseEnter={e => { if (name.trim()) { e.target.style.background = '#0a0a0a'; e.target.style.color = '#fff'; e.target.style.borderColor = '#0a0a0a'; }}}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = name.trim() ? M.heading : M.muted; e.target.style.borderColor = name.trim() ? M.borderStrong : M.border; }}>
          確認進入
        </button>
      </div>
    </div>
  );
}
