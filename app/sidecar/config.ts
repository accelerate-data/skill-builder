export interface SidecarConfig {
  prompt: string;
  model?: string;
  agentName?: string;
  apiKey: string;
  cwd: string;
  allowedTools?: string[];
  maxTurns?: number;
  permissionMode?: string;
  sessionId?: string;
  betas?: string[];
  maxThinkingTokens?: number;
  pathToClaudeCodeExecutable?: string;
}
