import { Tags } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface TagFilterProps {
  availableTags: string[]
  selectedTags: string[]
  onChange: (tags: string[]) => void
}

export default function TagFilter({
  availableTags,
  selectedTags,
  onChange,
}: TagFilterProps) {
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter((t) => t !== tag))
    } else {
      onChange([...selectedTags, tag])
    }
  }

  if (availableTags.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Tags className="size-4" />
          Tags
          {selectedTags.length > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
              {selectedTags.length}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableTags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={selectedTags.includes(tag)}
            onCheckedChange={() => toggleTag(tag)}
          >
            {tag}
          </DropdownMenuCheckboxItem>
        ))}
        {selectedTags.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <button
              type="button"
              className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
