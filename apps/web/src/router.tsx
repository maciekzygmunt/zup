import { createBrowserRouter } from "react-router"
import { AppShell } from "./components/AppShell.tsx"
import { RequireAuth, SetupGate } from "./components/guards.tsx"
import { ConsentPage } from "./pages/ConsentPage.tsx"
import { DevicePage } from "./pages/DevicePage.tsx"
import { LoginPage } from "./pages/LoginPage.tsx"
import { NotFoundPage } from "./pages/NotFoundPage.tsx"
import { SettingsPage } from "./pages/SettingsPage.tsx"
import { SetupPage } from "./pages/SetupPage.tsx"
import { SiteDetailPage } from "./pages/SiteDetailPage.tsx"
import { SitesPage } from "./pages/SitesPage.tsx"

export const router = createBrowserRouter([
  {
    element: <SetupGate />,
    children: [
      { path: "/setup", element: <SetupPage /> },
      { path: "/login", element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/device", element: <DevicePage /> },
          { path: "/consent", element: <ConsentPage /> },
          {
            element: <AppShell />,
            children: [
              { index: true, element: <SitesPage /> },
              { path: "/sites/:slug", element: <SiteDetailPage /> },
              { path: "/settings", element: <SettingsPage /> },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
])
