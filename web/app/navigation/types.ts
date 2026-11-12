import type { LucideIcon } from 'lucide-react';

export type AppView =
  | 'profile'
  | 'home'
  | 'wiki'
  | 'market'
  | 'components'
  | 'reviews'
  | 'knowledge'
  | 'proposals'
  | 'domains'
  | 'mcp'
  | 'plugin-lab'
  | 'workshop';

export type NavigationItem = {
  view: AppView;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export type NavigationEntry =
  | NavigationItem
  | {
      id: string;
      label: string;
      icon: LucideIcon;
      children: readonly NavigationItem[];
    };

export type PrimaryNavigationProps = {
  view: AppView;
  role: string;
  onNavigate: (view: AppView) => void;
};
