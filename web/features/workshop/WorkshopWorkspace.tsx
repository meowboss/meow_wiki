import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import './workshop-workspace.css';

export type WorkshopWorkspaceProps = {
  chat: ReactNode;
  preview: ReactNode;
  source: ReactNode;
  files: string[];
  selectedFile: string;
  onSelectFile: (path: string) => void;
  title: string;
  busy: boolean;
  /** Actions alongside the preview/source tabs (for example, apply or validate). */
  actions?: ReactNode;
  /** Always-visible heading tools, before the title (for example, project navigation). */
  headerTools?: ReactNode;
};

type WorkspaceTab = 'preview' | 'source';
const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: 'preview', label: '预览' },
  { id: 'source', label: '源码' },
];

export default function WorkshopWorkspace({
  chat,
  preview,
  source,
  files,
  selectedFile,
  onSelectFile,
  title,
  busy,
  actions,
  headerTools,
}: WorkshopWorkspaceProps) {
  const id = useId();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const [filesOpen, setFilesOpen] = useState(true);
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false,
  );
  const [previewVisible, setPreviewVisible] = useState(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 900px)').matches : true,
  );
  const [leftPercent, setLeftPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    width: number;
    percent: number;
  } | null>(null);
  const desktopPreviewRef = useRef(true);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const onChange = () => {
      dragRef.current = null;
      setMobile(query.matches);
      // Mobile starts with chat; restore the desktop's instance-local choice on return.
      setPreviewVisible(query.matches ? false : desktopPreviewRef.current);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  function togglePreview() {
    const next = !previewVisible;
    setPreviewVisible(next);
    if (!mobile) desktopPreviewRef.current = next;
  }

  function updateSplit(percent: number) {
    setLeftPercent(Math.min(70, Math.max(30, percent)));
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (mobile || event.button !== 0 || !containerRef.current) return;
    const width = containerRef.current.getBoundingClientRect().width - 6;
    if (width <= 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      width,
      percent: leftPercent,
    };
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (mobile || !drag || drag.pointerId !== event.pointerId) return;
    updateSplit(drag.percent + ((event.clientX - drag.startX) / drag.width) * 100);
  }

  function endResize(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleSeparatorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (mobile) return;
    switch (event.key) {
      case 'ArrowLeft':
        updateSplit(leftPercent - 2);
        break;
      case 'ArrowRight':
        updateSplit(leftPercent + 2);
        break;
      case 'Home':
        updateSplit(30);
        break;
      case 'End':
        updateSplit(70);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (index + tabs.length - 1) % tabs.length;
        break;
      case 'ArrowRight':
        nextIndex = (index + 1) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      ref={containerRef}
      className={`workshop-workspace${previewVisible ? ' workshop-workspace-preview-visible' : ' workshop-workspace-preview-hidden'}`}
      style={
        {
          '--workshop-left': `${leftPercent}fr`,
          '--workshop-right': `${100 - leftPercent}fr`,
        } as CSSProperties
      }
    >
      <header className="workshop-workspace-heading">
        {headerTools && <div className="workshop-workspace-header-tools">{headerTools}</div>}
        <h2 id={`${id}-title`} title={title}>
          {title || '组件工作区'}
        </h2>
        <div className="workshop-workspace-controls">
          <span className="workshop-workspace-status" role="status">
            {busy ? '正在更新…' : '工作区'}
          </span>
          <button
            className="workshop-workspace-preview-toggle"
            type="button"
            aria-label={previewVisible ? '隐藏预览工作区' : '显示预览工作区'}
            title={previewVisible ? '隐藏预览工作区' : '显示预览工作区'}
            aria-expanded={previewVisible}
            aria-controls={`${id}-pane`}
            onClick={togglePreview}
          >
            {previewVisible ? (
              <PanelRightClose size={18} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>
      <div
        className="workshop-workspace-chat"
        id={`${id}-chat`}
        inert={mobile && previewVisible}
        aria-hidden={mobile && previewVisible ? true : undefined}
      >
        {chat}
      </div>
      <div
        className="workshop-workspace-separator"
        role="separator"
        aria-label="调整对话与工作区宽度"
        aria-orientation="vertical"
        aria-controls={`${id}-chat ${id}-pane`}
        aria-valuemin={30}
        aria-valuemax={70}
        aria-valuenow={Math.round(leftPercent)}
        aria-valuetext={`对话 ${Math.round(leftPercent)}%，工作区 ${100 - Math.round(leftPercent)}%`}
        tabIndex={mobile || !previewVisible ? -1 : 0}
        hidden={!previewVisible || mobile}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onLostPointerCapture={() => {
          dragRef.current = null;
        }}
        onKeyDown={handleSeparatorKeyDown}
        onDoubleClick={() => updateSplit(50)}
      />
      <section
        className="workshop-workspace-pane"
        id={`${id}-pane`}
        aria-labelledby={`${id}-title`}
        hidden={!previewVisible}
        inert={!previewVisible}
      >
        <div className="workshop-workspace-toolbar">
          <div className="workshop-workspace-tabs" role="tablist" aria-label="工作区视图">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`${id}-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            className="workshop-workspace-files-toggle"
            type="button"
            hidden={activeTab !== 'source'}
            aria-expanded={filesOpen}
            aria-controls={`${id}-files`}
            onClick={() => setFilesOpen((open) => !open)}
          >
            {filesOpen ? '收起文件' : '展开文件'}
          </button>
          {actions && <div className="workshop-workspace-actions">{actions}</div>}
        </div>
        {/* Keep both slots mounted so tab changes preserve editor and preview state. */}
        <div
          className="workshop-workspace-panel workshop-workspace-preview"
          id={`${id}-panel-preview`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-preview`}
          aria-busy={busy}
          tabIndex={0}
          hidden={activeTab !== 'preview'}
        >
          {preview}
        </div>
        <div
          className="workshop-workspace-panel workshop-workspace-source"
          id={`${id}-panel-source`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-source`}
          tabIndex={0}
          hidden={activeTab !== 'source'}
        >
          <nav
            className="workshop-workspace-files"
            id={`${id}-files`}
            aria-label="项目文件"
            hidden={!filesOpen}
          >
            <h3>文件</h3>
            {files.length ? (
              <ul>
                {files.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      title={path}
                      aria-current={selectedFile === path ? 'true' : undefined}
                      onClick={() => onSelectFile(path)}
                    >
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>暂无项目文件</p>
            )}
          </nav>
          <div className="workshop-workspace-editor">
            {selectedFile && (
              <p className="workshop-workspace-file-path" title={selectedFile}>
                {selectedFile}
              </p>
            )}
            {source}
          </div>
        </div>
      </section>
    </div>
  );
}
