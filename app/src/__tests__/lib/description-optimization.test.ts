import { describe, it, expect } from 'vitest';
import {
  parseProgressEvent,
  addQuery,
  removeQuery,
  updateQuery,
  scoreColor,
  scoreDelta,
  findBestIteration,
  type EvalQuery,
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

  it('accepts iteration 0 baseline with null train fields', () => {
    // Iteration 0 (baseline) runs test-set-only eval — train fields are null
    const payload = {
      iteration: 0,
      description: 'Baseline description',
      train_passed: null,
      train_total: null,
      test_passed: 7,
      test_total: 11,
    };

    const result = parseProgressEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.iteration).toBe(0);
    expect(result?.train_passed).toBeNull();
    expect(result?.train_total).toBeNull();
    expect(result?.test_passed).toBe(7);
    expect(result?.test_total).toBe(11);
  });

  it('returns null when train_passed is non-numeric non-null', () => {
    const payload = {
      iteration: 1,
      description: 'Test',
      train_passed: 'bad',
      train_total: 10,
      test_passed: 5,
      test_total: 10,
    };

    expect(parseProgressEvent(payload)).toBeNull();
  });

  it('returns null when train_total is non-numeric non-null', () => {
    const payload = {
      iteration: 1,
      description: 'Test',
      train_passed: 8,
      train_total: 'bad',
      test_passed: 5,
      test_total: 10,
    };

    expect(parseProgressEvent(payload)).toBeNull();
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

const iter0: OptimizationIteration = {
  iteration: 0, description: 'baseline', train_passed: null, train_total: null, test_passed: 5, test_total: 11,
};
const iter1: OptimizationIteration = {
  iteration: 1, description: 'v1', train_passed: 8, train_total: 13, test_passed: 7, test_total: 11,
};
const iter2: OptimizationIteration = {
  iteration: 2, description: 'v2', train_passed: 6, train_total: 13, test_passed: 6, test_total: 11,
};

describe('scoreDelta', () => {
  it('returns null for the first item (no previous)', () => {
    expect(scoreDelta(iter0, null)).toBeNull();
  });

  it('uses test score when both iterations have test scores', () => {
    // iter1 test=7/11≈0.636, iter0 test=5/11≈0.455 → delta≈0.182
    const delta = scoreDelta(iter1, iter0);
    expect(delta).toBeCloseTo(7 / 11 - 5 / 11, 5);
  });

  it('falls back to train score when iteration 0 has null train but next has test', () => {
    // iter0 has test score so it uses test; iter1 also has test score
    const delta = scoreDelta(iter2, iter1);
    expect(delta).toBeCloseTo(6 / 11 - 7 / 11, 5);
  });

  it('treats null train as 0 when test is also null', () => {
    const noScores: OptimizationIteration = {
      iteration: 3, description: 'x', train_passed: null, train_total: null, test_passed: null, test_total: null,
    };
    // Falls back to scoreRate(null??0, null??0) = 0
    const delta = scoreDelta(noScores, iter1);
    expect(delta).toBeCloseTo(0 - 7 / 11, 5);
  });
});

describe('findBestIteration', () => {
  it('returns -1 for empty history', () => {
    expect(findBestIteration([])).toBe(-1);
  });

  it('picks highest test score across iterations including iteration 0', () => {
    const history = [iter0, iter1, iter2];
    // iter0=5/11≈0.45, iter1=7/11≈0.636, iter2=6/11≈0.545 → best is index 1
    expect(findBestIteration(history)).toBe(1);
  });

  it('iteration 0 is best when no later candidate improves', () => {
    const lowIter: OptimizationIteration = {
      iteration: 1, description: 'worse', train_passed: 5, train_total: 13, test_passed: 3, test_total: 11,
    };
    expect(findBestIteration([iter0, lowIter])).toBe(0);
  });
});
