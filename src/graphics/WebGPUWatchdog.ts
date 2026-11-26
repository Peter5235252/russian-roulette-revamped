import { ControllerSettings } from '../controller';
import {
  RoughHardwareProfile,
  WatchdogBaselineTargets,
  computeWatchdogTargets,
} from './RoughHardwareProfile';

export interface WebGPUFailureReport {
  reason: string;
  category: 'device_lost' | 'corruption' | 'queue_hang' | 'fps_collapse';
  details: string;
  observedFps?: number;
  baselineFps?: number;
  hardwareTier: string;
}

const RING_SIZE = 120;

export class WebGPUWatchdog {
  private isAttached = false;
  private hasTriggered = false;
  private renderer: any = null;
  private device: any = null;
  private profile: RoughHardwareProfile | null = null;
  private targets: WatchdogBaselineTargets | null = null;
  private onTrigger: ((report: WebGPUFailureReport) => void) | null = null;

  // Ring buffer telemetry (zero per-frame allocations)
  private frameTimesMs = new Float64Array(RING_SIZE);
  private frameTimestampsMs = new Float64Array(RING_SIZE);
  private renderCpuTimesMs = new Float64Array(RING_SIZE);
  private ringHead = 0;
  private ringCount = 0;

  // Rolling baseline & error counters
  private baselineFps = 0;
  private baselineHealthySamples = 0;
  private uncapturedErrorTimestamps: number[] = [];
  private consecutiveRenderFailures = 0;
  private renderExceptionTimestamps: number[] = [];

  // Async GPU queue probe state
  private gpuProbePending = false;
  private gpuProbeStartMs = 0;
  private lastGpuProbeSentMs = 0;
  private slowQueueStreak = 0;

  // Visibility & grace windows to prevent false positives on tab switch / shader rebuild
  private isTabHidden = false;
  private wasHiddenRecently = false;
  private graceUntilMs = 0;
  private lastVisibilityHandler: (() => void) | null = null;
  private uncapturedErrorHandler: ((ev: any) => void) | null = null;

  public attach(
    renderer: any,
    profile: RoughHardwareProfile,
    settings: ControllerSettings,
    onTrigger: (report: WebGPUFailureReport) => void
  ) {
    this.detach();

    this.renderer = renderer;
    this.device = renderer?.backend?.device || null;
    this.profile = profile;
    this.targets = computeWatchdogTargets(profile, settings);
    this.onTrigger = onTrigger;
    this.isAttached = true;
    this.hasTriggered = false;

    this.ringHead = 0;
    this.ringCount = 0;
    this.baselineFps = 0;
    this.baselineHealthySamples = 0;
    this.uncapturedErrorTimestamps = [];
    this.consecutiveRenderFailures = 0;
    this.renderExceptionTimestamps = [];
    this.gpuProbePending = false;
    this.gpuProbeStartMs = 0;
    this.lastGpuProbeSentMs = performance.now();
    this.slowQueueStreak = 0;

    this.isTabHidden = typeof document !== 'undefined' ? document.hidden : false;
    this.wasHiddenRecently = false;
    // Initial 3.0s grace period right after startup shader compilation
    this.graceUntilMs = performance.now() + 3000;

    if (typeof document !== 'undefined') {
      this.lastVisibilityHandler = () => {
        if (document.hidden) {
          this.isTabHidden = true;
          this.wasHiddenRecently = true;
          this.gpuProbePending = false;
        } else {
          this.isTabHidden = false;
          this.wasHiddenRecently = true;
          this.grantGracePeriod(2200);
        }
      };
      document.addEventListener('visibilitychange', this.lastVisibilityHandler);
    }

    // 1. Device Lost watcher
    if (this.device?.lost && typeof this.device.lost.then === 'function') {
      const boundDevice = this.device;
      this.device.lost.then((info: any) => {
        if (!this.isAttached || this.hasTriggered || this.device !== boundDevice) return;
        if (info?.reason !== 'destroyed') {
          this.fireFallback({
            reason: 'WebGPU device lost mid-gameplay',
            category: 'device_lost',
            details: info?.message || `Device lost (${info?.reason || 'unknown'})`,
            hardwareTier: this.profile?.label || 'Unknown',
          });
        }
      });
    }

    // 2. Uncaptured GPU errors watcher (OOM, WGSL validation, internal corruption)
    if (this.device && typeof this.device.addEventListener === 'function') {
      this.uncapturedErrorHandler = (event: any) => {
        if (!this.isAttached || this.hasTriggered) return;
        const err = event?.error;
        const name = String(err?.constructor?.name || '');
        const msg = String(err?.message || 'Uncaptured WebGPU error');

        if (name === 'GPUOutOfMemoryError' || /out of memory/i.test(msg)) {
          this.fireFallback({
            reason: 'WebGPU out-of-memory fault detected',
            category: 'corruption',
            details: msg,
            hardwareTier: this.profile?.label || 'Unknown',
          });
          return;
        }

        const now = performance.now();
        this.uncapturedErrorTimestamps.push(now);
        this.uncapturedErrorTimestamps = this.uncapturedErrorTimestamps.filter(
          (t) => now - t <= 6000
        );

        if (this.uncapturedErrorTimestamps.length >= 3) {
          this.fireFallback({
            reason: 'Repeated WebGPU pipeline/shader corruption errors',
            category: 'corruption',
            details: msg,
            hardwareTier: this.profile?.label || 'Unknown',
          });
        }
      };
      this.device.addEventListener('uncapturederror', this.uncapturedErrorHandler);
    }
  }

  public updateSettings(settings: ControllerSettings) {
    if (!this.profile) return;
    this.targets = computeWatchdogTargets(this.profile, settings);
    // Grant grace period for live shader pipeline graph rebuilds
    this.grantGracePeriod(2200);
  }

  public grantGracePeriod(durationMs: number) {
    const until = performance.now() + durationMs;
    if (until > this.graceUntilMs) {
      this.graceUntilMs = until;
    }
  }

  public recordRenderError(err: unknown) {
    if (!this.isAttached || this.hasTriggered) return;
    const now = performance.now();
    this.renderExceptionTimestamps.push(now);
    this.renderExceptionTimestamps = this.renderExceptionTimestamps.filter(
      (t) => now - t <= 3500
    );
    const msg = err instanceof Error ? err.message : String(err || 'Render exception');

    if (this.renderExceptionTimestamps.length >= 4) {
      this.fireFallback({
        reason: 'WebGPU render pass threw repeated exceptions',
        category: 'corruption',
        details: msg,
        hardwareTier: this.profile?.label || 'Unknown',
      });
    }
  }

  /**
   * Called once per rendered animation frame after rendering completes.
   */
  public recordFrame(
    nowMs: number,
    rawFrameIntervalMs: number,
    renderCpuMs: number,
    frameFailedCompletely: boolean
  ) {
    if (!this.isAttached || this.hasTriggered || !this.profile || !this.targets) return;

    if (this.isTabHidden || (typeof document !== 'undefined' && document.hidden)) {
      this.wasHiddenRecently = true;
      return;
    }

    if (frameFailedCompletely) {
      this.consecutiveRenderFailures++;
      if (this.consecutiveRenderFailures >= 2) {
        this.fireFallback({
          reason: 'WebGPU failed consecutive frame renders',
          category: 'corruption',
          details: 'Primary and direct fallback render paths failed consecutively.',
          hardwareTier: this.profile.label,
        });
        return;
      }
    } else {
      this.consecutiveRenderFailures = 0;
    }

    // Check GPU command queue probe status
    this.checkAndDispatchGpuQueueProbe(nowMs);
    if (this.hasTriggered) return;

    // Ignore first frame interval immediately after tab resume or OS sleep spikes (> 5s)
    if (this.wasHiddenRecently) {
      this.wasHiddenRecently = false;
      return;
    }
    if (rawFrameIntervalMs > 5000 || rawFrameIntervalMs <= 0) {
      return;
    }

    // Ignore FPS collapse checks during startup / settings grace windows
    if (nowMs < this.graceUntilMs) {
      return;
    }

    // Push frame telemetry into circular buffer
    this.frameTimesMs[this.ringHead] = rawFrameIntervalMs;
    this.frameTimestampsMs[this.ringHead] = nowMs;
    this.renderCpuTimesMs[this.ringHead] = renderCpuMs;
    this.ringHead = (this.ringHead + 1) % RING_SIZE;
    if (this.ringCount < RING_SIZE) this.ringCount++;

    // Need enough samples spanning the sustained choke evaluation window
    if (this.ringCount < 14) return;

    const targets = this.targets;
    const windowMs = targets.sustainedWindowMs;
    const maxFrameBudgetForFloor = 1000 / targets.drasticMinFps;

    let windowFrames = 0;
    let windowElapsedSum = 0;
    let windowSlowFloorFrames = 0;
    let windowSevereFrames = 0;
    let renderCpuSum = 0;
    let newestTs = nowMs;
    let oldestIncludedTs = nowMs;

    for (let i = 0; i < this.ringCount; i++) {
      const idx = (this.ringHead - 1 - i + RING_SIZE) % RING_SIZE;
      const ts = this.frameTimestampsMs[idx];
      if (newestTs - ts > windowMs) break;

      const dtMs = this.frameTimesMs[idx];
      const cpuMs = this.renderCpuTimesMs[idx];
      oldestIncludedTs = ts;
      windowFrames++;
      windowElapsedSum += dtMs;
      renderCpuSum += cpuMs;

      if (dtMs >= maxFrameBudgetForFloor) {
        windowSlowFloorFrames++;
      }
      if (dtMs >= targets.severeFrameMs) {
        windowSevereFrames++;
      }
    }

    const coveredSpanMs = newestTs - oldestIncludedTs;
    if (windowFrames < 10 || coveredSpanMs < windowMs * 0.72) {
      return;
    }

    const windowFps = (windowFrames * 1000) / Math.max(1, windowElapsedSum);
    const avgRenderCpuMs = renderCpuSum / windowFrames;
    const slowFloorFraction = windowSlowFloorFrames / windowFrames;
    const severeFraction = windowSevereFrames / windowFrames;

    // Update calibrated healthy baseline ONLY when current performance is healthy
    if (windowFps >= targets.drasticMinFps * 1.35 && severeFraction < 0.25) {
      if (this.baselineFps <= 0) {
        this.baselineFps = windowFps;
      } else {
        this.baselineFps = this.baselineFps * 0.92 + windowFps * 0.08;
      }
      this.baselineHealthySamples += 1;
    }

    // Condition 1: Sustained catastrophic drop below hardware profile minimum FPS floor
    if (windowFps < targets.drasticMinFps && slowFloorFraction >= 0.72) {
      this.fireFallback({
        reason: `Severe WebGPU framerate collapse (${windowFps.toFixed(1)} FPS for ${this.profile.label})`,
        category: 'fps_collapse',
        details: `Sustained ${windowFps.toFixed(1)} FPS over ${(coveredSpanMs / 1000).toFixed(1)}s (expected ≥${targets.drasticMinFps} FPS).`,
        observedFps: Number(windowFps.toFixed(1)),
        baselineFps: this.baselineFps > 0 ? Number(this.baselineFps.toFixed(1)) : undefined,
        hardwareTier: this.profile.label,
      });
      return;
    }

    // Condition 2: Drastic unusual drop relative to established smooth WebGPU baseline
    if (
      this.baselineHealthySamples >= 35 &&
      this.baselineFps >= 28 &&
      windowFps < this.baselineFps * targets.relativeCollapseRatio &&
      severeFraction >= 0.72
    ) {
      this.fireFallback({
        reason: `Unusual WebGPU performance drop (${this.baselineFps.toFixed(0)} → ${windowFps.toFixed(1)} FPS)`,
        category: 'fps_collapse',
        details: `Dropped ${Math.round((1 - windowFps / this.baselineFps) * 100)}% below calibrated session baseline.`,
        observedFps: Number(windowFps.toFixed(1)),
        baselineFps: Number(this.baselineFps.toFixed(1)),
        hardwareTier: this.profile.label,
      });
      return;
    }

    // Condition 3: Severe GPU command submission stall on CPU render thread
    if (windowFrames >= 16 && avgRenderCpuMs > targets.maxRenderCpuMs) {
      this.fireFallback({
        reason: `WebGPU frame submission choking (${avgRenderCpuMs.toFixed(0)}ms avg render time)`,
        category: 'fps_collapse',
        details: `Average render pass submission latency ${avgRenderCpuMs.toFixed(1)}ms exceeds ${targets.maxRenderCpuMs}ms threshold.`,
        observedFps: Number(windowFps.toFixed(1)),
        baselineFps: this.baselineFps > 0 ? Number(this.baselineFps.toFixed(1)) : undefined,
        hardwareTier: this.profile.label,
      });
    }
  }

  private checkAndDispatchGpuQueueProbe(nowMs: number) {
    if (!this.targets || !this.device?.queue || typeof this.device.queue.onSubmittedWorkDone !== 'function') {
      return;
    }

    // Check active pending probe for timeout/hang
    if (this.gpuProbePending) {
      const pendingMs = nowMs - this.gpuProbeStartMs;
      if (pendingMs > this.targets.gpuQueueHangMs) {
        this.fireFallback({
          reason: `WebGPU GPU queue hang detected (${Math.round(pendingMs)}ms without retirement)`,
          category: 'queue_hang',
          details: `GPU queue.onSubmittedWorkDone() failed to complete within ${this.targets.gpuQueueHangMs}ms.`,
          hardwareTier: this.profile?.label || 'Unknown',
        });
      }
      return;
    }

    if (nowMs < this.graceUntilMs) return;
    if (nowMs - this.lastGpuProbeSentMs < 1200) return;

    const boundDevice = this.device;
    this.gpuProbePending = true;
    this.gpuProbeStartMs = nowMs;
    this.lastGpuProbeSentMs = nowMs;

    try {
      this.device.queue.onSubmittedWorkDone().then(
        () => {
          if (!this.isAttached || this.hasTriggered || this.device !== boundDevice) return;
          const drainMs = performance.now() - this.gpuProbeStartMs;
          this.gpuProbePending = false;

          if (drainMs > 550 && !this.isTabHidden) {
            this.slowQueueStreak++;
            if (this.slowQueueStreak >= 3) {
              this.fireFallback({
                reason: `WebGPU command queue severely backed up (${Math.round(drainMs)}ms GPU latency)`,
                category: 'queue_hang',
                details: 'Three consecutive GPU queue probes exceeded 550ms execution latency.',
                hardwareTier: this.profile?.label || 'Unknown',
              });
            }
          } else {
            this.slowQueueStreak = 0;
          }
        },
        (err: any) => {
          if (!this.isAttached || this.hasTriggered || this.device !== boundDevice) return;
          this.gpuProbePending = false;
          this.fireFallback({
            reason: 'WebGPU queue synchronization rejected',
            category: 'queue_hang',
            details: err?.message || 'onSubmittedWorkDone promise rejected',
            hardwareTier: this.profile?.label || 'Unknown',
          });
        }
      );
    } catch {
      this.gpuProbePending = false;
    }
  }

  private fireFallback(report: WebGPUFailureReport) {
    if (this.hasTriggered || !this.isAttached) return;
    this.hasTriggered = true;
    const cb = this.onTrigger;
    this.detach();
    cb?.(report);
  }

  public detach() {
    this.isAttached = false;
    if (this.lastVisibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.lastVisibilityHandler);
      this.lastVisibilityHandler = null;
    }
    if (this.device && this.uncapturedErrorHandler && typeof this.device.removeEventListener === 'function') {
      try {
        this.device.removeEventListener('uncapturederror', this.uncapturedErrorHandler);
      } catch {
        // Ignore cleanup errors on lost device
      }
    }
    this.uncapturedErrorHandler = null;
    this.renderer = null;
    this.device = null;
    this.onTrigger = null;
    this.gpuProbePending = false;
  }
}
