import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../shared/api';

const SOURCE_LIMIT = 30000;
type Revision = { revision: number; bytes: number; createdAt: string };
type Props = {
  project: { id: string; kind?: string; revision?: number } | null;
  currentContent: string;
  disabled: boolean;
  onRestoreDraft: (content: string) => void;
};

/** Linear, line-index comparison, not an edit script or an LCS diff. */
export function summarizeRevisionDiff(current: string, historical: string) {
  const lines = (value: string) => (value === '' ? [] : value.replace(/\r\n/g, '\n').split('\n'));
  const before = lines(current);
  const after = lines(historical);
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (i < before.length && i < after.length && before[i] === after[i]) unchanged++;
    else {
      if (i < before.length) removed++;
      if (i < after.length) added++;
    }
  }
  return { added, removed, unchanged };
}

export default function WorkshopRevisionHistory(props: Props) {
  if (props.project?.kind !== 'page') return null;
  // A project switch discards all previous source and aborts its requests.
  return <ProjectRevisionHistory key={props.project.id} {...props} project={props.project} />;
}

function ProjectRevisionHistory({
  project,
  currentContent,
  disabled,
  onRestoreDraft,
}: Props & {
  project: NonNullable<Props['project']>;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState<{ revision: number; content: string } | null>(null);
  const [notice, setNotice] = useState('');
  const listRequest = useRef<AbortController | null>(null);
  const sourceRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const sourceGeneration = useRef(0);
  const base = `/workshop/projects/${encodeURIComponent(project.id)}/revisions`;

  useEffect(
    () => () => {
      generation.current++;
      sourceGeneration.current++;
      listRequest.current?.abort();
      sourceRequest.current?.abort();
    },
    [project.id],
  );

  async function refresh() {
    if (disabled) return;
    listRequest.current?.abort();
    sourceRequest.current?.abort();
    sourceGeneration.current++;
    const controller = new AbortController();
    listRequest.current = controller;
    const request = ++generation.current;
    setLoading(true);
    setReading(false);
    setSelected('');
    setSnapshot(null);
    setNotice('');
    try {
      const result = await api<Revision[] | { revisions?: Revision[] }>(
        base,
        undefined,
        'GET',
        controller.signal,
      );
      if (controller.signal.aborted || request !== generation.current) return;
      const rows = Array.isArray(result) ? result : (result.revisions ?? []);
      // Retain public metadata only, never unexpected response fields.
      setRevisions(rows.map(({ revision, bytes, createdAt }) => ({ revision, bytes, createdAt })));
      setLoaded(true);
      if (!rows.length) setNotice('此项目暂无修订历史；旧项目会在后续保存后产生记录。');
    } catch (error) {
      if (controller.signal.aborted || request !== generation.current) return;
      setRevisions([]);
      setLoaded(true);
      setNotice(
        error instanceof ApiError && error.status === 404
          ? '此项目暂无可用修订历史（旧项目可能尚无历史记录）。'
          : '修订记录读取失败，请重试。',
      );
    } finally {
      if (!controller.signal.aborted && request === generation.current) setLoading(false);
    }
  }

  async function selectRevision(value: string) {
    sourceRequest.current?.abort();
    const request = ++sourceGeneration.current;
    setSelected(value);
    setSnapshot(null);
    setNotice('');
    setReading(false);
    if (!value || disabled) return;
    const revision = Number(value);
    const controller = new AbortController();
    sourceRequest.current = controller;
    setReading(true);
    try {
      const result = await api<{ content: string }>(
        `${base}/${revision}`,
        undefined,
        'GET',
        controller.signal,
      );
      if (controller.signal.aborted || request !== sourceGeneration.current) return;
      if (typeof result.content !== 'string') throw new Error('Invalid revision');
      setSnapshot({ revision, content: result.content });
    } catch (error) {
      if (controller.signal.aborted || request !== sourceGeneration.current) return;
      setNotice(
        error instanceof ApiError && error.status === 404
          ? '此修订已不可用，可能已被历史保留策略清理；请刷新修订记录。'
          : '历史源码读取失败，请重新选择或刷新修订记录。',
      );
    } finally {
      if (!controller.signal.aborted && request === sourceGeneration.current) setReading(false);
    }
  }

  const diff = snapshot ? summarizeRevisionDiff(currentContent, snapshot.content) : null;
  return (
    <details
      className="workshop-revision-history"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !loading) void refresh();
      }}
    >
      <summary>项目修订历史</summary>
      <div className="workshop-revision-history-body">
        <p>仅查看当前页面项目的源码。载入只替换本地草稿，不会保存、应用或回退项目修订号。</p>
        <div className="workshop-revision-history-controls">
          <button
            type="button"
            className="secondary-btn"
            disabled={disabled || loading}
            onClick={() => void refresh()}
          >
            刷新修订记录
          </button>
          <label>
            历史版本
            <select
              value={selected}
              disabled={disabled || loading || !revisions.length}
              onChange={(event) => void selectRevision(event.target.value)}
            >
              <option value="">选择历史版本</option>
              {revisions.map((row) => (
                <option key={row.revision} value={row.revision}>
                  修订 {row.revision}
                  {row.revision === project.revision ? '（当前）' : ''} · {row.bytes} 字节 ·{' '}
                  {row.createdAt}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(loading || reading) && (
          <p role="status">{loading ? '正在读取修订记录…' : '正在读取历史源码…'}</p>
        )}
        {notice && <p role="status">{notice}</p>}
        {snapshot && diff && (
          <>
            <p>
              相对当前草稿：新增 {diff.added} 行，移除 {diff.removed} 行，同行未变 {diff.unchanged}{' '}
              行。 按行号直接比较，插入或移动行可能计为多行变化，并非精确差异。
            </p>
            <pre
              className="workshop-revision-history-source"
              aria-label={`修订 ${snapshot.revision} 的只读历史源码`}
              tabIndex={0}
            >
              {snapshot.content.slice(0, SOURCE_LIMIT)}
            </pre>
            {snapshot.content.length > SOURCE_LIMIT && (
              <p>仅显示前 30000 个字符；此修订超出草稿上限，无法载入。</p>
            )}
            <button
              type="button"
              className="secondary-btn"
              disabled={disabled || loading || reading || snapshot.content.length > SOURCE_LIMIT}
              onClick={() => {
                if (disabled || reading || loading || snapshot.content.length > SOURCE_LIMIT)
                  return;
                if (
                  window.confirm(
                    `将修订 ${snapshot.revision} 载入为草稿？这会覆盖当前未保存的编辑，但不会写入服务器。后续仍需手动保存。`,
                  )
                ) {
                  onRestoreDraft(snapshot.content);
                  setNotice(
                    '已载入为本地草稿；请检查后手动保存。项目修订号保持不变，保存仍会检查并发冲突。',
                  );
                }
              }}
            >
              载入此修订为草稿
            </button>
          </>
        )}
      </div>
    </details>
  );
}
