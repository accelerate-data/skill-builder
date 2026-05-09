import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getEvalsRunning,
  setEvalsRunning,
  getEvalsStopping,
  setEvalsStopping,
  setEvalsCancelHandler,
  requestEvalsCancel,
} from "@/lib/eval-running-state";

beforeEach(() => {
  setEvalsRunning(false);
  setEvalsStopping(false);
  setEvalsCancelHandler(null);
});

describe("eval-running-state", () => {
  describe("isStopping", () => {
    it("setEvalsStopping toggles the stopping flag", () => {
      setEvalsStopping(true);
      expect(getEvalsStopping()).toBe(true);
      setEvalsStopping(false);
      expect(getEvalsStopping()).toBe(false);
    });

    it("setEvalsRunning clears isStopping", () => {
      setEvalsStopping(true);
      setEvalsRunning(true);
      expect(getEvalsStopping()).toBe(false);
    });

    it("defaults to false", () => {
      expect(getEvalsStopping()).toBe(false);
    });
  });

  describe("cancel handler", () => {
    it("requestEvalsCancel calls the handler when set", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      setEvalsCancelHandler(handler);
      await requestEvalsCancel();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("requestEvalsCancel does nothing when no handler is set", async () => {
      await expect(requestEvalsCancel()).resolves.toBeUndefined();
    });

    it("setEvalsCancelHandler replaces the previous handler", async () => {
      const first = vi.fn().mockResolvedValue(undefined);
      const second = vi.fn().mockResolvedValue(undefined);
      setEvalsCancelHandler(first);
      setEvalsCancelHandler(second);
      await requestEvalsCancel();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("setEvalsCancelHandler(null) clears the handler", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      setEvalsCancelHandler(handler);
      setEvalsCancelHandler(null);
      await requestEvalsCancel();
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
