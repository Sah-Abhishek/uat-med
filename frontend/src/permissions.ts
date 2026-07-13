import type { Role } from '@/api/types';

export const PERMISSIONS = {
  // Coders intentionally excluded — they consume charts via the Charts page
  // and shouldn't be navigating into worklist management.
  'worklist.view': ['TEAMLEAD', 'MANAGER', 'AUDITOR'],
  'worklist.create': ['TEAMLEAD', 'MANAGER'],
  'worklist.delete': ['TEAMLEAD', 'MANAGER'],
  'worklist.allocate': ['TEAMLEAD', 'MANAGER'],
  'worklist.bulkImport': ['TEAMLEAD', 'MANAGER'],
  'chart.bulkModify': ['TEAMLEAD', 'MANAGER'],
  'chart.bulkDelete': ['TEAMLEAD', 'MANAGER'],
  'chart.selfAllocate': ['CODER', 'AUDITOR', 'TEAMLEAD', 'MANAGER'],
  'chart.feedback.add': ['AUDITOR'],
  'chart.feedback.respond': ['CODER'],
  'user.create': ['TEAMLEAD', 'MANAGER'],
  'user.deactivate': ['TEAMLEAD', 'MANAGER'],
  'user.changeRole': ['TEAMLEAD', 'MANAGER'],
  'user.list': ['TEAMLEAD', 'MANAGER'],
  'config.view': ['TEAMLEAD', 'MANAGER'],
  'config.edit': ['TEAMLEAD', 'MANAGER'],
  'dashboard.team': ['TEAMLEAD', 'MANAGER'],
  'reports.run': ['AUDITOR', 'TEAMLEAD', 'MANAGER'],
  'qa.view': ['TEAMLEAD', 'MANAGER'],
  'coderRules.manage': ['TEAMLEAD', 'MANAGER'],
  'admin.codeDecisions.view': ['TEAMLEAD', 'MANAGER'],
  'admin.activeWork.view': ['TEAMLEAD', 'MANAGER'],
  // Manager-exclusive by product decision: Team Leads are deliberately excluded
  // from the allocation-history audit trail. The backend enforces this with a
  // dedicated ManagerOnlyGuard (RolesGuard would otherwise let TEAMLEAD through
  // as a super-role).
  'allocation.audit.view': ['MANAGER'],
  'billing.view': ['TEAMLEAD', 'MANAGER'],
  'billing.configure': ['TEAMLEAD', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(
  user: { role: Role } | null | undefined,
  action: Permission,
): boolean {
  if (!user) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(user.role);
}
