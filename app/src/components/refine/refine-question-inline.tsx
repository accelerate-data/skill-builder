import { useMemo, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RefineMessage, RefineQuestionPrompt, RefineQuestionResponse } from "@/stores/refine-store";

interface RefineQuestionInlineProps {
  message: RefineMessage;
  onSubmit: (message: RefineMessage, response: RefineQuestionResponse) => Promise<void>;
}

function isClarifyLabel(label: string): boolean {
  return label.toLowerCase().includes("clarify");
}

function QuestionStep({
  question,
  selectedAnswers,
  onSelect,
}: {
  question: RefineQuestionPrompt;
  selectedAnswers: string[];
  onSelect: (label: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {question.header}
        </div>
        <div className="mt-1 text-sm font-medium text-foreground">
          {question.question}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {question.options.map((option) => {
          const selected = selectedAnswers.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/30 bg-background/40 hover:bg-background/70"
              }`}
              onClick={() => onSelect(option.label)}
            >
              <div className="flex items-start gap-2 text-sm font-medium text-foreground">
                {question.multiSelect && (
                  <span
                    className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border ${
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                )}
                <span>{option.label}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{option.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RefineQuestionInline({ message, onSubmit }: RefineQuestionInlineProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>({});
  const [clarificationText, setClarificationText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const questions = message.questions ?? [];
  const isWizard = questions.length > 1;
  const clarifySelected = useMemo(
    () => Object.values(selectedAnswers).some((answers) => answers.some(isClarifyLabel)),
    [selectedAnswers],
  );

  const handleSubmit = async () => {
    if (questions.length === 0) return;
    const unanswered = questions.some((question) => (selectedAnswers[question.question] ?? []).length === 0);
    if (unanswered) return;

    const customText = clarifySelected ? clarificationText.trim() : undefined;
    if (clarifySelected && !customText) return;

    setIsSubmitting(true);
    try {
      await onSubmit(message, {
        answers: Object.fromEntries(
          questions.map((question) => {
            const selected = selectedAnswers[question.question] ?? [];
            const answerValues = selected.map((label) =>
              isClarifyLabel(label) && customText ? customText : label,
            );
            return [
              question.question,
              answerValues.join(", "),
            ];
          }),
        ),
        selectedLabels: questions
          .flatMap((question) => selectedAnswers[question.question] ?? []),
        customText,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!message.pending && message.response) {
    return (
      <div
        data-testid="refine-question-inline"
        className="rounded-xl border bg-muted/20 px-4 py-3"
        style={{ borderColor: "color-mix(in oklch, var(--color-seafoam), transparent 60%)" }}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <CheckCircle2 className="size-3.5" style={{ color: "var(--color-seafoam)" }} />
          Clarified
        </div>
        <div className="space-y-3">
          {(message.questions ?? []).map((question) => (
            <div key={question.question} className="space-y-1">
              <div className="text-sm font-medium text-foreground">{question.question}</div>
              <div className="text-sm text-muted-foreground">
                {Array.isArray(message.response?.answers[question.question])
                  ? (message.response?.answers[question.question] as string[]).join(", ")
                  : String(message.response?.answers[question.question] ?? "")}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentStep];
  const isLastStep = currentStep === questions.length - 1;
  const currentAnswers = currentQuestion ? (selectedAnswers[currentQuestion.question] ?? []) : [];
  const currentAnswered = currentAnswers.length > 0;
  const currentNeedsClarifyText =
    currentAnswered && currentAnswers.some(isClarifyLabel) && clarificationText.trim().length === 0;
  const allAnswered = questions.every((q) => (selectedAnswers[q.question] ?? []).length > 0);

  const updateSelectedAnswers = (question: RefineQuestionPrompt, label: string) => {
    setSelectedAnswers((current) => {
      const existing = current[question.question] ?? [];
      const next = question.multiSelect
        ? (existing.includes(label)
            ? existing.filter((answer) => answer !== label)
            : [...existing, label])
        : [label];
      return {
        ...current,
        [question.question]: next,
      };
    });
  };

  return (
    <div
      data-testid="refine-question-inline"
      className="rounded-xl border border-border/30 bg-muted/20 px-4 py-3"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <HelpCircle className="size-3.5" />
        Need Clarification
        {isWizard && (
          <span data-testid="wizard-step-indicator" className="ml-auto tabular-nums">
            {currentStep + 1} of {questions.length}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {isWizard ? (
          <QuestionStep
            key={currentQuestion.question}
            question={currentQuestion}
            selectedAnswers={selectedAnswers[currentQuestion.question] ?? []}
            onSelect={(label) => updateSelectedAnswers(currentQuestion, label)}
          />
        ) : (
          questions.map((question: RefineQuestionPrompt) => (
            <QuestionStep
              key={question.question}
              question={question}
              selectedAnswers={selectedAnswers[question.question] ?? []}
              onSelect={(label) => updateSelectedAnswers(question, label)}
            />
          ))
        )}

        {clarifySelected && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">Clarify the refine request</div>
            <Textarea
              value={clarificationText}
              onChange={(event) => setClarificationText(event.target.value)}
              placeholder="Describe what should be changed..."
              className="min-h-24 resize-y"
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          {isWizard ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="wizard-back"
                disabled={currentStep === 0}
                onClick={() => setCurrentStep((s) => s - 1)}
              >
                <ChevronLeft className="mr-1 size-4" />
                Back
              </Button>
              {isLastStep ? (
                <Button
                  type="button"
                  data-testid="refine-question-submit"
                  disabled={
                    isSubmitting
                    || !allAnswered
                    || (clarifySelected && clarificationText.trim().length === 0)
                  }
                  onClick={() => void handleSubmit()}
                >
                  Submit
                </Button>
              ) : (
                <Button
                  type="button"
                  data-testid="wizard-next"
                  disabled={!currentAnswered || currentNeedsClarifyText}
                  onClick={() => setCurrentStep((s) => s + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              )}
            </>
          ) : (
            <div className="ml-auto">
              <Button
                type="button"
                data-testid="refine-question-submit"
                disabled={
                  isSubmitting
                  || questions.some((question) => (selectedAnswers[question.question] ?? []).length === 0)
                  || (clarifySelected && clarificationText.trim().length === 0)
                }
                onClick={() => void handleSubmit()}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
