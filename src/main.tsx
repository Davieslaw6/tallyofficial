import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  componentDidCatch(e: Error) { try { const k = 'tally.errors'; const a = JSON.parse(localStorage.getItem(k) ?? '[]'); a.push({ t: new Date().toISOString(), m: e.message.slice(0, 300) }); localStorage.setItem(k, JSON.stringify(a.slice(-20))); } catch { /* local-only crash log */ } }
  render() { return this.state.err ? <div style={{ padding: 32, font: '16px system-ui', maxWidth: 560, margin: '10vh auto' }}><h1>Something went wrong</h1><p>Your data is safe and still encrypted. Reload the page and unlock again.</p><p style={{ color: '#666' }}>{this.state.err}</p><button onClick={() => location.reload()} style={{ padding: '10px 18px', fontSize: 16 }}>Reload</button></div> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<StrictMode><Boundary><App /></Boundary></StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ }); });
