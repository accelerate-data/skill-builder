import { describe, it, expect, beforeEach } from "vitest";
import {
  getEvalsRunning,
  setEvalsRunning,
  getEvalsStopping,
  setEvalsStopping,
} from "@/lib/eval-running-state";

beforeEach(() => {
  setEvalsRunning(false);
  setEvalsStopping(false);
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
});
