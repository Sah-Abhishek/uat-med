import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/store';
import { can, type Permission } from '@/permissions';
import { cn } from '@/lib/utils';
import { ValerionLogo } from '@/components/ui/Logo';
import { TopBar } from './TopBar';
import {
  LayoutDashboard,
  ClipboardList,
  FileStack,
  Layers,
  Users,
  Settings,
  BarChart3,
  ClipboardCheck,
  BookOpenCheck,
  ShieldCheck,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { ComponentProps, ComponentType, ReactNode } from 'react';

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
  { to: '/qa', label: 'Quality Assurance', icon: ClipboardCheck, requires: 'qa.view' },
  { to: '/ai-analytics', label: 'AI Analytics', icon: Sparkles, requires: 'qa.view' },
  { to: '/coder-rules', label: 'Coder Rules', icon: BookOpenCheck, requires: 'coderRules.manage' },
  { to: '/admin/code-decisions', label: 'Code Decisions', icon: ShieldCheck, requires: 'admin.codeDecisions.view' },
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
    <div className="h-screen overflow-hidden bg-bg flex">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside
        className={cn(
          'shrink-0 border-r border-line bg-bg flex flex-col relative transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-[240px]',
        )}
      >
        {/* Header: logo + collapse chevron live in the same row in both
            states — when collapsed, the logo is hidden so the chevron
            occupies the spot the previous chevron occupied (top-right band).
            Keeps the toggle's vertical position stable as the user
            collapses/expands instead of jumping to the bottom of the rail. */}
        <div
          className={cn(
            'h-16 flex items-center border-b border-line',
            collapsed ? 'justify-center px-2' : 'justify-between px-5',
          )}
        >
          {!collapsed && <ValerionLogo />}
          <HoverTooltip
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            enabled={collapsed}
          >
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-sunken transition"
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              ) : (
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              )}
            </button>
          </HoverTooltip>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const visible = !item.requires || can(user, item.requires);
            if (!visible) return null;
            const Icon = item.icon;
            return (
              <HoverTooltip key={item.to} label={item.label} enabled={collapsed}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
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
              </HoverTooltip>
            );
          })}
        </nav>

        {/* Sign out lives in the TopBar profile menu — keeping a single
            exit path avoids the dead/duplicate sidebar button. */}
      </aside>

      {/* ── Main area ───────────────────────────────── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function HoverTooltip({
  label,
  enabled,
  className,
  children,
}: {
  label: string;
  enabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function showAt() {
    if (!enabled || !wrapperRef.current) return;
    const r = wrapperRef.current.getBoundingClientRect();
    setPos({ top: r.top + r.height / 2, left: r.right + 12 });
  }

  return (
    <div
      ref={wrapperRef}
      className={cn('relative', className)}
      onMouseEnter={showAt}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
            className={cn(
              'pointer-events-none fixed z-[100] -translate-y-1/2',
              'px-2.5 py-1.5 rounded-md whitespace-nowrap',
              'bg-ink text-bg text-xs font-medium shadow-pop',
              'animate-[tooltip-in_150ms_ease-out]',
            )}
          >
            <span
              aria-hidden
              className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-y-[5px] border-y-transparent border-r-[5px] border-r-ink"
            />
            {label}
          </span>,
          document.body,
        )}
    </div>
  );
}
