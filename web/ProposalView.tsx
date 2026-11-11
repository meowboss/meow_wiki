import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type WikiPage } from './api';

export interface Props {
  pages: WikiPage[];
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onApplied: () => Promise<unknown>;
}

type Evidence = { sourceId: string; revision: number; chunkId: string };
type Proposal = {
  id: string;
  pageId: string;
  expectedRevision: number;
  title: string;
  markdown: string;
  evidence: Evidence[];
  status: string;
  createdAt: string;
};
type Draft = { title: string; markdown: string; evidence: string };
const emptyDraft: Draft = { title: '', markdown: '', evidence: '[]' };
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plainTextStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' } as const;

function parseEvidence(text: string): Evidence[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('证据引用必须是合法的 JSON 数组。'); }
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('请粘贴 1–8 条来自问答的证据引用。');
  return value.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${index + 1} 条证据不是引用对象。`);
    const ref = item as Record<string, unknown>;
    if (Object.keys(ref).some(key => !['sourceId', 'revision', 'chunkId'].includes(key)) || typeof ref.sourceId !== 'string' || !uuid.test(ref.sourceId) || typeof ref.chunkId !== 'string' || !uuid.test(ref.chunkId) || typeof ref.revision !== 'number' || !Number.isSafeInteger(ref.revision) || ref.revision < 1) {
      throw new Error(`第 ${index + 1} 条证据需要 UUID 格式的 sourceId、chunkId 和正整数 revision，且不能含其它字段。`);
    }
    return { sourceId: ref.sourceId, revision: ref.revision, chunkId: ref.chunkId };
  });
}

function Comparison({ current, title, markdown }: { current?: WikiPage; title: string; markdown: string }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
    <section aria-label="当前页面纯文本"><h4>当前页面{current ? ` · v${current.revision}` : ''}</h4>{current ? <><strong>{current.title}</strong><pre className="template-preview" style={plainTextStyle}>{current.markdown}</pre></> : <p>目标页面不存在、已删除或尚未选择。</p>}</section>
    <section aria-label="拟议页面纯文本"><h4>拟议内容</h4><strong>{title || '（标题为空）'}</strong><pre className="template-preview" style={plainTextStyle}>{markdown || '（正文为空）'}</pre></section>
  </div>;
}

export default function ProposalView({ pages, onDirtyChange, onBusyChange, onApplied }: Props) {
  const [target, setTarget] = useState<WikiPage | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState<Draft>(emptyDraft);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [modelReady, setModelReady] = useState(false);
  const [instruction, setInstruction] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onDirtyChange, onBusyChange, onApplied });
  callbacks.current = { onDirtyChange, onBusyChange, onApplied };
  const dirty = draft.title !== saved.title || draft.markdown !== saved.markdown || draft.evidence !== saved.evidence;
  const working = busy || loading;
  const currentPage = pages.find(page => page.id === target?.id && !page.deletedAt);
  const activePages = pages.filter(page => !page.deletedAt);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (mounted.current) { setLoading(true); setListError(''); }
    try {
      const result = await api<{ proposals: Proposal[] }>('/proposals', undefined, 'GET', signal);
      if (!Array.isArray(result?.proposals)) throw new Error('提议列表返回格式无效。');
      if (mounted.current && !signal?.aborted) { setProposals(result.proposals); setLoaded(true); }
    } catch (e) {
      if (mounted.current && !signal?.aborted) setListError(`提议列表刷新失败：${message(e)}`);
    } finally {
      if (mounted.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    void api<{ configured: boolean }>('/models/status', undefined, 'GET', controller.signal).then(r => { if (!controller.signal.aborted) setModelReady(r.configured); }).catch(() => {});
    return () => { mounted.current = false; controller.abort(); callbacks.current.onDirtyChange(false); callbacks.current.onBusyChange(false); };
  }, [load]);
  useEffect(() => { callbacks.current.onDirtyChange(dirty); }, [dirty]);
  useEffect(() => { callbacks.current.onBusyChange(working); }, [working]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || working) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, working]);

  function selectTarget(id: string, force = false) {
    if (working || (!force && id === target?.id)) return;
    if (dirty && !window.confirm('提议草稿有未提交的更改，确定放弃并重新载入目标页吗？')) return;
    const page = activePages.find(item => item.id === id) ?? null;
    const next = page ? { title: page.title, markdown: page.markdown, evidence: '[]' } : emptyDraft;
    // Keep the selected revision fixed; a parent refresh must not silently rebase a draft.
    setTarget(page ? { ...page } : null); setDraft(next); setSaved(next); setError(''); setNotice('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || working || !target || !currentPage || !dirty) return;
    setError(''); setNotice('');
    let evidence: Evidence[];
    try {
      if (!draft.title.trim() || draft.title.trim().length > 160) throw new Error('拟议标题需要 1–160 个字符。');
      if (!draft.markdown.trim() || draft.markdown.length > 200_000) throw new Error('拟议正文不能为空，且最多 200,000 个字符。');
      if (!Number.isSafeInteger(target.revision) || target.revision < 1) throw new Error('目标页缺少有效版本，请刷新工作空间后重新选择。');
      evidence = parseEvidence(draft.evidence);
    } catch (e) { setError(message(e)); return; }
    lock.current = true; setBusy(true);
    try {
      await api('/proposals', { pageId: target.id, expectedRevision: target.revision, title: draft.title.trim(), markdown: draft.markdown, evidence });
      if (!mounted.current) return;
      setSaved({ ...draft });
      setNotice('提议已提交，页面正文没有改变。请在列表中核对后明确接受或拒绝。');
      await load();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setError(`版本或证据冲突：${message(e)}。草稿和原始版本均已保留，未自动重试；已刷新提议列表。请核对最新页面及证据后手动整理。`);
        await load();
      } else setError(message(e));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function decide(proposal: Proposal, decision: 'accept' | 'reject') {
    if (lock.current || working || proposal.status !== 'pending') return;
    const explanation = decision === 'accept' ? '接受后会以拟议标题和正文替换目标页面，并创建新版本。' : '拒绝不会修改目标页面正文。';
    if (!window.confirm(`确定${decision === 'accept' ? '接受' : '拒绝'}提议“${proposal.title}”？${explanation}`)) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await api(`/proposals/${encodeURIComponent(proposal.id)}/decide`, { decision });
      if (!mounted.current) return;
      setProposals(items => items.map(item => item.id === proposal.id ? { ...item, status: decision === 'accept' ? 'accepted' : 'rejected' } : item));
      setNotice(decision === 'accept' ? '提议已接受，目标页面已更新。当前草稿不会自动重置。' : '提议已拒绝，目标页面正文未改变。');
      if (decision === 'accept') {
        try { await callbacks.current.onApplied(); } catch (e) { if (mounted.current) setError(`提议已接受，但工作空间刷新失败：${message(e)}。请手动刷新，不要重复应用。`); }
      }
      if (mounted.current) await load();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setError(`处理冲突：${message(e)}。草稿与页面选择已保留，未自动重试；已刷新提议列表，请重新核对页面版本和证据。`);
        await load();
      } else setError(message(e));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function generate() {
    if (!target || !instruction.trim() || working || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await api('/proposals/generate', { pageId: target.id, expectedRevision: target.revision, question: instruction.trim() }); setNotice('模型提议已保存，尚未应用；请核对证据和差异后确认。'); await load(); }
    catch (e) { setError(message(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  return <div className="catalog-view">
    <div className="section-heading"><div><div className="eyebrow">MANUAL PROPOSALS</div><h1>页面变更提议<span className="heading-dot">.</span></h1><p>可手动整理证据提议，或在模型已配置时生成草稿。两者都必须人工确认，提交不会修改页面正文。</p></div><button className="secondary-btn" disabled={working} onClick={() => void load()}>刷新提议列表</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <section className="home-component" aria-labelledby="proposal-draft-heading">
      <h2 id="proposal-draft-heading">整理提议草稿</h2>
      {!activePages.length && <p role="status">暂无可选页面，请先创建目标页面。</p>}
      <label className="field">目标页面<select value={target?.id ?? ''} disabled={working || !activePages.length} onChange={event => selectTarget(event.target.value)}><option value="">请选择页面</option>{target && !currentPage && <option value={target.id}>原目标页（已删除或不可访问）</option>}{activePages.map(page => <option key={page.id} value={page.id}>{page.title || '无标题页面'} · v{page.revision}</option>)}</select></label>
      {target && <p>草稿基于目标页 v{target.revision}。{currentPage && currentPage.revision !== target.revision ? `当前已为 v${currentPage.revision}，原始版本未自动推进。` : ''}</p>}
      {target && !currentPage && <p className="form-error" role="alert">目标页已删除或不可访问；草稿保留，不能提交。</p>}
      <section className="local-notice"><label className="field">模型写作要求<input maxLength={1000} value={instruction} disabled={working || !modelReady} onChange={e => setInstruction(e.target.value)}/></label><button className="secondary-btn" disabled={working || !target || !modelReady || !instruction.trim()} onClick={() => void generate()}>从资料生成模型提议</button>{!modelReady && <p>模型未配置，此入口禁用；仍可手动整理提议。</p>}</section>
      <form onSubmit={event => void submit(event)}>
        <label className="field">拟议标题<input required maxLength={160} value={draft.title} disabled={working || !target} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))}/></label>
        <label className="field">拟议正文（Markdown 原文）<textarea required rows={10} maxLength={200_000} value={draft.markdown} disabled={working || !target} onChange={event => setDraft(value => ({ ...value, markdown: event.target.value }))}/></label>
        <label className="field">证据引用 JSON（1–8 条）<textarea rows={5} spellCheck={false} value={draft.evidence} disabled={working || !target} aria-describedby="proposal-evidence-help" onChange={event => setDraft(value => ({ ...value, evidence: event.target.value }))}/></label>
        <p id="proposal-evidence-help">从问答复制引用数组，保留真实的 sourceId / revision / chunkId；不要编造引用。示例结构（请替换为实际值）：</p>
        <pre className="template-preview" style={plainTextStyle}>{'[{"sourceId":"来源 UUID","revision":1,"chunkId":"片段 UUID"}]'}</pre>
        <p>预览为纯文本对比，不渲染或执行 HTML。左侧为当前页面，并非历史版本快照。</p>
        <Comparison current={currentPage} title={draft.title} markdown={draft.markdown}/>
        <div className="dialog-actions"><span role="status">{dirty ? '有未提交的草稿更改' : '没有未提交的草稿更改'}</span><button type="button" className="secondary-btn" disabled={working || !target} onClick={() => selectTarget(target?.id ?? '', true)}>重新载入目标页（放弃草稿）</button><button type="submit" className="primary-btn" disabled={working || !target || !currentPage || !dirty || !draft.title.trim() || !draft.markdown.trim()}>{busy ? '处理中…' : '提交提议（不改正文）'}</button></div>
      </form>
    </section>
    <section aria-labelledby="proposal-list-heading"><h2 id="proposal-list-heading">提议列表</h2>
      {listError && <p className="form-error" role="alert">{listError} <button className="text-btn" disabled={working} onClick={() => void load()}>重试加载</button></p>}
      {loading && <p role="status">正在加载提议列表…</p>}
      {!loading && loaded && !proposals.length && !listError && <div className="empty-state"><h3>暂无提议</h3><p>选择目标页并粘贴问答引用，手动整理第一条提议。</p></div>}
      {proposals.map(proposal => {
        const page = pages.find(item => item.id === proposal.pageId && !item.deletedAt);
        const status = ({ pending: '待处理', accepted: '已接受', rejected: '已拒绝' } as Record<string, string>)[proposal.status] ?? proposal.status;
        const date = new Date(proposal.createdAt);
        return <article className="home-component" key={proposal.id}>
          <header><strong>{proposal.title}</strong><span>{status}</span></header>
          <p>目标：{page?.title || proposal.pageId} · 预期版本 v{proposal.expectedRevision} · {Number.isNaN(date.getTime()) ? proposal.createdAt : date.toLocaleString('zh-CN')}</p>
          {proposal.status === 'pending' && (!page || page.revision !== proposal.expectedRevision) && <p>目标页面不可用或版本已变化，接受可能冲突；不会自动覆盖或重试。</p>}
          <details><summary>核对当前 / 拟议纯文本及证据</summary><Comparison current={page} title={proposal.title} markdown={proposal.markdown}/><h4>证据引用</h4><pre className="template-preview" style={plainTextStyle}>{JSON.stringify(proposal.evidence, null, 2)}</pre></details>
          {proposal.status === 'pending' && <div className="dialog-actions"><button className="secondary-btn" disabled={working} onClick={() => void decide(proposal, 'reject')}>拒绝提议</button><button className="primary-btn" disabled={working || !page} onClick={() => void decide(proposal, 'accept')}>接受并应用到正文</button></div>}
        </article>;
      })}
    </section>
  </div>;
}
