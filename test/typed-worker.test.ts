import Worker from './worker?worker';
import type { Actions, Events } from './worker';
import { describe, test, expect } from 'vitest';
import { createTypedWorker } from '../src/index';

const worker = createTypedWorker<Actions, Events>(() => new Worker());

describe('Typed Worker', async () => {
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
    const task1 = worker.longTimeTask(500);
    const task2 = worker.longTimeTask(800);

    const terminatePromise = worker.terminate();

    const result1 = await task1;
    expect(result1).toBe('Waited for 500 ms');

    const result2 = await task2;
    expect(result2).toBe('Waited for 800 ms');

    await terminatePromise;
    // If we reach here, it means termination waited for pending tasks
    expect(true).toBe(true);
  });

  test('should emit and receive events from worker', async () => {
    let count = 0;
    await new Promise<string>((resolve) => {
      const off = worker.onWSE('heartbeat', (payload) => {
        expect(payload).toBe('ping');
        count++;
        if (count === 3) {
          off();
          resolve(payload);
        }
      });
    });

    expect(count).toBe(3);
  });

  test('should remove event listener correctly', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let count = 0;
    const handler = () => {
      count++;
    };
    worker.onWSE('heartbeat', handler);

    // Wait for some events
    await sleep(500);
    expect(count).toBeGreaterThan(0);

    worker.offWSE('heartbeat', handler);
    const prevCount = count;

    // Wait more to see if count increases
    await sleep(500);
    expect(count).toBe(prevCount);
  });

  test('should clear all event listeners', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let count = 0;
    let count2 = 0;
    const off = worker.onWSE('heartbeat', () => {
      count++;
    });
    const off2 = worker.onWSE('heartbeat', () => {
      count2++;
    });

    // Wait for some events
    await sleep(500);
    expect(count).toBeGreaterThan(0);
    expect(count2).toBeGreaterThan(0);

    worker.clearWSE();
    const prevCount = count;
    const prevCount2 = count2;

    // Wait more to see if count increases
    await sleep(500);
    expect(count).toBe(prevCount);
    expect(count2).toBe(prevCount2);

    off(); // just to be safe
    off2();
  });

  await worker.terminate();
});
