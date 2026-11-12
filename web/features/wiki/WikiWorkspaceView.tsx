import type { ReactNode } from 'react';
import './workspace-layout.css';
import { ArrowRight, FileText, LoaderCircle, Plus, Puzzle, Sparkles, Sprout } from 'lucide-react';

export type WikiWorkspaceViewProps = {
  description: string;
  pageCount: number;
  enabledPluginCount: number;
  busy: string;
  hasPage: boolean;
  onCreatePage: () => void;
  onAsk: () => void;
  children: ReactNode;
};

export default function WikiWorkspaceView({
  description,
  pageCount,
  enabledPluginCount,
  busy,
  hasPage,
  onCreatePage,
  onAsk,
  children,
}: WikiWorkspaceViewProps) {
  return (
    <div className="wiki-view">
      <div className="section-heading">
        <div>
          <div className="eyebrow">
            <span />
            YOUR PERSONAL KNOWLEDGE GARDEN
          </div>
          <h1>
            知识空间<span className="heading-dot">.</span>
          </h1>
          <p>{description || '收藏灵感，连接想法。在这里，慢慢建立你的知识宇宙。'}</p>
        </div>
        <button className="primary-btn" disabled={!!busy} onClick={onCreatePage}>
          {busy === 'new' ? <LoaderCircle className="spin" size={16} /> : <Plus size={17} />}
          新建页面
        </button>
      </div>
      <div className="workspace-stats">
        <span>
          <FileText size={14} />
          <b>{pageCount}</b> 篇知识笔记
        </span>
        <span>
          <Puzzle size={14} />
          <b>{enabledPluginCount}</b> 个插件已启用
        </span>
        <span className="stats-hint">
          <span />
          所有内容存储在本地工作空间
        </span>
      </div>
      {children}
      {!hasPage && (
        <div className="empty-state large">
          <div className="empty-icon">
            <Sprout size={32} />
          </div>
          <h2>给你的第一个想法，找个家</h2>
          <p>一份笔记、一段灵感，都可以是知识花园的开始。</p>
          <button className="primary-btn" onClick={onCreatePage} disabled={!!busy}>
            <Plus size={16} />
            创建第一篇页面
          </button>
        </div>
      )}
      <button className="ask-banner" onClick={onAsk}>
        <span className="ask-banner-icon">
          <Sparkles size={21} />
        </span>
        <span>
          <strong>让知识彼此连接</strong>
          <small>向你的 Wiki 提问，从已有笔记中寻找答案</small>
        </span>
        <span className="local-badge">本地引用问答</span>
        <ArrowRight size={18} />
      </button>
      <div className="quiet-footer">
        <span>一点一滴，积累属于你的知识。</span>
        <span>
          MADE FOR CURIOUS MINDS <Sprout size={12} />
        </span>
      </div>
    </div>
  );
}
