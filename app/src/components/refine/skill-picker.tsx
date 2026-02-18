import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SKILL_TYPE_LABELS,
  SKILL_TYPE_COLORS,
  type SkillSummary,
  type SkillType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function SkillTypeBadge({ skillType, className }: { skillType: string; className?: string }) {
  const type = skillType as SkillType;
  return (
    <Badge className={cn("px-1.5 py-0 text-[10px]", SKILL_TYPE_COLORS[type], className)}>
      {SKILL_TYPE_LABELS[type] ?? skillType}
    </Badge>
  );
}

interface SkillPickerProps {
  skills: SkillSummary[];
  selected: SkillSummary | null;
  isLoading: boolean;
  disabled?: boolean;
  onSelect: (skill: SkillSummary) => void;
}

export function SkillPicker({ skills, selected, isLoading, disabled, onSelect }: SkillPickerProps) {
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-9 w-64" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-64 justify-between" disabled={disabled}>
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span className="truncate">{selected.name}</span>
              {selected.skill_type && <SkillTypeBadge skillType={selected.skill_type} />}
            </span>
          ) : (
            <span className="text-muted-foreground">Select a skill...</span>
          )}
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search skills..." />
          <CommandList>
            <CommandEmpty>No skills found</CommandEmpty>
            <CommandGroup>
              {skills.map((skill) => (
                <CommandItem
                  key={skill.name}
                  value={skill.name}
                  onSelect={() => {
                    onSelect(skill);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{skill.name}</span>
                  {skill.skill_type && <SkillTypeBadge skillType={skill.skill_type} className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
