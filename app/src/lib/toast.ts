import { toast as sonnerToast } from "sonner";
import { formatCause, logDebug } from "@/lib/app-log";

type ToastContext = Record<string, unknown>;

export type LoggedToastOptions = {
  cause?: unknown;
  context?: ToastContext;
};

type SonnerErrorArgs = Parameters<(typeof sonnerToast)["error"]>;
type SonnerWarningArgs = Parameters<(typeof sonnerToast)["warning"]>;

export type AppToastErrorOptions = (SonnerErrorArgs[1] extends undefined ? {} : SonnerErrorArgs[1]) & LoggedToastOptions;
export type AppToastWarningOptions =
  (SonnerWarningArgs[1] extends undefined ? {} : SonnerWarningArgs[1]) & LoggedToastOptions;

function toastMessageToString(message: unknown): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.message;
  return "[non-string toast message]";
}

function logToastShown(toastLevel: "warning" | "error", message: unknown, options?: LoggedToastOptions) {
  logDebug("toast_shown", {
    event: "toast_shown",
    component: "toast",
    toastLevel,
    toastMessage: toastMessageToString(message),
    cause: formatCause(options?.cause),
    context: options?.context ?? undefined,
  });
}

type AppToast = Omit<typeof sonnerToast, "warning" | "error"> & {
  warning: (message: SonnerWarningArgs[0], options?: AppToastWarningOptions) => ReturnType<(typeof sonnerToast)["warning"]>;
  error: (message: SonnerErrorArgs[0], options?: AppToastErrorOptions) => ReturnType<(typeof sonnerToast)["error"]>;
};

export const toast: AppToast = {
  ...sonnerToast,
  warning: (message, options) => {
    const { cause, context, ...sonnerOptions } = (options ?? {}) as LoggedToastOptions & Record<string, unknown>;
    logToastShown("warning", message, { cause, context });
    return sonnerToast.warning(message, sonnerOptions);
  },
  error: (message, options) => {
    const { cause, context, ...sonnerOptions } = (options ?? {}) as LoggedToastOptions & Record<string, unknown>;
    logToastShown("error", message, { cause, context });
    return sonnerToast.error(message, sonnerOptions);
  },
};

