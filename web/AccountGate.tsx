import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, LoaderCircle, ShieldCheck, Sprout } from 'lucide-react';
import App from './App';
import { api, setActiveWorkspace, setSessionCsrf, type SessionInfo, type SessionUser, type Workspace } from './api';

const errorMessage = (e: unknown) => e instanceof Error ? e.message : '请求失败，请重试。';

export default function AccountGate() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const readSession = useCallback(async (signal?: AbortSignal) => {
    const next = await api<SessionInfo>('/auth/me', undefined, 'GET', signal);
    if (signal?.aborted) return;
    if (!['session', 'local', 'token'].includes(next.mode) || typeof next.csrfToken !== 'string') throw new Error('会话接口返回格式不正确。');
    setSessionCsrf(next.mode === 'token' ? '' : next.csrfToken);
    setSession(next);
    return next;
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { await readSession(signal); } catch (e) { if (!signal?.aborted) { setSessionCsrf(''); setError(errorMessage(e)); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [readSession]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    if (password.length < 12 || password.length > 128) { setError('密码长度须为 12 至 128 个字符。'); return; }
    setBusy(true); setError('');
    try {
      await api(register ? '/auth/sign-up/email' : '/auth/sign-in/email', register ? { email: email.trim(), password, name: name.trim() } : { email: email.trim(), password });
      // Only /me can establish identity; never infer a login from the auth response.
      const verified = await readSession();
      if (!verified?.user || verified.mode === 'token') throw new Error('认证已提交，但尚未建立可用的浏览器会话。请确认邮箱或联系管理员。');
      setSessionCsrf(verified.csrfToken); setSession(verified); setPassword('');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    setBusy(true); setLogoutError('');
    try {
      await api('/auth/sign-out', {});
      // KnowledgeView stores drafts per user/workspace under this prefix. Leave unrelated storage intact.
      try {
        for (let index = sessionStorage.length - 1; index >= 0; index--) {
          const key = sessionStorage.key(index);
          if (key?.startsWith('meow-knowledge-draft:')) sessionStorage.removeItem(key);
        }
      } catch { /* Storage may be disabled; do not prevent a successful server logout. */ }
      setSessionCsrf(''); setActiveWorkspace(''); setSession(null); setPassword('');
      await refresh();
    } catch (e) { setLogoutError(errorMessage(e)); } finally { setBusy(false); }
  }
  if (loading) return <div className="account-status" role="status"><LoaderCircle className="spin" size={30}/><h2>正在确认你的会话</h2><p>安全连接知识空间…</p></div>;
  if (session?.mode === 'token') return <div className="account-status"><ShieldCheck size={38}/><h2>浏览器访问已禁用</h2><p>当前服务使用 Token 模式，仅供 API 客户端使用。请联系管理员启用 Session 登录或本地模式；不要在浏览器中输入 API Token。</p><button className="secondary-btn" onClick={() => void refresh()}>重新检查</button></div>;
  if (session?.user) return <WorkspaceSession key={session.user.id} user={session.user} mode={session.mode} onLogout={() => void logout()} logoutBusy={busy} logoutError={logoutError}/>;
  return <main className="account-page"><section className="account-story"><a className="brand" href="#"><span className="brand-mark"><BookOpen size={26}/></span><span>meow<span className="brand-light">wiki</span><small>让知识，自由生长</small></span></a><div className="account-story-body"><span className="eyebrow">A LITTLE SPACE FOR BIG IDEAS</span><h1>给每一个想法，<br/>留一片生长的地方<span>.</span></h1><p>收集灵感，连接知识。<br/>从一篇笔记开始，慢慢构建你的知识花园。</p><div className="account-art"><Sprout size={100} strokeWidth={1}/><span>GROW AT YOUR OWN PACE</span></div></div><small><ShieldCheck size={14}/>独立账户 · 专属工作空间</small></section><section className="account-form-panel"><div className="account-form-card"><span className="account-kicker">WELCOME TO YOUR KNOWLEDGE GARDEN</span><h2>{register ? '种下第一颗知识种子' : '欢迎回到你的知识花园'}</h2><p>{register ? '创建账户，开始收藏那些值得留下的想法。' : '登录账户，让灵感在这里继续生长。'}</p>{!session ? <div role="alert"><p className="form-error">{error || '尚未取得会话信息，无法开始登录。'}</p><button className="secondary-btn" onClick={() => void refresh()}>重试会话检查</button></div> : <><div className="account-tabs"><button disabled={busy} className={!register ? 'active' : ''} onClick={() => { setRegister(false); setError(''); }}>登录</button><button disabled={busy} className={register ? 'active' : ''} onClick={() => { setRegister(true); setError(''); }}>注册</button></div><form onSubmit={e => void submit(e)}>{register && <label className="field">你的名字<input required maxLength={100} autoComplete="name" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="怎么称呼你？"/></label>}<label className="field">邮箱<input type="email" required maxLength={254} autoComplete="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label><label className="field">密码<input type="password" required minLength={12} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} placeholder="12–128 个字符"/></label><p className="form-hint">请使用 12 至 128 个字符的密码。</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-btn account-submit" disabled={busy || (register && !name.trim())}>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowRight size={17}/>} {busy ? '正在安全连接…' : register ? '创建我的知识花园' : '登录工作空间'}</button></form></>}<p className="account-footnote"><ShieldCheck size={14}/>通过安全会话访问，不在浏览器保存密码或 Token。</p></div></section></main>;
}

function WorkspaceSession({ user, mode, onLogout, logoutBusy, logoutError }: { user: SessionUser; mode: SessionInfo['mode']; onLogout: () => void; logoutBusy: boolean; logoutError: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void api<{ workspaces: Workspace[] }>('/workspaces', undefined, 'GET', controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setWorkspaces(result.workspaces);
      const id = result.workspaces[0]?.id || ''; setActiveWorkspace(id); setActive(id);
    }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); setActiveWorkspace(''); };
  }, [attempt]);
  function activate(workspace: Workspace) { setActiveWorkspace(workspace.id); setWorkspaces(list => list.some(w => w.id === workspace.id) ? list.map(w => w.id === workspace.id ? workspace : w) : [...list, workspace]); setActive(workspace.id); }
  if (loading || error) return <div className="account-status">{loading ? <LoaderCircle className="spin" size={30}/> : <BookOpen size={34}/>}<h2>{loading ? '正在加载工作空间' : '无法加载工作空间'}</h2>{error && <p role="alert">{error}</p>}{error && <button className="primary-btn" onClick={() => setAttempt(v => v + 1)}>重试</button>}<button className="text-btn" disabled={logoutBusy} onClick={onLogout}>退出登录</button>{logoutError && <p role="alert">{logoutError}</p>}</div>;
  return <App key={active || 'empty'} workspace={workspaces.find(w => w.id === active) ?? null} workspaces={workspaces} onWorkspaceChange={activate} user={user} sessionMode={mode} onLogout={onLogout} logoutBusy={logoutBusy} logoutError={logoutError}/>;
}
