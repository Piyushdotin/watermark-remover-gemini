# `src/lib/processing` — Job orchestration (main thread)

`ProcessingController`: job state machine, worker lifetime, object-URL registry,
worker-event → UI-state mapping. Talks to the worker via protocol messages only.
No pixel or engine-math imports.
