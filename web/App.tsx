import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, Code2, Compass, Eye, FileText, FolderClosed, Layers3, LoaderCircle, Menu, MessageCircle, PanelLeftClose, PencilLine, Plus, Puzzle, RefreshCw, Search, Send, ShieldCheck, Sparkles, Sprout, X } from 'lucide-react';
import { api, ApiError, type Answer, type SearchResult, type SessionInfo, type SessionUser, type WikiPage, type Workspace, type WorkspaceData } from './api';
import PageHistory from './PageHistory';
import WorkspacePicker from './WorkspacePicker';
import HomeView from './HomeView';
import ComponentCatalog from './ComponentCatalog';
import ReviewView from './ReviewView';
import KnowledgeView from './KnowledgeView';
import ProposalView from './ProposalView';

type View = 'home' | 'wiki' | 'market' | 'components' | 'reviews' | 'knowledge' | 'proposals';
type Mode = 'split' | 'edit' | 'preview';
const message = (error: unknown) => error instanceof Error ? error.message : '发生未知错误，请重试。';
const dateLabel = (date: string) => { const d = new Date(date); return Number.isNaN(d.getTime()) ? '尚未更新' : d.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

type AppProps = { workspace: Workspace | null; workspaces: Workspace[]; onWorkspaceChange: (workspace: Workspace) => void; user: SessionUser; sessionMode: SessionInfo['mode']; onLogout: () => void; logoutBusy: boolean; logoutError: string };
export default function App({ workspace, workspaces, onWorkspaceChange, user, sessionMode, onLogout, logoutBusy, logoutError }: AppProps) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<View>('wiki');
  const [selected, setSelected] = useState('');
  const [editorPage, setEditorPage] = useState<WikiPage | null>(null);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  // A workspace refresh must never advance this editor's CAS baseline.
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ title: string; markdown: string; parentId: string | null }>({ title: '', markdown: '', parentId: null });
  const [conflict, setConflict] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('split');
  const [html, setHtml] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { setBusy(current => logoutBusy ? 'logout' : current === 'logout' ? '' : current); }, [logoutBusy]);
  const [sidebar, setSidebar] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState('');
  const [homeDirty, setHomeDirty] = useState(false);
  const [knowledgeDirty, setKnowledgeDirty] = useState(false);
  const [proposalDirty, setProposalDirty] = useState(false);
  const childBusy = useCallback((value: boolean) => setBusy(value ? 'component-view' : ''), []);
  const selectedRef = useRef('');
  const dirty = title !== saved.title || markdown !== saved.markdown || parentId !== saved.parentId;
  const page = editorPage;
  const enabled = (id: string) => data?.plugins.some(p => p.id === id && p.enabled) ?? false;
  const load = useCallback(async (signal?: AbortSignal) => { const next = await api<WorkspaceData>('/workspace', undefined, 'GET', signal); if (!signal?.aborted) setData(next); return next; }, []);
  const guardWorkspaceExit = () => !busy && !logoutBusy && (!(dirty || homeDirty || knowledgeDirty || proposalDirty) || window.confirm('页面、资料或首页布局有未保存的更改，切换工作空间或退出将放弃这些更改。确定继续吗？'));
  const selectPage = (p: WikiPage, force = false) => {
    if (!force && busy) return;
    if (!force && (dirty || homeDirty || knowledgeDirty || proposalDirty) && !window.confirm('当前页面有未保存的更改，确定放弃吗？')) return;
    selectedRef.current = p.id; setSelected(p.id); setEditorPage(p); setTitle(p.title); setMarkdown(p.markdown); setParentId(p.parentId); setBaseRevision(p.revision); setSaved({ title: p.title, markdown: p.markdown, parentId: p.parentId }); setConflict(false); setHistoryOpen(false); setView('wiki'); setSidebar(false);
  };
  const initialize = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    if (!workspace?.id) { setLoading(false); return; }
    try { const next = await load(signal); if (signal?.aborted) return; if (next.pages[0] && !selectedRef.current) { const p = next.pages[0]; selectedRef.current = p.id; setSelected(p.id); setEditorPage(p); setTitle(p.title); setMarkdown(p.markdown); setParentId(p.parentId); setBaseRevision(p.revision); setSaved({ title: p.title, markdown: p.markdown, parentId: p.parentId }); setConflict(false); setHistoryOpen(false); } } catch (e) { if (!signal?.aborted) setError(message(e)); } finally { if (!signal?.aborted) setLoading(false); }
  }, [load, workspace?.id]);
  useEffect(() => { const controller = new AbortController(); void initialize(controller.signal); return () => controller.abort(); }, [initialize]);
  useEffect(() => { if (workspace) setData(current => current ? { ...current, workspace } : current); }, [workspace]);
  useEffect(() => { const fn = (e: BeforeUnloadEvent) => { if (dirty || homeDirty || knowledgeDirty || proposalDirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', fn); return () => window.removeEventListener('beforeunload', fn); }, [dirty, homeDirty, knowledgeDirty, proposalDirty]);
  useEffect(() => {
    if (!selected || !enabled('official.markdown')) { setHtml(''); setRendering(false); setRenderError(''); return; }
    const controller = new AbortController(); setRendering(true); setHtml(''); setRenderError('');
    const timer = window.setTimeout(() => {
      api<{ html: string }>('/render', { markdown }, 'POST', controller.signal).then(result => { if (!controller.signal.aborted) { if (typeof result.html !== 'string') throw new Error('预览接口未返回有效 HTML。'); setHtml(result.html); } }).catch(e => { if (!controller.signal.aborted) setRenderError(message(e)); }).finally(() => { if (!controller.signal.aborted) setRendering(false); });
    }, 380);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [markdown, selected, data?.plugins]);
  useEffect(() => {
    if (!searchOpen || !query.trim() || !enabled('official.search')) { setResults([]); setSearchLoading(false); setSearchError(''); return; }
    const controller = new AbortController(); setSearchLoading(true); setSearchError(''); setResults([]);
    const timer = window.setTimeout(() => { api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query.trim())}`, undefined, 'GET', controller.signal).then(r => { if (!controller.signal.aborted) setResults(r.results); }).catch(e => { if (!controller.signal.aborted) setSearchError(message(e)); }).finally(() => { if (!controller.signal.aborted) setSearchLoading(false); }); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, searchOpen, data?.plugins]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(v => !v); } if (e.key === 'Escape') { setSearchOpen(false); setAskOpen(false); setHistoryOpen(false); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4200); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!searchOpen && !askOpen && !historyOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable(); const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [searchOpen, askOpen, historyOpen]);
  async function action(key: string, task: () => Promise<void>, success: string) {
    if (busy) return; setBusy(key); setError('');
    try { await task(); await load(); setNotice(success); } catch (e) { setError(message(e)); } finally { setBusy(''); }
  }
  function pageError(e: unknown) {
    if (e instanceof ApiError && e.status === 409) {
      setConflict(true);
      setError('页面版本冲突：本地编辑已保留，未自动重试。请先复制需要保留的内容，再点击“加载最新页面”确认替换本地编辑。');
    } else setError(message(e));
  }
  async function refreshAfterMutation() {
    try { await load(); } catch (e) { setError(`操作已成功，但列表刷新失败：${message(e)}`); }
  }
  function clearEditor() {
    selectedRef.current = ''; setSelected(''); setEditorPage(null); setTitle(''); setMarkdown(''); setParentId(null); setBaseRevision(null); setSaved({ title: '', markdown: '', parentId: null }); setConflict(false); setHistoryOpen(false);
  }
  async function loadLatest() {
    if (busy || !selected) return;
    if (!window.confirm('加载最新页面将替换本地标题、正文和父页面选择。请先复制需要保留的内容。确定继续吗？')) return;
    setBusy('latest'); setError('');
    try {
      const next = await load(); const latest = next.pages.find(p => p.id === selected);
      if (latest) selectPage(latest, true);
      else { setError('该页面已删除或已不可访问，本地编辑仍保留。可复制内容后选择其它页面，或从回收站恢复。'); }
    } catch (e) { setError(message(e)); } finally { setBusy(''); }
  }
  async function savePage() {
    if (busy || !selected || !title.trim() || baseRevision === null || conflict) return;
    const next = { title: title.trim(), markdown, parentId, expectedRevision: baseRevision };
    setBusy('save'); setError('');
    try {
      const updated = await api<WikiPage>(`/pages/${encodeURIComponent(selected)}`, next, 'PUT');
      selectPage(updated, true); setNotice('页面已保存，知识又生长了一点。'); await refreshAfterMutation();
    } catch (e) { pageError(e); } finally { setBusy(''); }
  }
  async function deletePage() {
    if (busy || !selected || baseRevision === null || conflict) return;
    if (!window.confirm(`确定将“${title || '无标题页面'}”移入回收站吗？${dirty ? '未保存的编辑将被放弃。' : ''}`)) return;
    setBusy('delete'); setError('');
    try {
      await api(`/pages/${encodeURIComponent(selected)}`, { expectedRevision: baseRevision }, 'DELETE');
      const remaining = data?.pages.filter(p => p.id !== selected) || [];
      const next = remaining[0]; if (next) selectPage(next, true); else clearEditor();
      setNotice('页面已移入回收站'); await refreshAfterMutation();
    } catch (e) { pageError(e); } finally { setBusy(''); }
  }
  async function undeletePage(trashed: WikiPage) {
    if (busy) return;
    setBusy(`undelete-${trashed.id}`); setError('');
    try {
      await api<WikiPage>(`/pages/${encodeURIComponent(trashed.id)}/undelete`, { expectedRevision: trashed.revision });
      setNotice('页面已从回收站恢复，可在侧边栏打开。'); await refreshAfterMutation();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('回收站页面版本冲突，未自动重试；请点击顶部刷新按钮加载最新列表，再确认是否恢复。本地编辑未改变。');
      else setError(message(e));
    } finally { setBusy(''); }
  }
  async function restoreRevision(revision: number) {
    if (busy || !selected || baseRevision === null || conflict) return;
    if (!window.confirm(`确定恢复到版本 ${revision} 吗？这会创建新版本${dirty ? '，并放弃当前未保存的编辑' : ''}。`)) return;
    setBusy('restore'); setError('');
    try {
      const updated = await api<WikiPage>(`/pages/${encodeURIComponent(selected)}/restore`, { revision, expectedRevision: baseRevision });
      selectPage(updated, true); setNotice(`已恢复版本 ${revision}`); await refreshAfterMutation();
    } catch (e) { pageError(e); } finally { setBusy(''); }
  }
  function createPage() { if ((dirty || homeDirty || knowledgeDirty || proposalDirty) && !window.confirm('新建页面将离开当前未保存的内容，确定继续吗？')) return; void action('new', async () => { const p = await api<WikiPage>('/pages', { title: '无标题页面', markdown: '# 新的灵感\n\n从这里开始，记录值得留下的知识。\n' }); selectPage(p, true); }, '新页面已创建'); }
  function openSource(id: string) { const p = data?.pages.find(p => p.id === id); if (p) { selectPage(p); setSearchOpen(false); } else setError('该引用页面不在当前工作区，请刷新后重试。'); }
  function ask(e: FormEvent) { e.preventDefault(); if (!question.trim() || busy) return; setAskError(''); setAnswer(null); setBusy('ask'); void api<Answer>('/ask', { question: question.trim() }).then(setAnswer).catch(e => setAskError(message(e))).finally(() => setBusy('')); }
  const nav = (next: View) => { if (busy || (view !== next && (dirty || homeDirty || knowledgeDirty || proposalDirty) && !window.confirm('页面、资料或首页布局有未保存的更改，确定离开吗？'))) return; setView(next); setSidebar(false); };

  return <div className="app-shell">
    {sidebar && <button className="sidebar-scrim" aria-label="收起导航" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); nav('home'); }}><span className="brand-mark"><BookOpen size={24}/><span/></span><span>meow<span className="brand-light">wiki</span><small>让知识，自由生长</small></span></a>
      <WorkspacePicker workspace={workspace} workspaces={workspaces} guard={guardWorkspaceExit} onChange={onWorkspaceChange} disabled={!!busy || logoutBusy} onBusyChange={value => setBusy(value ? 'workspace' : '')}/>
      <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16}/><span>搜索你的知识</span><kbd>Ctrl K</kbd></button>
      <nav className="main-nav" aria-label="主导航"><button className={view === 'proposals' ? 'active' : ''} onClick={() => nav('proposals')}><PencilLine size={18}/>写入提议</button><button className={view === 'home' ? 'active' : ''} onClick={() => nav('home')}><Sprout size={18}/>首页</button><button className={view === 'wiki' ? 'active' : ''} onClick={() => nav('wiki')}><BookOpen size={18}/>知识空间<span className="nav-count">{data?.pages.length || 0}</span></button><button className={view === 'knowledge' ? 'active' : ''} onClick={() => nav('knowledge')}><FileText size={18}/>资料工作台</button><button className={view === 'market' ? 'active' : ''} onClick={() => nav('market')}><Compass size={18}/>插件市场<span className="small-dot"/></button><button className={view === 'components' ? 'active' : ''} onClick={() => nav('components')}><Layers3 size={18}/>我的组件</button>{user.role === 'admin' && <button className={view === 'reviews' ? 'active' : ''} onClick={() => nav('reviews')}><ShieldCheck size={18}/>组件审核</button>}</nav>
      <div className="sidebar-label"><span>我的页面</span><button title="新建页面" aria-label="新建页面" disabled={!!busy || !data} onClick={createPage}><Plus size={16}/></button></div>
      <div className="page-tree"><div className="tree-folder"><FolderClosed size={15}/><span>知识笔记</span><span>{data?.pages.length || 0}</span></div>{data?.pages.map(p => <button key={p.id} className={`tree-page ${selected === p.id && view === 'wiki' ? 'selected' : ''}`} onClick={() => selectPage(p)}><FileText size={15}/><span>{p.title || '无标题页面'}</span></button>)}{!loading && !data?.pages.length && <p className="sidebar-empty">还没有页面，种下第一颗知识种子吧。</p>}</div>
      <details style={{ padding: '8px 20px', maxHeight: 200, overflowY: 'auto' }}><summary style={{ cursor: 'pointer' }}>回收站 · {data?.trash?.length || 0}</summary>{data?.trash?.map(p => <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}><span style={{ flex: 1, overflowWrap: 'anywhere' }}>{p.title || '无标题页面'}</span><button className="text-btn" disabled={!!busy} onClick={() => void undeletePage(p)}>恢复</button></div>)}{!data?.trash?.length && <p className="sidebar-empty">回收站为空</p>}</details>
      <div className="sidebar-bottom"><div className="garden-card"><Sprout size={24}/><strong>每一条记录，都有回响</strong><p>把零散的灵感，种成自己的知识花园。</p><button onClick={createPage} disabled={!!busy || !data}>记录一个灵感 <ArrowRight size={14}/></button></div><div className="profile"><span className="profile-avatar">{user.username.slice(0, 1) || '我'}</span><div><strong>{user.username}</strong><small><span/>{sessionMode === 'local' ? '本地模式' : '安全会话'}</small></div><button className="text-btn" disabled={!!busy || logoutBusy} onClick={() => { if (guardWorkspaceExit()) onLogout(); }}>{logoutBusy ? '退出中…' : '退出'}</button></div></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="mobile-menu icon-btn" aria-label="展开导航" onClick={() => setSidebar(true)}><Menu size={20}/></button><span>我的工作空间</span><ChevronRight size={13}/><strong>{view === 'home' ? '首页' : view === 'wiki' ? '知识空间' : view === 'market' ? '插件市场' : view === 'knowledge' ? '资料工作台' : view === 'reviews' ? '组件审核' : '我的组件'}</strong></div><div className="topbar-actions"><span className="private-label"><ShieldCheck size={13}/>仅自己可见</span><button className="icon-btn" title="刷新工作空间" disabled={!!busy || loading} onClick={() => { void load().catch(e => setError(message(e))); }}><RefreshCw size={16}/></button><span className="top-avatar">我</span></div></header>
      {logoutError && <div className="global-error" role="alert">退出登录失败：{logoutError}</div>}
      {error && <div className="global-error" role="alert"><CircleHelp size={17}/><span>{error}</span><button onClick={() => setError('')} aria-label="关闭错误"><X size={16}/></button></div>}
      {conflict && <div className="global-error" role="alert"><span>本地编辑基于版本 {baseRevision}，已发生冲突。不会自动覆盖；复制本地内容后可明确加载最新页面。</span><button disabled={!!busy} onClick={() => void loadLatest()}>加载最新页面</button></div>}
      {notice && <div className="toast" role="status"><CheckCheck size={17}/>{notice}</div>}
      {loading ? <div className="loading-screen"><LoaderCircle className="spin" size={30}/><h2>正在打开你的知识花园</h2><p>连接本地工作空间…</p></div> : !data ? <div className="loading-screen"><BookOpen size={38}/><h2>暂时无法打开工作空间</h2><p>{workspace ? '请检查连接或工作空间访问权限，然后重试。' : '请打开左侧工作空间选择器，创建你的第一个空间。'}</p>{workspace && <button className="primary-btn" onClick={() => void initialize()}><RefreshCw size={16}/>重新连接</button>}</div> : <>
        {view === 'wiki' && <div className="wiki-view"><div className="section-heading"><div><div className="eyebrow"><span/>YOUR PERSONAL KNOWLEDGE GARDEN</div><h1>知识空间<span className="heading-dot">.</span></h1><p>{data.workspace.description || '收藏灵感，连接想法。在这里，慢慢建立你的知识宇宙。'}</p></div><button className="primary-btn" disabled={!!busy} onClick={createPage}>{busy === 'new' ? <LoaderCircle className="spin" size={16}/> : <Plus size={17}/>}新建页面</button></div>
          <div className="workspace-stats"><span><FileText size={14}/><b>{data.pages.length}</b> 篇知识笔记</span><span><Puzzle size={14}/><b>{data.plugins.filter(p => p.enabled).length}</b> 个插件已启用</span><span className="stats-hint"><span/>所有内容存储在本地工作空间</span></div>
          {!page ? <div className="empty-state large"><div className="empty-icon"><Sprout size={32}/></div><h2>给你的第一个想法，找个家</h2><p>一份笔记、一段灵感，都可以是知识花园的开始。</p><button className="primary-btn" onClick={createPage} disabled={!!busy}><Plus size={16}/>创建第一篇页面</button></div> : <section className="editor-card"><div className="document-heading"><div className="document-path"><span className="document-icon"><FileText size={19}/></span><span>知识笔记</span><ChevronRight size={13}/><strong>{page.title}</strong></div><span className={`save-status ${dirty ? 'unsaved' : ''}`}>{dirty ? <span className="unsaved-dot"/> : <Check size={13}/>} {dirty ? '有未保存更改' : '已保存'}</span></div><div className="document-title"><input aria-label="页面标题" disabled={!!busy} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="无标题页面"/><div className="document-meta"><Clock3 size={13}/>更新于 {dateLabel(page.updatedAt)}<span className="meta-separator">·</span><span>{markdown.length.toLocaleString()} 字符</span><span className="document-tag">Markdown · v{baseRevision}</span></div><label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 12 }}>父页面<select aria-label="父页面" disabled={!!busy} value={parentId ?? ''} onChange={e => setParentId(e.target.value || null)} style={{ maxWidth: '70%', padding: '6px 10px', border: '1px solid #deded8', borderRadius: 6, background: 'transparent' }}><option value="">无（顶层页面）</option>{parentId && !data.pages.some(p => p.id === parentId) && <option value={parentId}>原父页面（已删除或不可访问）</option>}{data.pages.filter(p => p.id !== selected).map(p => <option key={p.id} value={p.id}>{p.title || '无标题页面'}</option>)}</select></label></div><div className="editor-toolbar"><div className="mode-tabs" aria-label="编辑模式"><button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}><PencilLine size={14}/>编辑</button><button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}><PanelLeftClose size={14}/>分屏</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}><Eye size={14}/>预览</button></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}><button className="text-btn" disabled={!!busy} onClick={() => setHistoryOpen(true)}>历史</button><button className="text-btn" disabled={!!busy} onClick={() => void loadLatest()}>加载最新</button><button className="text-btn" disabled={!!busy || conflict} onClick={() => void deletePage()}>删除</button><button className="save-btn" onClick={() => void savePage()} disabled={!!busy || conflict || !dirty || !title.trim()}>{busy === 'save' ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}保存页面</button></div></div><div className={`editor-panels mode-${mode}`}>{mode !== 'preview' && <div className="source-panel"><div className="panel-label"><span><Code2 size={13}/>MARKDOWN</span><span>纯文本，专注表达</span></div><textarea aria-label="Markdown 内容" disabled={!!busy} spellCheck={false} value={markdown} onChange={e => setMarkdown(e.target.value)} placeholder="# 从一个想法开始…"/></div>}{mode !== 'edit' && <div className="preview-panel"><div className="panel-label"><span><Eye size={13}/>实时预览</span><span className="live-indicator"><span/>安全渲染</span></div>{!enabled('official.markdown') ? <div className="inline-state"><Puzzle size={25}/><p>Markdown 插件尚未启用</p><button className="text-btn" onClick={() => nav('market')}>前往插件市场启用 <ArrowRight size={13}/></button></div> : renderError ? <div className="inline-state error-text" role="alert"><CircleHelp size={24}/><p>{renderError}</p><button className="text-btn" onClick={() => void load().catch(e => setError(message(e)))}>重试预览</button></div> : rendering ? <div className="inline-state"><LoaderCircle className="spin" size={24}/><p>正在安全渲染…</p></div> : html ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }}/> : <div className="inline-state"><PencilLine size={24}/><p>写点什么，预览会在这里生长。</p></div>}</div>}</div><footer className="editor-footer"><span><ShieldCheck size={12}/>预览仅使用服务端净化后的 HTML</span><span>好想法，值得被记录 <Sprout size={13}/></span></footer></section>}
          <button className="ask-banner" onClick={() => setAskOpen(true)}><span className="ask-banner-icon"><Sparkles size={21}/></span><span><strong>让知识彼此连接</strong><small>向你的 Wiki 提问，从已有笔记中寻找答案</small></span><span className="local-badge">本地引用问答</span><ArrowRight size={18}/></button><div className="quiet-footer"><span>一点一滴，积累属于你的知识。</span><span>MADE FOR CURIOUS MINDS <Sprout size={12}/></span></div>
        </div>}
        {view === 'proposals' && <ProposalView pages={data.pages} onDirtyChange={setProposalDirty} onBusyChange={childBusy} onApplied={load}/>}
        {view === 'knowledge' && <KnowledgeView key={data.workspace.id} draftKey={`${user.id}:${data.workspace.id}`} askEnabled={enabled('official.llm-wiki') && enabled('official.search')} onDirtyChange={setKnowledgeDirty} onBusyChange={childBusy}/>}
        {view === 'home' && <HomeView data={data} onOpen={openSource} onDirtyChange={setHomeDirty} onBusyChange={childBusy}/>}
        {(view === 'market' || view === 'components') && <ComponentCatalog key={view} view={view} data={data} user={user} refresh={load} onOpen={openSource} onBusyChange={childBusy}/>}
        {view === 'reviews' && user.role === 'admin' && <ReviewView userId={user.id} pages={data.pages} onOpen={openSource} refresh={load} onBusyChange={childBusy}/>}
      </>}
    </main>
    {historyOpen && page && <PageHistory pageId={page.id} busy={!!busy} conflict={conflict} onClose={() => setHistoryOpen(false)} onRestore={revision => void restoreRevision(revision)}/>}
    {searchOpen && <div className="modal-backdrop" onClick={() => setSearchOpen(false)}><section className="search-modal" role="dialog" aria-modal="true" aria-label="搜索知识" onClick={e => e.stopPropagation()}><div className="search-input-row"><Search size={21}/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索你的页面、想法和灵感…" aria-label="搜索关键词"/><button className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="关闭搜索"><X size={19}/></button></div><div className="search-results">{!enabled('official.search') ? <div className="empty-state"><Puzzle size={25}/><h3>搜索插件尚未启用</h3><button className="text-btn" onClick={() => { nav('market'); setSearchOpen(false); }}>前往插件市场启用</button></div> : searchLoading ? <div className="inline-state"><LoaderCircle size={23} className="spin"/><p>正在寻找相关知识…</p></div> : searchError ? <p className="form-error" role="alert">{searchError}</p> : !query.trim() ? <div className="empty-state"><Search size={27}/><h3>每一个想法，都有迹可循</h3><p>输入关键词，发现笔记之间的连接。</p></div> : results.length ? results.map(r => <button className="search-result" key={r.id} onClick={() => openSource(r.id)}><FileText size={19}/><span><strong>{r.title}</strong><small>{r.excerpt}</small></span><ArrowRight size={15}/></button>) : <div className="empty-state"><Search size={25}/><h3>没有找到相关页面</h3><p>换一个关键词，再找找看。</p></div>}</div><footer className="search-footer"><span>在当前工作空间中搜索</span><kbd>Esc 关闭</kbd></footer></section></div>}
    {askOpen && <div className="modal-backdrop" onClick={() => setAskOpen(false)}><section className="dialog ask-dialog" role="dialog" aria-modal="true" aria-labelledby="ask-title" onClick={e => e.stopPropagation()}><div className="dialog-heading"><span className="dialog-icon"><Sparkles size={23}/></span><button className="icon-btn" onClick={() => setAskOpen(false)} aria-label="关闭问答"><X size={20}/></button></div><h2 id="ask-title">向你的知识空间提问</h2><p className="dialog-description">答案来自已有笔记，而不是凭空想象。</p><div className="local-notice"><ShieldCheck size={15}/><span>本地引用问答 · 未配置模型<br/><small>使用本地内容提取与引用，不调用或假装调用大语言模型。</small></span></div>{!enabled('official.llm-wiki') ? <div className="empty-state"><Puzzle size={26}/><h3>请先启用 Wiki 问答插件</h3><button className="text-btn" onClick={() => { nav('market'); setAskOpen(false); }}>前往插件市场 <ArrowRight size={14}/></button></div> : <><form className="ask-form" onSubmit={ask}><input autoFocus aria-label="问题" value={question} onChange={e => setQuestion(e.target.value)} placeholder="例如：我的项目计划是什么？" maxLength={2000}/><button className="primary-btn" disabled={!!busy || !question.trim()} aria-label="发送问题">{busy === 'ask' ? <LoaderCircle size={17} className="spin"/> : <Send size={17}/>}</button></form>{askError && <p className="form-error" role="alert">{askError}</p>}{busy === 'ask' && <div className="inline-state"><LoaderCircle className="spin" size={22}/><p>正在阅读本地知识…</p></div>}{answer && <div className="answer-content"><span className="answer-label"><MessageCircle size={14}/>本地摘录回答</span><p>{answer.answer || '当前知识空间中没有足够的相关内容。'}</p><h4>参考来源 · {answer.sources.length}</h4>{answer.sources.map(s => <button className="source-card" key={s.id} onClick={() => { openSource(s.id); setAskOpen(false); }}><FileText size={16}/><span><strong>{s.title}</strong><small>{s.excerpt}</small></span><ArrowRight size={14}/></button>)}</div>}</>}</section></div>}
  </div>;
}
