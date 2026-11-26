import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Monitor, Sparkles, Volume2, Gamepad2, Cpu, Lock, AlertTriangle, Smartphone } from 'lucide-react';
import { CustomSelect, SelectOption } from './CustomSelect';
import { IndustrialScrollArea } from './IndustrialScrollArea';
import { ControllerGlyph, CONTROLLER_LAYOUT_META } from './ControllerGlyph';
import { getMasterVolume, getAmbientVolume, setMasterVolume, setAmbientVolume, playUIHover, playUIClick, playUISliderTick } from '../audio';
import {
  getControllerSettings,
  setControllerSettings,
  subscribeControllerSettings,
  vibrateGamepad,
  getConnectedGamepad,
  readSemanticGamepad,
  detectControllerLayoutFromId,
  getPressedRawButtonIndices,
  ControllerLayout,
  InputType,
  RemappableGamepadAction,
  ReflectionQuality,
  EffectQuality,
} from '../controller';
import { Difficulty } from '../types';
import {
  isWebGPUSupported,
  getWebGpuEmergencyFallbackState,
  subscribeWebGpuFallbackState,
  WebGpuFallbackState,
} from '../renderers/RendererManager';

interface SettingsPanelProps {
  difficulty?: Difficulty;
  onClose: () => void;
}

type TabType = 'graphics' | 'audio' | 'controls';

const effectQualityOptions: SelectOption<EffectQuality>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "ultra", label: "Ultra" }
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = getControllerSettings();
  const [activeTab, setActiveTab] = useState<TabType>('graphics');

  const [masterVol, setMasterVol] = useState(getMasterVolume());
  const [ambientVol, setAmbientVol] = useState(getAmbientVolume());
  const [inputType, setInputType] = useState<InputType>(settings.inputType);
  const [controllerLayout, setControllerLayout] = useState<ControllerLayout>(settings.controllerLayout || 'xbox');
  const [autoDetectInput, setAutoDetectInput] = useState(settings.autoDetectInput !== false);
  const [rightStickSensitivity, setRightStickSensitivity] = useState(settings.rightStickSensitivity ?? 1.0);
  const [touchLookSensitivity, setTouchLookSensitivity] = useState(settings.touchLookSensitivity ?? 1.0);
  const [connectedControllerName, setConnectedControllerName] = useState<string>('');
  const [graphicsPreset, setGraphicsPreset] = useState(settings.graphicsPreset);
  const modalRef = useRef<HTMLDivElement>(null);
  const focusedElRef = useRef<HTMLElement | null>(null);
  
  const [antiAliasing, setAntiAliasing] = useState(settings.antiAliasing);
  const [postProcessing, setPostProcessing] = useState(settings.postProcessing);
  const [shadowQuality, setShadowQuality] = useState(settings.shadowQuality);
  const [reflectionQuality, setReflectionQuality] = useState<ReflectionQuality>(settings.reflectionQuality || 'low');
  const [textureFiltering, setTextureFiltering] = useState(settings.textureFiltering);
  const [materialEnhancements, setMaterialEnhancements] = useState(settings.materialEnhancements);
  const [materialQuality, setMaterialQuality] = useState<EffectQuality>(settings.materialQuality || 'low');
  const [bloomIntensity, setBloomIntensity] = useState(settings.bloomIntensity);
  const [gtaoEnabled, setGtaoEnabled] = useState(settings.gtaoEnabled !== false);
  const [gtaoQuality, setGtaoQuality] = useState<EffectQuality>(settings.gtaoQuality || 'low');
  const [ssrEnabled, setSsrEnabled] = useState(settings.ssrEnabled !== false);
  const [ssrQuality, setSsrQuality] = useState<EffectQuality>(settings.ssrQuality || 'low');
  const [volumetricSmokeEnabled, setVolumetricSmokeEnabled] = useState(settings.volumetricSmokeEnabled !== false);
  const [volumetricSmokeQuality, setVolumetricSmokeQuality] = useState<EffectQuality>(settings.volumetricSmokeQuality || 'low');
  const [gpuComputePhysics, setGpuComputePhysics] = useState(settings.gpuComputePhysics !== false);
  const [computePhysicsQuality, setComputePhysicsQuality] = useState<EffectQuality>(settings.computePhysicsQuality || 'low');
  const [motionBlurEnabled, setMotionBlurEnabled] = useState(settings.motionBlurEnabled !== false);
  const [motionBlurQuality, setMotionBlurQuality] = useState<EffectQuality>(settings.motionBlurQuality || 'low');
  const [particleQuality, setParticleQuality] = useState(settings.particleQuality || 'low');
  const [rumbleEnabled, setRumbleEnabled] = useState(settings.rumbleEnabled !== false);
  const [rumbleIntensity, setRumbleIntensity] = useState(settings.rumbleIntensity !== undefined ? settings.rumbleIntensity : 1.0);
  const [polygonCount, setPolygonCount] = useState(settings.polygonCount || 'low');
  const [webGpuUpscalingPreset, setWebGpuUpscalingPreset] = useState(settings.webGpuUpscalingPreset || 'balanced');
  const [webGpuSharpening, setWebGpuSharpening] = useState(settings.webGpuSharpening !== undefined ? settings.webGpuSharpening : 0.6);
  const [showKeyboardHudSetting, setShowKeyboardHudSetting] = useState(settings.showKeyboardHud !== false);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadMappingMode, setGamepadMappingMode] = useState<'standard' | 'raw' | ''>('');
  const [swapWestNorth, setSwapWestNorth] = useState(Boolean(settings.swapWestNorth));
  const [customButtonMap, setCustomButtonMap] = useState<Partial<Record<RemappableGamepadAction, number>>>(settings.customButtonMap || {});
  const [listeningAction, setListeningAction] = useState<RemappableGamepadAction | null>(null);
  const [liveRawButtons, setLiveRawButtons] = useState<number[]>([]);
  const listeningActionRef = useRef<RemappableGamepadAction | null>(null);
  listeningActionRef.current = listeningAction;

  // Close on ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const checkGamepads = () => {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      const activeGp = Array.from(gps).find(gp => gp && gp.connected);
      setGamepadConnected(Boolean(activeGp));
      setConnectedControllerName(activeGp?.id ? activeGp.id : '');
      setGamepadMappingMode(activeGp ? (activeGp.mapping === 'standard' ? 'standard' : 'raw') : '');
    };

    checkGamepads();

    window.addEventListener('gamepadconnected', checkGamepads);
    window.addEventListener('gamepaddisconnected', checkGamepads);

    const interval = setInterval(checkGamepads, 1000);

    return () => {
      window.removeEventListener('gamepadconnected', checkGamepads);
      window.removeEventListener('gamepaddisconnected', checkGamepads);
      clearInterval(interval);
    };
  }, []);

  // Full Gamepad Navigation inside Settings Modal (LB/RB Tabs, D-Pad Focus/Sliders, Confirm/Cancel)
  useEffect(() => {
    let frameId = 0;
    let prevConfirm = false;
    let prevCancel = false;
    let prevLB = false;
    let prevRB = false;
    let prevUp = false;
    let prevDown = false;
    let prevLeft = false;
    let prevRight = false;
    let focusIndex = 0;

    const getFocusables = (): HTMLElement[] => {
      if (!modalRef.current) return [];
      const bodyArea = modalRef.current.querySelector('[data-settings-scroll-body]') || modalRef.current;
      return Array.from(
        bodyArea.querySelectorAll('button:not(:disabled), input[type="range"]:not(:disabled)')
      ).filter((el) => {
        const htmlEl = el as HTMLElement;
        return htmlEl.offsetParent !== null;
      }) as HTMLElement[];
    };

    const applyFocusRing = (target: HTMLElement | null) => {
      if (focusedElRef.current && focusedElRef.current !== target) {
        focusedElRef.current.classList.remove('gp-focus-ring');
      }
      if (target) {
        target.classList.add('gp-focus-ring');
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      focusedElRef.current = target;
    };

    let prevRawSet = new Set<number>();

    const loop = () => {
      frameId = requestAnimationFrame(loop);
      const gp = getConnectedGamepad();
      if (!gp) {
        applyFocusRing(null);
        setLiveRawButtons((prev) => (prev.length > 0 ? [] : prev));
        return;
      }

      const rawPressed = getPressedRawButtonIndices(gp);
      setLiveRawButtons((prev) => {
        if (prev.length === rawPressed.length && prev.every((v, i) => v === rawPressed[i])) {
          return prev;
        }
        return rawPressed;
      });

      const activeRebind = listeningActionRef.current;
      if (activeRebind) {
        const newlyPressed = rawPressed.find((idx) => !prevRawSet.has(idx));
        prevRawSet = new Set(rawPressed);
        if (newlyPressed !== undefined) {
          const nextMap = { ...(getControllerSettings().customButtonMap || {}), [activeRebind]: newlyPressed };
          setCustomButtonMap(nextMap);
          setControllerSettings({ customButtonMap: nextMap });
          setListeningAction(null);
          playUIClick('toggle');
          vibrateGamepad('click');
        }
        return;
      }
      prevRawSet = new Set(rawPressed);

      const s = getControllerSettings();
      const sem = readSemanticGamepad(gp, s.controllerLayout);

      if (sem.lb && !prevLB) {
        setActiveTab((curr) => (curr === 'controls' ? 'audio' : curr === 'audio' ? 'graphics' : 'controls'));
        focusIndex = 0;
        playUIClick('toggle');
        vibrateGamepad('click');
      }
      if (sem.rb && !prevRB) {
        setActiveTab((curr) => (curr === 'graphics' ? 'audio' : curr === 'audio' ? 'controls' : 'graphics'));
        focusIndex = 0;
        playUIClick('toggle');
        vibrateGamepad('click');
      }

      if (s.inputType === 'gamepad') {
        const focusables = getFocusables();
        if (focusables.length > 0) {
          focusIndex = Math.max(0, Math.min(focusIndex, focusables.length - 1));
          const currentEl = focusables[focusIndex];
          applyFocusRing(currentEl);

          if (sem.anyDown && !prevDown) {
            focusIndex = (focusIndex + 1) % focusables.length;
            applyFocusRing(focusables[focusIndex]);
            playUIHover(0.35);
            vibrateGamepad('click');
          } else if (sem.anyUp && !prevUp) {
            focusIndex = (focusIndex - 1 + focusables.length) % focusables.length;
            applyFocusRing(focusables[focusIndex]);
            playUIHover(0.35);
            vibrateGamepad('click');
          }

          if (currentEl && currentEl.tagName === 'INPUT' && (currentEl as HTMLInputElement).type === 'range') {
            const slider = currentEl as HTMLInputElement;
            if ((sem.anyLeft && !prevLeft) || (sem.anyRight && !prevRight)) {
              const dir = sem.anyRight ? 1 : -1;
              const min = parseFloat(slider.min || '0');
              const max = parseFloat(slider.max || '1');
              const step = parseFloat(slider.step || '0.05');
              const curr = parseFloat(slider.value || '0');
              const next = Math.max(min, Math.min(max, Number((curr + dir * step).toFixed(4))));
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              nativeSetter?.call(slider, String(next));
              slider.dispatchEvent(new Event('input', { bubbles: true }));
              slider.dispatchEvent(new Event('change', { bubbles: true }));
              vibrateGamepad('click');
            }
          } else if ((sem.anyLeft && !prevLeft) || (sem.anyRight && !prevRight)) {
            focusIndex = (focusIndex + (sem.anyRight ? 1 : -1) + focusables.length) % focusables.length;
            applyFocusRing(focusables[focusIndex]);
            playUIHover(0.35);
            vibrateGamepad('click');
          }

          if (sem.confirm && !prevConfirm && currentEl) {
            currentEl.click();
            vibrateGamepad('click');
          }
        }
      } else {
        applyFocusRing(null);
      }

      if (sem.cancel && !prevCancel) {
        playUIClick('back');
        onClose();
      }

      prevConfirm = sem.confirm;
      prevCancel = sem.cancel;
      prevLB = sem.lb;
      prevRB = sem.rb;
      prevUp = sem.anyUp;
      prevDown = sem.anyDown;
      prevLeft = sem.anyLeft;
      prevRight = sem.anyRight;
    };

    frameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frameId);
      applyFocusRing(null);
    };
  }, [onClose]);

  const [isWebGpuSupportedOnHardware, setIsWebGpuSupportedOnHardware] = useState(true);
  const [fallbackState, setFallbackState] = useState<WebGpuFallbackState>(() =>
    getWebGpuEmergencyFallbackState()
  );

  useEffect(() => {
    isWebGPUSupported().then(res => {
      setIsWebGpuSupportedOnHardware(res.supported);
    });
    return subscribeWebGpuFallbackState((next) => {
      setFallbackState(next);
    });
  }, []);

  const isWebGLActive = !isWebGpuSupportedOnHardware || fallbackState.active;

  useEffect(() => {
    return subscribeControllerSettings(s => {
      setInputType(s.inputType);
      setControllerLayout(s.controllerLayout || 'xbox');
      setAutoDetectInput(s.autoDetectInput !== false);
      setRightStickSensitivity(s.rightStickSensitivity ?? 1.0);
      setTouchLookSensitivity(s.touchLookSensitivity ?? 1.0);
      setGraphicsPreset(s.graphicsPreset);
      setAntiAliasing(s.antiAliasing);
      setPostProcessing(s.postProcessing);
      setShadowQuality(s.shadowQuality);
      setReflectionQuality(s.reflectionQuality || 'low');
      setTextureFiltering(s.textureFiltering);
      setMaterialEnhancements(s.materialEnhancements);
      setMaterialQuality(s.materialQuality || 'low');
      setBloomIntensity(s.bloomIntensity);
      setGtaoEnabled(s.gtaoEnabled !== false);
      setGtaoQuality(s.gtaoQuality || 'low');
      setSsrEnabled(s.ssrEnabled !== false);
      setSsrQuality(s.ssrQuality || 'low');
      setVolumetricSmokeEnabled(s.volumetricSmokeEnabled !== false);
      setVolumetricSmokeQuality(s.volumetricSmokeQuality || 'low');
      setGpuComputePhysics(s.gpuComputePhysics !== false);
      setComputePhysicsQuality(s.computePhysicsQuality || 'low');
      setMotionBlurEnabled(s.motionBlurEnabled !== false);
      setMotionBlurQuality(s.motionBlurQuality || 'low');
      setParticleQuality(s.particleQuality || 'low');
      setRumbleEnabled(s.rumbleEnabled !== false);
      setRumbleIntensity(s.rumbleIntensity !== undefined ? s.rumbleIntensity : 1.0);
      setPolygonCount(s.polygonCount || 'low');
      setWebGpuUpscalingPreset(s.webGpuUpscalingPreset || 'balanced');
      setWebGpuSharpening(s.webGpuSharpening !== undefined ? s.webGpuSharpening : 0.6);
      setShowKeyboardHudSetting(s.showKeyboardHud !== false);
      setSwapWestNorth(Boolean(s.swapWestNorth));
      setCustomButtonMap(s.customButtonMap || {});
    });
  }, []);

  const handleMasterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setMasterVol(v);
    setMasterVolume(v);
  };

  const handleAmbientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setAmbientVol(v);
    setAmbientVolume(v);
  };

  const setInputMode = (mode: InputType) => {
    setInputType(mode);
    setControllerSettings({ inputType: mode });
  };

  const selectControllerLayout = (layout: ControllerLayout) => {
    try {
      localStorage.setItem('dealer_controller_layout_manual', '1');
    } catch {}
    setControllerLayout(layout);
    setControllerSettings({ controllerLayout: layout });
    vibrateGamepad('click');
  };

  const applyGraphicsPreset = (preset: 'Low' | 'Medium' | 'High' | 'Ultra') => {
    switch (preset) {
      case 'Low':
        setControllerSettings({
          graphicsPreset: preset,
          antiAliasing: 'fxaa',
          postProcessing: 'low',
          shadowQuality: 'low',
          reflectionQuality: 'low',
          textureFiltering: 2,
          materialEnhancements: true,
          materialQuality: 'low',
          bloomIntensity: 0.15,
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
          motionBlurIntensity: 0.25,
          polygonCount: 'low',
          webGpuUpscalingPreset: webGpuUpscalingPreset || 'performance',
          webGpuSharpening: webGpuSharpening !== undefined ? webGpuSharpening : 0.6,
          particleQuality: 'low'
        });
        break;
      case 'Medium':
        setControllerSettings({
          graphicsPreset: preset,
          antiAliasing: 'fxaa',
          postProcessing: 'high',
          shadowQuality: 'medium',
          reflectionQuality: 'medium',
          textureFiltering: 4,
          materialEnhancements: true,
          materialQuality: 'medium',
          bloomIntensity: 0.25,
          gtaoEnabled: true,
          gtaoQuality: 'medium',
          ssrEnabled: true,
          ssrQuality: 'medium',
          volumetricSmokeEnabled: true,
          volumetricSmokeQuality: 'medium',
          gpuComputePhysics: true,
          computePhysicsQuality: 'medium',
          motionBlurEnabled: true,
          motionBlurQuality: 'medium',
          motionBlurIntensity: 0.45,
          polygonCount: 'medium',
          webGpuUpscalingPreset: 'balanced',
          webGpuSharpening: 0.6,
          particleQuality: 'medium'
        });
        break;
      case 'High':
        setControllerSettings({
          graphicsPreset: preset,
          antiAliasing: 'smaa',
          postProcessing: 'cinematic',
          shadowQuality: 'high',
          reflectionQuality: 'high',
          textureFiltering: 8,
          materialEnhancements: true,
          materialQuality: 'high',
          bloomIntensity: 0.35,
          gtaoEnabled: true,
          gtaoQuality: 'high',
          ssrEnabled: true,
          ssrQuality: 'high',
          volumetricSmokeEnabled: true,
          volumetricSmokeQuality: 'high',
          gpuComputePhysics: true,
          computePhysicsQuality: 'high',
          motionBlurEnabled: true,
          motionBlurQuality: 'high',
          motionBlurIntensity: 0.65,
          polygonCount: 'high',
          webGpuUpscalingPreset: 'quality',
          webGpuSharpening: 0.5,
          particleQuality: 'high'
        });
        break;
      case 'Ultra':
        setControllerSettings({
          graphicsPreset: preset,
          antiAliasing: 'smaa',
          postProcessing: 'cinematic',
          shadowQuality: 'ultra',
          reflectionQuality: 'ultra',
          textureFiltering: 16,
          materialEnhancements: true,
          materialQuality: 'ultra',
          bloomIntensity: 0.4,
          gtaoEnabled: true,
          gtaoQuality: 'ultra',
          ssrEnabled: true,
          ssrQuality: 'ultra',
          volumetricSmokeEnabled: true,
          volumetricSmokeQuality: 'ultra',
          gpuComputePhysics: true,
          computePhysicsQuality: 'ultra',
          motionBlurEnabled: true,
          motionBlurQuality: 'ultra',
          motionBlurIntensity: 0.85,
          polygonCount: 'ultra',
          webGpuUpscalingPreset: 'native',
          webGpuSharpening: 0.4,
          particleQuality: 'ultra'
        });
        break;
    }
  };

  const handleCustomSetting = (update: any) => {
    setControllerSettings({ ...update, graphicsPreset: 'Custom' });
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'graphics', label: 'Display & Graphics', icon: <Monitor size={16} /> },
    { id: 'audio', label: 'Audio & Haptics', icon: <Volume2 size={16} /> },
    { id: 'controls', label: 'Controls', icon: <Gamepad2 size={16} /> },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 sm:p-6"
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.14 }}
        className="settings-panel border border-[#26262b] bg-[#0b0b0d] flex flex-col w-full max-w-4xl h-[90vh] sm:h-[85vh] max-h-[900px] overflow-hidden text-neutral-200"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[#26262b] bg-[#0e0e11] shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-neutral-100 font-mono tracking-[0.2em] text-sm sm:text-base font-bold uppercase">
              SETTINGS
            </h2>
            {inputType === 'gamepad' && (
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-neutral-500">
                <ControllerGlyph role="lb" layout={controllerLayout} size="xs" />
                <ControllerGlyph role="rb" layout={controllerLayout} size="xs" />
                <span>TABS</span>
              </div>
            )}
          </div>
          <button 
            onClick={onClose}
            className="back-btn w-9 h-9 bg-[#121215] border border-[#2e2e34] text-neutral-400 hover:text-neutral-100 hover:bg-[#2f0909] hover:border-red-800 transition-colors flex items-center justify-center cursor-pointer"
            aria-label="Close Settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 border-b border-[#26262b] bg-[#0e0e11] p-2 gap-1.5 shrink-0">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab" onClick={() => setActiveTab(tab.id)}
                className={`min-h-[42px] px-2 sm:px-3 py-2 font-mono text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer border text-center ${
                  isActive 
                    ? 'bg-[#250909] text-neutral-100 border-red-800' 
                    : 'bg-[#111114] text-neutral-400 border-[#26262b] hover:text-neutral-200 hover:bg-[#17171b]'
                }`}
              >
                {tab.icon}
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Panel with Custom Industrial Scrollbar */}
        <IndustrialScrollArea className="flex-1 min-h-0" viewportClassName="p-4 sm:p-6 space-y-5 sm:space-y-6 pb-12" data-settings-scroll-body>

          {/* TAB 1: UNIFIED DISPLAY & GRAPHICS */}
          {activeTab === 'graphics' && (
            <div className="space-y-6">

              {/* SECTION: RENDERING PIPELINE (AUTO-LOCKED BY WEBGPU SUPPORT) */}
              <div className="p-3.5 border border-[#26262b] bg-[#101013] space-y-3 font-mono">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-red-600" />
                    <span className="text-neutral-200 font-mono uppercase text-xs font-bold tracking-wider">
                      Rendering Pipeline
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                    isWebGLActive ? 'text-amber-500' : 'text-neutral-200'
                  }`}>
                    {fallbackState.active
                      ? 'WEBGL 2.0 (EMERGENCY FALLBACK)'
                      : isWebGLActive
                      ? 'WEBGL 2.0 (FORCED)'
                      : 'WEBGPU (FORCED)'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap pt-0.5">
                  <div className="space-y-0.5 max-w-sm">
                    <div className="text-[11px] text-neutral-300 font-bold uppercase tracking-wide">
                      {fallbackState.active
                        ? 'WebGL 2.0 Emergency Fallback Pipeline'
                        : isWebGLActive
                        ? 'WebGL 2.0 Fallback Pipeline'
                        : 'WebGPU Hardware Pipeline'}
                    </div>
                    <p className="text-[10px] text-neutral-500 leading-relaxed font-sans">
                      {fallbackState.active
                        ? `Emergency WebGL 2.0 fallback activated (${fallbackState.reason || 'WebGPU instability detected'}). WebGPU compute and deferred passes bypassed.`
                        : isWebGLActive
                        ? 'WebGPU is not supported in this browser. Forced to WebGL 2.0 — WebGPU compute and deferred passes (GTAO, SSR, smoke & blood physics) bypassed.'
                        : 'WebGPU is supported in this browser and enforced as the primary pipeline. WGSL compute shaders, deferred normals, GTAO, and SSR active.'}
                    </p>
                  </div>

                  {/* Locked Backend Selector Display */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled
                      aria-pressed={isWebGLActive}
                      title={
                        fallbackState.active
                          ? 'WebGL 2.0 active via runtime emergency fallback'
                          : isWebGLActive
                          ? 'WebGL 2.0 forced (WebGPU unsupported in this browser)'
                          : 'WebGL disabled — WebGPU is supported and enforced'
                      }
                      className={`px-3 py-1.5 border font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                        isWebGLActive
                          ? 'bg-[#1c150c] border-amber-700 text-amber-400 cursor-default'
                          : 'bg-[#0b0b0d] border-[#1c1c20] text-neutral-600 opacity-40 cursor-not-allowed'
                      }`}
                    >
                      {!isWebGLActive && <Lock className="w-3 h-3" />}
                      <span>WebGL</span>
                    </button>
                    <button
                      type="button"
                      disabled
                      aria-pressed={!isWebGLActive}
                      title={
                        fallbackState.active
                          ? `WebGPU disabled for this session (${fallbackState.reason || 'runtime fallback'})`
                          : !isWebGLActive
                          ? 'WebGPU forced as primary rendering pipeline'
                          : 'WebGPU unavailable — unsupported in this browser'
                      }
                      className={`px-3 py-1.5 border font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                        !isWebGLActive
                          ? 'bg-[#250909] border-red-800 text-neutral-100 cursor-default'
                          : 'bg-[#0b0b0d] border-[#1c1c20] text-neutral-600 opacity-40 cursor-not-allowed'
                      }`}
                    >
                      {isWebGLActive && <Lock className="w-3 h-3" />}
                      <span>WebGPU</span>
                    </button>
                  </div>
                </div>

                {isWebGLActive && (
                  <div className="p-2 bg-[#16120b] border border-amber-900/60 flex items-center gap-2 text-[10px] text-amber-400 font-mono">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <span>
                      {fallbackState.active
                        ? `Emergency WebGL 2.0 fallback active: ${fallbackState.reason || 'WebGPU choking or corruption detected'}.`
                        : 'WebGPU unsupported in this browser. Forced to WebGL 2.0 compatibility mode.'}
                    </span>
                  </div>
                )}
              </div>

              {/* SECTION 1: QUALITY PRESET MATRIX */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-red-600" />
                    <span className="text-neutral-200 font-mono uppercase text-xs font-bold tracking-wider">
                      Graphics Preset
                    </span>
                  </div>
                  <span className="text-xs font-mono font-bold text-red-500 uppercase tracking-wider">
                    {graphicsPreset}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(['Low', 'Medium', 'High', 'Ultra'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyGraphicsPreset(preset)}
                      className={`min-h-[42px] px-2 py-2 font-mono text-xs font-bold uppercase transition-colors border cursor-pointer ${
                        graphicsPreset === preset
                          ? 'bg-[#250909] border-red-800 text-neutral-100'
                          : 'bg-[#121215] border-[#26262b] text-neutral-400 hover:bg-[#18181c] hover:text-neutral-200'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        {preset}
                      </span>
                    </button>
                  ))}
                  <div className={`min-h-[42px] px-2 py-2 font-mono text-xs uppercase flex items-center justify-center border ${
                    graphicsPreset === 'Custom'
                      ? 'bg-[#1c1c21] border-[#3d3d45] text-white font-bold'
                      : 'bg-[#0e0e11] border-[#202025] text-neutral-600'
                  }`}>
                    Custom
                  </div>
                </div>

                {isWebGLActive && (
                  <div className="p-2.5 bg-[#12100c] border border-amber-900/60 flex items-start gap-2 text-amber-400 font-mono text-[11px] leading-relaxed">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold uppercase tracking-wider text-amber-400 block mb-0.5">
                        WebGL Pipeline Active — WebGPU Passes Disabled
                      </span>
                      <span className="text-neutral-400">
                        GTAO, Screen Space Reflections, compute blood/sparks, and atmospheric smoke wisps are disabled in WebGL compatibility mode.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 2: SPATIAL UPSCALING & SHARPENING */}
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-4">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-red-600" />
                    <span className="text-neutral-200 font-mono uppercase text-xs font-bold">
                      Spatial Upscaling
                    </span>
                  </div>
                  <span className="text-xs font-mono font-bold text-red-500 uppercase tracking-wider">
                    {webGpuUpscalingPreset === 'native' ? 'Native (100%)' :
                     webGpuUpscalingPreset === 'ultra_quality' ? 'Ultra Quality (88%)' :
                     webGpuUpscalingPreset === 'quality' ? 'Quality (77%)' :
                     webGpuUpscalingPreset === 'balanced' ? 'Balanced (67%)' : 'Performance (50%)'}
                  </span>
                </div>
                
                <p className="text-[11px] font-mono text-neutral-500 leading-relaxed">
                  {webGpuUpscalingPreset === 'native'
                    ? 'Native resolution active (100%). Spatial upscaling and Robust Contrast-Adaptive Sharpening disabled.'
                    : 'Edge-adaptive spatial upscaling renders at optimized internal scale and reconstructs to native resolution.'}
                </p>

                {/* Upscaling Presets */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1">
                  {[
                    { id: 'native' as const, label: 'Native', sub: '100%' },
                    { id: 'ultra_quality' as const, label: 'Ultra', sub: '88%' },
                    { id: 'quality' as const, label: 'Quality', sub: '77%' },
                    { id: 'balanced' as const, label: 'Balanced', sub: '67%' },
                    { id: 'performance' as const, label: 'Perf', sub: '50%' },
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleCustomSetting({ webGpuUpscalingPreset: p.id })}
                      className={`px-2 py-2 border font-mono text-xs flex flex-col items-center justify-center transition-colors cursor-pointer ${
                        webGpuUpscalingPreset === p.id 
                          ? 'bg-[#250909] border-red-800 text-neutral-100' 
                          : 'bg-[#121215] border-[#26262b] text-neutral-400 hover:border-[#34343c] hover:text-neutral-200'
                      }`}
                    >
                      <span className="font-bold">{p.label}</span>
                      <span className="text-[10px] text-neutral-500">{p.sub}</span>
                    </button>
                  ))}
                </div>

                {/* Robust Contrast-Adaptive Sharpening Slider */}
                <div className={`pt-3 border-t border-neutral-800/80 space-y-2 transition-opacity ${
                  webGpuUpscalingPreset === 'native' ? 'opacity-40 cursor-not-allowed select-none' : ''
                }`}>
                  <div className="flex justify-between items-center">
                    <label className={`font-mono uppercase text-xs font-bold flex items-center gap-1.5 ${
                      webGpuUpscalingPreset === 'native' ? 'text-neutral-500' : 'text-neutral-300'
                    }`}>
                      Robust Contrast-Adaptive Sharpening
                      {webGpuUpscalingPreset === 'native' && (
                        <span className="text-[10px] font-normal lowercase tracking-normal text-neutral-500">
                          (disabled in native mode)
                        </span>
                      )}
                    </label>
                    <span className={`font-mono text-xs font-bold ${
                      webGpuUpscalingPreset === 'native' ? 'text-neutral-600' : 'text-red-400'
                    }`}>
                      {webGpuUpscalingPreset === 'native' ? 'DISABLED' : `${Math.round(webGpuSharpening * 100)}%`}
                    </span>
                  </div>
                  <input 
                    type="range" min="0.0" max="1.0" step="0.05"
                    disabled={webGpuUpscalingPreset === 'native'}
                    value={webGpuSharpening}
                    onChange={(e) => handleCustomSetting({ webGpuSharpening: parseFloat(e.target.value) })}
                    className={`w-full h-2 rounded-none appearance-none bg-neutral-800 border border-neutral-700 ${
                      webGpuUpscalingPreset === 'native'
                        ? 'accent-neutral-700 cursor-not-allowed opacity-50'
                        : 'accent-red-600 cursor-pointer'
                    }`}
                  />
                  <p className={`text-[10px] font-mono ${
                    webGpuUpscalingPreset === 'native' ? 'text-neutral-600' : 'text-neutral-500'
                  }`}>
                    {webGpuUpscalingPreset === 'native'
                      ? 'Robust Contrast-Adaptive Sharpening pass is disabled while running at native 100% viewport resolution.'
                      : 'Adaptive edge-enhancement algorithm sharpening fine barrel engravings and CRT scanlines without grain amplification.'}
                  </p>
                </div>
              </div>

              {/* SECTION 3: ADVANCED GPU PIPELINE & HARDWARE ACCELERATION */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                  <span className="text-neutral-300 font-mono uppercase text-xs font-bold tracking-wider">
                    Next-Gen Lighting & GPU Acceleration
                  </span>
                  {isWebGLActive && (
                    <span className="text-[10px] font-mono text-amber-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> WEBGPU PASSES BYPASSED
                    </span>
                  )}
                </div>

                {isWebGLActive && (
                  <div className="p-2.5 bg-neutral-950/90 border border-amber-900/50 flex items-start gap-2 text-amber-400 font-mono text-[11px] leading-relaxed">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold uppercase tracking-wider text-amber-300 block mb-0.5">WebGL Compatibility Active — WebGPU Passes Bypassed</span>
                      <span>GTAO, Screen Space Reflections, WGSL Compute Physics, and Atmospheric Volumetric Smoke are disabled on WebGL 2.0. Standard scene lighting, PBR materials, motion blur, and spatial upscaling remain fully active.</span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomSelect<EffectQuality>
                    label={isWebGLActive ? "GTAO (Ambient Occlusion) — Requires WebGPU" : "Ground Truth Ambient Occlusion (GTAO)"}
                    options={effectQualityOptions}
                    value={isWebGLActive ? 'low' : gtaoQuality}
                    disabled={isWebGLActive}
                    onChange={(val) => handleCustomSetting({ gtaoQuality: val, gtaoEnabled: true })}
                  />

                  <CustomSelect<EffectQuality>
                    label={isWebGLActive ? "Screen Space Reflections (SSR) — Requires WebGPU" : "Screen Space Reflections (SSR)"}
                    options={effectQualityOptions}
                    value={isWebGLActive ? 'low' : ssrQuality}
                    disabled={isWebGLActive}
                    onChange={(val) => handleCustomSetting({ ssrQuality: val, ssrEnabled: true })}
                  />

                  <CustomSelect<EffectQuality>
                    label={isWebGLActive ? "Compute Physics (Blood & Sparks) — Requires WebGPU" : "WebGPU Compute Physics (Blood & Sparks)"}
                    options={effectQualityOptions}
                    value={isWebGLActive ? 'low' : computePhysicsQuality}
                    disabled={isWebGLActive}
                    onChange={(val) => handleCustomSetting({ computePhysicsQuality: val, gpuComputePhysics: true })}
                  />

                  <CustomSelect<EffectQuality>
                    label={isWebGLActive ? "Atmospheric Smoke & Ash Wisps — Requires WebGPU" : "Atmospheric Smoke & Ash Wisps"}
                    options={effectQualityOptions}
                    value={isWebGLActive ? 'low' : volumetricSmokeQuality}
                    disabled={isWebGLActive}
                    onChange={(val) => handleCustomSetting({ volumetricSmokeQuality: val, volumetricSmokeEnabled: true })}
                  />

                  <CustomSelect<EffectQuality>
                    label="Object Velocity Motion Blur"
                    options={effectQualityOptions}
                    value={motionBlurQuality}
                    onChange={(val) => handleCustomSetting({ motionBlurQuality: val, motionBlurEnabled: true })}
                  />

                  <CustomSelect<EffectQuality>
                    label="PBR Material Enhancements"
                    options={effectQualityOptions}
                    value={materialQuality}
                    onChange={(val) => handleCustomSetting({ materialQuality: val, materialEnhancements: true })}
                  />
                </div>
              </div>

              {/* SECTION 4: GEOMETRY & TEXTURE FIDELITY */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                  <span className="text-neutral-300 font-mono uppercase text-xs font-bold tracking-wider">
                    Geometry & Texture Fidelity
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomSelect
                    label="Anti-Aliasing"
                    options={[
                      { value: "fxaa", label: "FXAA (Fast)" },
                      { value: "smaa", label: "SMAA (Quality)" }
                    ]}
                    value={antiAliasing}
                    onChange={(val) => handleCustomSetting({ antiAliasing: val })}
                  />

                  <CustomSelect
                    label="Shadow Quality"
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "ultra", label: "Ultra" }
                    ]}
                    value={shadowQuality}
                    onChange={(val) => handleCustomSetting({ shadowQuality: val })}
                  />

                  <CustomSelect<ReflectionQuality>
                    label="Reflections"
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "ultra", label: "Ultra" }
                    ]}
                    value={reflectionQuality}
                    onChange={(val) => handleCustomSetting({ reflectionQuality: val })}
                  />

                  <CustomSelect
                    label="Polygon Detail"
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "ultra", label: "Ultra" }
                    ]}
                    value={polygonCount}
                    onChange={(val) => handleCustomSetting({ polygonCount: val })}
                  />

                  <CustomSelect<number>
                    label="Anisotropic Filtering"
                    options={[
                      { value: 1, label: "1x" },
                      { value: 2, label: "2x" },
                      { value: 4, label: "4x" },
                      { value: 8, label: "8x" },
                      { value: 16, label: "16x" }
                    ]}
                    value={textureFiltering}
                    onChange={(val) => handleCustomSetting({ textureFiltering: val })}
                  />

                  <CustomSelect
                    label="Particle FX Density (Sparks & Smoke)"
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "ultra", label: "Ultra" }
                    ]}
                    value={particleQuality}
                    onChange={(val) => handleCustomSetting({ particleQuality: val })}
                  />
                </div>
              </div>

              {/* SECTION 5: POST-PROCESSING & CALIBRATION */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                  <span className="text-neutral-300 font-mono uppercase text-xs font-bold tracking-wider">
                    Post-Processing & Calibration
                  </span>
                </div>

                <CustomSelect
                  label="Post-Processing Profile"
                  options={[
                    { value: "low", label: "Low (Direct Color Buffer)" },
                    { value: "high", label: "High (HDR Tone Mapping & FX)" },
                    { value: "cinematic", label: "Cinematic (Full Pipeline Pass)" }
                  ]}
                  value={postProcessing}
                  onChange={(val) => handleCustomSetting({ postProcessing: val })}
                />

                <div className="grid grid-cols-1 gap-4">
                  <div className="p-4 border border-[#26262b] bg-[#101013] space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-neutral-300 font-mono uppercase text-xs font-bold flex items-center gap-1.5">
                        Bloom Glow Intensity
                      </label>
                      <span className="text-red-500 font-mono text-xs font-bold tabular-nums">{Math.round(bloomIntensity * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" max="2" step="0.1" 
                      value={bloomIntensity} 
                      onChange={(e) => handleCustomSetting({ bloomIntensity: parseFloat(e.target.value) })}
                      className="w-full h-2 appearance-none bg-neutral-800 accent-red-600 border border-neutral-700 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AUDIO & HAPTICS */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-neutral-200 font-mono uppercase text-xs font-bold">Master Volume</label>
                  <span className="text-red-500 font-mono text-xs font-bold tabular-nums">{Math.round(masterVol * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="1" step="0.01" 
                  value={masterVol} 
                  onChange={handleMasterChange} 
                  className="w-full h-2 appearance-none bg-neutral-800 accent-red-600 border border-neutral-700 cursor-pointer"
                />
              </div>

              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-neutral-200 font-mono uppercase text-xs font-bold">Ambient & Music Volume</label>
                  <span className="text-red-500 font-mono text-xs font-bold tabular-nums">{Math.round(ambientVol * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="1" step="0.01" 
                  value={ambientVol} 
                  onChange={handleAmbientChange} 
                  className="w-full h-2 appearance-none bg-neutral-800 accent-red-600 border border-neutral-700 cursor-pointer"
                />
              </div>

              {/* Gamepad Haptics Section */}
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-xs font-bold uppercase text-neutral-100 tracking-wider block">
                      Gamepad Rumble & Haptics
                    </span>
                    <span className="text-[11px] text-neutral-500 font-mono">
                      {gamepadConnected ? 'Gamepad Connected' : 'No Controller Detected'}
                    </span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={rumbleEnabled}
                    onClick={() => {
                      const nextVal = !rumbleEnabled;
                      handleCustomSetting({ rumbleEnabled: nextVal });
                      if (nextVal) {
                        vibrateGamepad('rumble', { duration: 150 });
                      }
                    }}
                    className={`min-h-[40px] px-4 py-2 font-mono text-xs font-bold transition-colors border cursor-pointer ${
                      rumbleEnabled 
                        ? 'bg-[#250909] border-red-800 text-neutral-100' 
                        : 'bg-[#121215] border-[#26262b] text-neutral-500'
                    }`}
                  >
                    {rumbleEnabled ? 'RUMBLE ON' : 'RUMBLE OFF'}
                  </button>
                </div>

                {rumbleEnabled && (
                  <div className="space-y-2 pt-2 border-t border-[#26262b]">
                    <div className="flex justify-between items-center">
                      <label className="text-neutral-300 font-mono uppercase text-xs font-bold">Vibration Intensity</label>
                      <span className="text-red-500 font-mono text-xs font-bold tabular-nums">{Math.round(rumbleIntensity * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" max="1.0" step="0.05" 
                      value={rumbleIntensity} 
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        handleCustomSetting({ rumbleIntensity: val });
                        vibrateGamepad('rumble', { duration: 100, weak: 0.25 * val });
                      }}
                      className="w-full h-2 appearance-none bg-neutral-800 accent-red-600 border border-neutral-700 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: CONTROLS */}
          {activeTab === 'controls' && (
            <div className="space-y-4">
              {/* Input Mode Selector (Keyboard & Mouse / Controller / Touchscreen) */}
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-mono text-xs font-bold uppercase text-neutral-100 tracking-wider block">
                      Active Input Mode
                    </span>
                    <span className="text-[11px] text-neutral-500 font-mono">
                      {gamepadConnected
                        ? `Controller detected (${connectedControllerName.slice(0, 34) || 'USB/Bluetooth'})`
                        : 'Select primary control interface'}
                    </span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={autoDetectInput}
                    onClick={() => {
                      const next = !autoDetectInput;
                      setAutoDetectInput(next);
                      setControllerSettings({ autoDetectInput: next });
                    }}
                    className={`px-3 py-1.5 border font-mono text-[10px] font-bold uppercase tracking-wider cursor-pointer ${
                      autoDetectInput
                        ? 'bg-[#250909] border-red-800 text-neutral-100'
                        : 'bg-[#121215] border-[#26262b] text-neutral-500'
                    }`}
                  >
                    AUTO-SWITCH: {autoDetectInput ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'kbm' as const, label: 'Keyboard & Mouse', sub: 'Desktop reticle & keys', icon: <Monitor className="w-4 h-4" /> },
                    { id: 'gamepad' as const, label: 'Controller', sub: 'Stick look, triggers & glyphs', icon: <Gamepad2 className="w-4 h-4" /> },
                    { id: 'touch' as const, label: 'Touchscreen', sub: 'Drag look, tap & thumb triggers', icon: <Smartphone className="w-4 h-4" /> },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setInputMode(mode.id)}
                      className={`min-h-[48px] px-3 py-2.5 border font-mono text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                        inputType === mode.id
                          ? 'bg-[#250909] border-red-800 text-neutral-100'
                          : 'bg-[#121215] border-[#26262b] text-neutral-400 hover:bg-[#18181c] hover:text-neutral-200'
                      }`}
                    >
                      <span className={inputType === mode.id ? 'text-red-400' : 'text-neutral-500'}>
                        {mode.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase truncate">{mode.label}</div>
                        <div className="text-[10px] text-neutral-500 truncate">{mode.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Controller Prompt Layout Selector (Universal / Nintendo / PlayStation / Xbox) */}
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-mono text-xs font-bold uppercase text-neutral-100 tracking-wider block">
                      Controller Button Layout
                    </span>
                    <span className="text-[11px] text-neutral-500 font-mono">
                      Matches face glyphs, colors & confirm convention
                    </span>
                  </div>
                  {gamepadConnected && (
                    <button
                      type="button"
                      onClick={() => {
                        const gp = getConnectedGamepad();
                        if (gp) {
                          const detected = detectControllerLayoutFromId(gp.id);
                          selectControllerLayout(detected);
                        }
                      }}
                      className="px-2.5 py-1 border border-[#2e2e34] bg-[#16161a] hover:bg-[#222228] text-neutral-300 font-mono text-[10px] font-bold uppercase cursor-pointer"
                    >
                      Detect Connected
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(['universal', 'nintendo', 'playstation', 'xbox'] as ControllerLayout[]).map((layoutId) => {
                    const meta = CONTROLLER_LAYOUT_META[layoutId];
                    const isSelected = controllerLayout === layoutId;
                    return (
                      <button
                        key={layoutId}
                        type="button"
                        onClick={() => selectControllerLayout(layoutId)}
                        className={`p-3 border font-mono flex items-center justify-between gap-3 transition-colors cursor-pointer text-left ${
                          isSelected
                            ? 'bg-[#250909] border-red-800 text-neutral-100'
                            : 'bg-[#121215] border-[#26262b] text-neutral-400 hover:bg-[#18181c] hover:text-neutral-200'
                        }`}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-xs font-bold uppercase tracking-wider">{meta.name}</div>
                          <div className="text-[10px] text-neutral-500 leading-snug">{meta.subtitle}</div>
                        </div>

                        {/* Authentic 4-button physical diamond preview */}
                        <div className="relative w-12 h-12 shrink-0">
                          <div className="absolute top-0 left-1/2 -translate-x-1/2">
                            <ControllerGlyph role="north" layout={layoutId} size="xs" />
                          </div>
                          <div className="absolute right-0 top-1/2 -translate-y-1/2">
                            <ControllerGlyph role={layoutId === 'nintendo' ? 'confirm' : 'cancel'} layout={layoutId} size="xs" />
                          </div>
                          <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                            <ControllerGlyph role={layoutId === 'nintendo' ? 'cancel' : 'confirm'} layout={layoutId} size="xs" />
                          </div>
                          <div className="absolute left-0 top-1/2 -translate-y-1/2">
                            <ControllerGlyph role="west" layout={layoutId} size="xs" />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Camera Look Sensitivity Sliders */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 border border-[#26262b] bg-[#101013] space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-neutral-200 font-mono uppercase text-xs font-bold">
                      Right Stick Look Speed
                    </label>
                    <span className="text-red-500 font-mono text-xs font-bold tabular-nums">
                      {rightStickSensitivity.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="2.0"
                    step="0.1"
                    value={rightStickSensitivity}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setRightStickSensitivity(val);
                      setControllerSettings({ rightStickSensitivity: val });
                    }}
                    className="w-full h-2 appearance-none bg-neutral-800 accent-red-600 border border-neutral-700 cursor-pointer"
                  />
                </div>

                <div className="p-4 border border-[#26262b] bg-[#101013] space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-neutral-200 font-mono uppercase text-xs font-bold">
                      Touch Drag Look Speed
                    </label>
                    <span className="text-red-500 font-mono text-xs font-bold tabular-nums">
                      {touchLookSensitivity.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="2.0"
                    step="0.1"
                    value={touchLookSensitivity}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setTouchLookSensitivity(val);
                      setControllerSettings({ touchLookSensitivity: val });
                    }}
                    className="w-full h-2 appearance-none bg-neutral-800 accent-red-600 border border-neutral-700 cursor-pointer"
                  />
                </div>
              </div>

              <div className="p-4 border border-[#26262b] bg-[#101013] flex items-center justify-between gap-4">
                <div>
                  <span className="font-mono text-xs font-bold uppercase text-neutral-100 tracking-wider block">
                    On-Screen Control Hints Bar
                  </span>
                  <span className="text-[11px] text-neutral-500 font-mono">
                    Show top shortcut hints during play
                  </span>
                </div>
                <button 
                  role="switch"
                  aria-checked={showKeyboardHudSetting}
                  onClick={() => {
                    const nextVal = !showKeyboardHudSetting;
                    setShowKeyboardHudSetting(nextVal);
                    setControllerSettings({ showKeyboardHud: nextVal });
                  }}
                  className={`min-h-[40px] px-4 py-2 border font-mono text-xs font-bold transition-colors cursor-pointer ${
                    showKeyboardHudSetting
                      ? 'bg-[#250909] border-red-800 text-neutral-100'
                      : 'bg-[#121215] border-[#26262b] text-neutral-500'
                  }`}
                >
                  {showKeyboardHudSetting ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              {/* Layout-Aware Controller Bindings & Live Calibration */}
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-neutral-300 uppercase text-[11px] tracking-wider font-bold">
                      {CONTROLLER_LAYOUT_META[controllerLayout].name} Controller Bindings
                    </h3>
                    <span className="text-[10px] text-neutral-500">
                      {gamepadConnected
                        ? `${gamepadMappingMode === 'standard' ? 'Standard W3C Mapping' : 'Raw HID Auto-Normalized'} · Click any action to rebind`
                        : 'Click any action below to calibrate or override'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextSwap = !swapWestNorth;
                        setSwapWestNorth(nextSwap);
                        setControllerSettings({ swapWestNorth: nextSwap });
                        vibrateGamepad('click');
                      }}
                      className={`px-2.5 py-1 border font-mono text-[10px] font-bold uppercase cursor-pointer ${
                        swapWestNorth
                          ? 'bg-[#250909] border-red-800 text-neutral-100'
                          : 'bg-[#16161a] border-[#2e2e34] text-neutral-300 hover:bg-[#222228]'
                      }`}
                    >
                      {swapWestNorth ? 'Left/Top Swapped' : 'Swap Left / Top'}
                    </button>
                    {(swapWestNorth || Object.keys(customButtonMap).length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSwapWestNorth(false);
                          setCustomButtonMap({});
                          setListeningAction(null);
                          setControllerSettings({ swapWestNorth: false, customButtonMap: {} });
                          vibrateGamepad('click');
                        }}
                        className="px-2.5 py-1 border border-[#2e2e34] bg-[#16161a] hover:bg-[#222228] text-neutral-400 hover:text-neutral-200 font-mono text-[10px] font-bold uppercase cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {gamepadConnected && (
                  <div className="px-3 py-2 bg-[#141418] border border-[#242429] flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-neutral-400 uppercase">
                      {listeningAction
                        ? `Press any physical button to bind: ${listeningAction.toUpperCase()}...`
                        : 'Live Controller Input Test:'}
                    </span>
                    <span className="text-neutral-200 font-bold tabular-nums">
                      {liveRawButtons.length > 0
                        ? `Raw Btn ${liveRawButtons.map((i) => `#${i}`).join(', ')}`
                        : listeningAction
                        ? 'Waiting...'
                        : 'Press a button'}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-neutral-300">
                  {([
                    { action: 'confirm' as const, label: 'Confirm / Use / Buy', role: 'confirm' as const },
                    { action: 'cancel' as const, label: 'Toggle Item Targeting', role: 'cancel' as const },
                    { action: 'north' as const, label: 'Black Market / Back', role: 'north' as const },
                    { action: 'lt' as const, label: 'Shoot Self', role: 'lt' as const },
                    { action: 'rt' as const, label: 'Shoot Dealer (Revamped)', role: 'rt' as const },
                  ]).map((row) => {
                    const customIdx = customButtonMap[row.action];
                    const isListening = listeningAction === row.action;
                    return (
                      <button
                        key={row.action}
                        type="button"
                        onClick={() => {
                          setListeningAction((curr) => (curr === row.action ? null : row.action));
                          vibrateGamepad('click');
                        }}
                        className={`p-2.5 border flex justify-between items-center text-left transition-colors cursor-pointer ${
                          isListening
                            ? 'bg-[#2a0909] border-red-500 text-neutral-100'
                            : 'bg-[#141418] border-[#242429] hover:bg-[#1a1a20]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate">{row.label}</div>
                          {typeof customIdx === 'number' && !isListening && (
                            <div className="text-[9px] text-amber-400 uppercase">Custom: Btn #{customIdx}</div>
                          )}
                          {isListening && (
                            <div className="text-[9px] text-red-400 uppercase">Press controller button...</div>
                          )}
                        </div>
                        <ControllerGlyph role={row.role} layout={controllerLayout} size="sm" />
                      </button>
                    );
                  })}
                  <div className="p-2.5 bg-[#141418] border border-[#242429] flex justify-between items-center">
                    <span>Cycle Items / Shop</span>
                    <span className="flex items-center gap-1">
                      <ControllerGlyph role="lb" layout={controllerLayout} size="xs" />
                      <ControllerGlyph role="rb" layout={controllerLayout} size="xs" />
                      <ControllerGlyph role="dpad" layout={controllerLayout} size="xs" />
                    </span>
                  </div>
                  <div className="p-2.5 bg-[#141418] border border-[#242429] flex justify-between items-center">
                    <span>Camera Look / Cursor</span>
                    <span className="flex items-center gap-1">
                      <ControllerGlyph role="rstick" layout={controllerLayout} size="xs" />
                      <ControllerGlyph role="select" layout={controllerLayout} size="xs" />
                    </span>
                  </div>
                </div>
              </div>

              {/* Touchscreen & Keyboard Bindings */}
              <div className="p-4 border border-[#26262b] bg-[#101013] space-y-3 font-mono text-xs">
                <h3 className="text-neutral-400 uppercase text-[11px] tracking-wider font-bold">Touchscreen & Keyboard</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-neutral-300">
                  <div className="p-2.5 bg-[#141418] border border-[#242429] flex justify-between items-center gap-2">
                    <span>Touch: Look Around</span>
                    <span className="bg-[#1b1b20] text-neutral-200 px-2 py-0.5 font-bold border border-[#2e2e34] text-[10px]">DRAG SCREEN</span>
                  </div>
                  <div className="p-2.5 bg-[#141418] border border-[#242429] flex justify-between items-center gap-2">
                    <span>Touch: Inspect / Trigger</span>
                    <span className="bg-[#1b1b20] text-neutral-200 px-2 py-0.5 font-bold border border-[#2e2e34] text-[10px]">TAP · TAP AGAIN</span>
                  </div>
                  <div className="p-2.5 bg-[#141418] border border-[#242429] flex justify-between items-center">
                    <span>Keys: Shoot Self / Dealer</span>
                    <span className="bg-[#1b1b20] text-neutral-200 px-2 py-0.5 font-bold border border-[#2e2e34]">S / D</span>
                  </div>
                  <div className="p-2.5 bg-[#141418] border border-[#242429] flex justify-between items-center">
                    <span>Keys: Items & Market</span>
                    <span className="bg-[#1b1b20] text-neutral-200 px-2 py-0.5 font-bold border border-[#2e2e34]">1-8 · Q</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </IndustrialScrollArea>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 border-t border-[#26262b] bg-[#0e0e11] flex items-center justify-between gap-4">
          {inputType === 'gamepad' ? (
            <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono text-neutral-500 uppercase">
              <span className="flex items-center gap-1.5">
                <ControllerGlyph role="confirm" layout={controllerLayout} size="xs" />
                <span>Select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <ControllerGlyph role="dpad" layout={controllerLayout} size="xs" />
                <span>Navigate</span>
              </span>
            </div>
          ) : <div />}
          <button 
            className="back-btn btn-rusty flex-1 sm:flex-initial min-h-[44px] px-7 py-2.5 text-xs font-bold tracking-widest flex items-center justify-center gap-3 cursor-pointer" 
            onClick={onClose}
          >
            {inputType === 'gamepad' && (
              <ControllerGlyph role="cancel" layout={controllerLayout} size="md" />
            )}
            <span>RETURN</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
