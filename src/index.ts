// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerActions = Record<string, (...args: any[]) => Promise<unknown>>;
export type WorkerEvents = Record<string, any[]>;

export type MainMessage = {
  id: number;
  name: string;
  args: unknown[];
};

export type WorkerMessage =
  | {
      id: number;
      name: string;
      payload: unknown;
      error?: boolean;
    }
  | {
      type: 'worker-send-event';
      name: string;
      payload: unknown[];
    };

export function createTypedWorker<T extends WorkerActions, E extends WorkerEvents = WorkerEvents>(
  setupWorker: () => Worker
) {
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
  const eventListeners = new Map<keyof E, Set<(...args: any[]) => void>>();
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

    // 处理event消息
    if ('type' in data) {
      if (data.type !== 'worker-send-event' || !eventListeners.has(data.name)) return;
      const listeners = eventListeners.get(data.name)!;
      listeners.forEach((listener) => {
        listener(...data.payload);
      });
      return;
    }

    // 处理 action 消息
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

  /**
   * 移除指定事件的监听器
   * @param name event name
   * @param listener event listener
   */
  function offEvent<N extends keyof E>(name: N, listener: (...args: E[N]) => void) {
    if (!eventListeners.has(name)) return;
    eventListeners.get(name)!.delete(listener);
  }
  /**
   * 监听worker推送的事件
   * @param name event name
   * @param listener event listener
   * @returns 用于移除监听器的函数
   */
  function onEvent<N extends keyof E>(name: N, listener: (...args: E[N]) => void) {
    getWorker();
    if (!eventListeners.has(name)) {
      eventListeners.set(name, new Set());
    }
    eventListeners.get(name)!.add(listener);

    return () => offEvent(name, listener);
  }

  /**
   * 清除指定事件的所有监听器
   * @param name event name
   */
  function clearEvents<N extends keyof E>(name: N): void;
  /**
   * 清除所有事件的所有监听器
   */
  function clearEvents(): void;
  function clearEvents<N extends keyof E>(name?: N): void {
    if (name !== void 0) {
      eventListeners.delete(name);
    } else {
      eventListeners.clear();
    }
  }

  const result = {} as T & {
    terminate: typeof terminate;
    call: typeof call;
    onEvent: typeof onEvent;
    offEvent: typeof offEvent;
    clearEvents: typeof clearEvents;
  };
  return new Proxy(result, {
    get(_, prop) {
      switch (prop as keyof typeof result) {
        case 'terminate':
          return terminate;
        case 'call':
          return call;
        case 'onEvent':
          return onEvent;
        case 'offEvent':
          return offEvent;
        case 'clearEvents':
          return clearEvents;
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

export function defineWorkerSendEvent<T extends WorkerEvents>() {
  async function sender<N extends keyof T>(name: N, ...payload: T[N]) {
    globalThis.postMessage({
      type: 'worker-send-event',
      name,
      payload,
    });
  }

  return sender;
}
