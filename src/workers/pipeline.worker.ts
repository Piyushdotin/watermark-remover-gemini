// Dedicated pipeline worker entry (Phase 4: lifecycle + engine invocation).
// Thin adapter only: all job logic lives in `./runner.js`, which is
// unit-tested in Node. No React, no media pipeline yet (Phase 6).
import { createJobRunner } from "./runner.js";

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
}

const scope = self as unknown as WorkerScope;

const runner = createJobRunner({
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
});

scope.addEventListener("message", (event: MessageEvent) => {
  runner.handleCommand(event.data);
});

export {};
