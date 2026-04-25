import type { Role } from '@/api/types';

export const PERMISSIONS = {
  'worklist.create': ['ADMIN', 'MANAGER'],
  'worklist.delete': ['ADMIN', 'MANAGER'],
  'worklist.allocate': ['ADMIN', 'MANAGER'],
  'chart.bulkModify': ['ADMIN', 'MANAGER'],
  'chart.selfAllocate': ['CODER', 'AUDITOR'],
  'chart.feedback.add': ['AUDITOR'],
  'chart.feedback.respond': ['CODER'],
  'user.create': ['ADMIN'],
  'user.deactivate': ['ADMIN'],
  'user.list': ['ADMIN', 'MANAGER'],
  'config.view': ['ADMIN', 'MANAGER'],
  'config.edit': ['ADMIN'],
  'dashboard.team': ['ADMIN', 'MANAGER'],
  'reports.run': ['ADMIN', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(
  user: { role: Role } | null | undefined,
  action: Permission,
): boolean {
  if (!user) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(user.role);
}
