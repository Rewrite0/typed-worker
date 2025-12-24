# @rewrite0/typed-worker

一个类型安全的 Web Worker 包装器，提供简洁的 API 和完整的 TypeScript 支持。

## 特性

- 🔒 **类型安全** - 完整的 TypeScript 类型推导和校验
- 🚀 **简单易用** - 简洁直观的 API 设计
- 🔄 **并发支持** - 能够正确处理并发任务，确保输入输出的一致性
- ⚡ **懒加载** - Worker 只在第一次调用时初始化
- 📦 **轻量级** - 零依赖
- 🛡️ **错误处理** - 完整的错误处理
- 📤 **Transferable 对象** - 支持数据所有权转移
- 🔧 **优雅关闭** - 等待所有未完成任务后安全关闭 Worker，关闭期间拒绝新任务
- 📡 **事件监听** - 支持监听 Worker 主动向主线程推送的事件
- 🎯 **事件管理** - 完整的事件监听器管理，支持添加、移除和清理

## 安装

```bash
npm install @rewrite0/typed-worker
```

或使用 pnpm：

```bash
pnpm add @rewrite0/typed-worker
```

## 使用案例

### 1. 定义 Worker 操作

首先创建一个 worker 文件 (`worker.ts`)：

```typescript
import { defineWorkerActions, setupWorkerActions, defineWorkerSendEvent } from '@rewrite0/typed-worker';

// 定义事件类型并导出
export type Events = {
  progress: [percent: number, message: string];
  status: [status: 'idle' | 'working' | 'completed'];
  notification: [message: string];
  ping: [];
};

// 定义事件发送方法
const sender = defineWorkerSendEvent<Events>();

// 定期发送心跳事件
setInterval(() => sender('ping'), 2000);

const actions = defineWorkerActions({
  async add(a: number, b: number) {
    return a + b;
  },
  async processData(data: string) {
    // 模拟重计算任务
    await new Promise(resolve => setTimeout(resolve, 1000));
    return data.toUpperCase();
  },
  async transferBuffer(buffer: ArrayBuffer) {
    // 处理 ArrayBuffer
    return buffer.byteLength;
  },
  async riskyOperation() {
    throw new Error('Something went wrong');
  },
  async longTimeTask(duration: number) {
    const sender = defineWorkerSendEvent<Events>();

    // 发送开始状态
    sender('status', 'working');
    sender('progress', 0, '开始任务...');

    // 模拟任务进度
    for (let i = 0; i <= 100; i += 25) {
      await new Promise(resolve => setTimeout(resolve, duration / 4));
      sender('progress', i, `进度: ${i}%`);
    }

    sender('status', 'completed');
    sender('notification', '任务完成！');
    return duration;
  },
});

setupWorkerActions(actions);

// 导出类型以供主线程使用
export type Actions = typeof actions;
```

### 2. 在主线程中使用

```typescript
import { createTypedWorker } from '@rewrite0/typed-worker';
import Worker from './worker?worker'; // Vite 风格导入
import type { Actions, Events } from './worker'; // 导入类型

// 创建类型安全的 worker 实例，支持事件监听
const worker = createTypedWorker<Actions, Events>(() => new Worker());

// 第一次调用时才会创建和初始化 Worker 实例
const result = await worker.add(1, 2); // Worker 在此时创建

// 直接调用方法 - 完整的类型推导
const result1 = await worker.add(2, 3); // number
const result2 = await worker.processData('hello'); // string

// action抛出的错误会被正常catch
try {
  await worker.riskyOperation();
} catch (error) {
  console.error(error.message); // "Something went wrong"
}

// 使用 call 方法进行所有权转移（Transferable）
const buffer = new ArrayBuffer(16);
console.log(buffer.byteLength) // 16
await worker.call('transferBuffer', [buffer])(buffer);
console.log(buffer.byteLength); // 0 - buffer 已被转移

// 如果不需要所有权转移，直接调用方法
const buffer2 = new ArrayBuffer(1024 * 1024);
await worker.transferBuffer(buffer2);
console.log(buffer2.byteLength); // 1048576 - buffer 仍然可用

// 正确处理多个并发任务
const tasks = Array.from({ length: 100 }, (_, i) =>
  worker.add(i, 1)
);

const results = await Promise.all(tasks);
console.log(results); // [1, 2, 3, ..., 100]

// 优雅关闭 worker (会等待所有未完成任务完毕后关闭, 在关闭等待期间，任何新的任务请求都会被直接拒绝)
// 启动一些任务
const task1 = worker.longTimeTask(1000);
const task2 = worker.longTimeTask(1500);

// 开始关闭流程
const terminatePromise = worker.terminate();

// 在关闭等待期间尝试添加新任务会被拒绝
try {
  await worker.add(1, 2); // 抛出错误：Worker is terminating
} catch (error) {
  console.log(error.message); // "Worker is terminating, cannot accept new tasks"
}

// 正常完成任务
console.log(await task1) // 1000
console.log(await task2) // 1500
await terminatePromise // 等待关闭
console.log('ok') // ok

// 事件监听使用示例
// 监听任务进度
const unsubscribeProgress = worker.onEvent('progress', (percent, message) => {
  console.log(`${percent}%: ${message}`);
});

// 监听状态变化
worker.onEvent('status', (status) => {
  console.log(`状态变更: ${status}`);
});

// 监听通知消息
worker.onEvent('notification', (message) => {
  console.log(`通知: ${message}`);
});

// 监听心跳事件
let heartbeatCount = 0;
const heartbeatHandler = () => {
  heartbeatCount++;
  console.log(`心跳 #${heartbeatCount}`);
};
worker.onEvent('ping', heartbeatHandler);

// 执行长时间任务，观察事件
await worker.longTimeTask(2000);

// 移除特定监听器
unsubscribeProgress(); // 通过返回的函数移除
worker.offEvent('ping', heartbeatHandler); // 通过 offEvent 移除

// 清除所有事件监听器
worker.clearEvents();
```

## API 参考

### 核心 API

- `createTypedWorker<Actions, Events>(setupWorker)` - 创建类型安全的 Worker 实例
- `defineWorkerActions(actions)` - 定义 Worker 操作
- `setupWorkerActions(actions)` - 设置 Worker 操作
- `defineWorkerSendEvent<Events>()` - 创建事件发送函数

### Worker 实例方法

- `call(actionName, transferableObjects?)` - 调用方法并支持 Transferable 对象
- `terminate()` - 优雅关闭 Worker
- `onEvent(eventName, listener)` - 监听事件
- `offEvent(eventName, listener)` - 移除事件监听器
- `clearEvents(eventName?)` - 清除事件监听器
