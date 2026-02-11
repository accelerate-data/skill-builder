import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Tauri commands — vi.hoisted ensures these are available during vi.mock hoisting
const { mockWriteFile, mockReadFile } = vi.hoisted(() => ({
  mockWriteFile: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  mockReadFile: vi.fn<(...args: unknown[]) => Promise<string>>(() => Promise.resolve("")),
}));

vi.mock("@/lib/tauri", () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile,
}));

import {
  saveChatSession,
  loadChatSession,
  type ChatSession,
} from "@/lib/chat-storage";

describe("chat-storage", () => {
  beforeEach(() => {
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset().mockResolvedValue("");
  });

  const session: ChatSession = {
    sessionId: "session-abc",
    stepId: 4,
    messages: [
      {
        role: "user",
        content: "Hello",
        timestamp: "2025-01-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "Hi there!",
        timestamp: "2025-01-01T00:00:01.000Z",
        agentId: "agent-1",
      },
    ],
  };

  // --- saveChatSession ---

  describe("saveChatSession", () => {
    it("writes JSON to the correct file path", async () => {
      await saveChatSession("/workspace", "my-skill", "reasoning", session);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/workspace/my-skill/logs/reasoning-chat.json",
        JSON.stringify(session, null, 2),
      );
    });

    it("uses correct path for different step labels", async () => {
      await saveChatSession("/ws", "skill-a", "refinement", session);

      expect(mockWriteFile).toHaveBeenCalledWith(
        "/ws/skill-a/logs/refinement-chat.json",
        expect.any(String),
      );
    });

    it("propagates write errors", async () => {
      mockWriteFile.mockRejectedValueOnce(new Error("disk full"));

      await expect(
        saveChatSession("/workspace", "my-skill", "reasoning", session),
      ).rejects.toThrow("disk full");
    });
  });

  // --- loadChatSession ---

  describe("loadChatSession", () => {
    it("reads and parses JSON from the correct file path", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(session));

      const result = await loadChatSession("/workspace", "my-skill", "reasoning");

      expect(mockReadFile).toHaveBeenCalledWith(
        "/workspace/my-skill/logs/reasoning-chat.json",
      );
      expect(result).toEqual(session);
    });

    it("returns null when file does not exist", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("not found"));

      const result = await loadChatSession("/workspace", "my-skill", "reasoning");
      expect(result).toBeNull();
    });

    it("returns null when file contains invalid JSON", async () => {
      mockReadFile.mockResolvedValueOnce("not-valid-json{{{");

      const result = await loadChatSession("/workspace", "my-skill", "reasoning");
      expect(result).toBeNull();
    });

    it("returns null when file is empty", async () => {
      mockReadFile.mockResolvedValueOnce("");

      // Empty string parses as invalid JSON, so should return null
      const result = await loadChatSession("/workspace", "my-skill", "reasoning");
      expect(result).toBeNull();
    });

    it("preserves all message fields including optional agentId", async () => {
      const sessionWithAgent: ChatSession = {
        sessionId: "s1",
        stepId: 4,
        messages: [
          {
            role: "assistant",
            content: "Analysis complete",
            timestamp: "2025-06-01T00:00:00.000Z",
            agentId: "agent-42",
          },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(sessionWithAgent));

      const result = await loadChatSession("/ws", "skill", "reasoning");

      expect(result?.messages[0].agentId).toBe("agent-42");
    });
  });
});
