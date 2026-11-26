import { ControllerSettings } from '../controller';

export type RoughHardwareTier =
  | 'software_emulated'
  | 'constrained_integrated'
  | 'standard_desktop'
  | 'high_throughput';

export interface RoughHardwareProfile {
  tier: RoughHardwareTier;
  label: string;
  confidence: 'low' | 'medium';
  isFallbackAdapter: boolean;
  isMobileOrTouch: boolean;
  cores: number;
  deviceMemoryGB?: number;
  maxStorageBufferMB?: number;
  maxTextureSize?: number;
  viewportMegaPixels: number;
  signalsSummary: string;
}

export interface WatchdogBaselineTargets {
  healthyTargetFps: number;
  drasticMinFps: number;
  severeFrameMs: number;
  relativeCollapseRatio: number;
  gpuQueueHangMs: number;
  sustainedWindowMs: number;
  maxRenderCpuMs: number;
}

/**
 * Estimates a rough hardware profile without pretending to pinpoint an exact GPU model
 * (modern browsers generalize/mask adapter identifiers for privacy).
 */
export async function estimateRoughHardwareProfile(adapter?: any): Promise<RoughHardwareProfile> {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  const deviceMemoryGB = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? Number((navigator as any).deviceMemory)
    : undefined;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const isMobileOrTouch = /Android|iPhone|iPad|iPod/i.test(ua) || maxTouch > 1;

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight || 720 : 720;
  const viewportMegaPixels = Number(((vw * vh * dpr * dpr) / 1_000_000).toFixed(2));

  let isFallbackAdapter = false;
  let maxStorageBufferMB: number | undefined;
  let maxTextureSize: number | undefined;
  let hintString = '';
  let hasAdvancedFeatures = false;

  // 1. Inspect WebGPU adapter limits & coarse capabilities if available
  try {
    let activeAdapter = adapter;
    if (!activeAdapter && typeof navigator !== 'undefined' && (navigator as any).gpu) {
      activeAdapter = await (navigator as any).gpu
        .requestAdapter({ powerPreference: 'high-performance' })
        .catch(() => null);
    }

    if (activeAdapter) {
      const info = activeAdapter.info || {};
      isFallbackAdapter = Boolean(
        activeAdapter.isFallbackAdapter || info.isFallbackAdapter
      );
      hintString = `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''} ${info.device || ''}`.toLowerCase();

      if (activeAdapter.limits) {
        if (activeAdapter.limits.maxStorageBufferBindingSize) {
          maxStorageBufferMB = Math.round(
            activeAdapter.limits.maxStorageBufferBindingSize / (1024 * 1024)
          );
        }
        if (activeAdapter.limits.maxTextureDimension2D) {
          maxTextureSize = activeAdapter.limits.maxTextureDimension2D;
        }
      }

      if (activeAdapter.features && typeof activeAdapter.features.has === 'function') {
        const f16 = activeAdapter.features.has('shader-f16');
        const floatFilter = activeAdapter.features.has('float32-filterable');
        const subgroups = activeAdapter.features.has('subgroups');
        hasAdvancedFeatures = Boolean(f16 || (floatFilter && subgroups));
      }
    }
  } catch {
    // Keep non-fatal fallback estimation
  }

  // 2. Ultra-light coarse hint probe via disposable WebGL context (immediately released)
  let glRendererHint = '';
  if (typeof document !== 'undefined') {
    try {
      const probeCanvas = document.createElement('canvas');
      const gl = (probeCanvas.getContext('webgl2') ||
        probeCanvas.getContext('webgl')) as WebGLRenderingContext | null;
      if (gl) {
        if (!maxTextureSize) {
          maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        }
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          glRendererHint = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch {
      // Ignore probe failure
    }
  }

  const combinedHints = `${hintString} ${glRendererHint}`;
  const isSoftwareHint =
    isFallbackAdapter ||
    /swiftshader|llvmpipe|softpipe|basic render|warp|cpu|software/i.test(combinedHints);
  const isDiscreteHint =
    /rtx|gtx|radeon\s+rx\s*[5-9]\d{3}|arc\s+[ab]\d{3}|apple\s+m[1-9]|geforce/i.test(combinedHints);
  const isIntegratedHint =
    /intel.*(?:uhd|hd|iris|graphics)|mali|adreno|powervr|vega\s*[3-9]|vega\s*1[01]|integrated/i.test(
      combinedHints
    );

  // 3. Classify into rough hardware tier
  let tier: RoughHardwareTier = 'standard_desktop';
  let confidence: 'low' | 'medium' = 'low';

  if (isSoftwareHint) {
    tier = 'software_emulated';
    confidence = 'medium';
  } else if (
    isMobileOrTouch ||
    isIntegratedHint ||
    cores <= 4 ||
    (deviceMemoryGB !== undefined && deviceMemoryGB <= 4) ||
    (maxStorageBufferMB !== undefined && maxStorageBufferMB <= 128)
  ) {
    tier = 'constrained_integrated';
    confidence = isIntegratedHint || isMobileOrTouch ? 'medium' : 'low';
  } else if (
    (isDiscreteHint || (maxStorageBufferMB !== undefined && maxStorageBufferMB >= 1024 && hasAdvancedFeatures)) &&
    cores >= 8 &&
    (deviceMemoryGB === undefined || deviceMemoryGB >= 8)
  ) {
    tier = 'high_throughput';
    confidence = isDiscreteHint ? 'medium' : 'low';
  } else {
    tier = 'standard_desktop';
    confidence = 'low';
  }

  const labelMap: Record<RoughHardwareTier, string> = {
    software_emulated: 'Software / CPU Rasterizer Estimate',
    constrained_integrated: 'Integrated / Low-Power Estimate',
    standard_desktop: 'Standard Desktop GPU Estimate',
    high_throughput: 'High-Throughput GPU Estimate',
  };

  return {
    tier,
    label: labelMap[tier],
    confidence,
    isFallbackAdapter,
    isMobileOrTouch,
    cores,
    deviceMemoryGB,
    maxStorageBufferMB,
    maxTextureSize,
    viewportMegaPixels,
    signalsSummary: `${cores} threads${deviceMemoryGB ? ` · ~${deviceMemoryGB}GB RAM` : ''}${maxStorageBufferMB ? ` · ${maxStorageBufferMB}MB SSBO` : ''}`,
  };
}

/**
 * Computes profile-calibrated real-time framerate & GPU stall thresholds
 * taking active post-processing / upscaling load into account.
 */
export function computeWatchdogTargets(
  profile: RoughHardwareProfile,
  settings: ControllerSettings
): WatchdogBaselineTargets {
  let healthyTargetFps = 50;
  let drasticMinFps = 16;
  let severeFrameMs = 82;
  let relativeCollapseRatio = 0.36;
  let gpuQueueHangMs = 2000;
  let sustainedWindowMs = 2300;
  let maxRenderCpuMs = 85;

  switch (profile.tier) {
    case 'high_throughput':
      healthyTargetFps = 58;
      drasticMinFps = 20;
      severeFrameMs = 66;
      relativeCollapseRatio = 0.38;
      gpuQueueHangMs = 1700;
      sustainedWindowMs = 2100;
      maxRenderCpuMs = 70;
      break;
    case 'standard_desktop':
      healthyTargetFps = 48;
      drasticMinFps = 16;
      severeFrameMs = 82;
      relativeCollapseRatio = 0.36;
      gpuQueueHangMs = 2000;
      sustainedWindowMs = 2300;
      maxRenderCpuMs = 85;
      break;
    case 'constrained_integrated':
      healthyTargetFps = 30;
      drasticMinFps = 10;
      severeFrameMs = 115;
      relativeCollapseRatio = 0.34;
      gpuQueueHangMs = 2500;
      sustainedWindowMs = 2600;
      maxRenderCpuMs = 105;
      break;
    case 'software_emulated':
      healthyTargetFps = 18;
      drasticMinFps = 8;
      severeFrameMs = 135;
      relativeCollapseRatio = 0.35;
      gpuQueueHangMs = 2800;
      sustainedWindowMs = 2400;
      maxRenderCpuMs = 120;
      break;
  }

  // Factor in intentional graphics load so heavy presets don't cause false positives
  // while still catching severe choking.
  let loadScale = 1.0;
  if (settings.webGpuUpscalingPreset === 'native') loadScale *= 0.88;
  else if (settings.webGpuUpscalingPreset === 'ultra_quality') loadScale *= 0.94;

  if (settings.graphicsPreset === 'Ultra' || (settings.gtaoQuality === 'ultra' && settings.ssrQuality === 'ultra')) {
    loadScale *= 0.88;
  } else if (settings.graphicsPreset === 'High') {
    loadScale *= 0.94;
  }

  // High-resolution Retina/4K viewports allow slightly more frame budget
  if (profile.viewportMegaPixels > 4.5 && settings.webGpuUpscalingPreset === 'native') {
    loadScale *= 0.88;
  }

  drasticMinFps = Math.max(7, Math.round(drasticMinFps * loadScale));
  severeFrameMs = Math.round(severeFrameMs / Math.max(0.75, loadScale));

  return {
    healthyTargetFps,
    drasticMinFps,
    severeFrameMs,
    relativeCollapseRatio,
    gpuQueueHangMs,
    sustainedWindowMs,
    maxRenderCpuMs,
  };
}
