// PHASE 0 stub — proves the Next.js build can compile a Dedicated Worker
// entry. Real pipeline arrives in Phase 4. Responds to "ping" only.

self.addEventListener("message", (event: MessageEvent) => {
  if (event.data === "ping") {
    self.postMessage("pong");
  }
});

export {};
