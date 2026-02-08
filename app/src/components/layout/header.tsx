import { Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Skill Builder</h1>
      </div>

      <div className="flex items-center gap-3">
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="size-8">
            <Settings className="size-4" />
          </Button>
        </Link>
      </div>
    </header>
  );
}
