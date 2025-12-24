import { defineWorkerActions, setupWorkerActions, defineWorkerSendEvent } from '../src/index';

const actions = defineWorkerActions({
  async add(a: number, b: number) {
    return a + b;
  },
  async print(str: string) {
    return str;
  },
  async transferBuffer(buffer: ArrayBuffer) {
    return buffer.byteLength;
  },
  async throwError() {
    throw new Error('This is a test error');
  },
  async longTimeTask(duration: number) {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(`Waited for ${duration} ms`);
      }, duration);
    });
  },
});

setupWorkerActions(actions);

export type Actions = typeof actions;

export type Events = {
  count: [value: number];
  ping: [];
};

const sender = defineWorkerSendEvent<Events>();

let count = 0;

setInterval(() => {
  sender('count', count++);
  sender('ping');
}, 100);
