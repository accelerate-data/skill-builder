import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type SkillSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface SkillPickerProps {
  skills: SkillSummary[];
  selected: SkillSummary | null;
  isLoading: boolean;
  disabled?: boolean;
  lockedSkills?: Set<string>;
  onSelect: (skill: SkillSummary) => void;
}

export function SkillPicker({ skills, selected, isLoading, disabled, lockedSkills, onSelect }: SkillPickerProps) {
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-9 w-64" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-64 justify-between" disabled={disabled}>
          {selected ? (
            <span className="truncate">{selected.name}</span>
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
              {skills.map((skill) => {
                const isLocked = lockedSkills?.has(skill.name) ?? false;
                const item = (
                  <CommandItem
                    key={skill.name}
                    value={skill.name}
                    disabled={isLocked}
                    onSelect={() => {
                      if (isLocked) return;
                      onSelect(skill);
                      setOpen(false);
                    }}
                    className={cn(isLocked && "opacity-50 cursor-not-allowed")}
                  >
                    <span className="truncate">{skill.name}</span>
                    {isLocked && <Lock className="ml-auto size-3 shrink-0 text-muted-foreground" />}
                  </CommandItem>
                );

                if (isLocked) {
                  return (
                    <TooltipProvider key={skill.name}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>{item}</div>
                        </TooltipTrigger>
                        <TooltipContent>Being edited in another window</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                }

                return item;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
