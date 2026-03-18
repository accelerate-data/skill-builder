import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./components/layout/app-layout";
import DashboardPage from "./pages/dashboard";
import SettingsPage from "./pages/settings";
import WorkflowPage from "./pages/workflow";
const rootRoute = createRootRoute({
  component: AppLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skill/$skillName",
  component: WorkflowPage,
});

const skillsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { tab: "skills" } });
  },
});

const refineRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/refine",
  beforeLoad: () => {
    throw redirect({ to: "/", search: { tab: "refine" } });
  },
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  settingsRoute,
  skillsRedirectRoute,
  workflowRoute,
  refineRedirectRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface HistoryState {
    autoStart?: boolean;
  }
}
