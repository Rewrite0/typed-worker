// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerActions = Record<string, (...args: any[]) => Promise<unknown>>;

export type MainMessage = {
  id: number;
  name: string;
  args: unknown[];
};

export type WorkerMessage = {
  id: number;
  name: string;
  payload: unknown;
  error?: boolean;
};

export function createTypedWorker<T extends WorkerActions>(setupWorker: () => Worker) {
  let worker: Worker | null = null;
  let terminateResolve: (() => void) | null = null;
  let terminatePromise: Promise<void> | null = null;
  const queue = new Map<
    number,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: (payload: any) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  let id = 0;
  const generateId = () => ++id;

  const getWorker = () => {
    if (worker === null) {
      worker = setupWorker();
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.addEventListener('messageerror', handleError);
    }

    return worker;
  };

  function terminateWorker() {
    // 清理 worker
    if (worker) {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.removeEventListener('messageerror', handleError);
      worker.terminate();
      worker = null;
    }
  }

  // 检查是否可以完成终止
  function checkTerminateComplete() {
    if (terminatePromise && terminateResolve && queue.size === 0) {
      const resolve = terminateResolve;
      // 先清理状态
      terminateResolve = null;
      terminatePromise = null;
      id = 0;
      terminateWorker();
      // 最后 resolve
      resolve();
    }
  }

  // 任务完成时调用
  function onTaskComplete() {
    checkTerminateComplete();
  }

  function handleMessage(e: MessageEvent<WorkerMessage>) {
    const data = e.data;
    if (!queue.has(data.id)) return;

    const { resolve, reject } = queue.get(data.id)!;
    queue.delete(data.id);
    data.error ? reject(data.payload) : resolve(data.payload);

    onTaskComplete();
  }

  function handleError(e: ErrorEvent | MessageEvent) {
    console.error('Worker encountered an error', e);
    queue.forEach(({ reject }) => {
      reject(e);
    });
    queue.clear();

    onTaskComplete();
  }

  async function terminate(): Promise<void> {
    if (worker === null) return;
    // 如果已经在终止过程中，返回现有的 Promise
    if (terminatePromise) return terminatePromise;

    // 如果队列已经为空，直接终止
    if (queue.size === 0) {
      terminateWorker();
      return;
    }

    // 创建终止 Promise 并等待所有任务完成
    terminatePromise = new Promise<void>((resolve) => (terminateResolve = resolve));
    return terminatePromise;
  }

  function call<N extends keyof T>(name: N, transfer?: Transferable[]) {
    const worker = getWorker();
    return (...args: Parameters<T[N]>) =>
      new Promise<ReturnType<T[N]>>((resolve, reject) => {
        // 如果正在终止，直接拒绝新任务
        if (terminatePromise) {
          reject(new Error('Worker is terminating, cannot accept new tasks'));
          return;
        }

        const id = generateId();
        queue.set(id, { resolve, reject });

        const data: MainMessage = {
          id,
          name: name as string,
          args,
        };

        transfer ? worker.postMessage(data, transfer) : worker.postMessage(data);
      });
  }

  const result = {} as T & {
    terminate: typeof terminate;
    call: typeof call;
  };
  return new Proxy(result, {
    get(_, prop) {
      switch (prop as keyof typeof result) {
        case 'terminate':
          return terminate;
        case 'call':
          return call;
        default:
          return call(prop as keyof T);
      }
    },
    set() {
      throw new Error('Cannot set properties on typed worker proxy');
    },
  });
}

export function defineWorkerActions<T extends WorkerActions>(actions: T): T {
  return actions;
}

export function setupWorkerActions<T extends WorkerActions>(actions: T) {
  globalThis.addEventListener('message', async (e) => {
    const data = e.data as MainMessage;
    const fn = actions[data.name as keyof T];

    if (!fn) {
      globalThis.postMessage({
        id: data.id,
        name: data.name,
        payload: `Action "${data.name}" not found`,
        error: true,
      });
      return;
    }

    try {
      const result = await fn(...data.args);
      globalThis.postMessage({
        id: data.id,
        name: data.name,
        payload: result,
      } as WorkerMessage);
    } catch (err) {
      globalThis.postMessage({
        id: data.id,
        name: data.name,
        payload: err instanceof Error ? err.message : String(err),
        error: true,
      } as WorkerMessage);
    }
  });

  globalThis.addEventListener('error', (e) => {
    console.error('Worker error:', e);
  });
}
