import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useSkillStore } from "@/stores/skill-store";
import DashboardPage from "./dashboard";

export default function HomePage() {
  const navigate = useNavigate();
  const selectedSkillName = useSkillStore((s) => s.activeSkill);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (pathname !== "/") return;
    if (!selectedSkillName) return;
    navigate({
      to: "/workspace/$skillName",
      params: { skillName: selectedSkillName },
      search: { tab: undefined },
      replace: true,
    });
  }, [navigate, selectedSkillName, pathname]);

  return <DashboardPage />;
}
