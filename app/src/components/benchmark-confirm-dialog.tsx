import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface BenchmarkConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onSkip: () => void;
}

export function BenchmarkConfirmDialog({ open, onConfirm, onSkip }: BenchmarkConfirmDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Skill written successfully</DialogTitle>
          <DialogDescription>
            Run benchmarks to evaluate the skill against test cases?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={onConfirm}>
            Run Benchmarks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
