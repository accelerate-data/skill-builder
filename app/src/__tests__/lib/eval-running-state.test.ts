import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getEvalsRunning,
  setEvalsRunning,
  getEvalsStopping,
  setEvalsStopping,
  setEvalsCancelHandler,
  requestEvalsCancel,
  subscribeEvalsRunning,
  subscribeEvalsStopping,
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

  describe("subscribeEvalsRunning", () => {
    it("notifies subscribers when running state changes", () => {
      const fn = vi.fn();
      const unsub = subscribeEvalsRunning(fn);
      setEvalsRunning(true);
      expect(fn).toHaveBeenCalledWith(true);
      setEvalsRunning(false);
      expect(fn).toHaveBeenCalledWith(false);
      unsub();
    });

    it("does not notify after unsubscribe", () => {
      const fn = vi.fn();
      const unsub = subscribeEvalsRunning(fn);
      unsub();
      setEvalsRunning(true);
      expect(fn).not.toHaveBeenCalled();
    });

    it("notifies multiple subscribers", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      subscribeEvalsRunning(fn1);
      subscribeEvalsRunning(fn2);
      setEvalsRunning(true);
      expect(fn1).toHaveBeenCalledWith(true);
      expect(fn2).toHaveBeenCalledWith(true);
    });
  });

  describe("subscribeEvalsStopping", () => {
    it("notifies subscribers when stopping state changes", () => {
      const fn = vi.fn();
      const unsub = subscribeEvalsStopping(fn);
      setEvalsStopping(true);
      expect(fn).toHaveBeenCalledWith(true);
      setEvalsStopping(false);
      expect(fn).toHaveBeenCalledWith(false);
      unsub();
    });

    it("does not notify after unsubscribe", () => {
      const fn = vi.fn();
      const unsub = subscribeEvalsStopping(fn);
      unsub();
      setEvalsStopping(true);
      expect(fn).not.toHaveBeenCalled();
    });

    it("notifies multiple subscribers", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      subscribeEvalsStopping(fn1);
      subscribeEvalsStopping(fn2);
      setEvalsStopping(true);
      expect(fn1).toHaveBeenCalledWith(true);
      expect(fn2).toHaveBeenCalledWith(true);
    });
  });
});
