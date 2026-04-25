import { useEffect, useRef, useState } from 'react';
import { Bell, Search, Sun, Moon, LogOut } from 'lucide-react';
import { useTheme } from '@/theme/store';
import { useAuth } from '@/auth/store';
import { logout } from '@/api/auth';
import { useNavigate } from 'react-router-dom';
import { cn, initials } from '@/lib/utils';
import { Select } from '@/components/ui/Field';

export function TopBar() {
  const { theme, toggle } = useTheme();
  const user = useAuth((s) => s.user);
  const refreshToken = useAuth((s) => s.refreshToken);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function handleLogout() {
    try {
      if (refreshToken) await logout(refreshToken);
    } catch {
      /* ignore */
    } finally {
      clear();
      navigate('/login', { replace: true });
    }
  }

  return (
    <header className="h-16 px-6 border-b border-line bg-bg flex items-center gap-4">
      <div className="flex-1" />

      {/* Client selector */}
      <label className="flex items-center gap-2 text-xs">
        <span className="text-ink-muted font-medium">Client</span>
        <Select defaultValue="all" className="h-9 w-36 text-sm">
          <option value="all">All</option>
        </Select>
      </label>

      {/* Location selector */}
      <label className="flex items-center gap-2 text-xs">
        <span className="text-ink-muted font-medium">Location</span>
        <Select defaultValue="all" className="h-9 w-36 text-sm">
          <option value="all">All</option>
        </Select>
      </label>

      {/* Icon buttons */}
      <div className="flex items-center gap-1">
        <button
          className="w-9 h-9 rounded-full hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          className="w-9 h-9 rounded-full hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition relative"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
        </button>
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full hover:bg-surface-sunken flex items-center justify-center text-ink-muted transition"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* User avatar + menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'w-9 h-9 rounded-full overflow-hidden flex items-center justify-center font-semibold text-sm',
            'bg-gradient-to-br from-violet-500 via-fuchsia-500 to-orange-400 text-white',
          )}
          aria-label="User menu"
        >
          {user ? initials(user.fullName) : '?'}
        </button>
        {menuOpen && user && (
          <div className="absolute right-0 top-full mt-2 w-64 card shadow-pop dark:shadow-pop-dark p-1 z-50">
            <div className="px-3 py-2.5 border-b border-line">
              <p className="text-sm font-semibold text-ink truncate">{user.fullName}</p>
              <p className="text-xs text-ink-muted truncate">{user.email}</p>
              <p className="text-[10px] uppercase tracking-[0.1em] text-ink-subtle mt-1 font-semibold">
                {user.role}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-ink hover:bg-surface-sunken rounded-md transition text-left"
            >
              <LogOut className="w-4 h-4 text-ink-muted" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
