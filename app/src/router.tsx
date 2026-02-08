import {
  createRouter,
  createRoute,
  createRootRoute,
} from "@tanstack/react-router";
import { AppLayout } from "./components/layout/app-layout";
import DashboardPage from "./pages/dashboard";
import SettingsPage from "./pages/settings";
import WorkflowPage from "./pages/workflow";
import EditorPage from "./pages/editor";
import ChatPage from "./pages/chat";

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

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skill/$skillName/editor",
  component: EditorPage,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skill/$skillName/chat",
  component: ChatPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  settingsRoute,
  workflowRoute,
  editorRoute,
  chatRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
