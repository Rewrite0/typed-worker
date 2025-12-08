// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerActions = Record<string, (...args: any[]) => Promise<unknown>>;

export type WorkerSentEvents = Record<string, unknown>;

export type WorkerSentEventMessage = {
  type: 'worker-sent-event';
  name: string;
  payload: unknown;
};

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

export function createTypedWorker<
  T extends WorkerActions,
  E extends WorkerSentEvents = WorkerSentEvents
>(setupWorker: () => Worker) {
  let id = 0;
  const generateId = () => ++id;
  let worker: Worker | null = null;
  let terminateResolve: (() => void) | null = null;
  let terminatePromise: Promise<void> | null = null;
  // worker action queue
  const queue = new Map<
    number,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: (payload: any) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  // worker sent event handles
  const handles = new Map<string, Set<(payload: unknown) => void>>();

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

    if ('type' in data && data.type === 'worker-sent-event' && handles.has(data.name)) {
      // 处理 Worker 发送的事件
      const eventHandles = handles.get(data.name)!;
      Promise.all(
        Array.from(eventHandles).map((handle) => {
          try {
            handle(data.payload);
          } catch (error) {
            console.error(`Error in event handler for "${data.name}":`, error);
          }
        })
      );
      return;
    }

    if (!queue.has(data.id)) return;

    const { resolve, reject } = queue.get(data.id)!;
    queue.delete(data.id);
    data.error ? reject(data.payload) : resolve(data.payload);

    onTaskComplete();
  }

  async function handleError(e: ErrorEvent | MessageEvent) {
    console.error('Worker encountered an error', e);
    await Promise.all(Array.from(queue.values()).map(({ reject }) => reject(e)));
    queue.clear();

    onTaskComplete();
  }

  /**
   * graceful terminate worker
   */
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

  /**
   * call worker action
   * @param name action name
   * @param transfer [option] transferable objects
   * @example
   * ```ts
   * const buffer = new ArrayBuffer(1024);
   * await worker.call('processData', [buffer])(data, buffer);
   * console.log(buffer.byteLength); // 0 - buffer has been transferred
   * ```
   */
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
   * listen to worker sent events
   * @param name event name
   * @param handler event handler
   */
  function onWSE<N extends keyof E>(name: N, handler: (payload: E[N]) => void) {
    // ensure worker is created
    getWorker();

    if (!handles.has(name as string)) {
      handles.set(name as string, new Set());
    }
    const eventHandles = handles.get(name as string)!;
    eventHandles.add(handler as (payload: unknown) => void);

    return () => offWSE(name, handler);
  }

  function offWSE<N extends keyof E>(name: N, handler: (payload: E[N]) => void) {
    if (!handles.has(name as string)) return;
    const eventHandles = handles.get(name as string)!;
    eventHandles.delete(handler as (payload: unknown) => void);
  }

  /** clear all worker sent event listeners */
  function clearWSE() {
    handles.clear();
  }

  const result = {} as T & {
    terminate: typeof terminate;
    call: typeof call;
    onWSE: typeof onWSE;
    offWSE: typeof offWSE;
    clearWSE: typeof clearWSE;
  };
  return new Proxy(result, {
    get(_, prop) {
      switch (prop as keyof typeof result) {
        case 'terminate':
          return terminate;
        case 'call':
          return call;
        case 'onWSE':
          return onWSE;
        case 'offWSE':
          return offWSE;
        case 'clearWSE':
          return clearWSE;

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

export function setupWorkerSentEvent<T extends WorkerSentEvents>() {
  function emit<N extends keyof T, R = T[N]>(name: N, payload: R) {
    globalThis.postMessage({
      type: 'worker-sent-event',
      name,
      payload,
    } as WorkerSentEventMessage);
  }

  return emit;
}
