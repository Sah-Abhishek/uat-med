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
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
