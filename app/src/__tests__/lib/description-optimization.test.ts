import { describe, it, expect } from 'vitest';
import {
  parseProgressEvent,
  addQuery,
  removeQuery,
  updateQuery,
  scoreColor,
  computeDiff,
  getBestIteration,
  type EvalQuery,
  type DiffPart,
  type OptimizationIteration,
} from '@/lib/description-optimization';

describe('parseProgressEvent', () => {
  it('returns iteration from valid progress event', () => {
    const payload = {
      iteration: 1,
      description: 'Test description',
      train_passed: 8,
      train_total: 10,
      test_passed: 7,
      test_total: 10,
    };

    const result = parseProgressEvent(payload);

    expect(result).not.toBeNull();
    expect(result).toEqual({
      iteration: 1,
      description: 'Test description',
      train_passed: 8,
      train_total: 10,
      test_passed: 7,
      test_total: 10,
    });
  });

  it('returns null for missing iteration field', () => {
    const payload = {
      description: 'Test description',
      train_passed: 8,
      train_total: 10,
      test_passed: 7,
      test_total: 10,
    };

    const result = parseProgressEvent(payload);
    expect(result).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseProgressEvent(null)).toBeNull();
    expect(parseProgressEvent(undefined)).toBeNull();
    expect(parseProgressEvent('string')).toBeNull();
    expect(parseProgressEvent(123)).toBeNull();
  });

  it('handles null test scores gracefully', () => {
    const payload = {
      iteration: 2,
      description: 'Another test',
      train_passed: 9,
      train_total: 10,
      test_passed: null,
      test_total: null,
    };

    const result = parseProgressEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.test_passed).toBeNull();
    expect(result?.test_total).toBeNull();
  });

  it('returns null when test_passed is non-numeric non-null', () => {
    const payload = {
      iteration: 1,
      description: 'Test',
      train_passed: 8,
      train_total: 10,
      test_passed: 'invalid',
      test_total: 5,
    };

    const result = parseProgressEvent(payload);
    expect(result).toBeNull();
  });

  it('returns null when test_total is non-numeric non-null', () => {
    const payload = {
      iteration: 1,
      description: 'Test',
      train_passed: 8,
      train_total: 10,
      test_passed: 5,
      test_total: 'invalid',
    };

    const result = parseProgressEvent(payload);
    expect(result).toBeNull();
  });
});

describe('addQuery', () => {
  it('appends a new blank query with unique id', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'First', should_trigger: true },
      { id: '2', query: 'Second', should_trigger: false },
    ];

    const result = addQuery(original);

    expect(result.length).toBe(3);
    expect(result[0]).toEqual(original[0]);
    expect(result[1]).toEqual(original[1]);
    expect(result[2]).toEqual({
      id: expect.any(String),
      query: '',
      should_trigger: true,
    });
  });

  it('generates a UUID-like id for new query', () => {
    const result = addQuery([]);

    expect(result[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('does not mutate original array', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Test', should_trigger: true },
    ];

    const originalLength = original.length;
    addQuery(original);

    expect(original.length).toBe(originalLength);
  });

  it('produces unique ids on successive calls', () => {
    let arr: EvalQuery[] = [];
    arr = addQuery(arr);
    const id1 = arr[0].id;

    arr = addQuery(arr);
    const id2 = arr[1].id;

    expect(id1).not.toBe(id2);
  });
});

describe('removeQuery', () => {
  it('removes query by id', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'First', should_trigger: true },
      { id: '2', query: 'Second', should_trigger: false },
      { id: '3', query: 'Third', should_trigger: true },
    ];

    const result = removeQuery(original, '2');

    expect(result).toHaveLength(2);
    expect(result.map((q) => q.id)).toEqual(['1', '3']);
  });

  it('returns same array when id not found', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Test', should_trigger: true },
    ];

    const result = removeQuery(original, 'nonexistent');

    expect(result).toBe(original);
  });

  it('does not mutate original array', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'First', should_trigger: true },
      { id: '2', query: 'Second', should_trigger: false },
    ];

    removeQuery(original, '1');

    expect(original).toHaveLength(2);
    expect(original[0].id).toBe('1');
  });
});

describe('updateQuery', () => {
  it('updates query text', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Old text', should_trigger: true },
    ];

    const result = updateQuery(original, '1', { query: 'New text' });

    expect(result[0].query).toBe('New text');
    expect(result[0].should_trigger).toBe(true);
  });

  it('updates should_trigger toggle', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Test', should_trigger: true },
    ];

    const result = updateQuery(original, '1', { should_trigger: false });

    expect(result[0].should_trigger).toBe(false);
    expect(result[0].query).toBe('Test');
  });

  it('updates multiple fields in one call', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Test', should_trigger: true },
    ];

    const result = updateQuery(original, '1', {
      query: 'Updated',
      should_trigger: false,
    });

    expect(result[0]).toEqual({
      id: '1',
      query: 'Updated',
      should_trigger: false,
    });
  });

  it('does not mutate original array', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Test', should_trigger: true },
    ];

    updateQuery(original, '1', { query: 'New text' });

    expect(original[0].query).toBe('Test');
  });

  it('leaves other queries unchanged', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'First', should_trigger: true },
      { id: '2', query: 'Second', should_trigger: false },
      { id: '3', query: 'Third', should_trigger: true },
    ];

    const result = updateQuery(original, '2', { query: 'Updated' });

    expect(result[0]).toEqual(original[0]);
    expect(result[1]).toEqual({ id: '2', query: 'Updated', should_trigger: false });
    expect(result[2]).toEqual(original[2]);
  });

  it('returns same array when id not found', () => {
    const original: EvalQuery[] = [
      { id: '1', query: 'Test', should_trigger: true },
    ];

    const result = updateQuery(original, 'nonexistent', { query: 'New' });

    expect(result).toBe(original);
  });
});

describe('scoreColor', () => {
  it('returns seafoam for high score (>=80%)', () => {
    expect(scoreColor(8, 10)).toBe('text-[var(--color-seafoam)]');
    expect(scoreColor(80, 100)).toBe('text-[var(--color-seafoam)]');
    expect(scoreColor(4, 5)).toBe('text-[var(--color-seafoam)]');
    expect(scoreColor(1, 1)).toBe('text-[var(--color-seafoam)]');
  });

  it('returns amber for medium score (>=60% and <80%)', () => {
    expect(scoreColor(6, 10)).toBe('text-amber-600 dark:text-amber-400');
    expect(scoreColor(60, 100)).toBe('text-amber-600 dark:text-amber-400');
    expect(scoreColor(3, 5)).toBe('text-amber-600 dark:text-amber-400');
    expect(scoreColor(7, 10)).toBe('text-amber-600 dark:text-amber-400');
    expect(scoreColor(79, 100)).toBe('text-amber-600 dark:text-amber-400');
  });

  it('returns destructive for low score (<60%)', () => {
    expect(scoreColor(5, 10)).toBe('text-destructive');
    expect(scoreColor(0, 10)).toBe('text-destructive');
    expect(scoreColor(59, 100)).toBe('text-destructive');
    expect(scoreColor(1, 5)).toBe('text-destructive');
  });

  it('handles 0/0 gracefully (returns muted-foreground)', () => {
    expect(scoreColor(0, 0)).toBe('text-muted-foreground');
  });

  it('handles fractional scores', () => {
    expect(scoreColor(0.8, 1)).toBe('text-[var(--color-seafoam)]');
    expect(scoreColor(0.6, 1)).toBe('text-amber-600 dark:text-amber-400');
    expect(scoreColor(0.5, 1)).toBe('text-destructive');
  });
});

describe('computeDiff', () => {
  it('identical strings → all parts have type unchanged and combined text equals input', () => {
    const input = 'A skill for handling tickets';
    const parts = computeDiff(input, input);

    expect(parts.every((p: DiffPart) => p.type === 'unchanged')).toBe(true);
    expect(parts.map((p: DiffPart) => p.text).join('')).toBe(input);
  });

  it('completely different strings → original tokens all deleted, best tokens all inserted', () => {
    const original = 'alpha';
    const best = 'beta';
    const parts = computeDiff(original, best);

    const types = parts.map((p: DiffPart) => p.type);
    expect(types).not.toContain('unchanged');
    const deletedText = parts
      .filter((p: DiffPart) => p.type === 'deleted')
      .map((p: DiffPart) => p.text)
      .join('');
    const insertedText = parts
      .filter((p: DiffPart) => p.type === 'inserted')
      .map((p: DiffPart) => p.text)
      .join('');
    expect(deletedText).toBe(original);
    expect(insertedText).toBe(best);
  });

  it('all deleted when best is empty string', () => {
    const original = 'some text here';
    const parts = computeDiff(original, '');

    expect(parts.every((p: DiffPart) => p.type === 'deleted')).toBe(true);
    expect(parts.map((p: DiffPart) => p.text).join('')).toBe(original);
  });

  it('all inserted when original is empty string', () => {
    const best = 'some text here';
    const parts = computeDiff('', best);

    expect(parts.every((p: DiffPart) => p.type === 'inserted')).toBe(true);
    expect(parts.map((p: DiffPart) => p.text).join('')).toBe(best);
  });

  it('mixed diff: result contains unchanged, deleted, and inserted parts with correct reconstruction', () => {
    const original = 'A skill for handling tickets';
    const best = 'Use when a customer needs help';
    const parts = computeDiff(original, best);

    const types = new Set(parts.map((p: DiffPart) => p.type));
    expect(types.has('unchanged') || types.has('deleted') || types.has('inserted')).toBe(true);

    const deletedAndUnchanged = parts
      .filter((p: DiffPart) => p.type !== 'inserted')
      .map((p: DiffPart) => p.text)
      .join('');
    expect(deletedAndUnchanged).toBe(original);

    const insertedAndUnchanged = parts
      .filter((p: DiffPart) => p.type !== 'deleted')
      .map((p: DiffPart) => p.text)
      .join('');
    expect(insertedAndUnchanged).toBe(best);
  });

  it('single word unchanged in middle: handle and now unchanged, tickets deleted, forms inserted', () => {
    const original = 'handle tickets now';
    const best = 'handle forms now';
    const parts = computeDiff(original, best);

    const unchangedTexts = parts
      .filter((p: DiffPart) => p.type === 'unchanged')
      .map((p: DiffPart) => p.text);
    const deletedTexts = parts
      .filter((p: DiffPart) => p.type === 'deleted')
      .map((p: DiffPart) => p.text);
    const insertedTexts = parts
      .filter((p: DiffPart) => p.type === 'inserted')
      .map((p: DiffPart) => p.text);

    expect(unchangedTexts.join('')).toContain('handle');
    expect(unchangedTexts.join('')).toContain('now');
    expect(deletedTexts.join('')).toContain('tickets');
    expect(insertedTexts.join('')).toContain('forms');

    const deletedAndUnchanged = parts
      .filter((p: DiffPart) => p.type !== 'inserted')
      .map((p: DiffPart) => p.text)
      .join('');
    expect(deletedAndUnchanged).toBe(original);

    const insertedAndUnchanged = parts
      .filter((p: DiffPart) => p.type !== 'deleted')
      .map((p: DiffPart) => p.text)
      .join('');
    expect(insertedAndUnchanged).toBe(best);
  });
});

describe('getBestIteration', () => {
  function makeIter(
    iteration: number,
    trainPassed: number,
    trainTotal: number,
    testPassed: number | null = null,
    testTotal: number | null = null
  ): OptimizationIteration {
    return {
      iteration,
      description: `desc-${iteration}`,
      train_passed: trainPassed,
      train_total: trainTotal,
      test_passed: testPassed,
      test_total: testTotal,
    };
  }

  it('empty array → returns 0', () => {
    expect(getBestIteration([])).toBe(0);
  });

  it('single entry → returns 0', () => {
    expect(getBestIteration([makeIter(1, 5, 10, 5, 10)])).toBe(0);
  });

  it('multiple entries with test scores → winner is the highest test score ratio', () => {
    const history = [
      makeIter(1, 5, 10, 5, 10),  // test score 0.5
      makeIter(2, 8, 10, 8, 10),  // test score 0.8 ← winner
      makeIter(3, 9, 10, 7, 10),  // test score 0.7
    ];
    expect(getBestIteration(history)).toBe(1);
  });

  it('test scores absent → falls back to train score', () => {
    const history = [
      makeIter(1, 5, 10),  // train score 0.5
      makeIter(2, 8, 10),  // train score 0.8 ← winner
      makeIter(3, 7, 10),  // train score 0.7
    ];
    expect(getBestIteration(history)).toBe(1);
  });

  it('tie-breaking: later iteration wins', () => {
    const history = [
      makeIter(1, 8, 10, 8, 10),  // test score 0.8
      makeIter(2, 8, 10, 8, 10),  // test score 0.8 ← later, wins tie
    ];
    expect(getBestIteration(history)).toBe(1);
  });
});
