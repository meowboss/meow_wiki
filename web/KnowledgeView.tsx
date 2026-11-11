import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, LoaderCircle, Plus, RefreshCw, Send, Upload, X } from 'lucide-react';
import { api, ApiError } from './api';
import './knowledge.css';

type Status = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
type Source = { id: string; workspaceId: string; title: string; revision: number; status: Status; createdAt: string; updatedAt: string; deletedAt: string | null };
type Detail = Source & { content: string };
type Job = { id: string; sourceId: string; revision: number; attempt: number; status: Status; error: string | null };
type Citation = { sourceId: string; revision: number; chunkId: string; title: string; excerpt: string; label: string };
type Answer = { mode: 'local-extractive' | 'model' | 'no-evidence'; answer: string; sources: Citation[] };
type Draft = { id: string; title: string; content: string; base: { title: string; content: string; revision: number | null } };
const blank = (): Draft => ({ id: '', title: '', content: '', base: { title: '', content: '', revision: null } });
const changed = (draft: Draft) => draft.title !== draft.base.title || draft.content !== draft.base.content;
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。';
const labels: Record<Status, string> = { queued: '待处理', running: '处理中', ready: '已就绪', failed: '处理错误', cancelled: '已取消' };
function restore(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as Draft | null;
    if (value && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.content === 'string' && value.base && typeof value.base.title === 'string' && typeof value.base.content === 'string' && (value.base.revision === null || Number.isSafeInteger(value.base.revision))) return value;
  } catch { /* Storage may be disabled. */ }
  return blank();
}

export default function KnowledgeView({ draftKey, askEnabled, onDirtyChange, onBusyChange }: { draftKey: string; askEnabled: boolean; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const storageKey = `meow-knowledge-draft:${draftKey}`;
  const [draft, setDraft] = useState<Draft>(() => restore(storageKey));
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [model, setModel] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [modelError, setModelError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<'extractive' | 'model'>('extractive');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [citation, setCitation] = useState<{ hit: Citation; detail: Detail | null; error: string } | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const listRequest = useRef<AbortController | null>(null);
  const modelRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const citationRequest = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const highlight = useRef<HTMLElement>(null);
  const dirty = changed(draft);
  const source = sources.find(s => s.id === draft.id);
  const request = useCallback(async <T,>(path: string, body?: unknown, method?: string, controller = new AbortController()) => {
    controllers.current.add(controller);
    try { const result = await api<T>(path, body, method, controller.signal); if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError'); return result; }
    finally { controllers.current.delete(controller); }
  }, []);
  const refresh = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller; setLoading(true);
    try { const result = await request<{ sources: Source[]; jobs: Job[] }>('/sources', undefined, 'GET', controller); setSources(result.sources); setJobs(result.jobs); }
    catch (e) { if (!controller.signal.aborted) setError(message(e)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [request]);
  const refreshModel = useCallback(async () => {
    modelRequest.current?.abort();
    const controller = new AbortController(); modelRequest.current = controller;
    setModelError('');
    try { const result = await request<{ configured: boolean; model: string | null }>('/models/status', undefined, 'GET', controller); setModel(result); if (!result.configured) setMode('extractive'); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) { setModel(null); setMode('extractive'); setModelError(message(e)); } }
  }, [request]);
  useEffect(() => { void refresh(); void refreshModel(); const active = controllers.current; return () => { for (const c of active) c.abort(); onBusyChange(false); onDirtyChange(false); }; }, [refresh, refreshModel, onBusyChange, onDirtyChange]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    try { if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(draft)); else sessionStorage.removeItem(storageKey); }
    catch { if (dirty) setNotice('浏览器草稿存储不可用；本页刷新可能丢失编辑，请先保存或复制。'); }
  }, [draft, dirty, storageKey]);
  useEffect(() => { highlight.current?.scrollIntoView({ block: 'center' }); }, [citation]);
  function allowReplace() { return !operation.current && (!dirty || window.confirm('当前资料有未保存更改，确定放弃并打开其他内容吗？')); }
  function reset(next: Draft) { setDraft(next); setConflict(false); setError(''); }
  async function open(id: string, latest = false) {
    if (operation.current || (!latest && !allowReplace())) return;
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller;
    setError(''); setBusy('open'); onBusyChange(true);
    try { const detail = await request<Detail>(`/sources/${encodeURIComponent(id)}`, undefined, 'GET', controller); reset({ id: detail.id, title: detail.title, content: detail.content, base: { title: detail.title, content: detail.content, revision: detail.revision } }); if (latest) setNotice('已明确加载最新资料。'); }
    catch (e) { if (!controller.signal.aborted) setError(message(e)); }
    finally { if (!controller.signal.aborted) { setBusy(''); onBusyChange(false); } }
  }
  async function mutate(key: string, work: () => Promise<void>) {
    if (operation.current || busy) return;
    operation.current = true; setBusy(key); onBusyChange(true); setError(''); setNotice('');
    try { await work(); await refresh(); }
    catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (key === 'save' && e instanceof ApiError && e.status === 409) { setConflict(true); setError('版本冲突：本地草稿及原版本基线已保留，未自动覆盖或重试。请复制需要的内容后，明确加载最新资料。'); }
      else setError(message(e));
    } finally { operation.current = false; setBusy(''); onBusyChange(false); }
  }
  function save(e: FormEvent) {
    e.preventDefault(); if (!draft.title.trim() || !draft.content.trim() || draft.content.length > 200_000 || conflict) return;
    void mutate('save', async () => {
      const title = draft.title.trim(), content = draft.content;
      const result = await request<Source>(draft.id ? `/sources/${encodeURIComponent(draft.id)}` : '/sources', draft.id ? { title, content, expectedRevision: draft.base.revision } : { title, content }, draft.id ? 'PUT' : 'POST');
      reset({ id: result.id, title, content, base: { title, content, revision: result.revision } }); setAnswer(null); setNotice('资料已保存为待处理状态。请点击“处理资料”建立可检索内容。');
    });
  }
  async function importFile(file: File | undefined) {
    if (!file || !allowReplace()) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name)) { setError('仅支持 .txt、.md、.markdown 文本文件。'); return; }
    if (file.size > 800_000) { setError('文件过大；资料最多 200000 字符。'); return; }
    operation.current = true; setBusy('import'); onBusyChange(true); setError('');
    try { const content = await file.text(); if (!content.trim() || content.length > 200_000 || content.includes('\0')) throw new Error('请输入非空文本或 Markdown，最多 200000 字符，不支持二进制内容。'); reset({ ...blank(), title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), content }); setNotice('文件已读入草稿，尚未上传。保存后仍需手动处理。'); }
    catch (e) { setError(message(e)); }
    finally { operation.current = false; setBusy(''); onBusyChange(false); }
  }
  function ask(e: FormEvent) {
    e.preventDefault(); if (!askEnabled || !question.trim() || (mode === 'model' && !model?.configured)) return;
    void mutate('ask', async () => { setAnswer(null); const result = await request<Answer>('/knowledge/ask', { question: question.trim(), mode }); setAnswer(result); });
  }
  async function viewCitation(hit: Citation) {
    citationRequest.current?.abort(); const controller = new AbortController(); citationRequest.current = controller;
    setCitation({ hit, detail: null, error: '' });
    try { const detail = await request<Detail>(`/sources/${encodeURIComponent(hit.sourceId)}`, undefined, 'GET', controller); setCitation({ hit, detail, error: '' }); }
    catch (e) { if (!controller.signal.aborted) setCitation({ hit, detail: null, error: `引用资料已删除、不可访问或加载失败：${message(e)}` }); }
  }
  const citationIndex = citation?.detail && citation.detail.revision === citation.hit.revision ? citation.detail.content.indexOf(citation.hit.excerpt) : -1;
  return <div className="catalog-view knowledge-view">
    <div className="section-heading"><div><div className="eyebrow">SOURCE KNOWLEDGE WORKBENCH</div><h1>资料工作台<span className="heading-dot">.</span></h1><p>导入原文，手动处理，基于可核验的资料问答。</p></div><div className="knowledge-actions"><button className="secondary-btn" disabled={!!busy || loading} onClick={() => { setError(''); void refresh(); void refreshModel(); }}><RefreshCw size={15}/>刷新状态</button><button className="primary-btn" disabled={!!busy} onClick={() => { if (allowReplace()) reset(blank()); }}><Plus size={16}/>新建资料</button></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="knowledge-notice" role="status">{notice}</p>}
    <div className="knowledge-grid"><section className="knowledge-list" aria-label="资料列表"><h2>资料来源 · {sources.length}</h2><p className="knowledge-hint">刷新只更新状态，不替换当前草稿。</p>{loading && <p role="status">正在刷新资料…</p>}{!loading && !sources.length && <p>暂无资料。新建或导入文本开始。</p>}{sources.map(s => <button key={s.id} disabled={!!busy} className={`knowledge-source ${s.id === draft.id ? 'selected' : ''}`} onClick={() => void open(s.id)}><FileText size={16}/><span><strong>{s.title}</strong><small>v{s.revision} · <span className={`knowledge-status status-${s.status}`}>{labels[s.status] || s.status}</span></small></span></button>)}</section>
    <section className="knowledge-editor"><form onSubmit={save}><div className="knowledge-actions"><h2>{draft.id ? '编辑资料' : '新资料'}</h2><span className="knowledge-hint">{dirty ? '未保存草稿' : '无未保存更改'}{draft.base.revision !== null ? ` · 基于 v${draft.base.revision}` : ''}</span><button className="secondary-btn" type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={15}/>导入文件</button><input ref={fileInput} type="file" hidden accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importFile(file); }}/></div>
    <label className="field">资料标题<input aria-label="资料标题" disabled={!!busy} maxLength={200} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="给资料一个清晰的名字"/></label><label className="field">原文 · 文本 / Markdown<textarea aria-label="资料原文" disabled={!!busy} maxLength={200000} value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))} placeholder="粘贴资料原文，或导入文本 / Markdown 文件。"/></label><p className="knowledge-hint">{draft.content.length.toLocaleString()} / 200000 字符 · 原文按纯文本显示，不执行 HTML。草稿保存在当前浏览器会话中。</p>
    {draft.id && source && source.revision !== draft.base.revision && <p className="form-error">服务器已是 v{source.revision}，编辑仍基于 v{draft.base.revision}；刷新不会推进保存基线。</p>}{draft.id && !loading && !source && <p className="knowledge-hint">当前草稿对应的来源不在列表中；可能已删除或列表尚未加载。草稿仍保留。</p>}
    <div className="knowledge-actions"><button className="primary-btn" disabled={!!busy || !draft.title.trim() || !draft.content.trim() || conflict || (!dirty && !!draft.id)}>{busy === 'save' ? <LoaderCircle size={15} className="spin"/> : null}保存资料</button>{draft.id && <><button type="button" className="secondary-btn" disabled={!!busy} onClick={() => { if (window.confirm('加载最新资料会替换本地草稿。请先复制需要保留的内容，确定继续吗？')) void open(draft.id, true); }}>加载最新资料</button><button type="button" className="secondary-btn" disabled={!!busy || dirty || conflict || !source || source.status === 'running'} onClick={() => void mutate('process', async () => { await request<Source>(`/sources/${encodeURIComponent(draft.id)}/process`, undefined, 'POST'); setAnswer(null); setNotice('处理请求已完成；以刷新后的实际状态为准。'); })}>{busy === 'process' ? '处理中…' : '处理资料'}</button><button type="button" className="text-btn knowledge-danger" disabled={!!busy} onClick={() => { if (window.confirm(`确定删除“${draft.title}”吗？来源、索引和相关引用将失效。${dirty ? '本地未保存编辑也将放弃。' : ''}`)) void mutate('delete', async () => { await request(`/sources/${encodeURIComponent(draft.id)}`, undefined, 'DELETE'); reset(blank()); setAnswer(null); setNotice('资料已删除。'); }); }}>删除资料</button></>}</div><p className="knowledge-hint">保存会进入 queued（待处理），不会自动建立索引。编辑后请先保存，再手动处理；只有 ready（已就绪）的当前版本参与问答。</p>
    </form>{draft.id && <details className="knowledge-jobs"><summary>处理记录</summary>{jobs.filter(j => j.sourceId === draft.id).map(j => <p key={j.id}>v{j.revision} · 第 {j.attempt} 次 · {labels[j.status] || j.status}{j.error && <span className="form-error"> · {j.error}</span>}</p>)}</details>}</section></div>
    <section className="knowledge-ask"><h2>向资料提问</h2><div className="local-notice"><span>{model?.configured ? `宿主已配置模型${model.model ? `：${model.model}` : ''}。模型模式会向宿主配置的模型发送问题及检索片段。` : modelError ? `无法确认模型状态，已禁用模型模式：${modelError}` : model === null ? '正在检查模型配置；模型模式暂不可用。' : '宿主未配置模型。仅可使用本地摘录，不调用或假装调用大语言模型。'}</span></div>{!askEnabled && <p className="form-error">请先在插件市场启用问答与检索插件，才能使用资料问答。</p>}<form onSubmit={ask} className="knowledge-ask-form"><label className="field">回答模式<select aria-label="资料回答模式" disabled={!!busy} value={mode} onChange={e => setMode(e.target.value as 'extractive' | 'model')}><option value="extractive">本地摘录（不调用模型）</option><option value="model" disabled={!model?.configured}>模型回答{!model?.configured ? '（不可用）' : ''}</option></select></label><label className="field">问题<input aria-label="资料问题" maxLength={1000} disabled={!!busy} value={question} onChange={e => setQuestion(e.target.value)} placeholder="输入资料中的关键词或问题"/></label><button className="primary-btn" disabled={!!busy || !askEnabled || !question.trim() || (mode === 'model' && !model?.configured)}><Send size={15}/>{busy === 'ask' ? '正在查询…' : '提问'}</button></form>{answer && <div className="knowledge-answer"><strong>{answer.mode === 'model' ? '模型回答 · 请核验引用' : answer.mode === 'no-evidence' ? '无可引用证据 · 未调用模型' : '本地摘录 · 非模型生成'}</strong><p>{answer.answer}</p><h3>引用来源 · {answer.sources.length}</h3>{answer.sources.map(hit => <button className="source-card" key={`${hit.sourceId}:${hit.revision}:${hit.chunkId}`} onClick={() => void viewCitation(hit)}><FileText size={16}/><span><strong>[{hit.label}] {hit.title} · v{hit.revision}</strong><small>{hit.excerpt}</small><small>查看原文并定位引用</small></span></button>)}</div>}</section>
    {citation && <section className="knowledge-citation" aria-label="引用原文查看"><div className="knowledge-actions"><h2>[{citation.hit.label}] {citation.hit.title}</h2><button className="icon-btn" aria-label="关闭引用原文" onClick={() => { citationRequest.current?.abort(); setCitation(null); }}><X size={18}/></button></div><p className="knowledge-hint">来源 {citation.hit.sourceId} · 引用版本 v{citation.hit.revision} · 片段 {citation.hit.chunkId}</p><blockquote>{citation.hit.excerpt}</blockquote>{citation.error ? <p role="alert" className="form-error">{citation.error}</p> : !citation.detail ? <p role="status">正在加载原文…</p> : <>{citation.detail.revision !== citation.hit.revision ? <p role="alert" className="form-error">引用已过期：来源当前为 v{citation.detail.revision}，以下是当前原文，不是引用时的历史版本。请重新提问核验。</p> : citation.detail.status !== 'ready' ? <p role="alert">来源当前尚未就绪，此引用需要重新处理后核验。</p> : <p>{citationIndex >= 0 ? '已在同版本原文中定位摘录（重复文本显示首次匹配）。' : '未能在原文中精确定位摘录，请手动核验。'}</p>}<pre className="knowledge-original">{citationIndex >= 0 ? <>{citation.detail.content.slice(0, citationIndex)}<mark ref={highlight}>{citation.detail.content.slice(citationIndex, citationIndex + citation.hit.excerpt.length)}</mark>{citation.detail.content.slice(citationIndex + citation.hit.excerpt.length)}</> : citation.detail.content}</pre></>}</section>}
  </div>;
}
