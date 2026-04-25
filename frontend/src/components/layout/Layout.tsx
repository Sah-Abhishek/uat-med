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
  Power,
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

export function Layout() {
  const user = useAuth((s) => s.user);
  if (!user) return null;

  return (
    <div className="min-h-screen bg-bg flex">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="w-[240px] shrink-0 border-r border-line bg-bg flex flex-col">
        <div className="h-16 flex items-center px-5 border-b border-line">
          <ValerionLogo />
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const visible = !item.requires || can(user, item.requires);
            if (!visible) return null;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition',
                    isActive
                      ? 'bg-primary-soft text-primary-ink font-semibold'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink font-medium',
                  )
                }
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Power button at bottom */}
        <div className="p-3 border-t border-line">
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-primary hover:bg-primary-soft transition"
            aria-label="Sign out"
            title="Sign out (use menu for full options)"
          >
            <Power className="w-4 h-4" />
          </button>
        </div>
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
