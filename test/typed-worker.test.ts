import Worker from './worker?worker';
import type { Actions } from './worker';
import { describe, test, expect } from 'vitest';
import { createTypedWorker } from '../src/index';

const worker = createTypedWorker<Actions>(() => new Worker());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  test('should handle event listeners with onEvent', async () => {
    let countValue = -1;
    let pingReceived = false;

    const countUnsubscribe = worker.onEvent('count', (value) => {
      countValue = value;
    });

    const pingUnsubscribe = worker.onEvent('ping', () => {
      pingReceived = true;
    });

    // Wait for events to be emitted
    await sleep(250);

    expect(countValue).toBeGreaterThanOrEqual(0);
    expect(pingReceived).toBe(true);

    countUnsubscribe();
    pingUnsubscribe();
  });

  test('should remove specific event listener with offEvent', async () => {
    let count1 = -1;
    let count2 = -1;

    const handler1 = (value: number) => {
      count1 = value;
    };
    const handler2 = (value: number) => {
      count2 = value;
    };

    worker.onEvent('count', handler1);
    worker.onEvent('count', handler2);

    // Wait for events
    await sleep(150);

    const firstValue2 = count2;

    // Remove only handler1
    worker.offEvent('count', handler1);

    // Reset and wait for more events
    count1 = -1;
    count2 = -1;
    await sleep(150);

    expect(count1).toBe(-1); // Should not have changed
    expect(count2).toBeGreaterThan(firstValue2); // Should have updated

    worker.offEvent('count', handler2);
  });

  test('should clear all event listeners with clearEvents', async () => {
    let countReceived = false;
    let pingReceived = false;

    worker.onEvent('count', () => {
      countReceived = true;
    });
    worker.onEvent('ping', () => {
      pingReceived = true;
    });

    // Wait for events
    await sleep(150);

    expect(countReceived).toBe(true);
    expect(pingReceived).toBe(true);

    // Clear all events and reset flags
    worker.clearEvents();
    countReceived = false;
    pingReceived = false;

    // Wait again
    await sleep(150);

    expect(countReceived).toBe(false);
    expect(pingReceived).toBe(false);
  });

  test('should handle multiple listeners for the same event', async () => {
    const values: number[] = [];
    const moreValues: number[] = [];

    worker.onEvent('count', (value) => values.push(value));
    worker.onEvent('count', (value) => moreValues.push(value * 2));

    await sleep(250);

    expect(values.length).toBeGreaterThan(0);
    expect(moreValues.length).toBe(values.length);
    expect(moreValues[0]).toBe(values[0] * 2);

    worker.clearEvents();
  });

  test('should handle event listener removal that does not exist', () => {
    const handler = () => {};

    // Should not throw when removing non-existent handler
    expect(() => worker.offEvent('count', handler)).not.toThrow();
    expect(() => worker.offEvent('nonexistent' as any, handler)).not.toThrow();
  });
});
