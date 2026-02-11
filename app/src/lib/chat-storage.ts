import { writeFile, readFile } from "@/lib/tauri";

// --- Types ---

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  agentId?: string;
}

export interface ChatSession {
  sessionId: string;
  stepId: number;
  messages: ChatMessage[];
}

// --- Path helper ---

function chatFilePath(
  workspacePath: string,
  skillName: string,
  stepLabel: string,
): string {
  return `${workspacePath}/${skillName}/logs/${stepLabel}-chat.json`;
}

// --- Public API ---

/**
 * Save a chat session to disk as JSON.
 * Creates parent directories if needed (handled by the Rust write_file command).
 */
export async function saveChatSession(
  workspacePath: string,
  skillName: string,
  stepLabel: string,
  session: ChatSession,
): Promise<void> {
  const path = chatFilePath(workspacePath, skillName, stepLabel);
  const content = JSON.stringify(session, null, 2);
  await writeFile(path, content);
}

/**
 * Load a chat session from disk.
 * Returns null if the file does not exist or contains invalid JSON.
 */
export async function loadChatSession(
  workspacePath: string,
  skillName: string,
  stepLabel: string,
): Promise<ChatSession | null> {
  const path = chatFilePath(workspacePath, skillName, stepLabel);
  try {
    const content = await readFile(path);
    if (!content) return null;
    const session: ChatSession = JSON.parse(content);
    return session;
  } catch {
    // File not found or invalid JSON — return null
    return null;
  }
}
