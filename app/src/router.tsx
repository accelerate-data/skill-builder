import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./components/layout/app-layout";
import HomePage from "./pages/home";
import SettingsPage from "./pages/settings";
import WorkflowPage from "./pages/workflow";
import WorkspaceRoutePage from "./pages/workspace-route";
const rootRoute = createRootRoute({
  component: AppLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflow/$skillId",
  component: WorkflowPage,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace/$skillId",
  component: WorkspaceRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
});

const workspaceRefineRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/refine",
  component: WorkspaceRoutePage,
});

const workspaceEvalsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/evals",
  component: WorkspaceRoutePage,
});

const skillsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { tab: "skills" } });
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  settingsRoute,
  workflowRoute,
  workspaceRoute,
  workspaceRefineRoute,
  workspaceEvalsRoute,
  skillsRedirectRoute,
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
