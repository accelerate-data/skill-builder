/**
 * Human-readable error labels for SDK result and assistant error codes.
 *
 * @module error-labels
 */

/** User-friendly labels for SDK result `subtype` error codes. */
export const RESULT_ERROR_LABELS: Record<string, string> = {
  error_max_turns: "Agent reached the maximum number of turns allowed.",
  error_max_budget_usd: "Agent exceeded the maximum cost budget.",
  error_during_execution: "An error occurred during agent execution.",
  error_max_structured_output_retries:
    "Agent failed to produce valid structured output after multiple retries.",
  error_authentication:
    "Authentication failed — check your API key in Settings.",
};

/** User-friendly labels for SDK assistant message error codes. */
export const ASSISTANT_ERROR_LABELS: Record<string, string> = {
  authentication_failed: "Authentication failed — check your API key in Settings.",
  billing_error: "Billing error — check your Anthropic account billing status.",
  rate_limit: "Rate limit exceeded — try again in a few moments.",
  invalid_request: "Invalid request sent to the API.",
  server_error: "Anthropic API server error — try again shortly.",
};
