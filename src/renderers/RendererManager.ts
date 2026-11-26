import { WebGPURenderer } from 'three/webgpu';

let cachedWebGpuSupport: Promise<{ supported: boolean; reason?: string }> | null = null;

export interface WebGpuFallbackState {
  active: boolean;
  reason: string | null;
}

let emergencyFallbackState: WebGpuFallbackState = {
  active: false,
  reason: null,
};
const fallbackListeners = new Set<(state: WebGpuFallbackState) => void>();

export const getWebGpuEmergencyFallbackState = (): WebGpuFallbackState => emergencyFallbackState;

export const activateWebGpuEmergencyFallback = (reason: string) => {
  if (emergencyFallbackState.active) return;
  emergencyFallbackState = { active: true, reason };
  fallbackListeners.forEach((l) => l(emergencyFallbackState));
};

export const resetWebGpuEmergencyFallback = () => {
  emergencyFallbackState = { active: false, reason: null };
  fallbackListeners.forEach((l) => l(emergencyFallbackState));
};

export const subscribeWebGpuFallbackState = (
  listener: (state: WebGpuFallbackState) => void
) => {
  fallbackListeners.add(listener);
  return () => {
    fallbackListeners.delete(listener);
  };
};

export const isWebGPUSupported = async (forceRecheck: boolean = false): Promise<{ supported: boolean; reason?: string }> => {
  if (!forceRecheck && cachedWebGpuSupport) {
    return cachedWebGpuSupport;
  }

  const checkPromise = (async (): Promise<{ supported: boolean; reason?: string }> => {
    const gpu = typeof navigator !== 'undefined' ? (navigator as any).gpu : undefined;
    if (!gpu) {
      return {
        supported: false,
        reason: 'WebGPU API (navigator.gpu) is not supported or disabled in your browser.',
      };
    }
    try {
      let adapter = null;
      try {
        adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      } catch {
        // ignore and try default requestAdapter below
      }
      if (!adapter) {
        try {
          adapter = await gpu.requestAdapter();
        } catch {
          // ignore
        }
      }
      if (!adapter) {
        return {
          supported: false,
          reason: 'No compatible WebGPU adapter found on system.',
        };
      }
      return { supported: true };
    } catch (err: any) {
      return {
        supported: false,
        reason: err?.message || 'Failed to request WebGPU adapter.',
      };
    }
  })();

  cachedWebGpuSupport = checkPromise;
  return checkPromise;
};

export const createWebGPURenderer = async (
  canvas: HTMLCanvasElement,
  options?: { forceWebGL?: boolean }
) => {
  const check = await isWebGPUSupported();
  const shouldUseWebGL =
    !check.supported ||
    emergencyFallbackState.active ||
    options?.forceWebGL === true;

  if (shouldUseWebGL) {
    if (emergencyFallbackState.active || options?.forceWebGL) {
      console.warn(
        `Emergency WebGL 2.0 backend activated (${emergencyFallbackState.reason || 'runtime fallback'}).`
      );
    } else {
      console.warn(`WebGPU is unsupported (${check.reason || 'no compatible adapter'}). Forcing WebGL 2.0 backend.`);
    }
  }

  // Safety filter to silence benign WebGL context lost errors on renderer teardown
  if (typeof window !== 'undefined' && !(window as any).__deviceLostFilterInstalled) {
    (window as any).__deviceLostFilterInstalled = true;
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: any[]) => {
      if (args.length > 0 && typeof args[0] === 'string') {
        if (args[0].includes('WebGPURenderer') && args[0].includes('Device Lost')) {
          // Benign context loss during pipeline switch from WebGL to WebGPU
          return;
        }
      }
      originalConsoleError(...args);
    };
  }

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    forceWebGL: shouldUseWebGL
  });

  let isDisposed = false;

  // Override onDeviceLost to prevent verbose error spam during intentional renderer destruction
  (renderer as any).onDeviceLost = (info: any) => {
    if (isDisposed) return;
    if (info?.api === 'WebGL') {
      return;
    }
    console.warn(`[WebGPURenderer] Device loss: ${info?.message || 'unknown'}`);
  };

  const originalDispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    isDisposed = true;
    try {
      const backend = (renderer as any).backend;
      if (backend && backend._onContextLost && renderer.domElement) {
        renderer.domElement.removeEventListener('webglcontextlost', backend._onContextLost, false);
      }
    } catch (e) {}
    try {
      originalDispose();
    } catch (e) {}
  };

  await (renderer as any).init();

  return renderer;
};


