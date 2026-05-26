import { createBrowserRouter } from 'react-router-dom';
import { LoginPage } from '@/auth/LoginPage';
import { SignupPage } from '@/auth/SignupPage';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { Layout } from '@/components/layout/Layout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { WorklistsPage } from '@/features/worklists/WorklistsPage';
import { WorklistDetailPage } from '@/features/worklists/WorklistDetailPage';
import { ChartsPage } from '@/features/charts/ChartsPage';
import { ChartDetailPage } from '@/features/charts/ChartDetailPage';
import { HccPage } from '@/features/hcc/HccPage';
import { UsersPage } from '@/features/users/UsersPage';
import { UserProfilePage } from '@/features/users/UserProfilePage';
import { ConfigurationsPage } from '@/features/configurations/ConfigurationsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { QaPage } from '@/features/qa/QaPage';
import { AiAnalyticsPage } from '@/features/ai-analytics/AiAnalyticsPage';
import { ProductivityPage } from '@/features/productivity/ProductivityPage';
import { CoderRulesPage } from '@/features/coder-rules/CoderRulesPage';
import { CodeDecisionsPage } from '@/features/admin/CodeDecisionsPage';
import { ChartDecisionsDetailPage } from '@/features/admin/ChartDecisionsDetailPage';
import { NotFoundPage } from '@/components/NotFoundPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'worklists', element: <WorklistsPage /> },
          { path: 'worklists/:id', element: <WorklistDetailPage /> },
          { path: 'charts', element: <ChartsPage /> },
          { path: 'charts/:id', element: <ChartDetailPage /> },
          { path: 'hcc', element: <HccPage /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'users/:id', element: <UserProfilePage /> },
          { path: 'configurations', element: <ConfigurationsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'qa', element: <QaPage /> },
          { path: 'ai-analytics', element: <AiAnalyticsPage /> },
          { path: 'productivity', element: <ProductivityPage /> },
          { path: 'coder-rules', element: <CoderRulesPage /> },
          { path: 'admin/code-decisions', element: <CodeDecisionsPage /> },
          { path: 'admin/code-decisions/charts/:id', element: <ChartDecisionsDetailPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
