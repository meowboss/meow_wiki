import { useEffect, useRef } from 'react';
import {
  BookOpen,
  ChevronDown,
  Compass,
  FileText,
  Layers3,
  PencilLine,
  Puzzle,
  ShieldCheck,
  Sprout,
} from 'lucide-react';
import type { NavigationEntry, NavigationItem, PrimaryNavigationProps } from './types';
import './navigation.css';

export type { AppView, PrimaryNavigationProps } from './types';

export const primaryNavigation: readonly NavigationEntry[] = [
  { view: 'wiki', label: '知识空间', icon: BookOpen },
  { view: 'home', label: '首页', icon: Sprout },
  {
    id: 'collaboration',
    label: '知识协作',
    icon: Layers3,
    children: [
      { view: 'domains', label: '知识域', icon: Layers3 },
      { view: 'mcp', label: 'Agent 连接', icon: ShieldCheck },
      { view: 'proposals', label: '写入提议', icon: PencilLine },
      { view: 'knowledge', label: '资料工作台', icon: FileText },
    ],
  },
  {
    id: 'extensions',
    label: '组件中心',
    icon: Puzzle,
    children: [
      { view: 'market', label: '插件市场', icon: Compass },
      { view: 'components', label: '我的组件', icon: Layers3 },
      { view: 'workshop', label: '组件工坊', icon: Puzzle },
      { view: 'plugin-lab', label: '插件实验室', icon: Puzzle },
      { view: 'reviews', label: '组件审核', icon: ShieldCheck, adminOnly: true },
    ],
  },
];

function NavigationButton({
  item,
  view,
  onNavigate,
}: Pick<PrimaryNavigationProps, 'view' | 'onNavigate'> & { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className="primary-navigation__item"
      title={item.label}
      aria-label={item.label}
      aria-current={view === item.view ? 'page' : undefined}
      onClick={() => onNavigate(item.view)}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  );
}

function NavigationGroup({
  entry,
  view,
  role,
  onNavigate,
}: PrimaryNavigationProps & { entry: Extract<NavigationEntry, { children: unknown }> }) {
  const details = useRef<HTMLDetailsElement>(null);
  const children = entry.children.filter((item) => !item.adminOnly || role === 'admin');
  const active = children.some((item) => item.view === view);
  const Icon = entry.icon;

  // Open on entering this group; leave native toggling free to close it afterward.
  useEffect(() => {
    if (active && details.current) details.current.open = true;
  }, [active]);

  return (
    <details ref={details} className="primary-navigation__group">
      <summary
        className="primary-navigation__summary"
        data-active={active || undefined}
        title={entry.label}
        aria-label={entry.label}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{entry.label}</span>
        <ChevronDown size={16} className="primary-navigation__chevron" aria-hidden="true" />
      </summary>
      <div className="primary-navigation__children">
        {children.map((item) => (
          <NavigationButton key={item.view} item={item} view={view} onNavigate={onNavigate} />
        ))}
      </div>
    </details>
  );
}

export default function PrimaryNavigation(props: PrimaryNavigationProps) {
  return (
    <nav className="main-nav primary-navigation" aria-label="主导航">
      {primaryNavigation.map((entry) =>
        'children' in entry ? (
          <NavigationGroup key={entry.id} entry={entry} {...props} />
        ) : (
          <NavigationButton key={entry.view} item={entry} {...props} />
        ),
      )}
    </nav>
  );
}
