import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
}: WorkshopWorkspaceProps) {
  const id = useId();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const [filesOpen, setFilesOpen] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
      className={`workshop-workspace${previewVisible ? '' : ' workshop-workspace-preview-hidden'}`}
    >
      <header className="workshop-workspace-heading">
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
            onClick={() => setPreviewVisible((visible) => !visible)}
          >
            {previewVisible ? (
              <PanelRightClose size={18} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>
      <div className="workshop-workspace-chat">{chat}</div>
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
