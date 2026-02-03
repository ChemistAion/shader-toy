# WebGL2 → CPU → AudioWorklet (MessagePort-only) Streaming Pipeline
*(Anchored to `rc_plan.md` + `audioworklet.md` Stage7B “need → render → push” model; updated for **no SharedArrayBuffer** in VS Code webview.)*

## 0) Scope & invariants (from RC constraints)

- **Audio output is AudioWorklet-only.** If worklet init fails/unavailable: compile shaders, **emit no audio**, surface VS Code error.
- **No “self-sound” special semantics.** Sound sources are only those declared by `#iSoundN`.
- **Do not invent a parallel uniform universe.** Sound shaders are driven by the standardized set:
  - `iAudioTime`
  - `iSampleRate`
  - `iSampleBlockSize`
  - `iSampleRingDepth`
  - plus existing `#iSoundN` / `#iSampleN` directives as already defined in HEAD.

The goal here is the complete machinery breakdown for **streaming** with **MessagePort + Transferables**, since in VS Code webviews:
- `self.crossOriginIsolated === false`
- `SharedArrayBuffer` is not available

---

## 1) High-level architecture

```
┌──────────────────────────────────────────┐
│ Main Thread (Webview)                    │
│                                          │
│  ┌───────────────┐   ┌───────────────┐  │
│  │ WebGL2 GPU     │   │ Readback      │  │
│  │ Block Renderer │──►│ (PBO+Fence)   │  │
│  └───────┬───────┘   └───────┬───────┘  │
│          │                   │          │
│          │ fills Transferable│          │
│          ▼   ArrayBuffers    ▼          │
│      ┌───────────────────────────┐      │
│      │ BufferPool (leased bufs)  │      │
│      └───────────┬───────────────┘      │
│                  │ postMessage(push)     │
└──────────────────┼──────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ Audio Rendering Thread (AudioWorklet)    │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Incoming Block Queue (FIFO)        │  │
│  │  - blocks are Transferables        │  │
│  │  - no allocations in process()     │  │
│  └───────────────┬────────────────────┘  │
│                  │ consume 128 frames     │
│                  ▼                        │
│            process(): outputs[2][128]     │
│                  │                        │
│                  └─ recycle buffers back  │
└──────────────────────────────────────────┘
```

Key idea: **Worklet pulls** when low (“need”), main thread responds by generating **one or more blocks** and pushing them (“push”). Worklet outputs **exactly 128 frames per process()**, always.

---

## 2) Block sizing: “GPU block size” vs Worklet quantum

- AudioWorklet quantum is effectively fixed at **128 frames** per `process()` call.
- To reduce message frequency and jitter, the GPU renderer should typically produce blocks that are **multiples of 128**:
  - 128, 256, 512, 1024…

Recommended defaults:
- **GPU block size:** 512 frames (good stability; moderate latency)
- **Render-ahead target:** 2–4 quanta (256–512 frames) minimum in the worklet queue
- Expose a user setting for GPU block size; report its algorithmic block latency:
  - `block_ms = 1000 * blockSize / iSampleRate`

---

## 3) Audio timebase: derive sample index from `iAudioTime` (no new uniforms)

### 3.1 Worklet is the clock
The worklet maintains:
- `playheadSample`: global sample index of the **next** sample it will output
- `queueFrames`: number of frames currently buffered in the incoming block queue

When the queue drops below a low watermark, the worklet asks for more:

- `wantBaseSample = playheadSample + queueFrames`

Main thread renders new samples starting at `wantBaseSample`:
- `iAudioTime = wantBaseSample / iSampleRate`
- `iSampleBlockSize = blockSize`

### 3.2 Shader per-fragment indexing
In the sound fragment shader (block viewport `blockW×blockH` where `blockW*blockH = iSampleBlockSize`):

- `i = x + y * blockW`
- `baseSample = floor(iAudioTime * iSampleRate)`
- `sampleIndex = baseSample + i`
- `sampleTime = sampleIndex / iSampleRate`
- `vec2 lr = mainSound(sampleIndex, sampleTime)`

No additional uniforms are required to align audio to the worklet clock.

---

## 4) Message protocol (MessagePort-only, Transferables)

### 4.1 Message types

**Main → Worklet**
- `init`
  - `{ type: "init", sampleRate, channels: 2, quantum: 128, blockSize }`
- `push`
  - `{ type: "push", buffer, frames, baseSample, layout }` + Transferable `[buffer]`
  - `layout`: `"planarLR"` (recommended) or `"interleavedLR"`
- `ctl` (optional)
  - play/pause, gain, reset, etc.

**Worklet → Main**
- `ready`
  - `{ type: "ready" }`
- `need`
  - `{ type: "need", wantBaseSample, framesWanted, queueFrames, underruns }`
- `recycle`
  - `{ type: "recycle", buffer }` + Transferable `[buffer]`
- `stats` (throttled)
  - `{ type: "stats", playheadSample, queueFrames, underruns }`

### 4.2 Buffer ownership rules
- A buffer is **owned by exactly one side at a time**.
- `push`: main transfers ownership to worklet (main’s buffer becomes detached).
- `recycle`: worklet transfers ownership back to main.

This provides a zero-copy-ish path with predictable allocations.

---

## 5) Buffer format & pooling

### 5.1 Recommended layout: planar stereo in one ArrayBuffer
For a block of `N` frames:

- buffer byte length: `N * 2 * 4` (Float32, 2 channels)
- views:
  - `L = new Float32Array(buffer, 0, N)`
  - `R = new Float32Array(buffer, N*4, N)`

Advantages:
- Worklet copies L and R directly into `outputs[0][0]` and `outputs[0][1]` with simple indexing.
- No deinterleaving math in the audio thread hot loop.

### 5.2 Pool sizing
Pick pool size so main can keep producing even if a few buffers are “in flight”:

- `poolCount = 4..8` typical
- `poolCount >= 2 + ceil(renderAheadFrames / blockSize)`

Keep buffers reusable:
- Allocate once at startup or when blockSize changes.
- Reuse via `recycle`.

---

## 6) Worklet side: implementation details

### 6.1 State
- `blockSize` (frames per pushed block; can accept varying sizes but prefer fixed)
- `queue`: FIFO of block descriptors
- `underruns` counter
- `playheadSample`
- `queueFrames` (maintained incrementally, not recomputed)

Block descriptor fields:
- `buffer` (ArrayBuffer)
- `L`, `R` (Float32Array views created on receipt)
- `frames` (N)
- `readPos` (0..N)

### 6.2 onmessage handler (keep it light)
- On `push`:
  - Create typed array views for L/R (small/cheap)
  - Append block descriptor to FIFO
  - `queueFrames += frames`
- On `init`:
  - Store sampleRate/blockSize, reset state
  - Post `ready`
- On `ctl` (pause/reset):
  - Handle state changes; optionally flush FIFO

### 6.3 process() hot loop (must never allocate)
For each `process()` call:
- Need to output exactly `quantum = 128` frames
- While framesRemaining > 0:
  - If FIFO not empty:
    - Copy `k = min(framesRemaining, block.frames - readPos)`
    - For j in [0..k-1]:
      - `outL[outPos+j] = block.L[readPos+j]`
      - `outR[outPos+j] = block.R[readPos+j]`
    - Advance `readPos`, `outPos`, reduce `framesRemaining`, `queueFrames -= k`
    - If block fully consumed:
      - Transfer `buffer` back via `recycle` (outside the tightest inner loop if possible)
      - Pop FIFO
  - Else (underrun):
    - Fill remaining output with 0
    - `underruns++`
    - break
- Advance `playheadSample += quantum`

### 6.4 Requesting more audio (“need”)
Use watermarks:
- `lowWaterFrames` (e.g., 256 or 384)
- `targetFillFrames` (e.g., 512 or 1024)

When `queueFrames < lowWaterFrames`, post:
- `framesWanted = max(targetFillFrames - queueFrames, blockSize)`
- `wantBaseSample = playheadSample + queueFrames`

Throttle “need” messages:
- Don’t post a new one if a previous `need` is still outstanding (track `needInFlight`).
- Clear `needInFlight` when at least one new block arrives.

---

## 7) Main thread: scheduler + GPU renderer + readback

### 7.1 Main thread state
- `audioCtx.sampleRate` → `iSampleRate`
- `blockSize` user setting (multiple of 128 recommended)
- BufferPool:
  - `freeBuffers: ArrayBuffer[]`
  - `inFlightGPU: {buffer, fence, pbo, baseSample, frames}[]`
- Worklet handshake:
  - `workletReady` boolean
  - `needQueue` or a simple “last need” record

### 7.2 Worklet-driven scheduling (“need” handler)
On `need(wantBaseSample, framesWanted)`:
- Determine how many blocks to render:
  - `blocks = ceil(framesWanted / blockSize)`
- For each block:
  - Acquire a free buffer from pool
    - If none: render fewer blocks and log “pool starvation”
  - Schedule GPU render for base sample:
    - `baseSample = wantBaseSample + renderedSoFar`
    - `iAudioTime = baseSample / sampleRate`
    - `iSampleBlockSize = blockSize`
  - Render + readback into that buffer
  - When buffer is filled, `postMessage(push)` with transferable

Important: Do not render on-demand “just in time”. Always attempt to keep the queue above the target fill.

---

## 8) WebGL2 GPU block render & readback (summary)

*(This section assumes your existing “block renderer + cache + queue-driven streaming” from Stage7B; the goal is to show how it plugs into the MessagePort buffer leasing.)*

### 8.1 Render block into a small FBO texture
- Set viewport to `blockW×blockH` where `blockW*blockH = blockSize`.
- Fragment shader writes `vec4(L,R,0,0)` per texel.

### 8.2 Readback into PBO + fence (avoid stalls)
- Bind `PIXEL_PACK_BUFFER`
- `gl.readPixels(...)` into PBO
- `gl.fenceSync(...)` after issuing readPixels
- Later (poll):
  - if fence signaled → `gl.getBufferSubData(...)` into the leased ArrayBuffer’s Float32Array views

### 8.3 Fill the transfer buffer
Convert GPU readback format to `planarLR`:

- If readback is RGBA float:
  - For each sample i:
    - `L[i] = rgba[4*i+0]`
    - `R[i] = rgba[4*i+1]`

Then `postMessage(push, [buffer])` to the worklet.

---

## 9) Hot reload behavior (worklet lives, generator changes)

The worklet should remain alive; only the generator changes.

Recommended reload sequence:
1. Main thread sets a “reloading” flag and stops responding to `need`.
2. Optionally send `ctl.pause` to worklet (or keep playing with existing queued audio).
3. Recompile shaders + rebuild GPU pipeline.
4. Flush old queued buffers:
   - Either:
     - `ctl.reset` + return any buffers in worklet FIFO via `recycle`
   - Or:
     - soft-seek: continue at current playheadSample but accept discontinuity
5. Clear “reloading” flag; worklet will request audio again via `need`.

---

## 10) Diagnostics & tuning

Expose these counters in the webview UI:
- `underruns` (worklet-side)
- `queueFrames` (worklet-side)
- `poolFree` / `poolInFlight` (main thread)
- “need rate” (messages/sec), “push rate”

Tuning knobs:
- `blockSize` (128–1024)
- `lowWaterFrames` (256–512)
- `targetFillFrames` (512–2048)
- `poolCount` (4–8)

Rule of thumb:
- If underruns occur:
  - increase `targetFillFrames`
  - increase `poolCount`
  - increase `blockSize` (lower message frequency)
  - optimize GPU readback latency

---

## 11) Minimal pseudo-code sketches

### 11.1 Worklet (conceptual)

```js
// audio_worklet_processor.js
class GPUBlockPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queueFrames = 0;
    this.playheadSample = 0;
    this.underruns = 0;
    this.needInFlight = false;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "init") { /* store config; post ready */ }
      if (m.type === "push") {
        const N = m.frames;
        const buf = m.buffer;
        const L = new Float32Array(buf, 0, N);
        const R = new Float32Array(buf, N*4, N);
        this.queue.push({ buf, L, R, N, p: 0 });
        this.queueFrames += N;
        this.needInFlight = false;
      }
      if (m.type === "ctl") { /* pause/reset */ }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const outL = out[0];
    const outR = out[1] || out[0]; // mono fallback

    let remaining = 128;
    let o = 0;

    while (remaining > 0) {
      const b = this.queue[0];
      if (!b) {
        // underrun
        for (let i = 0; i < remaining; i++) { outL[o+i] = 0; outR[o+i] = 0; }
        this.underruns++;
        break;
      }

      const avail = b.N - b.p;
      const k = avail < remaining ? avail : remaining;

      for (let i = 0; i < k; i++) {
        outL[o+i] = b.L[b.p+i];
        outR[o+i] = b.R[b.p+i];
      }

      b.p += k;
      this.queueFrames -= k;
      o += k;
      remaining -= k;

      if (b.p === b.N) {
        // recycle buffer to main thread
        this.port.postMessage({ type: "recycle", buffer: b.buf }, [b.buf]);
        this.queue.shift();
      }
    }

    this.playheadSample += 128;

    // ask for more if low (throttled)
    const lowWater = 256;
    const target = 1024;
    if (!this.needInFlight && this.queueFrames < lowWater) {
      this.needInFlight = true;
      const wantBase = this.playheadSample + this.queueFrames;
      const wantFrames = target - this.queueFrames;
      this.port.postMessage({
        type: "need",
        wantBaseSample: wantBase,
        framesWanted: wantFrames,
        queueFrames: this.queueFrames,
        underruns: this.underruns
      });
    }

    return true;
  }
}
registerProcessor("gpu-block-player", GPUBlockPlayer);
```

### 11.2 Main thread (conceptual)

```js
worklet.port.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "recycle") pool.free(m.buffer);
  if (m.type === "need") {
    const blocks = Math.ceil(m.framesWanted / blockSize);
    for (let k = 0; k < blocks; k++) {
      const buf = pool.take();
      if (!buf) break;
      const baseSample = m.wantBaseSample + k*blockSize;
      await renderGpuBlockIntoBuffer(buf, baseSample, blockSize);
      worklet.port.postMessage(
        { type: "push", buffer: buf, frames: blockSize, baseSample, layout: "planarLR" },
        [buf]
      );
    }
  }
};
```

---

## 12) Reference notes (URLs kept in code blocks)

```text
Chrome AudioWorklet design pattern (ring buffers + 128 quantum):
https://developer.chrome.com/blog/audio-worklet-design-pattern/

AudioWorkletProcessor.process() 128-frame quantum note:
https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process

Cross-origin isolation (why SharedArrayBuffer is missing):
https://web.dev/articles/coop-coep

WebGL best practices (readPixels stalls; use PBO/fences where possible):
https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
```
