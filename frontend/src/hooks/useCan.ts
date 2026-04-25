import { useAuth } from '@/auth/store';
import { can, type Permission } from '@/permissions';

export function useCan(action: Permission): boolean {
  const user = useAuth((s) => s.user);
  return can(user, action);
}
