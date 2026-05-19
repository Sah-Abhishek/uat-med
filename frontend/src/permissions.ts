import type { Role } from '@/api/types';

export const PERMISSIONS = {
  // Coders intentionally excluded — they consume charts via the Charts page
  // and shouldn't be navigating into worklist management.
  'worklist.view': ['TEAMLEAD', 'MANAGER', 'AUDITOR'],
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
  'qa.view': ['TEAMLEAD', 'MANAGER'],
  'coderRules.manage': ['TEAMLEAD', 'MANAGER'],
  'admin.codeDecisions.view': ['TEAMLEAD', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(
  user: { role: Role } | null | undefined,
  action: Permission,
): boolean {
  if (!user) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(user.role);
}
