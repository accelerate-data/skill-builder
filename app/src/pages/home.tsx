import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useSkillStore } from "@/stores/skill-store";
import DashboardPage from "./dashboard";

export default function HomePage() {
  const navigate = useNavigate();
  const activeSkillId = useSkillStore((s) => s.activeSkillId);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (pathname !== "/") return;
    if (!activeSkillId) return;
    navigate({
      to: "/workspace/$skillId",
      params: { skillId: activeSkillId },
      search: { tab: undefined },
      replace: true,
    });
  }, [navigate, activeSkillId, pathname]);

  return <DashboardPage />;
}
