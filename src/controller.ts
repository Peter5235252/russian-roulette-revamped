export type WebGpuUpscalingPreset = 'native' | 'ultra_quality' | 'quality' | 'balanced' | 'performance';
export type ReflectionQuality = 'low' | 'medium' | 'high' | 'ultra';
export type EffectQuality = 'low' | 'medium' | 'high' | 'ultra';
export type InputType = 'kbm' | 'gamepad' | 'touch';
export type ControllerLayout = 'universal' | 'nintendo' | 'playstation' | 'xbox';
export type RemappableGamepadAction = 'confirm' | 'cancel' | 'north' | 'lt' | 'rt';

export interface ControllerSettings {
  inputType: InputType;
  controllerLayout: ControllerLayout;
  autoDetectInput: boolean;
  rightStickSensitivity: number;
  touchLookSensitivity: number;
  swapWestNorth?: boolean;
  customButtonMap?: Partial<Record<RemappableGamepadAction, number>>;
  graphicsPreset: 'Low' | 'Medium' | 'High' | 'Ultra' | 'Custom';
  antiAliasing: 'fxaa' | 'smaa';
  postProcessing: 'low' | 'high' | 'cinematic';
  shadowQuality: 'low' | 'medium' | 'high' | 'ultra';
  reflectionQuality: ReflectionQuality;
  textureFiltering: 1 | 2 | 4 | 8 | 16;
  materialEnhancements: boolean;
  materialQuality?: EffectQuality;
  bloomIntensity: number;
  gtaoEnabled?: boolean;
  gtaoQuality?: EffectQuality;
  ssrEnabled?: boolean;
  ssrQuality?: EffectQuality;
  volumetricSmokeEnabled?: boolean;
  volumetricSmokeQuality?: EffectQuality;
  gpuComputePhysics?: boolean;
  computePhysicsQuality?: EffectQuality;
  motionBlurEnabled?: boolean;
  motionBlurQuality?: EffectQuality;
  motionBlurIntensity?: number;
  bloodEffectsEnabled: boolean;
  particleQuality: 'low' | 'medium' | 'high' | 'ultra';
  brightness: number;
  rumbleEnabled: boolean;
  rumbleIntensity: number;
  polygonCount: 'low' | 'medium' | 'high' | 'ultra';
  webGpuUpscalingPreset: WebGpuUpscalingPreset;
  webGpuSharpening: number;
  showKeyboardHud?: boolean;
}

const STORAGE_KEY = 'dealer_controller_settings_v9';

const isLikelyTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const hasTouch = (navigator.maxTouchPoints || 0) > 0;
    return Boolean(coarse && hasTouch && window.innerWidth <= 1024);
  } catch {
    return false;
  }
};

const defaultSettings: ControllerSettings = {
  inputType: isLikelyTouchDevice() ? 'touch' : 'kbm',
  controllerLayout: 'xbox',
  autoDetectInput: true,
  rightStickSensitivity: 1.0,
  touchLookSensitivity: 1.0,
  swapWestNorth: false,
  customButtonMap: {},
  graphicsPreset: 'Low',
  antiAliasing: 'fxaa',
  postProcessing: 'low',
  shadowQuality: 'low',
  reflectionQuality: 'low',
  textureFiltering: 2,
  materialEnhancements: true,
  materialQuality: 'low',
  bloomIntensity: 0.2,
  gtaoEnabled: true,
  gtaoQuality: 'low',
  ssrEnabled: true,
  ssrQuality: 'low',
  volumetricSmokeEnabled: true,
  volumetricSmokeQuality: 'low',
  gpuComputePhysics: true,
  computePhysicsQuality: 'low',
  motionBlurEnabled: true,
  motionBlurQuality: 'low',
  motionBlurIntensity: 0.3,
  bloodEffectsEnabled: true,
  particleQuality: 'low',
  brightness: 1.0,
  rumbleEnabled: true,
  rumbleIntensity: 1.0,
  polygonCount: 'low',
  webGpuUpscalingPreset: 'balanced',
  webGpuSharpening: 0.6,
  showKeyboardHud: true,
};

let currentSettings: ControllerSettings = { ...defaultSettings };
let lastTouchTimestamp = 0;

const listeners = new Set<(s: ControllerSettings) => void>();

// Initialization to load saved settings
(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      delete parsed.aiProvider;
      delete parsed.aiApiKey;
      delete parsed.aiCustomModel;
      // Sanitize legacy "off" or "none" values to baseline "low" or "fxaa"
      if (parsed.antiAliasing === 'none') parsed.antiAliasing = 'fxaa';
      if (parsed.reflectionQuality === 'off') parsed.reflectionQuality = 'low';
      if (parsed.particleQuality === 'off') parsed.particleQuality = 'low';
      if (parsed.gtaoQuality === 'off') parsed.gtaoQuality = 'low';
      if (parsed.ssrQuality === 'off') parsed.ssrQuality = 'low';
      if (parsed.materialQuality === 'off') parsed.materialQuality = 'low';
      if (parsed.volumetricSmokeQuality === 'off') parsed.volumetricSmokeQuality = 'low';
      if (parsed.computePhysicsQuality === 'off') parsed.computePhysicsQuality = 'low';
      if (parsed.motionBlurQuality === 'off') parsed.motionBlurQuality = 'low';
      if (parsed.webGpuUpscalingPreset === 'off') parsed.webGpuUpscalingPreset = 'balanced';
      if (!['kbm', 'gamepad', 'touch'].includes(parsed.inputType)) {
        parsed.inputType = defaultSettings.inputType;
      }
      if (!['universal', 'nintendo', 'playstation', 'xbox'].includes(parsed.controllerLayout)) {
        parsed.controllerLayout = defaultSettings.controllerLayout;
      }
      parsed.brightness = 1.0;
      delete parsed.useWebGPU;
      delete parsed.webglForcedByUser;

      currentSettings = { ...defaultSettings, ...parsed };
      listeners.forEach(l => l(currentSettings));
    }
  } catch (e) {
    console.warn("Failed to load controller settings:", e);
  }
})();

export const getControllerSettings = () => currentSettings;

export const setControllerSettings = (s: Partial<ControllerSettings>) => {
  currentSettings = { ...currentSettings, ...s };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch (e) {
    console.warn("Failed to persist settings:", e);
  }

  listeners.forEach(l => l(currentSettings));
};

export const subscribeControllerSettings = (listener: (s: ControllerSettings) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function detectControllerLayoutFromId(id: string): ControllerLayout {
  const lower = (id || '').toLowerCase();
  if (
    lower.includes('nintendo') ||
    lower.includes('switch') ||
    lower.includes('joy-con') ||
    lower.includes('pro controller') ||
    lower.includes('057e')
  ) {
    return 'nintendo';
  }
  if (
    lower.includes('sony') ||
    lower.includes('playstation') ||
    lower.includes('dualsense') ||
    lower.includes('dualshock') ||
    lower.includes('054c')
  ) {
    return 'playstation';
  }
  if (
    lower.includes('xbox') ||
    lower.includes('xinput') ||
    lower.includes('microsoft') ||
    lower.includes('045e')
  ) {
    return 'xbox';
  }
  return 'universal';
}

export function markTouchActivity() {
  lastTouchTimestamp = performance.now();
  if (currentSettings.autoDetectInput !== false && currentSettings.inputType !== 'touch') {
    setControllerSettings({ inputType: 'touch' });
  }
}

export function markMouseOrKeyActivity() {
  // Ignore synthetic mouse events emitted right after a touch tap
  if (performance.now() - lastTouchTimestamp < 900) return;
  if (currentSettings.autoDetectInput !== false && currentSettings.inputType !== 'kbm') {
    setControllerSettings({ inputType: 'kbm' });
  }
}

export function isSyntheticMouseFromTouch(): boolean {
  return performance.now() - lastTouchTimestamp < 900;
}

export function getConnectedGamepad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const gamepads = navigator.getGamepads();
  for (const gp of gamepads) {
    if (gp && gp.connected) {
      return gp;
    }
  }
  return null;
}

export function pollGamepadAutoSwitch(): Gamepad | null {
  const gp = getConnectedGamepad();
  if (!gp) return null;

  const hasButtonInput = gp.buttons.some((b) => b && (b.pressed || b.value > 0.35));
  const hasAxisInput = gp.axes.some((a, idx) => idx < 4 && Math.abs(a) > 0.42);
  if ((hasButtonInput || hasAxisInput) && currentSettings.autoDetectInput !== false && currentSettings.inputType !== 'gamepad') {
    const detected = detectControllerLayoutFromId(gp.id);
    const nextPatch: Partial<ControllerSettings> = { inputType: 'gamepad' };
    // Auto-select matching layout only if user hasn't explicitly picked a non-default or when id is unambiguous
    if (detected !== 'universal' && !localStorage.getItem('dealer_controller_layout_manual')) {
      nextPatch.controllerLayout = detected;
    }
    setControllerSettings(nextPatch);
  }
  return currentSettings.inputType === 'gamepad' ? gp : null;
}

export function updateGamepads(): Gamepad | null {
  return pollGamepadAutoSwitch();
}

export interface SemanticGamepadState {
  confirm: boolean;   // Bottom on Xbox/PS/Universal, Right (A) on Nintendo
  cancel: boolean;    // Right on Xbox/PS/Universal, Bottom (B) on Nintendo
  west: boolean;      // Left face button (X / Square / Y)
  north: boolean;     // Top face button (Y / Triangle / X) -> Market
  lb: boolean;
  rb: boolean;
  lt: boolean;
  rt: boolean;
  select: boolean;
  start: boolean;
  dpadUp: boolean;
  dpadDown: boolean;
  dpadLeft: boolean;
  dpadRight: boolean;
  stickX: number;
  stickY: number;
  rStickX: number;
  rStickY: number;
  anyUp: boolean;
  anyDown: boolean;
  anyLeft: boolean;
  anyRight: boolean;
}

const applyDeadzone = (val: number, deadzone = 0.2): number => {
  if (Math.abs(val) < deadzone) return 0;
  const sign = Math.sign(val);
  return (sign * (Math.abs(val) - deadzone)) / (1 - deadzone);
};

const isRawBtn = (gp: Gamepad, idx: number, analogThreshold = 0.45): boolean => {
  if (idx < 0 || idx >= gp.buttons.length) return false;
  const b = gp.buttons[idx];
  return Boolean(b && (b.pressed || b.value > analogThreshold));
};

// DirectInput / Chromium HID POV hat axis decoder (axes[9] typically)
const decodePovHat = (val: number | undefined): { up: boolean; down: boolean; left: boolean; right: boolean } => {
  if (val === undefined || Number.isNaN(val) || Math.abs(val) > 1.08) {
    return { up: false, down: false, left: false, right: false };
  }
  // Standard 8-way values: N=-1.0, NE=-0.714, E=-0.429, SE=-0.143, S=+0.143, SW=+0.429, W=+0.714, NW=+1.0
  return {
    up: val <= -0.65 || val >= 0.90,
    right: val >= -0.82 && val <= -0.05,
    down: val >= -0.24 && val <= 0.52,
    left: val >= 0.34 && val <= 1.05,
  };
};

interface RawDecodedDiamond {
  south: boolean;
  east: boolean;
  west: boolean;
  north: boolean;
  lb: boolean;
  rb: boolean;
  lt: boolean;
  rt: boolean;
  select: boolean;
  start: boolean;
  dpadUp: boolean;
  dpadDown: boolean;
  dpadLeft: boolean;
  dpadRight: boolean;
  stickX: number;
  stickY: number;
  rStickX: number;
  rStickY: number;
}

function decodeStandardOrRawGamepad(gp: Gamepad): RawDecodedDiamond {
  if (gp.mapping === 'standard') {
    return {
      south: isRawBtn(gp, 0),
      east: isRawBtn(gp, 1),
      west: isRawBtn(gp, 2),
      north: isRawBtn(gp, 3),
      lb: isRawBtn(gp, 4),
      rb: isRawBtn(gp, 5),
      lt: isRawBtn(gp, 6),
      rt: isRawBtn(gp, 7),
      select: isRawBtn(gp, 8) || isRawBtn(gp, 17),
      start: isRawBtn(gp, 9),
      dpadUp: isRawBtn(gp, 12),
      dpadDown: isRawBtn(gp, 13),
      dpadLeft: isRawBtn(gp, 14),
      dpadRight: isRawBtn(gp, 15),
      stickX: applyDeadzone(gp.axes[0] ?? 0, 0.22),
      stickY: applyDeadzone(gp.axes[1] ?? 0, 0.22),
      rStickX: applyDeadzone(gp.axes[2] ?? 0, 0.18),
      rStickY: applyDeadzone(gp.axes[3] ?? 0, 0.18),
    };
  }

  const idLower = (gp.id || '').toLowerCase();
  const isSony =
    idLower.includes('sony') ||
    idLower.includes('playstation') ||
    idLower.includes('dualsense') ||
    idLower.includes('dualshock') ||
    idLower.includes('054c');
  const isNintendo =
    idLower.includes('nintendo') ||
    idLower.includes('switch') ||
    idLower.includes('joy-con') ||
    idLower.includes('pro controller') ||
    idLower.includes('057e');
  const isXbox =
    idLower.includes('xbox') ||
    idLower.includes('xinput') ||
    idLower.includes('microsoft') ||
    idLower.includes('045e');
  const isAndroidUA = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

  const pov = decodePovHat(gp.axes[9]);
  const hasAxisHat67 = gp.axes.length >= 8;
  const dpadUp = isRawBtn(gp, 12) || pov.up || (hasAxisHat67 && (gp.axes[7] ?? 0) < -0.5);
  const dpadDown = isRawBtn(gp, 13) || pov.down || (hasAxisHat67 && (gp.axes[7] ?? 0) > 0.5);
  const dpadLeft = isRawBtn(gp, 14) || pov.left || (hasAxisHat67 && (gp.axes[6] ?? 0) < -0.5);
  const dpadRight = isRawBtn(gp, 15) || pov.right || (hasAxisHat67 && (gp.axes[6] ?? 0) > 0.5);

  // Sony DualShock 4 / DualSense DirectInput HID (Windows/macOS USB/BT raw)
  if (isSony && !isAndroidUA && gp.buttons.length >= 14 && gp.axes.length >= 9) {
    return {
      west: isRawBtn(gp, 0),   // Square
      south: isRawBtn(gp, 1),  // Cross
      east: isRawBtn(gp, 2),   // Circle
      north: isRawBtn(gp, 3),  // Triangle
      lb: isRawBtn(gp, 4),
      rb: isRawBtn(gp, 5),
      lt: isRawBtn(gp, 6) || (gp.axes[3] ?? -1) > -0.15,
      rt: isRawBtn(gp, 7) || (gp.axes[4] ?? -1) > -0.15,
      select: isRawBtn(gp, 8) || isRawBtn(gp, 13),
      start: isRawBtn(gp, 9),
      dpadUp,
      dpadDown,
      dpadLeft,
      dpadRight,
      stickX: applyDeadzone(gp.axes[0] ?? 0, 0.22),
      stickY: applyDeadzone(gp.axes[1] ?? 0, 0.22),
      rStickX: applyDeadzone(gp.axes[2] ?? 0, 0.18),
      rStickY: applyDeadzone(gp.axes[5] ?? 0, 0.18),
    };
  }

  // Nintendo Switch Pro DirectInput HID (Windows/macOS raw USB/BT: 0=Y, 1=X, 2=B, 3=A + POV hat)
  if (isNintendo && !isAndroidUA && gp.buttons.length >= 14 && gp.axes.length >= 9) {
    return {
      west: isRawBtn(gp, 0),   // Y (Left)
      north: isRawBtn(gp, 1),  // X (Top)
      south: isRawBtn(gp, 2),  // B (Bottom)
      east: isRawBtn(gp, 3),   // A (Right)
      lb: isRawBtn(gp, 4),     // L
      rb: isRawBtn(gp, 5),     // R
      lt: isRawBtn(gp, 6),     // ZL
      rt: isRawBtn(gp, 7),     // ZR
      select: isRawBtn(gp, 8), // Minus (-)
      start: isRawBtn(gp, 9),  // Plus (+)
      dpadUp,
      dpadDown,
      dpadLeft,
      dpadRight,
      stickX: applyDeadzone(gp.axes[0] ?? 0, 0.22),
      stickY: applyDeadzone(gp.axes[1] ?? 0, 0.22),
      rStickX: applyDeadzone(gp.axes[2] ?? 0, 0.18),
      rStickY: applyDeadzone(gp.axes[3] ?? 0, 0.18),
    };
  }

  // Android / Linux raw evdev gap (BTN_C at idx 2 -> A=0, B=1, X=3, Y=4, LB=6, RB=7)
  const usesEvdevGap =
    (isXbox && gp.buttons.length >= 12) ||
    (isAndroidUA && gp.buttons.length >= 12 && gp.axes.length <= 8) ||
    (!isSony && !isNintendo && isAndroidUA && gp.buttons.length >= 14);

  if (usesEvdevGap) {
    return {
      south: isRawBtn(gp, 0),
      east: isRawBtn(gp, 1),
      west: isRawBtn(gp, 3),
      north: isRawBtn(gp, 4),
      lb: isRawBtn(gp, 6),
      rb: isRawBtn(gp, 7),
      lt: isRawBtn(gp, 8) || (gp.axes.length >= 6 && (gp.axes[4] ?? -1) > -0.15),
      rt: isRawBtn(gp, 9) || (gp.axes.length >= 6 && (gp.axes[5] ?? -1) > -0.15),
      select: isRawBtn(gp, 10),
      start: isRawBtn(gp, 11),
      dpadUp,
      dpadDown,
      dpadLeft,
      dpadRight,
      stickX: applyDeadzone(gp.axes[0] ?? 0, 0.22),
      stickY: applyDeadzone(gp.axes[1] ?? 0, 0.22),
      rStickX: applyDeadzone(gp.axes[2] ?? 0, 0.18),
      rStickY: applyDeadzone(gp.axes[3] ?? 0, 0.18),
    };
  }

  // Generic unmapped HID (0=South, 1=East, 2=West, 3=North + POV hat)
  return {
    south: isRawBtn(gp, 0),
    east: isRawBtn(gp, 1),
    west: isRawBtn(gp, 2),
    north: isRawBtn(gp, 3),
    lb: isRawBtn(gp, 4),
    rb: isRawBtn(gp, 5),
    lt: isRawBtn(gp, 6),
    rt: isRawBtn(gp, 7),
    select: isRawBtn(gp, 8) || isRawBtn(gp, 17),
    start: isRawBtn(gp, 9),
    dpadUp,
    dpadDown,
    dpadLeft,
    dpadRight,
    stickX: applyDeadzone(gp.axes[0] ?? 0, 0.22),
    stickY: applyDeadzone(gp.axes[1] ?? 0, 0.22),
    rStickX: applyDeadzone(gp.axes[2] ?? 0, 0.18),
    rStickY: applyDeadzone(gp.axes[3] ?? 0, 0.18),
  };
}

export function readSemanticGamepad(
  gp: Gamepad,
  layout: ControllerLayout = currentSettings.controllerLayout
): SemanticGamepadState {
  const raw = decodeStandardOrRawGamepad(gp);

  let west = raw.west;
  let north = raw.north;
  if (currentSettings.swapWestNorth) {
    west = raw.north;
    north = raw.west;
  }

  // Authentic Nintendo A (Right/East) = Confirm, B (Bottom/South) = Cancel
  let confirm = layout === 'nintendo' ? raw.east : raw.south;
  let cancel = layout === 'nintendo' ? raw.south : raw.east;
  let lt = raw.lt;
  let rt = raw.rt;

  const custom = currentSettings.customButtonMap;
  if (custom) {
    if (typeof custom.confirm === 'number') confirm = isRawBtn(gp, custom.confirm);
    if (typeof custom.cancel === 'number') cancel = isRawBtn(gp, custom.cancel);
    if (typeof custom.north === 'number') north = isRawBtn(gp, custom.north);
    if (typeof custom.lt === 'number') lt = isRawBtn(gp, custom.lt);
    if (typeof custom.rt === 'number') rt = isRawBtn(gp, custom.rt);
  }

  return {
    confirm,
    cancel,
    west,
    north,
    lb: raw.lb,
    rb: raw.rb,
    lt,
    rt,
    select: raw.select,
    start: raw.start,
    dpadUp: raw.dpadUp,
    dpadDown: raw.dpadDown,
    dpadLeft: raw.dpadLeft,
    dpadRight: raw.dpadRight,
    stickX: raw.stickX,
    stickY: raw.stickY,
    rStickX: raw.rStickX,
    rStickY: raw.rStickY,
    anyUp: raw.dpadUp || raw.stickY < -0.55,
    anyDown: raw.dpadDown || raw.stickY > 0.55,
    anyLeft: raw.dpadLeft || raw.stickX < -0.55,
    anyRight: raw.dpadRight || raw.stickX > 0.55,
  };
}

export function getPressedRawButtonIndices(gp: Gamepad | null): number[] {
  if (!gp) return [];
  const pressed: number[] = [];
  for (let i = 0; i < gp.buttons.length; i++) {
    const b = gp.buttons[i];
    if (b && (b.pressed || b.value > 0.5)) {
      pressed.push(i);
    }
  }
  return pressed;
}

export function vibrateGamepad(
  strength: 'weak' | 'strong' | 'burst' | 'click' | 'jolt' | 'rumble',
  customOptions?: { duration?: number; weak?: number; strong?: number }
) {
  if (currentSettings.inputType !== 'gamepad') return;
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gamepads) {
    if (gp && gp.connected) {
      const actuator = gp.vibrationActuator ||
                       ((gp as any).hapticActuators && (gp as any).hapticActuators[0]) ||
                       ((gp as any).hapticActuator);

      if (actuator) {
        let duration = 60;
        let weakMagnitude = 0.25;
        let strongMagnitude = 0.05;

        if (strength === 'strong') {
          duration = 500;
          weakMagnitude = 1.0;
          strongMagnitude = 1.0;
        } else if (strength === 'burst') {
          duration = 150;
          weakMagnitude = 0.7;
          strongMagnitude = 0.5;
        } else if (strength === 'click') {
          duration = 20;
          weakMagnitude = 0.15;
          strongMagnitude = 0.0;
        } else if (strength === 'jolt') {
          duration = 750;
          weakMagnitude = 1.0;
          strongMagnitude = 1.0;
        } else if (strength === 'rumble') {
          duration = 120;
          weakMagnitude = 0.18;
          strongMagnitude = 0.03;
        }

        if (customOptions) {
          if (customOptions.duration !== undefined) duration = customOptions.duration;
          if (customOptions.weak !== undefined) weakMagnitude = customOptions.weak;
          if (customOptions.strong !== undefined) strongMagnitude = customOptions.strong;
        }

        const isRumbleEnabled = currentSettings.rumbleEnabled !== false;
        if (!isRumbleEnabled) {
          return;
        }
        const intensityMult = currentSettings.rumbleIntensity !== undefined ? currentSettings.rumbleIntensity : 1.0;
        weakMagnitude *= intensityMult;
        strongMagnitude *= intensityMult;

        try {
          if (typeof actuator.playEffect === 'function') {
            actuator.playEffect('dual-rumble', {
              startDelay: 0,
              duration,
              weakMagnitude,
              strongMagnitude
            });
          } else if (typeof actuator.pulse === 'function') {
            const intensity = Math.max(weakMagnitude, strongMagnitude);
            actuator.pulse(intensity, duration);
          }
        } catch (e) {
          console.warn('Gamepad vibration failed on actuator:', e);
        }
      }
    }
  }
}
