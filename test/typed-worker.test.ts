import Worker from './worker?worker';
import type { Actions } from './worker';
import { describe, test, expect } from 'vitest';
import { createTypedWorker } from '../src/index';

const worker = createTypedWorker<Actions>(() => new Worker());

describe('Typed Worker', () => {
  test('should handle multiple concurrent calls correctly', async () => {
    const tasks = Array.from({ length: 100 }, (_, i) => worker.add(i, 1).then((r) => r === i + 1));
    const results = await Promise.all(tasks);
    expect(results.every((r) => r)).toBe(true);
  });

  test('should add two numbers', async () => {
    const r1 = await worker.call('add')(2, 3);
    expect(r1).toBe(5);
    const r2 = await worker.add(4, 2);
    expect(r2).toBe(6);
  });

  test('should print a string', async () => {
    const r1 = await worker.call('print')('Hello, World!');
    expect(r1).toBe('Hello, World!');
    const r2 = await worker.print('ok');
    expect(r2).toBe('ok');
  });

  test('should transfer an ArrayBuffer', async () => {
    const buffer = new ArrayBuffer(16);
    const r1 = await worker.call('transferBuffer')(buffer);
    expect(r1).toBe(16);
    expect(buffer.byteLength).toBe(16);

    const r2 = await worker.call('transferBuffer', [buffer])(buffer);
    expect(r2).toBe(16);
    expect(buffer.byteLength).toBe(0);
  });

  test('should handle errors thrown in worker', async () => {
    await expect(worker.call('throwError')).rejects.toThrow('This is a test error');
  });

  test('should reject new tasks during termination', async () => {
    const longTask = worker.longTimeTask(1000);
    const terminatePromise = worker.terminate();

    await expect(worker.add(1, 2)).rejects.toThrow(
      'Worker is terminating, cannot accept new tasks'
    );

    const result = await longTask;
    expect(result).toBe('Waited for 1000 ms');

    await terminatePromise;
  });

  test('should handle pending tasks on termination', async () => {
    const task1 = worker.longTimeTask(1000);
    const task2 = worker.longTimeTask(1500);

    const terminatePromise = worker.terminate();

    const result1 = await task1;
    expect(result1).toBe('Waited for 1000 ms');

    const result2 = await task2;
    expect(result2).toBe('Waited for 1500 ms');

    await terminatePromise;
    // If we reach here, it means termination waited for pending tasks
    expect(true).toBe(true);
  });
});
