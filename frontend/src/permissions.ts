import type { Role } from '@/api/types';

export const PERMISSIONS = {
  'worklist.create': ['TEAMLEAD', 'MANAGER'],
  'worklist.delete': ['TEAMLEAD', 'MANAGER'],
  'worklist.allocate': ['TEAMLEAD', 'MANAGER'],
  'chart.bulkModify': ['TEAMLEAD', 'MANAGER'],
  'chart.selfAllocate': ['CODER', 'AUDITOR'],
  'chart.feedback.add': ['AUDITOR'],
  'chart.feedback.respond': ['CODER'],
  'user.create': ['TEAMLEAD'],
  'user.deactivate': ['TEAMLEAD'],
  'user.list': ['TEAMLEAD', 'MANAGER'],
  'config.view': ['TEAMLEAD', 'MANAGER'],
  'config.edit': ['TEAMLEAD'],
  'dashboard.team': ['TEAMLEAD', 'MANAGER'],
  'reports.run': ['TEAMLEAD', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(
  user: { role: Role } | null | undefined,
  action: Permission,
): boolean {
  if (!user) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(user.role);
}
