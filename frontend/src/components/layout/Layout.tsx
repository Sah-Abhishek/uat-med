import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/store';
import { can, type Permission } from '@/permissions';
import { cn } from '@/lib/utils';
import { ValerionLogo, ValerionMark } from '@/components/ui/Logo';
import { TopBar } from './TopBar';
import {
  LayoutDashboard,
  ClipboardList,
  FileStack,
  Layers,
  Users,
  Settings,
  BarChart3,
  Power,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { ComponentProps, ComponentType } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<ComponentProps<'svg'>>;
  requires?: Permission;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/worklists', label: 'Worklists', icon: ClipboardList, requires: 'worklist.create' },
  { to: '/charts', label: 'Charts', icon: FileStack },
  { to: '/hcc', label: 'HCC Project', icon: Layers },
  { to: '/users', label: 'Users', icon: Users, requires: 'user.list' },
  { to: '/configurations', label: 'Configurations', icon: Settings, requires: 'config.view' },
  { to: '/reports', label: 'Reports', icon: BarChart3, requires: 'reports.run' },
];

const STORAGE_KEY = 'app.sidebar.collapsed';

export function Layout() {
  const user = useAuth((s) => s.user);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-bg flex">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside
        className={cn(
          'shrink-0 border-r border-line bg-bg flex flex-col relative transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-[240px]',
        )}
      >
        <div
          className={cn(
            'h-16 flex items-center border-b border-line',
            collapsed ? 'justify-center px-0' : 'px-5',
          )}
        >
          {collapsed ? <ValerionMark className="w-9 h-9" /> : <ValerionLogo />}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {NAV.map((item) => {
            const visible = !item.requires || can(user, item.requires);
            if (!visible) return null;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg text-sm transition',
                    collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
                    isActive
                      ? 'bg-primary-soft text-primary-ink dark:text-primary font-semibold'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink font-medium',
                  )
                }
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Power button at bottom */}
        <div className={cn('border-t border-line', collapsed ? 'p-2 flex justify-center' : 'p-3')}>
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-primary hover:bg-primary-soft transition"
            aria-label="Sign out"
            title="Sign out (use menu for full options)"
          >
            <Power className="w-4 h-4" />
          </button>
        </div>

        {/* Collapse toggle — pinned to the right edge */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-20 -right-3 w-6 h-6 rounded-full bg-surface border border-line shadow-card flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 transition z-10"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronLeft className="w-3 h-3" />
          )}
        </button>
      </aside>

      {/* ── Main area ───────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
