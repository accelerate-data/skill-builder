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
import RefinePage from "./pages/refine";
const rootRoute = createRootRoute({
  component: AppLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
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

const refineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/refine",
  component: RefinePage,
  validateSearch: (search: Record<string, unknown>) => ({
    skill: typeof search.skill === "string" ? search.skill : undefined,
  }),
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  settingsRoute,
  skillsRedirectRoute,
  workflowRoute,
  refineRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
