import { defineWorkerActions, setupWorkerActions, setupWorkerSentEvent } from '../src/index';

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
  heartbeat: 'ping';
};

const emit = setupWorkerSentEvent<Events>();

setInterval(() => {
  emit('heartbeat', 'ping');
}, 200);
