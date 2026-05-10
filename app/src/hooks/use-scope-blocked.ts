import { useEffect, useState } from "react";
import { getDisabledSteps } from "@/lib/tauri";
import type { EditableSkill } from "@/lib/types";

export function useScopeBlocked(
  selectedSkill: EditableSkill | null,
  context?: string
): boolean {
  const [scopeBlocked, setScopeBlocked] = useState(false);

  useEffect(() => {
    if (!selectedSkill) {
      setScopeBlocked(false);
      return;
    }
    if (selectedSkill.id == null) {
      setScopeBlocked(false);
      return;
    }
    getDisabledSteps(selectedSkill.id)
      .then((disabled) => {
        const blocked = disabled.length > 0;
        setScopeBlocked(blocked);
        if (blocked)
          console.warn(
            "[%s] Scope recommendation active for skill '%s' — blocked",
            context ?? "app",
            selectedSkill.name
          );
      })
      .catch(() => setScopeBlocked(false));
  }, [selectedSkill, context]);

  return scopeBlocked;
}
