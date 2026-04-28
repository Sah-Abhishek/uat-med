import { useEffect, useRef, useState } from 'react';
import { Bell, Search, Sun, Moon, LogOut, ChevronDown, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/theme/store';
import { useAuth } from '@/auth/store';
import { logout } from '@/api/auth';
import { listClients, listLocations } from '@/api/configurations';
import { useNavigate } from 'react-router-dom';
import { cn, initials } from '@/lib/utils';

type ScopeId = number | 'all';

export function TopBar() {
  const { theme, toggle } = useTheme();
  const user = useAuth((s) => s.user);
  const refreshToken = useAuth((s) => s.refreshToken);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [scopeClient, setScopeClient] = useState<ScopeId>('all');
  const [scopeLocation, setScopeLocation] = useState<ScopeId>('all');

  const clients = useQuery({
    queryKey: ['configurations', 'clients'],
    queryFn: listClients,
    enabled: !!user,
  });
  const locations = useQuery({
    queryKey: ['configurations', 'locations', scopeClient],
    queryFn: () => listLocations(scopeClient as number),
    enabled: !!user && scopeClient !== 'all',
  });

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

      <ScopePicker
        label="Client"
        value={scopeClient}
        onChange={(v) => {
          setScopeClient(v);
          setScopeLocation('all');
        }}
        options={(clients.data?.items ?? []).map((c) => ({ id: c.id, name: c.name }))}
      />

      <ScopePicker
        label="Location"
        value={scopeLocation}
        onChange={setScopeLocation}
        options={
          scopeClient === 'all'
            ? []
            : (locations.data?.items ?? []).map((l) => ({ id: l.id, name: l.name }))
        }
        disabled={scopeClient === 'all'}
      />

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

/* ── Sleek scope picker (Client / Location) ─────────────── */
function ScopePicker({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: ScopeId;
  onChange: (v: ScopeId) => void;
  options: { id: number; name: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selected = value === 'all' ? null : options.find((o) => o.id === value) ?? null;
  const display = selected?.name ?? 'All';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-9 pl-3 pr-2.5 rounded-pill border flex items-center gap-2.5 text-sm transition min-w-[160px]',
          'border-line bg-surface hover:border-line-strong hover:bg-surface-sunken/60',
          open && 'border-primary/70 bg-surface-sunken/60 shadow-card',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        )}
      >
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
          {label}
        </span>
        <span className="font-semibold text-ink truncate flex-1 text-left">{display}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-ink-muted transition-transform shrink-0',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            'absolute right-0 top-full mt-2 min-w-[220px] max-w-[300px] z-50',
            'bg-surface border border-line rounded-xl shadow-pop dark:shadow-pop-dark p-1',
            'max-h-[340px] overflow-y-auto',
          )}
        >
          <ScopeItem
            label="All"
            isSelected={value === 'all'}
            onClick={() => {
              onChange('all');
              setOpen(false);
            }}
          />
          {options.length > 0 && <div className="my-1 mx-2 h-px bg-line" />}
          {options.map((o) => (
            <ScopeItem
              key={o.id}
              label={o.name}
              isSelected={value === o.id}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            />
          ))}
          {options.length === 0 && value === 'all' && (
            <p className="px-3 py-2 text-[11px] text-ink-muted">No options.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ScopeItem({
  label,
  isSelected,
  onClick,
}: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition text-left',
        isSelected
          ? 'bg-primary-soft text-primary-ink dark:text-primary font-semibold'
          : 'text-ink hover:bg-surface-sunken font-medium',
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      {isSelected && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
    </button>
  );
}
