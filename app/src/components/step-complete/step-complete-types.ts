import type { ClarificationsFile } from "@/lib/clarifications-types";
import type { ConversationRunRecord } from "@/lib/types";

/** Props shared by all step completion views. */
export interface StepCompleteBaseProps {
  stepName: string;
  isLastStep: boolean;
  reviewMode?: boolean;
  nextStepBlocked?: boolean;
  nextStepLabel?: string;
  onNextStep?: () => void;
  onClose?: () => void;
  onEval?: () => void;
  onResetStep?: () => void;
  conversationRuns: ConversationRunRecord[];
  duration?: number;
}

/** Extra props for steps 0/1 that support editable clarifications. */
export interface ClarificationsEditableProps {
  clarificationsEditable?: boolean;
  clarificationsData?: ClarificationsFile | null;
  onClarificationsChange?: (data: ClarificationsFile) => void;
  onClarificationsContinue?: () => void;
  onReset?: () => void;
  saveStatus?: "idle" | "dirty" | "saving" | "saved";
  evaluating?: boolean;
}

/** Props for the file content map consumed by step-specific views. */
export interface StepFileProps {
  fileContents: Map<string, string>;
  resolvedFiles: string[];
  selectedFile: string | null;
  setSelectedFile: (f: string | null) => void;
}
