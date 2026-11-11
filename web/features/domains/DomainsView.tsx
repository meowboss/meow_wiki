import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  type BuildProfile,
  type Domain,
  type DomainContribution,
  type DomainMember,
  type DomainRole,
  type Workspace,
} from '../../shared/api';
import './domains.css';

const profiles: Record<BuildProfile, string> = {
  general: '通用',
  project: '项目',
  research: '研究',
  product: '产品',
};
const roles: Record<DomainRole, string> = {
  owner: '所有者',
  reader: '只读成员',
  contributor: '贡献者',
  maintainer: '维护者',
};
const statuses = { pending: '待审核', published: '已发布', rejected: '已拒绝' };
const message = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请重试。');
type DomainFields = Pick<Domain, 'name' | 'description' | 'buildProfile'>;
const emptyFields: DomainFields = { name: '', description: '', buildProfile: 'general' };
const fields = (domain: Domain): DomainFields => ({
  name: domain.name,
  description: domain.description,
  buildProfile: domain.buildProfile,
});
const changed = (a: DomainFields, b: DomainFields) =>
  a.name !== b.name || a.description !== b.description || a.buildProfile !== b.buildProfile;
const pathFor = (id: string) => `/domains/${encodeURIComponent(id)}`;

function ProfileFields({
  value,
  onChange,
}: {
  value: DomainFields;
  onChange: (value: DomainFields) => void;
}) {
  return (
    <>
      <label>
        域名称
        <input
          required
          maxLength={160}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        描述
        <textarea
          rows={3}
          maxLength={1000}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </label>
      <label>
        构建方案
        <select
          value={value.buildProfile}
          onChange={(e) => onChange({ ...value, buildProfile: e.target.value as BuildProfile })}
        >
          {Object.entries(profiles).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export default function DomainsView({
  workspace,
  userId,
  onDirtyChange,
  onBusyChange,
}: {
  workspace: Workspace | null;
  userId: string;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DomainFields>(emptyFields);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const [error, setError] = useState('');
  const callbacks = useRef({ onDirtyChange, onBusyChange });
  callbacks.current = { onDirtyChange, onBusyChange };
  const lock = useRef(false);
  const mounted = useRef(true);
  const createDirty = creating && changed(draft, emptyFields);
  const working = loading || busy || detailBusy;
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await api<{ domains: Domain[] }>('/domains', undefined, 'GET', signal);
    if (!Array.isArray(result?.domains)) throw new Error('域列表返回格式无效。');
    if (!signal?.aborted && mounted.current) setDomains(result.domains);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    };
  }, [load]);
  useEffect(() => {
    callbacks.current.onDirtyChange(createDirty || detailDirty);
  }, [createDirty, detailDirty]);
  useEffect(() => {
    callbacks.current.onBusyChange(working);
  }, [working]);
  function navigate(id: string, create = false) {
    if (working || lock.current || (selectedId === id && creating === create)) return;
    if ((createDirty || detailDirty) && !window.confirm('域中有未保存的更改，确定放弃吗？')) return;
    setSelectedId(id);
    setCreating(create);
    setDraft(emptyFields);
    setDetailDirty(false);
    setError('');
  }
  async function refresh() {
    if (working || lock.current) return;
    lock.current = true;
    setLoading(true);
    setError('');
    try {
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (working || lock.current || !workspace || !draft.name.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const domain = await api<Domain>(`/domains?workspaceId=${encodeURIComponent(workspace.id)}`, {
        ...draft,
        name: draft.name.trim(),
      });
      if (!mounted.current) return;
      setDomains((current) => [...current.filter((item) => item.id !== domain.id), domain]);
      setDraft(emptyFields);
      setCreating(false);
      setSelectedId(domain.id);
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="domains-view" aria-label="知识域">
      <header className="domains-heading">
        <div>
          <h1>知识域</h1>
          <p>跨工作空间的成员域 · 独立成员、治理与贡献快照</p>
        </div>
        <div className="domains-actions">
          <button className="text-btn" disabled={working} onClick={() => void refresh()}>
            刷新域列表
          </button>
          <button
            className="primary-btn"
            disabled={working || !workspace}
            onClick={() => navigate('', true)}
          >
            创建知识域
          </button>
        </div>
      </header>
      <p className="domains-boundary">
        加入知识域不授予其所属工作空间的页面或资料访问权。这里仅展示独立提交的域快照，不自动共享私人内容。
      </p>
      <p className="domains-muted">
        构建方案用于确定性资料汇编（非 LLM）；Agent
        连接支持域范围只读或提交待审贡献，绝不授予审核或发布权限。
      </p>
      {!workspace && <p>当前没有工作空间；仍可访问已加入的域。创建域前请先创建自己的工作空间。</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="domains-layout">
        <aside className="domains-list" aria-label="我的成员域">
          <h2>我的成员域</h2>
          {loading && <p role="status">正在加载域列表…</p>}
          {!loading && !domains.length && !error && (
            <p>尚未加入任何域。可以创建域，或由域所有者通过邮箱邀请。</p>
          )}
          {domains.map((domain) => (
            <button
              key={domain.id}
              disabled={working}
              aria-pressed={domain.id === selectedId}
              onClick={() => navigate(domain.id)}
            >
              <strong>{domain.name}</strong>
              <span>
                {profiles[domain.buildProfile]} · {roles[domain.role]}
              </span>
              <small>{domain.description}</small>
            </button>
          ))}
        </aside>
        <div className="domains-detail">
          {creating ? (
            <form onSubmit={create}>
              <h2>创建知识域</h2>
              <p>绑定当前所有者工作空间：{workspace?.name}。域成员不会获得该空间的私人内容。</p>
              <fieldset disabled={working}>
                <ProfileFields value={draft} onChange={setDraft} />
                <button className="primary-btn" disabled={!workspace || !draft.name.trim()}>
                  {busy ? '创建中…' : '创建域'}
                </button>
                <button type="button" className="text-btn" onClick={() => navigate('')}>
                  取消
                </button>
              </fieldset>
            </form>
          ) : selectedId ? (
            <DomainDetail
              key={selectedId}
              id={selectedId}
              userId={userId}
              onDirtyChange={setDetailDirty}
              onBusyChange={setDetailBusy}
              onUpdated={(domain) =>
                setDomains((current) =>
                  current.map((item) => (item.id === domain.id ? domain : item)),
                )
              }
            />
          ) : (
            <p>选择知识域查看成员与贡献，或创建一个新域。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function DomainDetail({
  id,
  userId,
  onDirtyChange,
  onBusyChange,
  onUpdated,
}: {
  id: string;
  userId: string;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  onUpdated: (domain: Domain) => void;
}) {
  const [domain, setDomain] = useState<Domain | null>(null);
  const [draft, setDraft] = useState<DomainFields>(emptyFields);
  const [members, setMembers] = useState<DomainMember[]>([]);
  const [contributions, setContributions] = useState<DomainContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<DomainRole, 'owner'>>('reader');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // Capture the baseline when the draft starts; never silently rebase after another action.
  const [contributionRevision, setContributionRevision] = useState<number | null>(null);
  const [buildTitle, setBuildTitle] = useState('');
  const [buildIds, setBuildIds] = useState<string[]>([]);
  const [buildRevision, setBuildRevision] = useState<number | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onDirtyChange, onBusyChange, onUpdated });
  callbacks.current = { onDirtyChange, onBusyChange, onUpdated };
  const dirty =
    (!!domain && changed(draft, fields(domain))) ||
    !!email ||
    role !== 'reader' ||
    !!title ||
    !!content ||
    !!buildTitle ||
    buildIds.length > 0 ||
    Object.values(reasons).some(Boolean);
  const working = loading || busy;
  const owner = domain?.role === 'owner';
  const reviewer = owner || domain?.role === 'maintainer';
  const writable = !!domain && domain.role !== 'reader';
  const base = pathFor(id);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const next = await api<Domain>(pathFor(id), undefined, 'GET', signal);
      if (signal?.aborted || !mounted.current) return;
      // Load only domain-scoped resources. Never fetch or switch to the owner's workspace.
      const [memberResult, contributionResult] = await Promise.all([
        next.role === 'owner'
          ? api<{ members: DomainMember[] }>(`${pathFor(id)}/members`, undefined, 'GET', signal)
          : Promise.resolve({ members: [] }),
        api<{ contributions: DomainContribution[] }>(
          `${pathFor(id)}/contributions`,
          undefined,
          'GET',
          signal,
        ),
      ]);
      if (signal?.aborted || !mounted.current) return;
      if (!Array.isArray(memberResult.members) || !Array.isArray(contributionResult.contributions))
        throw new Error('域成员或贡献列表返回格式无效。');
      setDomain(next);
      setDraft(fields(next));
      setMembers(memberResult.members);
      setContributions(contributionResult.contributions);
      setConflict(false);
      callbacks.current.onUpdated(next);
    },
    [id],
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    };
  }, [load]);
  useEffect(() => {
    callbacks.current.onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => {
    callbacks.current.onBusyChange(working);
  }, [working]);

  async function run(task: () => Promise<void>) {
    if (working || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError('版本冲突：未自动重试，本地草稿保留。请复制需要保留的内容后，明确加载最新域。');
      } else setError(message(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refreshContributions() {
    const result = await api<{ contributions: DomainContribution[] }>(`${base}/contributions`);
    if (!Array.isArray(result?.contributions)) throw new Error('贡献列表返回格式无效。');
    if (mounted.current) setContributions(result.contributions);
  }
  async function refreshMembers() {
    const result = await api<{ members: DomainMember[] }>(`${base}/members`);
    if (!Array.isArray(result?.members)) throw new Error('成员列表返回格式无效。');
    if (mounted.current) setMembers(result.members);
  }
  async function afterMutation(refresh: () => Promise<void>, success: string) {
    if (mounted.current) setNotice(success);
    try {
      await refresh();
    } catch (e) {
      if (mounted.current) setError(`操作已成功，但刷新失败：${message(e)}。请刷新最新域。`);
    }
  }
  function reload() {
    if (
      dirty &&
      !window.confirm(
        '加载最新域将放弃域配置、邀请、贡献、构建标题与来源选择和审核草稿，请先复制要保留的内容。确定继续吗？',
      )
    )
      return;
    void run(async () => {
      await load();
      if (!mounted.current) return;
      setTitle('');
      setContent('');
      setContributionRevision(null);
      setEmail('');
      setRole('reader');
      setReasons({});
      setBuildTitle('');
      setBuildIds([]);
      setBuildRevision(null);
      setNotice('已加载最新域。');
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!reviewer || !domain || conflict || !draft.name.trim()) return;
    void run(async () => {
      const next = await api<Domain>(
        base,
        { ...draft, name: draft.name.trim(), expectedRevision: domain.revision },
        'PUT',
      );
      if (!mounted.current) return;
      setDomain(next);
      setDraft(fields(next));
      callbacks.current.onUpdated(next);
      setNotice('域配置已保存。');
    });
  }
  function invite(event: FormEvent) {
    event.preventDefault();
    if (!owner || !email.trim()) return;
    void run(async () => {
      await api(`${base}/members`, { email: email.trim(), role });
      if (!mounted.current) return;
      setEmail('');
      setRole('reader');
      await afterMutation(refreshMembers, '成员已添加。');
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!writable || !domain || conflict || !title.trim() || !content.trim()) return;
    void run(async () => {
      await api(`${base}/contributions`, {
        title: title.trim(),
        content,
        expectedDomainRevision: contributionRevision ?? domain.revision,
      });
      if (!mounted.current) return;
      setTitle('');
      setContent('');
      setContributionRevision(null);
      await afterMutation(refreshContributions, '贡献已提交，等待其他维护者审核；尚未发布。');
    });
  }
  async function refreshDomainAndContributions() {
    // Advance the displayed domain, but never rebase unsaved config, contribution or build drafts.
    const next = await api<Domain>(base);
    if (mounted.current) {
      if (domain && changed(draft, fields(domain))) setConflict(true);
      else {
        setDomain(next);
        setDraft(fields(next));
      }
      callbacks.current.onUpdated(next);
    }
    await refreshContributions();
  }
  function build(event: FormEvent) {
    event.preventDefault();
    if (
      !writable ||
      !domain ||
      conflict ||
      !buildTitle.trim() ||
      !buildIds.length ||
      buildIds.length > 10
    )
      return;
    if (
      !buildIds.every((sourceId) =>
        contributions.some(
          (item) => item.id === sourceId && item.domainId === id && item.status === 'published',
        ),
      )
    ) {
      setError('构建来源必须全部为当前域已发布的贡献，请核对选择。');
      return;
    }
    void run(async () => {
      const result = await api<{
        mode: 'deterministic-compilation';
        contribution: DomainContribution;
        provenance: { domainRevision: number; profile: BuildProfile; contributionIds: string[] };
      }>(`${base}/build`, {
        title: buildTitle.trim(),
        contributionIds: buildIds,
        expectedRevision: buildRevision ?? domain.revision,
      });
      if (!mounted.current) return;
      if (result?.mode !== 'deterministic-compilation' || result.contribution?.status !== 'pending')
        throw new Error('构建返回格式异常，请加载最新域核对结果；不会自动重试或发布。');
      setBuildTitle('');
      setBuildIds([]);
      setBuildRevision(null);
      await afterMutation(
        refreshDomainAndContributions,
        `确定性汇编已生成待审核贡献“${result.contribution.title}”（非 LLM），尚未发布，须由其他维护者审核。`,
      );
    });
  }
  function review(contribution: DomainContribution, decision: 'published' | 'rejected') {
    if (
      !reviewer ||
      contribution.authorId === userId ||
      contribution.status !== 'pending' ||
      conflict
    )
      return;
    if (
      !window.confirm(
        `确定${decision === 'published' ? '发布' : '拒绝'}贡献“${contribution.title}”吗？`,
      )
    )
      return;
    void run(async () => {
      await api(`${base}/contributions/${encodeURIComponent(contribution.id)}/review`, {
        decision,
        reason: reasons[contribution.id] || '',
      });
      if (!mounted.current) return;
      setReasons((current) => ({ ...current, [contribution.id]: '' }));
      await afterMutation(
        refreshDomainAndContributions,
        decision === 'published' ? '贡献已发布，域版本已推进。' : '贡献已拒绝。',
      );
    });
  }
  const visible = contributions.filter(
    (item) =>
      item.domainId === id &&
      (item.status === 'published' ||
        (domain?.role !== 'reader' && (reviewer || item.authorId === userId))),
  );
  return (
    <>
      <div className="domains-heading">
        <h2>{domain?.name || '域详情'}</h2>
        <button className="text-btn" disabled={working} onClick={reload}>
          加载最新域
        </button>
      </div>
      {loading && <p role="status">正在加载域内容…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {conflict && <p role="alert">版本已改变。草稿不会自动合并或重试，请保留内容后加载最新域。</p>}
      {domain && (
        <>
          <p>
            {roles[domain.role]} · 域版本 {domain.revision} · {profiles[domain.buildProfile]}
          </p>
          {reviewer ? (
            <form onSubmit={save}>
              <h3>域配置</h3>
              <fieldset disabled={working}>
                <ProfileFields value={draft} onChange={setDraft} />
                <button
                  className="primary-btn"
                  disabled={conflict || !draft.name.trim() || !changed(draft, fields(domain))}
                >
                  保存配置
                </button>
              </fieldset>
            </form>
          ) : (
            <p className="domains-plain">{domain.description}</p>
          )}
          <section aria-label="域成员">
            <h3>域成员</h3>
            {owner ? (
              <>
                <form onSubmit={invite}>
                  <fieldset disabled={working}>
                    <label>
                      成员邮箱
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                      />
                    </label>
                    <label>
                      成员角色
                      <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                        <option value="reader">只读成员</option>
                        <option value="contributor">贡献者</option>
                        <option value="maintainer">维护者</option>
                      </select>
                    </label>
                    <button className="primary-btn" disabled={!email.trim()}>
                      通过邮箱添加 / 更新成员
                    </button>
                  </fieldset>
                </form>
                <ul className="domains-members">
                  {members.map((member) => (
                    <li key={member.userId}>
                      <span>
                        {member.name} · {member.email} · {roles[member.role]}
                      </span>
                      {member.role !== 'owner' && (
                        <button
                          className="text-btn"
                          disabled={working}
                          onClick={() => {
                            if (!window.confirm(`确定移除成员“${member.email}”吗？`)) return;
                            void run(async () => {
                              await api(
                                `${base}/members/${encodeURIComponent(member.userId)}`,
                                undefined,
                                'DELETE',
                              );
                              await afterMutation(refreshMembers, '成员已移除。');
                            });
                          }}
                        >
                          移除
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>仅域所有者可维护成员。当前角色：{roles[domain.role]}。</p>
            )}
          </section>
          {writable && (
            <form onSubmit={submit}>
              <h3>提交独立贡献快照</h3>
              <p>
                基于域版本 {contributionRevision ?? domain.revision}
                。内容不会自动导入私人页面，作者不能审核自己的贡献。
              </p>
              <fieldset disabled={working}>
                <label>
                  贡献标题
                  <input
                    required
                    maxLength={160}
                    value={title}
                    onChange={(e) => {
                      if (contributionRevision === null) setContributionRevision(domain.revision);
                      setTitle(e.target.value);
                    }}
                  />
                </label>
                <label>
                  贡献内容
                  <textarea
                    required
                    rows={8}
                    maxLength={100000}
                    value={content}
                    onChange={(e) => {
                      if (contributionRevision === null) setContributionRevision(domain.revision);
                      setContent(e.target.value);
                    }}
                  />
                </label>
                <button
                  className="primary-btn"
                  disabled={conflict || !title.trim() || !content.trim()}
                >
                  提交审核
                </button>
              </fieldset>
            </form>
          )}
          {writable && (
            <form onSubmit={build} aria-label="确定性资料汇编">
              <h3>确定性资料汇编（非 LLM）</h3>
              <p>
                按“{profiles[domain.buildProfile]}”方案汇编 1–10 条已发布快照，未调用语言模型。
                基于域版本 {buildRevision ?? domain.revision}；仅生成
                pending（待审核）贡献，不会自动发布，作者不能审核自己的贡献。
              </p>
              <fieldset disabled={working}>
                <label>
                  构建标题
                  <input
                    required
                    maxLength={160}
                    value={buildTitle}
                    onChange={(event) => {
                      if (buildRevision === null) setBuildRevision(domain.revision);
                      setBuildTitle(event.target.value);
                    }}
                  />
                </label>
                <fieldset>
                  <legend>选择已发布来源（已选 {buildIds.length}/10）</legend>
                  {!contributions.some(
                    (item) => item.domainId === id && item.status === 'published',
                  ) && <p>暂无已发布来源，请先完成独立贡献审核。</p>}
                  {contributions
                    .filter((item) => item.domainId === id && item.status === 'published')
                    .map((item) => (
                      <label key={item.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={buildIds.includes(item.id)}
                          disabled={!buildIds.includes(item.id) && buildIds.length >= 10}
                          onChange={(event) => {
                            if (buildRevision === null) setBuildRevision(domain.revision);
                            setBuildIds((current) =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((sourceId) => sourceId !== item.id),
                            );
                          }}
                        />
                        {item.title}（已发布）
                      </label>
                    ))}
                </fieldset>
                <button
                  className="primary-btn"
                  disabled={
                    conflict || !buildTitle.trim() || buildIds.length < 1 || buildIds.length > 10
                  }
                >
                  {busy ? '处理中…' : '确定性汇编并提交待审（非 LLM）'}
                </button>
              </fieldset>
            </form>
          )}
          <section aria-label="域贡献">
            <h3>{domain.role === 'reader' ? '已发布快照' : '贡献与审核'}</h3>
            <p>
              {domain.role === 'reader'
                ? '只读成员仅能查看已发布快照。'
                : '作者可查看自己的待审贡献；所有者和维护者可审核其他人的待审贡献。'}
            </p>
            {(domain.role === 'owner' || domain.role === 'maintainer') && (
              <button
                className="text-btn"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      '永久清理此域所有已拒绝贡献以回收额度？已发布和待审内容不会删除。',
                    )
                  )
                    return;
                  void run(async () => {
                    await api(`${base}/prune-rejected`, {});
                    await refreshContributions();
                  });
                }}
              >
                清理已拒绝贡献（永久）
              </button>
            )}
            {!visible.length && <p>暂无可见贡献。</p>}
            {visible.map((item) => (
              <article className="domains-contribution" key={item.id}>
                <h4>{item.title}</h4>
                <p>
                  {statuses[item.status]} · 基于域版本 {item.expectedDomainRevision}
                </p>
                <p className="domains-muted">
                  作者：{item.authorId}
                  {item.reviewerId ? ` · 审核人：${item.reviewerId}` : ''}
                </p>
                <pre className="domains-plain">{item.content}</pre>
                {item.reason && <p className="domains-plain">审核说明：{item.reason}</p>}
                {item.status === 'pending' &&
                  reviewer &&
                  (item.authorId === userId ? (
                    <p>不能审核自己的贡献，请由其他维护者审核。</p>
                  ) : (
                    <fieldset disabled={working || conflict}>
                      <label>
                        审核说明
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={reasons[item.id] || ''}
                          onChange={(e) =>
                            setReasons((current) => ({ ...current, [item.id]: e.target.value }))
                          }
                        />
                      </label>
                      <div className="domains-actions">
                        <button className="primary-btn" onClick={() => review(item, 'published')}>
                          审核并发布
                        </button>
                        <button className="text-btn" onClick={() => review(item, 'rejected')}>
                          拒绝贡献
                        </button>
                      </div>
                    </fieldset>
                  ))}
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
