import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGPURenderer, RenderPipeline, PMREMGenerator, MeshBasicNodeMaterial } from 'three/webgpu';
import { pass, reflector } from 'three/tsl';
import { fsr1 } from 'three/examples/jsm/tsl/display/FSR1Node.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import { createProceduralTextureSet, createArenaEnvironmentScene } from '../graphics/ProceduralTextures';
import { WebGPUComputeBloodSystem } from '../graphics/WebGPUComputeBlood';
import { WebGPUComputeSparksSystem } from '../graphics/WebGPUComputeSparks';
import { WebGPUVolumetricSmokeSystem } from '../graphics/WebGPUVolumetricSmoke';
import { WebGPUAdvancedPipeline } from '../graphics/WebGPUAdvancedPipeline';
import { createDetailedRevolverModel, createDetailedSeveredBarrelPiece, RevolverRig } from '../graphics/RevolverModel';
import { createGoreGeometries, createDealerWoundsSystem, createWristSlashWoundGroup, createMedkitForearmSystem } from '../graphics/LowPolyGore';
import { motion } from 'motion/react';
import { GameState, Chamber, PlayerState, ItemType, Difficulty, GameBranch } from '../types';
import { getItemPrice, ITEM_METADATA, getRarityTagHtml } from '../gameData';
import {
  playBulletLoad,
  playCockSound,
  playTapSound,
  playPurchaseSound,
  playSyringeCap,
  playSyringeSlam,
  playThumpSound,
  playMirrorInspect,
  playWhiskeyDrink,
  playTourniquetTighten,
  playPentagramChant,
  playDefibrillatorShock,
  playMedkitSupplySound,
  playRazorSlice,
  playScalpelCut,
  playZippoOpen,
  playZippoStrike,
  playZippoClose,
  playCigaretteDrag,
  playSmokeExhale,
  playPliersSound,
  playPliersGripSound,
  playCylinderLatchSound,
  playGunDropSound,
  playGunFloorClatter,
  playBloodDrip,
  playBloodImpactSplatter,
} from '../audio';
import {
  getControllerSettings,
  subscribeControllerSettings,
  ControllerLayout,
  InputType,
  markMouseOrKeyActivity,
  markTouchActivity,
  isSyntheticMouseFromTouch,
  pollGamepadAutoSwitch,
  readSemanticGamepad,
  vibrateGamepad,
} from '../controller';
import { ControllerGlyph, getControllerGlyphHtml } from './ControllerGlyph';
import {
  createWebGPURenderer,
  isWebGPUSupported,
  activateWebGpuEmergencyFallback,
} from '../renderers/RendererManager';
import {
  estimateRoughHardwareProfile,
  RoughHardwareProfile,
} from '../graphics/RoughHardwareProfile';
import {
  WebGPUWatchdog,
  WebGPUFailureReport,
} from '../graphics/WebGPUWatchdog';
import { AlertCircle, Terminal, Cpu, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';

export interface ShaderCompileProgress {
  backend: string;
  stage: string;
  progress: number;
  compiled: number;
  total: number;
  elapsedMs: number;
}

interface Arena3DProps {
  gameState: GameState;
  chambers: Chamber[];
  currentChamberIndex: number;
  player: PlayerState;
  dealer: PlayerState;
  message: string;
  subMessage: string;
  bloodLevel: number;
  doubleDamageActive: 'player' | 'dealer' | null;
  retaliationActive: boolean;
  selectedItemIndex: number;
  bloodCurrency: number;
  showControls: boolean;
  useItem: (index: number, target: 'player' | 'dealer') => void;
  fireGun: (target: 'player' | 'dealer', sender: 'player' | 'dealer') => void;
  buyItem: (type: ItemType, cost: number) => void;
  playerDamageReductionEnd: number | null;
  dealerDamageReductionEnd: number | null;
  difficulty?: Difficulty;
  branch?: GameBranch;
  shooter: 'player' | 'dealer' | null;
  target: 'player' | 'dealer' | null;
  onShaderCompileProgress?: (info: ShaderCompileProgress) => void;
  onShaderCompileComplete?: () => void;
  onShaderCompileError?: (message: string) => void;
}

const ITEM_DESCS: Record<string, string> = {
  MIRROR: 'PEEK AT THE CURRENT CYLINDER CHAMBER IN THE REVOLVER.',
  PLIERS: 'DISCHARGE THE NEXT ROUND SAFELY OUTSIDE THE CYLINDER.',
  WHISKEY: 'RESTORES A PORTION OF YOUR HEALTH AT THE EXPENSE OF TEMPORARY BLURRY SENSES.',
  TOURNIQUET: 'BLOOD TRANSFUSION INSULATION. BUFFER HARMFUL BLOWS AND NEXT INCOMING PROJECTILES.',
  PENTAGRAM: 'BLOOD SACRIFICE. RELOADS REVOLVER CYLINDER DIRECTLY WITH A STRENGTHENED BARREL.',
  CIGARETTE: 'NICOTINE DRAG. STEADIES TREMBLING NERVES, BLOCKING 30 HP DAMAGE FOR 20 SECONDS.',
  SCALPEL: 'CUTS THE BARREL TOP. THE NEXT DISCHARGED LIVE SHELL DEALS DOUBLE THE AGONY.',
  DEFIBRILLATOR: 'ELECTRIC RESTART CHARGE. AUTOMATIC RESUSCITATION GUARANTEE IN CASE OF TERMINAL IMPACTS.',
  SYRINGE: 'INSTANT SURGE. DIRECT INJECTION THAT RESTORES 50 HP TO VITALITY.',
  RAZORBLADE: 'SLASH FLESH TO MAGICALLY CONVERT THE CURRENT BLANK INTO A LIVE ROUND AT THE COST OF 10 HP.',
  MEDKIT: 'ADVANCED MEDICAL SUPPLIES. FULLY RESTORES HEALTH TO MAXIMUM.'
};

const getItemDescription = (type: string, currentBranch: GameBranch = 'REVAMPED'): string => {
  if (type === 'MIRROR' && currentBranch === 'CLASSIC') {
    return 'SUPERNATURAL MIRROR. REVEALS THE CURRENT CHAMBER AND CURSES AN UPCOMING BLANK INTO A LIVE ROUND.';
  }
  return ITEM_DESCS[type] || 'Mystic contract elements';
};

// Universal safety patch on LightShadow.prototype.map to prevent "Cannot read properties of null (reading 'depthTexture')"
const dummyLight = new THREE.DirectionalLight();
const LightShadowClass = Object.getPrototypeOf(dummyLight.shadow.constructor); // Get base LightShadow class
if (LightShadowClass && LightShadowClass.prototype && !(LightShadowClass.prototype as any)._safeMapPatched) {
  (LightShadowClass.prototype as any)._safeMapPatched = true;
  const dummyRenderTarget: any = {
    texture: new THREE.Texture(),
    depthTexture: new THREE.DepthTexture(1, 1),
    width: 1,
    height: 1,
    dispose: () => {},
  };
  const realMapSymbol = Symbol('realMap');
  Object.defineProperty(LightShadowClass.prototype, 'map', {
    get() {
      return this[realMapSymbol] ?? dummyRenderTarget;
    },
    set(val) {
      this[realMapSymbol] = val;
    },
    configurable: true,
    enumerable: true,
  });
}

export function Arena3D({
  gameState,
  chambers,
  currentChamberIndex,
  player,
  dealer,
  message,
  subMessage,
  bloodLevel,
  doubleDamageActive,
  retaliationActive,
  selectedItemIndex,
  bloodCurrency,
  showControls,
  useItem,
  fireGun,
  buyItem,
  playerDamageReductionEnd,
  dealerDamageReductionEnd,
  difficulty = 'NORMAL',
  branch = 'REVAMPED',
  shooter,
  target,
  onShaderCompileProgress,
  onShaderCompileComplete,
  onShaderCompileError,
}: Arena3DProps) {
  const onCompileProgressRef = useRef(onShaderCompileProgress);
  const onCompileCompleteRef = useRef(onShaderCompileComplete);
  const onCompileErrorRef = useRef(onShaderCompileError);
  onCompileProgressRef.current = onShaderCompileProgress;
  onCompileCompleteRef.current = onShaderCompileComplete;
  onCompileErrorRef.current = onShaderCompileError;
  const [inputType, setInputType] = useState<InputType>('kbm');
  const [controllerLayout, setControllerLayout] = useState<ControllerLayout>('xbox');
  const [graphics, setGraphics] = useState({
      antiAliasing: 'fxaa',
      postProcessing: 'low',
      shadowQuality: 'low',
      textureFiltering: 2,
      materialEnhancements: true,
      bloomIntensity: 0.2,
      polygonCount: 'low'
  });

  useEffect(() => {
    const initialSettings = getControllerSettings();
    setInputType(initialSettings.inputType || 'kbm');
    setControllerLayout(initialSettings.controllerLayout || 'xbox');
    setGraphics({
        antiAliasing: initialSettings.antiAliasing || 'fxaa',
        postProcessing: initialSettings.postProcessing || 'low',
        shadowQuality: initialSettings.shadowQuality || 'low',
        textureFiltering: initialSettings.textureFiltering || 2,
        materialEnhancements: initialSettings.materialEnhancements !== false,
        bloomIntensity: initialSettings.bloomIntensity ?? 0.2,
        polygonCount: initialSettings.polygonCount || 'low'
    });
    const unsub = subscribeControllerSettings(s => {
       setInputType(s.inputType);
       setControllerLayout(s.controllerLayout || 'xbox');
       setGraphics({
          antiAliasing: s.antiAliasing || 'fxaa',
          postProcessing: s.postProcessing || 'low',
          shadowQuality: s.shadowQuality || 'low',
          textureFiltering: s.textureFiltering || 2,
          materialEnhancements: s.materialEnhancements !== false,
          bloomIntensity: s.bloomIntensity ?? 0.2,
          polygonCount: s.polygonCount || 'low'
       });
    });
    return () => unsub();
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Screnspace overlays refs for performance
  const popupRef = useRef<HTMLDivElement>(null);
  const popupNameRef = useRef<HTMLDivElement>(null);
  const popupDescRef = useRef<HTMLDivElement>(null);

  const [hoveredInfo, setHoveredInfo] = useState<{
    type: string;
    name: string;
    description: string;
    index?: number;
    shopType?: ItemType;
    cost?: number;
  } | null>(null);

  interface ScreenSplat {
    id: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    variant: number;
  }

  const [screenSplats, setScreenSplats] = useState<ScreenSplat[]>([]);
  const splatIdCounter = useRef(0);

    const spawnScreenSplat = () => {
    const s = getControllerSettings();
    if (s.bloodEffectsEnabled === false) return;
    const id = splatIdCounter.current++;
    const pQuality = s.particleQuality || 'low';
    const isLow = pQuality === 'low';
    const newSplat: ScreenSplat = {
      id,
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      scale: isLow ? (0.65 + Math.random() * 0.75) : (0.85 + Math.random() * 1.65),
      rotation: Math.random() * 360,
      variant: Math.floor(Math.random() * 3),
    };
    setScreenSplats(prev => [...prev, newSplat]);
    setTimeout(() => {
      setScreenSplats(prev => prev.filter(s => s.id !== id));
    }, 3800);
  };

  const lastProcessedHealth = useRef({ player: 0, dealer: 0 });

  useEffect(() => {
    if (gameState === 'SHOOTING') {
      const isDamaged = player.health < lastProcessedHealth.current.player || dealer.health < lastProcessedHealth.current.dealer;
      if (isDamaged) {
          // Intense screen splatter
          spawnScreenSplat();
          setTimeout(spawnScreenSplat, 150);
          setTimeout(spawnScreenSplat, 350);
          
          if (dealer.health < lastProcessedHealth.current.dealer) {
            stateRef.current.dealerFlinchTime = Date.now();
          }
      }
    }
    lastProcessedHealth.current = { player: player.health, dealer: dealer.health };
  }, [player.health, dealer.health, gameState]);

  const isLookingAtShopRef = useRef(false);
  const [debugToggle, setDebugToggle] = useState(0); // Force re-render simple UI
  const [showKeyboardHud, setShowKeyboardHud] = useState(true);
  const [webGpuError, setWebGpuError] = useState<string | null>(null);
  const [isRecheckingWebGpu, setIsRecheckingWebGpu] = useState(false);
  const [fallbackOverlay, setFallbackOverlay] = useState<{
    phase: 'switching' | 'complete';
    reason: string;
    progress: number;
    stage: string;
  } | null>(null);
  const webGpuErrorRef = useRef<string | null>(null);
  const fallbackOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    webGpuErrorRef.current = webGpuError;
  }, [webGpuError]);

  const handleRetryWebGpu = async () => {
    setIsRecheckingWebGpu(true);
    try {
      const check = await isWebGPUSupported(true);
      if (!check.supported) {
        setWebGpuError(check.reason || 'Hardware acceleration remains disabled or unsupported.');
      } else {
        setWebGpuError(null);
        window.location.reload();
      }
    } catch (e: any) {
      setWebGpuError(e?.message || 'Renderer re-initialization failed.');
    } finally {
      setIsRecheckingWebGpu(false);
    }
  };
  const mouseInactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lookYawRef = useRef(0);
  const lookPitchRef = useRef(0);

  // Update refs to track latest props
  const stateRef = useRef({
    gameState,
    difficulty,
    branch,
    chambers,
    currentChamberIndex,
    player,
    dealer,
    message,
    subMessage,
    bloodLevel,
    doubleDamageActive,
    retaliationActive,
    selectedItemIndex,
    bloodCurrency,
    showControls,
    playerDamageReductionEnd,
    dealerDamageReductionEnd,
    lookTargetVec: null as THREE.Vector3 | null,
    camPosVec: null as THREE.Vector3 | null,
    dealerFlinchTime: 0,
    isTouchActive: inputType === 'touch',
    controllerLayout,
    graphics,
    shooter: shooter,
    target: target,
  });

  useEffect(() => {
    stateRef.current = {
      gameState,
      difficulty,
      branch,
      chambers,
      currentChamberIndex,
      player,
      dealer,
      message,
      subMessage,
      bloodLevel,
      doubleDamageActive,
      retaliationActive,
      selectedItemIndex,
      bloodCurrency,
      showControls,
      playerDamageReductionEnd,
      dealerDamageReductionEnd,
      lookTargetVec: stateRef.current.lookTargetVec,
      camPosVec: stateRef.current.camPosVec,
      dealerFlinchTime: stateRef.current.dealerFlinchTime,
      isTouchActive: inputType === 'touch',
      controllerLayout,
      graphics,
      shooter,
      target,
    };
  }, [
    gameState,
    difficulty,
    branch,
    chambers,
    currentChamberIndex,
    player,
    dealer,
    message,
    subMessage,
    bloodLevel,
    doubleDamageActive,
    retaliationActive,
    selectedItemIndex,
    bloodCurrency,
    showControls,
    playerDamageReductionEnd,
    dealerDamageReductionEnd,
    inputType,
    controllerLayout,
    graphics,
    shooter,
    target,
  ]);

  // Persist animation state across prop updates to prevent double-animations
  const animRef = useRef({
    tickCount: 0,
    time: 0,
    cameraShakeIntensity: 0,
    cameraKickZ: 0,
    cameraKickPitch: 0,
    cameraKickRoll: 0,
    lookTargetY: 0.6,
    deathAnimStartTime: 0,
    loadingAnimStartTime: 0,
    loadedBulletsCount: 0,
    bulletLoadedFlags: [false, false, false, false, false, false],
    hasSpunCylinder: false,
    hasClosedCylinder: false,
    localCylinderAngle: 0,
    previousChamberIndex: currentChamberIndex,
    previousGameState: gameState,
    previousChambers: chambers,
    dealerSmileFactor: 0.0,
    dealerMouthOpenFactor: 0.0,
    dealerHeadTiltFactor: 0.0,
    nextBlinkTime: 0,
    blinkStartTime: 0,
    blinkDuration: 0.15,
    isDoubleBlinkPending: false,
    activeItemAnimType: null as ItemType | null,
    hasEjectedPliers: false,
    hasSlammedSyringe: false,
    hasWithdrawnSyringeBlood: false,
    hasCappedSyringe: false,
    hasTappedSyringe: false,
    hasTappedSyringe2: false,
    hasSlicedRazor: false,
    hasLitCigarette: false,
    hasOpenedZippo: false,
    hasStruckZippo: false,
    hasClosedZippo: false,
    hasDraggedCigarette: false,
    hasShedCigAsh: false,
    hasExhaledSmoke: false,
    hasPlayedMirrorSound: false,
    hasPlayedMirrorCurseSpark: false,
    hasPlayedWhiskeySound: false,
    hasPlayedTourniquetSound: false,
    hasPlayedPentagramSound: false,
    hasPlayedDefibSound: false,
    hasPlayedMedkitSetDown: false,
    hasPlayedMedkitSound: false,
    hasPlayedMedkitUnlatchR: false,
    hasPlayedMedkitOpenLid: false,
    hasPlayedMedkitSprayShake: false,
    hasPlayedMedkitSpray: false,
    hasPlayedMedkitSpray2: false,
    hasPlayedMedkitGauze: false,
    hasPlayedMedkitGauzeWrap: false,
    hasPlayedMedkitPills: false,
    hasPlayedMedkitPillPour: false,
    hasPlayedMedkitSwallow: false,
    hasPlayedMedkitClose: false,
    hasPlayedPliersOpen: false,
    hasPlayedPliersGrip: false,
    hasPlayedPliersClose: false,
    hasPlayedScalpelSawSound: false,
    hasSpawnedSeveredBarrel: false,
    gunBarrelFrontGroup: null as THREE.Group | null,
    isSawedOff: false,
    activeItemAnimUser: 'player' as 'player' | 'dealer',
    activeItemAnimStartTime: 0,
    activeItemAnimGroup: null as THREE.Group | null,
    activeZippoGroup: null as THREE.Group | null,
    actionCamOffset: new THREE.Vector3(),
    actionLookOffset: new THREE.Vector3(),
    activeShootAnimationState: 'IDLE' as 'IDLE' | 'RAISING' | 'AIM_ALERT' | 'FIRE_RECOIL' | 'CLEAN_UP',
    activeShootStartTime: 0,
    lastAimVibrateTime: 0,
    hasDischarged: false,
    hasCockingSoundPlayed: false,
    isFirstShotAfterLoad: false,
    animSuppressCockAudio: false,
    pliersEjectChamberIdx: -1,
    isTargetDealer: false,
    animShooter: 'player' as 'player' | 'dealer',
    animTarget: 'player' as 'player' | 'dealer',
    animIsLive: false,
    lastFireTime: 0,
    isFadingBlood: false,
    bloodFadeTimer: 0,
    lastFireIsLive: false,
    gunBloodyUntil: 0,
    hasThumpedPlayerFall: false,
    hasThumpedPlayerTable: false,
    hasThumpedDealerFall: false,
    dealerDeathStartTime: 0,
    previousRoundsSurvived: -1,
    wasPlayerDead: false,
    wasDealerDead: false,
    hasInitializedRound: false,
    smoothMouseX: 0,
    smoothMouseY: 0,
    instantiatedPlayerCount: 0,
    instantiatedDealerCount: 0,
    rebuildRequired: false,
    prevMuzzleWorldPos: null as THREE.Vector3 | null,
    // Fluid & Liquid Physics Simulation State
    whiskeyVolume: 1.0,
    whiskeySloshAngleX: 0,
    whiskeySloshAngleZ: 0,
    whiskeySloshVelX: 0,
    whiskeySloshVelZ: 0,
    syringeBubblePos: 0.28,
    syringeBubblePosX: 0.008,
    syringeBubblePosZ: 0,
    syringeBubbleVel: 0,
    syringeBubbleVelX: 0,
    syringeBubbleVelZ: 0,
    syringeFluidVolume: 1.0,
    syringeFluidOscillation: 0,
    syringeFluidOscVel: 0,
    prevItemPos: new THREE.Vector3(),
    prevItemRot: new THREE.Euler(),
    muzzleFlashIntensity: 0,
    revolverTriggerPull: 0,
    revolverReturnBounceTime: 0,
    shopTransitionArc: 0,
    actionFovOffset: 0,
    // Rigid-body lethal self-shot revolver drop physics state
    isPlayerDeathGunDropping: false,
    wasPlayerSelfLiveShot: false,
    gunFallSettled: false,
    gunFallBounceCount: 0,
    gunFallSettleFrames: 0,
    gunFallLastClatterMs: 0,
    gunFallStartTime: 0,
    gunFallPos: new THREE.Vector3(),
    gunFallVel: new THREE.Vector3(),
    gunFallQuat: new THREE.Quaternion(),
    gunFallAngVel: new THREE.Vector3(),
  });

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const container = containerRef.current;
    let activeCanvas: HTMLCanvasElement = canvasRef.current;

    let handleResize: (() => void) | null = null;
    const proceduralTextures = createProceduralTextureSet();

    // --- MATERIALS (CONSOLIDATED AT TOP) ---
    const rustySteelMat = new THREE.MeshStandardMaterial({
      color: 0x3d302d,
      roughness: 0.88,
      metalness: 0.72,
      bumpMap: proceduralTextures.gunMetalBumpMap,
      bumpScale: 0.014,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xb58900,
      metalness: 0.9,
      roughness: 0.22,
    });
    const darkMetalStyle = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.88,
      metalness: 0.35,
    });
    const cloakMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      roughness: 0.94,
      metalness: 0.04,
      bumpMap: proceduralTextures.cloakBumpMap,
      bumpScale: 0.025,
      flatShading: true,
    });
    const maskLineMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const gunMetalMat = new THREE.MeshStandardMaterial({
      color: 0x262c2f,
      roughness: 0.38,
      metalness: 0.88,
      roughnessMap: proceduralTextures.gunMetalRoughnessMap,
      bumpMap: proceduralTextures.gunMetalBumpMap,
      bumpScale: 0.012,
    });
    const stockMat = new THREE.MeshStandardMaterial({
      color: 0x6b3a24,
      roughness: 0.68,
      metalness: 0.05,
      map: proceduralTextures.woodGripMap,
      bumpMap: proceduralTextures.woodGripBumpMap,
      bumpScale: 0.016,
    });
    const darkLinerMat = new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.9 });
    const liveShellMat = new THREE.MeshStandardMaterial({ color: 0xd91e18, roughness: 0.28, metalness: 0.35 });
    const blankShellMat = new THREE.MeshStandardMaterial({ color: 0x1e8bc3, roughness: 0.28, metalness: 0.35 });
    const hollowShellMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0x1e1614,
      roughness: 0.88,
      metalness: 0.15,
      bumpMap: proceduralTextures.tableBumpMap,
      bumpScale: 0.014,
    });
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x8c7c72,
      roughness: 0.84,
      metalness: 0.10,
      map: proceduralTextures.tableMap,
      roughnessMap: proceduralTextures.tableRoughnessMap,
      bumpMap: proceduralTextures.tableBumpMap,
      bumpScale: 0.02,
    });
    const selfPadMat = new THREE.MeshStandardMaterial({
      color: 0x1f1414,
      roughness: 0.8,
      metalness: 0.7,
    });
    const etchMat = new THREE.MeshBasicMaterial({ color: 0x771111 });
    const scalMat = new THREE.MeshStandardMaterial({
      color: 0xd9e1e2,
      metalness: 0.95,
      roughness: 0.15,
    });
    const defibYMat = new THREE.MeshStandardMaterial({ color: 0xf39c12, roughness: 0.4 });
    const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.4 });
    
    // --- LAYOUT CONSTANTS ---
    const tableLegsGeo = new THREE.BoxGeometry(0.15, 1.2, 0.15);
    const legPositions = [
      [-3.0, -0.3, 1.4],
      [3.0, -0.3, 1.4],
      [-3.0, -0.3, -2.4],
      [3.0, -0.3, -2.4],
    ];

    // --- HELPERS ---
    const createTextTexture = (text: string, bgColor: string, textColor: string, fontSize = 38) => {
      const canvasTextEl = document.createElement('canvas');
      canvasTextEl.width = 256;
      canvasTextEl.height = 128;
      const ctx = canvasTextEl.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0a0a0e';
        ctx.fillRect(0, 0, 256, 128);
        ctx.strokeStyle = '#220808';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 248, 120);
        ctx.strokeStyle = '#661414';
        ctx.lineWidth = 3;
        ctx.strokeRect(9, 9, 238, 110);
        ctx.fillStyle = '#140606';
        ctx.fillRect(12, 12, 232, 104);
        ctx.font = `900 ${fontSize}px monospace`;
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = textColor;
        ctx.shadowBlur = 10;
        const words = text.split(' ');
        if (words.length > 1) {
          ctx.fillText(words[0], 128, 46);
          ctx.fillText(words[1], 128, 82);
        } else {
          ctx.fillText(text, 128, 64);
        }
        ctx.shadowBlur = 0;
      }
      const tex = new THREE.CanvasTexture(canvasTextEl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    };

    const createScalpelMesh = (): THREE.Group => {
      const scalpelGroup = new THREE.Group();
      scalpelGroup.name = 'scalpelGroup';

      // 1. Surgical Grade #3 Handle
      const handleMat = new THREE.MeshStandardMaterial({
        color: 0xd8dde3,
        metalness: 0.94,
        roughness: 0.22,
        envMapIntensity: 1.4,
      });
      const handleGripMat = new THREE.MeshStandardMaterial({
        color: 0x828d99,
        metalness: 0.88,
        roughness: 0.45,
      });
      const carbonBladeMat = new THREE.MeshStandardMaterial({
        color: 0xf4f8fb,
        metalness: 0.99,
        roughness: 0.03,
        envMapIntensity: 2.2,
      });
      const razorEdgeMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 1.0,
        roughness: 0.01,
        envMapIntensity: 2.8,
      });

      // Handle shaft body
      const handleGeo = new THREE.BoxGeometry(0.024, 0.36, 0.009);
      const handleMesh = new THREE.Mesh(handleGeo, handleMat);
      handleMesh.position.y = 0.18;
      handleMesh.castShadow = true;
      scalpelGroup.add(handleMesh);

      // Ergonomic rounded handle butt end
      const buttGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.009, 12);
      buttGeo.rotateX(Math.PI / 2);
      const buttMesh = new THREE.Mesh(buttGeo, handleMat);
      buttMesh.position.set(0, 0.005, 0);
      scalpelGroup.add(buttMesh);

      // Tactile ribbed cross-fluting grip grooves along surgeon thumb contact zone
      for (let g = 0; g < 6; g++) {
        const grooveGeo = new THREE.BoxGeometry(0.026, 0.0035, 0.011);
        const grooveMesh = new THREE.Mesh(grooveGeo, handleGripMat);
        grooveMesh.position.set(0, 0.13 + g * 0.02, 0);
        scalpelGroup.add(grooveMesh);
      }

      // Millimeter laser graduation markings (measurement ruler on side)
      for (let m = 0; m < 5; m++) {
        const tickGeo = new THREE.BoxGeometry(0.005, 0.002, 0.010);
        const tickMesh = new THREE.Mesh(tickGeo, handleGripMat);
        tickMesh.position.set(0.012, 0.25 + m * 0.018, 0);
        scalpelGroup.add(tickMesh);
      }

      // Tapered neck collar transitioning to blade mount tang
      const neckGeo = new THREE.CylinderGeometry(0.006, 0.010, 0.05, 8);
      const neckMesh = new THREE.Mesh(neckGeo, handleMat);
      neckMesh.position.set(0, 0.38, 0);
      scalpelGroup.add(neckMesh);

      // Slotted blade mounting tang
      const tangGeo = new THREE.BoxGeometry(0.008, 0.055, 0.005);
      const tangMesh = new THREE.Mesh(tangGeo, darkSteelMat);
      tangMesh.position.set(0, 0.41, 0);
      scalpelGroup.add(tangMesh);

      // 2. Ultra-Sharp #11 Surgical Carbon Steel Blade with precision angled spine
      const bladeSpineGeo = new THREE.BoxGeometry(0.005, 0.17, 0.004);
      const bladeSpine = new THREE.Mesh(bladeSpineGeo, carbonBladeMat);
      bladeSpine.position.set(0.008, 0.47, 0);
      bladeSpine.rotation.z = -0.16;
      bladeSpine.castShadow = true;
      scalpelGroup.add(bladeSpine);

      // Razor-sharp cutting edge bevel (ultra-reflective mirror finish)
      const edgeGeo = new THREE.BoxGeometry(0.016, 0.15, 0.002);
      const edgeMesh = new THREE.Mesh(edgeGeo, razorEdgeMat);
      edgeMesh.position.set(0.018, 0.46, 0);
      edgeMesh.rotation.z = -0.26;
      scalpelGroup.add(edgeMesh);

      // Triangular needle-point piercing tip
      const tipPointGeo = new THREE.ConeGeometry(0.005, 0.04, 4);
      tipPointGeo.rotateZ(-0.4);
      const tipPointMesh = new THREE.Mesh(tipPointGeo, razorEdgeMat);
      tipPointMesh.position.set(0.024, 0.54, 0);
      scalpelGroup.add(tipPointMesh);

      // Authentic blade cutout slot (slotted locking channel)
      const slotGeo = new THREE.BoxGeometry(0.005, 0.045, 0.006);
      const slotMesh = new THREE.Mesh(slotGeo, darkSteelMat);
      slotMesh.position.set(0.004, 0.42, 0);
      slotMesh.rotation.z = -0.16;
      scalpelGroup.add(slotMesh);

      return scalpelGroup;
    };

    // Shared flame geometries and materials to avoid runtime allocation and shader compile spikes
    const sharedFlameGeo = new THREE.ConeGeometry(0.018, 0.075, 12);
    const sharedInnerFlameGeo = new THREE.ConeGeometry(0.008, 0.035, 10);
    const sharedFlameMat = new THREE.MeshStandardMaterial({
      color: 0xffa500,
      emissive: 0xff5500,
      emissiveIntensity: 5.5,
      transparent: true,
      opacity: 0.92,
      roughness: 0.5,
      metalness: 0.0
    });
    const sharedInnerFlameMat = new THREE.MeshStandardMaterial({
      color: 0x4499ff,
      emissive: 0x0077ff,
      emissiveIntensity: 8.0,
      transparent: true,
      opacity: 0.95,
      roughness: 0.5,
      metalness: 0.0
    });

    const createZippoMesh = (): THREE.Group => {
      const zippoGroup = new THREE.Group();
      zippoGroup.name = 'zippoGroup';

      // High-grade Matte Black Casing & Metallic Materials
      const chromeMat = new THREE.MeshStandardMaterial({
        color: 0x18181a,
        metalness: 0.85,
        roughness: 0.35,
        envMapIntensity: 1.2
      });
      const steelInsertMat = new THREE.MeshStandardMaterial({
        color: 0x888899,
        metalness: 0.92,
        roughness: 0.25
      });
      const darkSteelMat = new THREE.MeshStandardMaterial({
        color: 0x33333d,
        metalness: 0.9,
        roughness: 0.4
      });
      const brassMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.9,
        roughness: 0.2
      });

      // 1. Lower Chrome Casing (Lighter Body)
      const bodyGeo = new THREE.BoxGeometry(0.08, 0.11, 0.042);
      const lighterBody = new THREE.Mesh(bodyGeo, chromeMat);
      lighterBody.position.y = 0.055;
      lighterBody.castShadow = true;
      lighterBody.receiveShadow = true;
      zippoGroup.add(lighterBody);

      // Bottom Stamp Plate (Authentic Zippo Bradford PA stamp etching)
      const bottomStampGeo = new THREE.BoxGeometry(0.076, 0.004, 0.038);
      const bottomStampMat = new THREE.MeshStandardMaterial({ color: 0xb8b8c5, metalness: 0.95, roughness: 0.3 });
      const bottomStamp = new THREE.Mesh(bottomStampGeo, bottomStampMat);
      bottomStamp.position.y = 0.002;
      zippoGroup.add(bottomStamp);

      // 2. 5-Barrel Hinge System on Left Vertical Seam
      const hingeGroup = new THREE.Group();
      hingeGroup.position.set(-0.0405, 0.11, 0);
      for (let i = 0; i < 5; i++) {
        const barrelMat = i % 2 === 0 ? chromeMat : steelInsertMat;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.007, 10), barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z = -0.014 + i * 0.007;
        hingeGroup.add(barrel);
      }
      // Hinge central steel pin
      const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.038, 8), darkSteelMat);
      hingePin.rotation.x = Math.PI / 2;
      hingeGroup.add(hingePin);
      zippoGroup.add(hingeGroup);

      // 3. Steel Inner Insert Module
      const insertGeo = new THREE.BoxGeometry(0.074, 0.04, 0.038);
      const insertMesh = new THREE.Mesh(insertGeo, steelInsertMat);
      insertMesh.position.y = 0.125;
      zippoGroup.add(insertMesh);

      // 4. Windproof Chimney Guard (Arch Profile with 16 Air Vent Holes)
      const chimneyGeo = new THREE.BoxGeometry(0.048, 0.045, 0.032);
      const chimney = new THREE.Mesh(chimneyGeo, steelInsertMat);
      chimney.position.set(-0.004, 0.15, 0);
      zippoGroup.add(chimney);

      // 16 Vent Holes (8 per side on +Z and -Z faces)
      const holeGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 10);
      const holeMat = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.95 });
      [-0.016, 0.016].forEach(zPos => {
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 4; col++) {
            const hole = new THREE.Mesh(holeGeo, holeMat);
            hole.rotation.x = Math.PI / 2;
            hole.position.set(-0.02 + col * 0.01, 0.142 + row * 0.014, zPos);
            zippoGroup.add(hole);
          }
        }
      });

      // 5. Cam Spring Lever (Flipping latch mechanism near hinge)
      const camLeverGeo = new THREE.BoxGeometry(0.008, 0.016, 0.012);
      const camLever = new THREE.Mesh(camLeverGeo, darkSteelMat);
      camLever.name = 'zippoCamLever';
      camLever.position.set(-0.032, 0.135, 0);
      zippoGroup.add(camLever);

      // 6. Serrated Flint Striking Wheel & Brass Rivet Pin
      const wheelGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.016, 12);
      const flintWheel = new THREE.Mesh(wheelGeo, darkSteelMat);
      flintWheel.name = 'zippoFlintWheel';
      flintWheel.rotation.x = Math.PI / 2;
      flintWheel.position.set(0.018, 0.158, 0);
      zippoGroup.add(flintWheel);

      const rivetGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.034, 8);
      const rivet = new THREE.Mesh(rivetGeo, brassMat);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(0.018, 0.158, 0);
      zippoGroup.add(rivet);

      // 7. Braided Cotton Wick with Copper Threads
      const wickGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.024, 8);
      const wickMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.9 });
      const wick = new THREE.Mesh(wickGeo, wickMat);
      wick.position.set(-0.01, 0.16, 0);
      zippoGroup.add(wick);

      // Copper wire strands sticking out of wick
      const copperGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.015, 6);
      const copperMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.3 });
      const copperStrand = new THREE.Mesh(copperGeo, copperMat);
      copperStrand.position.set(-0.009, 0.165, 0.002);
      copperStrand.rotation.z = 0.2;
      zippoGroup.add(copperStrand);

      // 8. Dynamic 3D Flame System (Inner Blue Cone + Outer Warm Amber Cone)
      const flameGroup = new THREE.Group();
      flameGroup.name = 'zippoFlame';
      flameGroup.position.set(-0.01, 0.168, 0);
      flameGroup.visible = false;

      const flameMesh = new THREE.Mesh(sharedFlameGeo, sharedFlameMat);
      flameMesh.position.y = 0.0375;
      flameGroup.add(flameMesh);

      const innerFlameMesh = new THREE.Mesh(sharedInnerFlameGeo, sharedInnerFlameMat);
      innerFlameMesh.position.y = 0.0175;
      flameGroup.add(innerFlameMesh);

      zippoGroup.add(flameGroup);

      // 9. Hinged Cap Lid Group
      const capGroup = new THREE.Group();
      capGroup.name = 'zippoCap';
      capGroup.position.set(-0.04, 0.11, 0);
      const capMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.042), chromeMat);
      capMesh.position.set(0.04, 0.0275, 0);
      capGroup.add(capMesh);
      zippoGroup.add(capGroup);

      return zippoGroup;
    };

    const createItemMesh = (type: ItemType): THREE.Group => {
      const parent = new THREE.Group();
      parent.userData.itemType = type;
      switch (type) {
        case 'MIRROR': {
          const fGeo = new THREE.TorusGeometry(0.15, 0.03, 8, 16);
          const fMesh = new THREE.Mesh(fGeo, rustySteelMat);
          fMesh.position.y = 0.25;
          parent.add(fMesh);

          const hGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8);
          const hMesh = new THREE.Mesh(hGeo, rustySteelMat);
          hMesh.position.y = 0.06;
          parent.add(hMesh);

          // Highly reflective silver mirror backing plate
          const silverGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.01, 16);
          const silverMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            metalness: 0.98,
            roughness: 0.05,
            envMapIntensity: 2.0,
          });
          const silverMesh = new THREE.Mesh(silverGeo, silverMat);
          silverMesh.name = 'mirrorSilverMesh';
          silverMesh.rotation.x = Math.PI / 2;
          silverMesh.position.set(0, 0.25, -0.002);
          parent.add(silverMesh);

          // Realistic subtle glass lens layer over reflective backing
          const glassGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.008, 16);
          const glassMat = new THREE.MeshStandardMaterial({
            color: 0xeaf4fb,
            metalness: 0.35,
            roughness: 0.05,
            transparent: true,
            opacity: 0.08,
            depthWrite: false,
            envMapIntensity: 1.2,
          });
          const glassMesh = new THREE.Mesh(glassGeo, glassMat);
          glassMesh.name = 'mirrorGlassMesh';
          glassMesh.rotation.x = Math.PI / 2;
          glassMesh.position.set(0, 0.25, 0.007);
          parent.add(glassMesh);

          // Glass bevel highlight ring
          const bevelGeo = new THREE.TorusGeometry(0.12, 0.005, 6, 16);
          const bevelMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.4,
            roughness: 0.02,
            transparent: true,
            opacity: 0.6,
            depthWrite: true,
          });
          const bevelMesh = new THREE.Mesh(bevelGeo, bevelMat);
          bevelMesh.position.set(0, 0.25, 0.008);
          parent.add(bevelMesh);
          break;
        }
        case 'PLIERS': {
          const plGeo1 = new THREE.BoxGeometry(0.04, 0.44, 0.03);
          const plMesh1 = new THREE.Mesh(plGeo1, rustySteelMat);
          plMesh1.rotation.z = 0.35;
          plMesh1.position.set(-0.06, 0.2, 0);
          const plMesh2 = plMesh1.clone();
          plMesh2.rotation.z = -0.35;
          plMesh2.position.set(0.06, 0.2, 0);
          parent.add(plMesh1);
          parent.add(plMesh2);
          break;
        }
        case 'WHISKEY': {
          const botGeo = new THREE.BoxGeometry(0.16, 0.35, 0.16);
          const glassMat = new THREE.MeshStandardMaterial({
            color: 0x1a120c,
            roughness: 0.1,
            metalness: 0.2,
            transparent: true,
            opacity: 0.45,
          });
          const botMesh = new THREE.Mesh(botGeo, glassMat);
          botMesh.position.y = 0.18;
          botMesh.name = 'whiskeyBottleMesh';
          parent.add(botMesh);

          // Liquid geometry: width/depth 0.134 (strictly inside 0.16 bottle cavity)
          // Translated so base y=0 sits cleanly on bottle floor
          const liquidGeo = new THREE.BoxGeometry(0.134, 0.28, 0.134);
          liquidGeo.translate(0, 0.14, 0);
          const liquidMat = new THREE.MeshStandardMaterial({
            color: 0x822e08,
            roughness: 0.05,
            metalness: 0.1,
            transparent: true,
            opacity: 0.92,
            emissive: 0x220a02,
          });
          const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
          liquidMesh.position.y = 0.015;
          liquidMesh.name = 'whiskeyLiquidMesh';
          parent.add(liquidMesh);

          const meniscusGeo = new THREE.PlaneGeometry(0.132, 0.132);
          const meniscusMat = new THREE.MeshStandardMaterial({
            color: 0x9c3d0c,
            roughness: 0.0,
            metalness: 0.2,
            transparent: true,
            opacity: 0.92,
            side: THREE.DoubleSide
          });
          const meniscus = new THREE.Mesh(meniscusGeo, meniscusMat);
          meniscus.rotation.x = -Math.PI / 2;
          meniscus.position.y = 0.295;
          meniscus.name = 'whiskeyMeniscus';
          parent.add(meniscus);

          const labelGeo = new THREE.BoxGeometry(0.162, 0.18, 0.005);
          const labelMat = new THREE.MeshStandardMaterial({
            color: 0x241408,
            roughness: 0.6,
          });
          const label = new THREE.Mesh(labelGeo, labelMat);
          label.position.set(0, 0.18, 0.081);
          parent.add(label);

          const neckGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8);
          const neckMesh = new THREE.Mesh(neckGeo, glassMat);
          neckMesh.position.y = 0.4;
          parent.add(neckMesh);

          const corkGeo = new THREE.CylinderGeometry(0.042, 0.038, 0.04, 8);
          const corkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
          const cork = new THREE.Mesh(corkGeo, corkMat);
          cork.position.y = 0.46;
          cork.name = 'whiskeyCork';
          parent.add(cork);
          break;
        }
        case 'TOURNIQUET': {
          const strapGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.15, 6);
          const strapMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const strap = new THREE.Mesh(strapGeo, strapMat);
          strap.position.y = 0.08;
          parent.add(strap);
          const buckGeo = new THREE.BoxGeometry(0.25, 0.04, 0.06);
          const buck = new THREE.Mesh(buckGeo, brassMat);
          buck.position.y = 0.18;
          parent.add(buck);
          break;
        }
        case 'PENTAGRAM': {
          const ringGeo = new THREE.TorusGeometry(0.18, 0.018, 4, 12);
          const pRingMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
          const ring = new THREE.Mesh(ringGeo, pRingMat);
          ring.position.y = 0.25;
          parent.add(ring);
          const starPointsGeo = new THREE.ConeGeometry(0.06, 0.22, 3);
          for (let i = 0; i < 5; i++) {
            const starPoint = new THREE.Mesh(starPointsGeo, pRingMat);
            const a = (i / 5) * Math.PI * 2;
            starPoint.position.set(Math.sin(a) * 0.14, 0.25 + Math.cos(a) * 0.14, 0);
            starPoint.rotation.z = -a;
            parent.add(starPoint);
          }
          break;
        }
        case 'CIGARETTE': {
          const cigGroup = new THREE.Group();
          cigGroup.name = 'cigGroupInner';

          // 1. Cork Tipping Filter (y: 0.0 -> 0.068)
          const filterGeo = new THREE.CylinderGeometry(0.0145, 0.0145, 0.068, 12);
          const filterMat = new THREE.MeshStandardMaterial({ color: 0xc28a4f, roughness: 0.86 });
          const filterMesh = new THREE.Mesh(filterGeo, filterMat);
          filterMesh.position.y = 0.034;
          cigGroup.add(filterMesh);

          // 2. Thin Brass/Gold Filter Band (y: 0.068 -> 0.071)
          const bandGeo = new THREE.CylinderGeometry(0.0148, 0.0148, 0.0035, 12);
          const bandMat = new THREE.MeshStandardMaterial({ color: 0xd4a44a, metalness: 0.65, roughness: 0.35 });
          const bandMesh = new THREE.Mesh(bandGeo, bandMat);
          bandMesh.position.y = 0.0695;
          cigGroup.add(bandMesh);

          // 3. Rolling Paper Tube (pivoted at base y=0.071 so scaling Y burns back naturally)
          const paperGeo = new THREE.CylinderGeometry(0.0144, 0.0144, 0.172, 12);
          paperGeo.translate(0, 0.086, 0);
          const paperMat = new THREE.MeshStandardMaterial({ color: 0xebe6da, roughness: 0.88 });
          const paperMesh = new THREE.Mesh(paperGeo, paperMat);
          paperMesh.name = 'cigPaper';
          paperMesh.position.y = 0.071;
          cigGroup.add(paperMesh);

          // 4. Raw Cured Unlit Tobacco Tip (visible while unlit, hidden once charred)
          const tobaccoGeo = new THREE.CylinderGeometry(0.0138, 0.0138, 0.010, 12);
          const tobaccoMat = new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.96 });
          const tobaccoMesh = new THREE.Mesh(tobaccoGeo, tobaccoMat);
          tobaccoMesh.name = 'cigTobacco';
          tobaccoMesh.position.y = 0.244;
          cigGroup.add(tobaccoMesh);

          // 5. Charred Paper Rim (revealed as flame meets paper)
          const charGeo = new THREE.CylinderGeometry(0.0147, 0.0147, 0.009, 12);
          const charMat = new THREE.MeshStandardMaterial({ color: 0x181513, roughness: 0.98 });
          const charMesh = new THREE.Mesh(charGeo, charMat);
          charMesh.name = 'cigCharRing';
          charMesh.position.y = 0.241;
          charMesh.visible = false;
          cigGroup.add(charMesh);

          // 6. Glowing Ember Core (starts completely cold/unlit: emissiveIntensity = 0)
          const emberGeo = new THREE.CylinderGeometry(0.013, 0.0138, 0.013, 12);
          const emberMat = new THREE.MeshStandardMaterial({
            color: 0x26120a,
            emissive: 0xff4200,
            emissiveIntensity: 0,
            roughness: 0.55
          });
          const emberMesh = new THREE.Mesh(emberGeo, emberMat);
          emberMesh.name = 'emberTip';
          emberMesh.position.y = 0.246;
          emberMesh.visible = false;
          cigGroup.add(emberMesh);

          // 7. Growing Tapered Ash Cone (grows cleanly past ember during deep drag)
          const ashGeo = new THREE.CylinderGeometry(0.011, 0.0136, 0.024, 10);
          ashGeo.translate(0, 0.012, 0);
          const ashMat = new THREE.MeshStandardMaterial({ color: 0x5c5b58, roughness: 1.0 });
          const ashMesh = new THREE.Mesh(ashGeo, ashMat);
          ashMesh.name = 'cigAshTip';
          ashMesh.position.y = 0.248;
          ashMesh.scale.set(1, 0.05, 1);
          ashMesh.visible = false;
          cigGroup.add(ashMesh);

          // 8. Tabletop/Shelf Zippo Lighter Prop (hidden during active two-handed lighting)
          const zippoOnTable = createZippoMesh();
          zippoOnTable.name = 'tableZippoGroup';
          zippoOnTable.scale.set(0.95, 0.95, 0.95);
          zippoOnTable.rotation.x = -Math.PI / 2; // lie flat on tabletop
          zippoOnTable.position.set(0.08, 0.02, -0.1);
          cigGroup.add(zippoOnTable);

          cigGroup.rotation.z = Math.PI / 2; // lie flat on shelf
          cigGroup.position.y = 0.02;
          parent.add(cigGroup);
          break;
        }
        case 'SCALPEL': {
          const scMesh = createScalpelMesh();
          parent.add(scMesh);
          break;
        }
        case 'DEFIBRILLATOR': {
          const boxG = new THREE.BoxGeometry(0.12, 0.18, 0.12);
          const box1 = new THREE.Mesh(boxG, defibYMat);
          box1.position.set(-0.08, 0.1, 0);
          box1.castShadow = true;
          const box2 = new THREE.Mesh(boxG, defibYMat);
          box2.position.set(0.08, 0.1, 0);
          box2.castShadow = true;
          parent.add(box1);
          parent.add(box2);
          const wireTGeo = new THREE.BoxGeometry(0.12, 0.03, 0.02);
          const wWire = new THREE.Mesh(wireTGeo, darkSteelMat);
          wWire.position.y = 0.2;
          parent.add(wWire);
          break;
        }
        case 'SYRINGE': {
          const barrelGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.35, 12);
          const glassMat = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.05,
            metalness: 0.1,
            transparent: true,
            opacity: 0.5,
          });
          const barrel = new THREE.Mesh(barrelGeo, glassMat);
          barrel.position.y = 0.245;
          barrel.name = 'syringeBarrel';
          parent.add(barrel);

          // Fluid geometry: radius 0.036 (strictly inside 0.045 barrel)
          // Translated so base y=0 sits at syringe nozzle base y=0.09
          const fluidGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.22, 16);
          fluidGeo.translate(0, 0.11, 0);
          const fluidMat = new THREE.MeshStandardMaterial({
            color: 0x880000,
            emissive: 0x330000,
            roughness: 0.1,
            metalness: 0.1,
            transparent: true,
            opacity: 0.85,
          });
          const fluid = new THREE.Mesh(fluidGeo, fluidMat);
          fluid.position.y = 0.09;
          fluid.name = 'syringeFluid';
          parent.add(fluid);

          const meniscusGeo = new THREE.CircleGeometry(0.035, 16);
          const meniscusMat = new THREE.MeshStandardMaterial({
            color: 0xaa0000,
            emissive: 0x440000,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
          });
          const meniscus = new THREE.Mesh(meniscusGeo, meniscusMat);
          meniscus.rotation.x = -Math.PI / 2;
          meniscus.position.y = 0.31;
          meniscus.name = 'syringeMeniscus';
          parent.add(meniscus);

          const bubbleGeo = new THREE.SphereGeometry(0.008, 8, 8);
          const bubbleMat = new THREE.MeshStandardMaterial({
            color: 0xff6666,
            roughness: 0.1,
            transparent: true,
            opacity: 0.5,
          });
          const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
          bubble.position.set(0.008, 0.26, 0);
          bubble.name = 'syringeBubble';
          parent.add(bubble);

          const bubbleGeo2 = new THREE.SphereGeometry(0.005, 8, 8);
          const bubble2 = new THREE.Mesh(bubbleGeo2, bubbleMat);
          bubble2.position.set(-0.006, 0.22, 0.004);
          bubble2.name = 'syringeBubble2';
          parent.add(bubble2);

          const plungerGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6);
          const plungerMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
          const plunger = new THREE.Mesh(plungerGeo, plungerMat);
          plunger.position.y = 0.48;
          plunger.name = 'syringePlunger';
          parent.add(plunger);

          const stopperGeo = new THREE.CylinderGeometry(0.041, 0.041, 0.02, 10);
          const stopperMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
          const stopper = new THREE.Mesh(stopperGeo, stopperMat);
          stopper.position.y = 0.32;
          stopper.name = 'syringeStopper';
          parent.add(stopper);

          const flangeGeo = new THREE.BoxGeometry(0.12, 0.015, 0.045);
          const metalMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
          const flange = new THREE.Mesh(flangeGeo, metalMat);
          flange.position.y = 0.42;
          parent.add(flange);

          const hubGeo = new THREE.CylinderGeometry(0.02, 0.01, 0.05, 8);
          const hub = new THREE.Mesh(hubGeo, metalMat);
          hub.position.y = 0.045;
          parent.add(hub);

          const needleGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4);
          const needle = new THREE.Mesh(needleGeo, metalMat);
          needle.position.y = -0.04;
          parent.add(needle);
          break;
        }
        case 'RAZORBLADE': {
          const bladeGroup = new THREE.Group();
          
          // Main Body (Aged weathered steel with rust patches)
          const bodyGeo = new THREE.BoxGeometry(0.14, 0.003, 0.28);
          const matBody = new THREE.MeshStandardMaterial({ 
            color: 0x3d3838, 
            metalness: 0.92, 
            roughness: 0.4,
          });
          const body = new THREE.Mesh(bodyGeo, matBody);
          bladeGroup.add(body);
          
          // Ultra-sharp silver honed razor bevel edges (Left & Right)
          const bevelGeoLeft = new THREE.BoxGeometry(0.012, 0.002, 0.28);
          const bevelGeoRight = new THREE.BoxGeometry(0.012, 0.002, 0.28);
          const matEdge = new THREE.MeshStandardMaterial({ 
            color: 0xf0f0f5, 
            metalness: 0.98, 
            roughness: 0.1,
          });
          const edgeLeft = new THREE.Mesh(bevelGeoLeft, matEdge);
          edgeLeft.position.x = -0.076;
          bladeGroup.add(edgeLeft);

          const edgeRight = new THREE.Mesh(bevelGeoRight, matEdge);
          edgeRight.position.x = 0.076;
          bladeGroup.add(edgeRight);

          // Dark inner slot cutout (classic safety razor center slot & 3 keyholes)
          const slotGeo = new THREE.BoxGeometry(0.024, 0.006, 0.16);
          const matSlot = new THREE.MeshBasicMaterial({ color: 0x050101 });
          const slot = new THREE.Mesh(slotGeo, matSlot);
          bladeGroup.add(slot);

          // Center round hole keyhole
          const centerHoleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.008, 12);
          const centerHole = new THREE.Mesh(centerHoleGeo, matSlot);
          bladeGroup.add(centerHole);

          // End round holes
          const endHoleTop = new THREE.Mesh(centerHoleGeo, matSlot);
          endHoleTop.position.z = 0.07;
          bladeGroup.add(endHoleTop);

          const endHoleBottom = new THREE.Mesh(centerHoleGeo, matSlot);
          endHoleBottom.position.z = -0.07;
          bladeGroup.add(endHoleBottom);

          // Corner notch cutouts (4 corners of classic razor blade)
          const cornerGeo = new THREE.BoxGeometry(0.025, 0.008, 0.025);
          const corners = [
            [-0.07, 0.13], [0.07, 0.13],
            [-0.07, -0.13], [0.07, -0.13]
          ];
          corners.forEach(([cx, cz]) => {
            const corner = new THREE.Mesh(cornerGeo, matSlot);
            corner.position.set(cx, 0, cz);
            bladeGroup.add(corner);
          });

          // Fresh glistening blood stains along primary cut edge with SSR reflections
          const bloodStainGeo = new THREE.BoxGeometry(0.03, 0.004, 0.18);
          const matBloodStain = new THREE.MeshStandardMaterial({
            color: 0x5a0000,
            roughness: 0.06,
            metalness: 0.22
          });
          const bloodStain = new THREE.Mesh(bloodStainGeo, matBloodStain);
          bloodStain.position.set(-0.06, 0.001, 0.02);
          bladeGroup.add(bloodStain);

          bladeGroup.position.y = 0.05;
          bladeGroup.rotation.y = Math.PI / 4;
          
          parent.add(bladeGroup);
          break;
        }
        case 'MEDKIT': {
          const medkitGroup = new THREE.Group();

          // Industrial scuffed enameled steel case + dark tray liner
          const matCase = new THREE.MeshStandardMaterial({
            color: 0xcfcfc8,
            roughness: 0.72,
            metalness: 0.22,
          });
          const matSteelTrim = new THREE.MeshStandardMaterial({
            color: 0x2a2d32,
            roughness: 0.48,
            metalness: 0.68,
          });
          const matTrayLiner = new THREE.MeshStandardMaterial({
            color: 0x1a1c1f,
            roughness: 0.88,
            metalness: 0.12,
          });
          const matCross = new THREE.MeshStandardMaterial({
            color: 0x8a1010,
            roughness: 0.78,
            metalness: 0.08,
          });

          // Open-top stamped steel lower shell (so tray contents are physically recessed inside)
          const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.014, 0.21), matCase);
          floorMesh.position.set(0, 0.007, 0);
          medkitGroup.add(floorMesh);

          const frontWall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.105, 0.012), matCase);
          frontWall.position.set(0, 0.058, 0.099);
          medkitGroup.add(frontWall);

          const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.105, 0.012), matCase);
          backWall.position.set(0, 0.058, -0.099);
          medkitGroup.add(backWall);

          const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.105, 0.19), matCase);
          leftWall.position.set(-0.154, 0.058, 0);
          medkitGroup.add(leftWall);

          const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.105, 0.19), matCase);
          rightWall.position.set(0.154, 0.058, 0);
          medkitGroup.add(rightWall);

          // Inner molded compartment tray floor & dividers
          const trayBed = new THREE.Mesh(new THREE.BoxGeometry(0.294, 0.016, 0.184), matTrayLiner);
          trayBed.position.set(0, 0.022, 0);
          medkitGroup.add(trayBed);

          const dividerL = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.058, 0.182), matTrayLiner);
          dividerL.position.set(-0.052, 0.056, 0);
          medkitGroup.add(dividerL);

          const dividerR = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.058, 0.182), matTrayLiner);
          dividerR.position.set(0.048, 0.056, 0);
          medkitGroup.add(dividerR);

          // Subtle rubber seal rim along inner perimeter lip
          const gasketMat = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.94, metalness: 0.05 });
          const gasketF = new THREE.Mesh(new THREE.BoxGeometry(0.304, 0.006, 0.006), gasketMat);
          gasketF.position.set(0, 0.111, 0.095);
          medkitGroup.add(gasketF);
          const gasketB = new THREE.Mesh(new THREE.BoxGeometry(0.304, 0.006, 0.006), gasketMat);
          gasketB.position.set(0, 0.111, -0.095);
          medkitGroup.add(gasketB);

          // Front steel carry handle & rear hinge knuckles
          const handleBar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.014, 0.018), matSteelTrim);
          handleBar.position.set(0, 0.056, 0.116);
          medkitGroup.add(handleBar);
          for (const hx of [-0.048, 0.048]) {
            const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, 0.020), matSteelTrim);
            bracket.position.set(hx, 0.056, 0.108);
            medkitGroup.add(bracket);
          }

          // Articulated front clasp latches
          const makeLatch = (xPos: number, name: string) => {
            const latch = new THREE.Group();
            latch.name = name;
            latch.position.set(xPos, 0.106, 0.107);
            const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.030, 0.010), matSteelTrim);
            clasp.position.set(0, 0.002, 0.004);
            latch.add(clasp);
            return latch;
          };
          medkitGroup.add(makeLatch(-0.095, 'medkitLatchL'));
          medkitGroup.add(makeLatch(0.095, 'medkitLatchR'));

          // Top hinged lid (hinged along back top edge)
          const lidGroup = new THREE.Group();
          lidGroup.name = 'medkitLid';
          lidGroup.position.set(0, 0.112, -0.105);

          const lidShell = new THREE.Mesh(new THREE.BoxGeometry(0.324, 0.024, 0.214), matCase);
          lidShell.position.set(0, 0.012, 0.105);
          lidGroup.add(lidShell);

          const lidFoam = new THREE.Mesh(new THREE.BoxGeometry(0.288, 0.008, 0.178), matTrayLiner);
          lidFoam.position.set(0, 0.001, 0.105);
          lidGroup.add(lidFoam);

          for (const hx of [-0.10, 0.10]) {
            const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.026, 8), matSteelTrim);
            hinge.rotation.z = Math.PI / 2;
            hinge.position.set(hx, 0, -0.002);
            lidGroup.add(hinge);
          }

          const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.006, 0.104), matCross);
          crossV.position.set(0, 0.025, 0.105);
          lidGroup.add(crossV);
          const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.006, 0.036), matCross);
          crossH.position.set(0, 0.025, 0.105);
          lidGroup.add(crossH);

          medkitGroup.add(lidGroup);

          // Articulated medical supplies seated inside compartments
          const contentsGroup = new THREE.Group();
          contentsGroup.name = 'medkitContents';

          // 1) Left Compartment: Pressurized Antiseptic Spray Canister
          const sprayGroup = new THREE.Group();
          sprayGroup.name = 'medkitSprayBottle';
          const canMat = new THREE.MeshStandardMaterial({ color: 0xaab2b8, roughness: 0.38, metalness: 0.58 });
          const labelTealMat = new THREE.MeshStandardMaterial({ color: 0x224f5a, roughness: 0.72, metalness: 0.1 });
          const capRedMat = new THREE.MeshStandardMaterial({ color: 0x8d1b1b, roughness: 0.55, metalness: 0.15 });

          const sprayCan = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.088, 10), canMat);
          sprayGroup.add(sprayCan);
          const sprayBand = new THREE.Mesh(new THREE.CylinderGeometry(0.0236, 0.0236, 0.044, 10), labelTealMat);
          sprayBand.position.y = -0.004;
          sprayGroup.add(sprayBand);
          const sprayShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.023, 0.014, 10), canMat);
          sprayShoulder.position.y = 0.051;
          sprayGroup.add(sprayShoulder);
          const sprayCrimp = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.005, 10), matSteelTrim);
          sprayCrimp.position.y = 0.058;
          sprayGroup.add(sprayCrimp);

          const sprayCapGroup = new THREE.Group();
          sprayCapGroup.name = 'medkitSprayCap';
          sprayCapGroup.position.set(0, 0.066, 0);
          const sprayNozzleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.020, 8), capRedMat);
          sprayCapGroup.add(sprayNozzleBody);
          const sprayTip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.007, 0.014), matSteelTrim);
          sprayTip.name = 'medkitSprayTip';
          sprayTip.position.set(0, 0.002, 0.013);
          sprayCapGroup.add(sprayTip);
          sprayGroup.add(sprayCapGroup);

          sprayGroup.position.set(-0.102, 0.056, 0.004);
          sprayGroup.rotation.set(Math.PI / 2, 0, 0.05);
          sprayGroup.userData.restPos = sprayGroup.position.clone();
          sprayGroup.userData.restQuat = sprayGroup.quaternion.clone();
          contentsGroup.add(sprayGroup);

          // 2) Center Compartment: Sterile Gauze Roll with sterile tear wrapper tab & unfurling strip
          const bandageGroup = new THREE.Group();
          bandageGroup.name = 'medkitBandageRoll';
          const gauzeMat = new THREE.MeshStandardMaterial({ color: 0xe0dbd0, roughness: 0.94, metalness: 0.0 });
          const coreMat = new THREE.MeshStandardMaterial({ color: 0x5c4c3d, roughness: 0.9 });
          const clipMat = new THREE.MeshStandardMaterial({ color: 0x6c7278, roughness: 0.45, metalness: 0.6 });
          const wrapperTabMat = new THREE.MeshStandardMaterial({ color: 0xc2cbc8, roughness: 0.68, metalness: 0.14 });

          const rollMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.068, 12), gauzeMat);
          rollMesh.rotation.z = Math.PI / 2;
          bandageGroup.add(rollMesh);
          const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.070, 8), coreMat);
          coreMesh.rotation.z = Math.PI / 2;
          bandageGroup.add(coreMesh);
          const wrapStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0296, 0.0296, 0.008, 12), labelTealMat);
          wrapStripe.rotation.z = Math.PI / 2;
          bandageGroup.add(wrapStripe);
          const safetyClip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, 0.012), clipMat);
          safetyClip.position.set(0, 0.029, 0.008);
          bandageGroup.add(safetyClip);

          const gauzeTab = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.028, 0.003), wrapperTabMat);
          gauzeTab.name = 'medkitGauzeTab';
          gauzeTab.position.set(0, 0.018, 0.028);
          gauzeTab.rotation.set(0.28, 0, 0.08);
          gauzeTab.userData.restPos = gauzeTab.position.clone();
          gauzeTab.userData.restRot = gauzeTab.rotation.clone();
          bandageGroup.add(gauzeTab);

          const gauzeStripPivot = new THREE.Group();
          gauzeStripPivot.name = 'medkitGauzeStrip';
          gauzeStripPivot.position.set(0, -0.024, 0.014);
          const gauzeStripMat = gauzeMat.clone();
          gauzeStripMat.side = THREE.DoubleSide;
          const gauzeStripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.13, 0.004), gauzeStripMat);
          gauzeStripMesh.position.set(0, -0.065, 0);
          gauzeStripPivot.add(gauzeStripMesh);
          gauzeStripPivot.scale.set(1, 0.01, 1);
          gauzeStripPivot.visible = false;
          bandageGroup.add(gauzeStripPivot);

          bandageGroup.position.set(-0.002, 0.061, -0.006);
          bandageGroup.rotation.set(0, 0.08, 0);
          bandageGroup.userData.restPos = bandageGroup.position.clone();
          bandageGroup.userData.restQuat = bandageGroup.quaternion.clone();
          contentsGroup.add(bandageGroup);

          // 3) Right Compartment: Amber Painkiller Pill Bottle + white pills + pop cap
          const pillGroup = new THREE.Group();
          pillGroup.name = 'medkitPillBottle';
          const amberMat = new THREE.MeshStandardMaterial({
            color: 0xb45c14,
            roughness: 0.28,
            metalness: 0.05,
            transparent: true,
            opacity: 0.82,
          });
          const rxLabelMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.88 });
          const whiteCapMat = new THREE.MeshStandardMaterial({ color: 0xdcdad2, roughness: 0.52 });
          const tabletMat = new THREE.MeshStandardMaterial({ color: 0xefede6, roughness: 0.65 });

          const amberVial = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.023, 0.082, 10), amberMat);
          pillGroup.add(amberVial);

          const rxLabel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0246, 0.0242, 0.042, 10, 1, true, -Math.PI * 0.45, Math.PI * 0.9),
            rxLabelMat
          );
          rxLabel.position.y = -0.003;
          pillGroup.add(rxLabel);

          // Visible tablets inside translucent amber bottle
          const pillOffsets: [number, number, number, number][] = [
            [-0.007, -0.028, 0.004, 0.3],
            [0.008, -0.025, -0.005, -0.4],
            [-0.003, -0.018, -0.007, 0.7],
            [0.006, -0.015, 0.007, -0.2],
            [-0.008, -0.009, 0.002, 0.5],
          ];
          for (const [px, py, pz, rotZ] of pillOffsets) {
            const tab = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.012, 6), tabletMat);
            tab.position.set(px, py, pz);
            tab.rotation.set(0.5, rotZ, rotZ);
            pillGroup.add(tab);
          }

          const pillCap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 10), whiteCapMat);
          pillCap.name = 'medkitPillCap';
          pillCap.position.set(0, 0.048, 0);
          pillGroup.add(pillCap);

          pillGroup.position.set(0.100, 0.056, 0.006);
          pillGroup.rotation.set(Math.PI / 2, 0, -0.06);
          pillGroup.userData.restPos = pillGroup.position.clone();
          pillGroup.userData.restQuat = pillGroup.quaternion.clone();
          contentsGroup.add(pillGroup);

          // Two loose animatable tablets poured out during treatment
          const pillGeo = new THREE.CylinderGeometry(0.0062, 0.0062, 0.013, 8);
          const loosePill1 = new THREE.Mesh(pillGeo, tabletMat);
          loosePill1.name = 'medkitPill1';
          loosePill1.visible = false;
          contentsGroup.add(loosePill1);

          const loosePill2 = new THREE.Mesh(pillGeo, tabletMat);
          loosePill2.name = 'medkitPill2';
          loosePill2.visible = false;
          contentsGroup.add(loosePill2);

          medkitGroup.add(contentsGroup);
          parent.add(medkitGroup);
          break;
        }
      }
      parent.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map((m) => m.clone());
              child.userData.baseEmissive = child.material[0] && 'emissive' in child.material[0] && (child.material[0] as any).emissive
                ? (child.material[0] as any).emissive.clone()
                : new THREE.Color(0, 0, 0);
            } else {
              child.material = child.material.clone();
              if ('emissive' in child.material && (child.material as any).emissive) {
                child.userData.baseEmissive = (child.material as any).emissive.clone();
              } else {
                child.userData.baseEmissive = new THREE.Color(0, 0, 0);
              }
            }
          }
        }
      });
      return parent;
    };

    // --- SETUP THREE.JS ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x110808, 0.035);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 3.4, 5.5);
    camera.lookAt(0, 0.5, -1);

    let renderer: any = null;
    let renderPipeline: any = null;
    let scenePass: any = null;
    let currentPostprocessingKey = '';
    let currentPostprocessingNode: any = null;

    let advancedPipeline: WebGPUAdvancedPipeline | null = null;
    let computeBloodSystem: WebGPUComputeBloodSystem | null = null;
    let computeSparksSystem: WebGPUComputeSparksSystem | null = null;
    let volumetricSmokeSystem: WebGPUVolumetricSmokeSystem | null = null;
    let pmremGenerator: PMREMGenerator | null = null;
    let pmremEnvTarget: THREE.RenderTarget | null = null;
    let lastMaterialConfigKey = '';

    let isDesktopHQ = false;
    let isCancelled = false;

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0xffedd8, 0.65); // Warm soft ambient fill
    scene.add(ambientLight);
    
    // Dedicated Zippo lighter flame light (persistent in scene with intensity 0 to eliminate lighting recompilation & shadow cubemap spikes)
    const zippoFlameLight = new THREE.PointLight(0xffa500, 0, 2.0);
    zippoFlameLight.name = "zippoFlameLight";
    zippoFlameLight.userData = { noShadow: true };
    zippoFlameLight.castShadow = false;
    zippoFlameLight.position.set(0, -100, 0);
    scene.add(zippoFlameLight);

    // Pre-warm flame materials upfront during scene init so the GPU pipelines compile before gameplay
    const flamePrewarmGroup = new THREE.Group();
    flamePrewarmGroup.name = "flamePrewarmGroup";
    flamePrewarmGroup.position.set(0, -100, 0);
    flamePrewarmGroup.scale.set(0.0001, 0.0001, 0.0001);
    flamePrewarmGroup.add(new THREE.Mesh(sharedFlameGeo, sharedFlameMat));
    flamePrewarmGroup.add(new THREE.Mesh(sharedInnerFlameGeo, sharedInnerFlameMat));
    scene.add(flamePrewarmGroup);
    
    // Fill light to prevent pitch black areas
    const fillLight = new THREE.HemisphereLight(0x55556a, 0x1a1515, 0.75);
    fillLight.position.set(0, 10, 0);
    scene.add(fillLight);

    // Flashing hanging focus spotlight
    const spotLight = new THREE.SpotLight(0xfff5e6, 25.0, 30, Math.PI / 3, 0.7, 1);
    spotLight.position.set(0, 5, 0);
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    spotLight.shadow.camera.near = 1.5;
    spotLight.shadow.camera.far = 16;
    spotLight.shadow.bias = -0.0008;
    spotLight.shadow.normalBias = 0.025;
    scene.add(spotLight);

    const spotLightTarget = new THREE.Object3D();
    spotLightTarget.position.set(0, 0, 0);
    scene.add(spotLightTarget);
    spotLight.target = spotLightTarget;

    // Persistent cool slate industrial rim spotlight separating the low-poly Dealer cloak from the dark background
    const rimSpotLight = new THREE.SpotLight(0x6e8ec4, 4.5, 18, Math.PI / 3.2, 0.85, 1.2);
    rimSpotLight.name = 'dealerRimLight';
    rimSpotLight.userData = { noShadow: true };
    rimSpotLight.castShadow = false;
    rimSpotLight.position.set(0, 4.2, -5.8);
    rimSpotLight.target = spotLightTarget;
    scene.add(rimSpotLight);

    // Persistent muzzle flash point light (intensity kept at 0 when idle to avoid shader recompilation)
    const muzzleFlashLight = new THREE.PointLight(0xffb44d, 0, 10, 2.0);
    muzzleFlashLight.name = 'muzzleFlashLight';
    muzzleFlashLight.userData = { noShadow: true };
    muzzleFlashLight.castShadow = false;
    muzzleFlashLight.position.set(0, 1.2, 0);
    scene.add(muzzleFlashLight);

    // Glowing dim red/orange bulb hanging visible in scene
    const wireGeo = new THREE.CylinderGeometry(0.012, 0.012, 2, 4);
    const wireMesh = new THREE.Mesh(wireGeo, darkMetalStyle);
    wireMesh.position.set(0, 6, 0);
    scene.add(wireMesh);

    const bulbGeo = new THREE.CylinderGeometry(0.4, 0.5, 0.4, 6);
    const bulbMesh = new THREE.Mesh(bulbGeo, darkMetalStyle);
    bulbMesh.position.set(0, 4.8, 0);
    scene.add(bulbMesh);

    const bulbGlowGeo = new THREE.SphereGeometry(0.16, 5, 5);
    const bulbGlowMat = new THREE.MeshBasicMaterial({ color: 0xffeaad });
    const bulbGlow = new THREE.Mesh(bulbGlowGeo, bulbGlowMat);
    bulbGlow.position.set(0, 4.4, 0);
    scene.add(bulbGlow);

    // --- ROOM ELEMENTS (THE INDUSTRIAL TABLE) ---
    // Table Top
    const tableTopGeo = new THREE.BoxGeometry(6.5, 0.3, 4.4);
    const tableTop = new THREE.Mesh(tableTopGeo, tableMat);
    tableTop.position.set(0, 0.4, -0.6);
    tableTop.receiveShadow = true;
    tableTop.castShadow = true;
    scene.add(tableTop);

    // Rusty steel industrial frame pillars under table
    legPositions.forEach(([x, y, z]) => {
      const leg = new THREE.Mesh(tableLegsGeo, rustySteelMat);
      leg.position.set(x, y, z);
      leg.castShadow = true;
      scene.add(leg);
    });

    // Dark rustic gritty concrete floor
    const floorGeo = new THREE.PlaneGeometry(35, 35);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x555558,
      roughness: 0.92,
      metalness: 0.06,
      map: proceduralTextures.floorMap,
      roughnessMap: proceduralTextures.floorRoughnessMap,
      bumpMap: proceduralTextures.floorBumpMap,
      bumpScale: 0.025,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.9;
    floor.receiveShadow = true;
    scene.add(floor);

    // --- THE INTEGRATED 3D SHOP ---
    const shopGroup = new THREE.Group();
    shopGroup.position.set(-15, 0.4, 0); 
    shopGroup.rotation.y = 0; // Front faces toward positive X (toward camera)
    scene.add(shopGroup);

    // Dark Booth Framework
    const boothWallGeo = new THREE.BoxGeometry(0.15, 3.2, 5.5);
    const boothWallMat = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 1.0 });
    const backWall = new THREE.Mesh(boothWallGeo, boothWallMat);
    backWall.position.set(-0.9, 1.0, 0); 
    shopGroup.add(backWall);

    const shelfMatToUse = shelfMat; 
    // Industrial Shelves
    const shelfGeo = new THREE.BoxGeometry(1.6, 0.12, 5.0);
    const shelf1 = new THREE.Mesh(shelfGeo, shelfMatToUse);
    shelf1.position.set(0, 0.5, 0);
    shelf1.castShadow = true;
    shelf1.receiveShadow = true;
    shopGroup.add(shelf1);

    const shelf2 = new THREE.Mesh(shelfGeo, shelfMatToUse);
    shelf2.position.set(0, 1.45, 0);
    shelf2.castShadow = true;
    shelf2.receiveShadow = true;
    shopGroup.add(shelf2);

    // Shop Light (dedicated flicker light)
    const shopSpotLight = new THREE.SpotLight(0xfff0dd, 45.0, 25, 0.75, 0.45, 2);
    shopSpotLight.position.set(1.5, 4.0, 0);
    shopSpotLight.target = shelf1;
    shopSpotLight.castShadow = false;
    shopSpotLight.userData = { noShadow: true };
    shopGroup.add(shopSpotLight);

    // Warm ambient point lights for the shop interior (configured without shadow mapping for high WebGL performance)
    const shopAmbient = new THREE.PointLight(0xff9944, 25.0, 12);
    shopAmbient.name = "shopAmbient";
    shopAmbient.userData = { noShadow: true };
    shopAmbient.castShadow = false;
    shopAmbient.position.set(1.2, 2.0, 0);
    shopGroup.add(shopAmbient);

    const shelfBottomLight = new THREE.PointLight(0xffcc88, 10.0, 8);
    shelfBottomLight.name = "shelfBottomLight";
    shelfBottomLight.userData = { noShadow: true };
    shelfBottomLight.castShadow = false;
    shelfBottomLight.position.set(0.8, 0.4, 0);
    shopGroup.add(shelfBottomLight);

    const shelfTopLight = new THREE.PointLight(0xffcc88, 10.0, 8);
    shelfTopLight.name = "shelfTopLight";
    shelfTopLight.userData = { noShadow: true };
    shelfTopLight.castShadow = false;
    shelfTopLight.position.set(0.8, 1.3, 0);
    shopGroup.add(shelfTopLight);

    // Fill shop with buyable item meshes + generous non-overlapping slot hitboxes
    const shopItemMeshes: THREE.Group[] = [];
    const shopHitBoxes: THREE.Mesh[] = [];
    const SHOP_ITEMS_BASE: { type: ItemType; shelf: number; pos: number }[] = [
      { type: 'MIRROR', shelf: 0, pos: -1.8 },
      { type: 'PLIERS', shelf: 0, pos: -0.9 },
      { type: 'RAZORBLADE', shelf: 0, pos: 0 },
      { type: 'WHISKEY', shelf: 0, pos: 0.9 },
      { type: 'TOURNIQUET', shelf: 0, pos: 1.8 },
      { type: 'PENTAGRAM', shelf: 1, pos: -1.8 },
      { type: 'CIGARETTE', shelf: 1, pos: -0.9 },
      { type: 'SYRINGE', shelf: 1, pos: 0 },
      { type: 'SCALPEL', shelf: 1, pos: 0.9 },
      { type: 'DEFIBRILLATOR', shelf: 1, pos: 1.8 },
    ];

    const tagGeo = new THREE.PlaneGeometry(0.35, 0.18);
    // Slot spacing is 0.90 along Z and 0.95 vertically between shelves -> 0.80 x 0.78 leaves clear gap with zero overlap
    const shopHitBoxGeo = new THREE.BoxGeometry(1.38, 0.78, 0.80);
    const shopHitBoxMat = new THREE.MeshBasicMaterial({ visible: false });

    SHOP_ITEMS_BASE.forEach(itemInfo => {
      const scaledCost = getItemPrice(itemInfo.type, difficulty);
      const itemMesh = createItemMesh(itemInfo.type);
      const shelfY = itemInfo.shelf === 0 ? 0.565 : 1.515;
      itemMesh.position.set(0, shelfY, itemInfo.pos);
      itemMesh.scale.set(1.5, 1.5, 1.5); 
      itemMesh.rotation.y = Math.PI / 2; // Face the camera (+X direction)

      // Tilt razorblade slightly so its flat metallic blade glints and is clearly legible from above
      if (itemInfo.type === 'RAZORBLADE') {
        itemMesh.rotation.x = -0.38;
        itemMesh.rotation.z = 0.22;
      }

      // Clone materials and record initial base emissive so hover lighting doesn't corrupt shared scene materials
      itemMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          child.material = child.material.clone();
          if ('emissive' in child.material && child.material.emissive) {
            child.userData.baseEmissive = child.material.emissive.clone();
          }
        }
      });

      itemMesh.userData = { 
        isShopItem: true, 
        type: itemInfo.type, 
        cost: scaledCost,
        shelfY,
        baseRotY: Math.PI / 2,
        baseScale: 1.5,
        currScale: 1.0,
        currY: 0.0,
        currEmissive: 0.0
      };
      
      // Price tag - angled physical label facing camera (+X)
      const tagTexture = createTextTexture(`${scaledCost}B`, '#0a0a0a', '#00ff44');
      const tagMat = new THREE.MeshBasicMaterial({ 
        map: tagTexture, 
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
      });
      const tag = new THREE.Mesh(tagGeo, tagMat);
      
      // Placed right on the front edge lip of the shelf (X = 0.82) facing +X
      tag.position.set(0.82, shelfY - 0.05, itemInfo.pos);
      tag.rotation.set(0, Math.PI / 2, 0.20); // Faces +X, tilted up 0.20 rad for top-down camera visibility
      shopGroup.add(tag);

      // Dedicated forgiving hitbox covering both the 3D shelf item and its front price tag
      const hitBox = new THREE.Mesh(shopHitBoxGeo, shopHitBoxMat);
      hitBox.position.set(0.24, shelfY + 0.25, itemInfo.pos);
      hitBox.userData = {
        isShopHitBox: true,
        targetShopItem: itemMesh,
      };
      shopGroup.add(hitBox);
      shopHitBoxes.push(hitBox);

      itemMesh.userData.priceTag = tag;
      itemMesh.userData.hitBox = hitBox;

      shopGroup.add(itemMesh);
      shopItemMeshes.push(itemMesh);
    });

    // --- THE HOODED DEALER ---
    const dealerGroup = new THREE.Group();
    dealerGroup.position.set(0, -0.4, -3.2); // sitting on chair behind table
    scene.add(dealerGroup);

    // Dealer's Chair
    const chairGroup = new THREE.Group();
    chairGroup.name = "dealerChairGroup";
    chairGroup.position.set(0, -1.2, -3.2); // On the floor
    scene.add(chairGroup);
    
    // Chair legs
    const chairLegGeo = new THREE.BoxGeometry(0.08, 0.8, 0.08);
    const chairLegMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.8 });
    [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]].forEach(([cx, cz]) => {
      const cleg = new THREE.Mesh(chairLegGeo, chairLegMat);
      cleg.position.set(cx, 0.4, cz);
      cleg.castShadow = true;
      chairGroup.add(cleg);
    });

    // Chair seat
    const seatGeo = new THREE.BoxGeometry(1.0, 0.1, 0.8);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x221111, roughness: 0.8 });
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.set(0, 0.85, 0);
    seat.castShadow = true;
    chairGroup.add(seat);

    // Chair backrest
    const backGeo = new THREE.BoxGeometry(1.0, 1.0, 0.1);
    const backrest = new THREE.Mesh(backGeo, seatMat);
    backrest.position.set(0, 1.35, -0.35);
    backrest.castShadow = true;
    chairGroup.add(backrest);

    let activePolyTier = getControllerSettings().polygonCount || 'high';
    const getPolySegments = (tier: string) => {
      switch (tier) {
        case 'low': return { cloak: 6, drum: 12, barrel: 8, torus: 6 };
        case 'medium': return { cloak: 8, drum: 16, barrel: 10, torus: 8 };
        case 'high': return { cloak: 12, drum: 20, barrel: 12, torus: 10 };
        case 'ultra': return { cloak: 16, drum: 28, barrel: 16, torus: 12 };
        default: return { cloak: 12, drum: 20, barrel: 12, torus: 10 };
      }
    };
    const initialPolySegs = getPolySegments(activePolyTier);

    const cloakGeo = new THREE.CylinderGeometry(0.1, 0.9, 1.8, initialPolySegs.cloak, 1, false);
    const cloakMesh = new THREE.Mesh(cloakGeo, cloakMat);
    cloakMesh.position.set(0, 1.5, 0);
    cloakMesh.scale.set(1.0, 1.55, 1.0); // Make cloak taller to reach the raised head
    cloakMesh.castShadow = true;
    dealerGroup.add(cloakMesh);

    // Hood Structure (Square/Box-like hood framing the dark face void)
    const hoodGeo = new THREE.BoxGeometry(0.85, 0.9, 0.75);
    const hoodMesh = new THREE.Mesh(hoodGeo, cloakMat);
    hoodMesh.position.set(0, 2.7, 0.1);
    hoodMesh.castShadow = true;
    dealerGroup.add(hoodMesh);

    // Inside the Dark Face Cavity
    const faceCavityGeo = new THREE.BoxGeometry(0.55, 0.55, 0.2);
    const blackCavityMat = new THREE.MeshBasicMaterial({ color: 0x010000 });
    const faceCavity = new THREE.Mesh(faceCavityGeo, blackCavityMat);
    faceCavity.position.set(0, 2.7, 0.45);
    dealerGroup.add(faceCavity);

    // Glowing red skeletal eyes with sharp faceted low-poly geometry across all settings
    const eyeGeo = new THREE.IcosahedronGeometry(0.052, 0); // Crisp 20-facet low-poly polyhedron
    const leftEyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const rightEyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const leftEye = new THREE.Mesh(eyeGeo, leftEyeMat);
    leftEye.position.set(-0.16, 2.75, 0.56);
    const rightEye = new THREE.Mesh(eyeGeo, rightEyeMat);
    rightEye.position.set(0.16, 2.75, 0.56);
    dealerGroup.add(leftEye);
    dealerGroup.add(rightEye);

    // Faceted low-poly eye sockets / orbit frames framing the glowing eyes
    const eyeSocketGeo = new THREE.BoxGeometry(0.13, 0.13, 0.04);
    const eyeSocketMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.8 });
    const leftSocket = new THREE.Mesh(eyeSocketGeo, eyeSocketMat);
    leftSocket.position.set(-0.16, 2.75, 0.53);
    const rightSocket = new THREE.Mesh(eyeSocketGeo, eyeSocketMat);
    rightSocket.position.set(0.16, 2.75, 0.53);
    dealerGroup.add(leftSocket);
    dealerGroup.add(rightSocket);

    // Expressive, low-poly angular eyebrows that tilt and furrow dynamically
    const browGeo = new THREE.BoxGeometry(0.14, 0.035, 0.06);
    const browMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.5 });
    const leftBrow = new THREE.Mesh(browGeo, browMat);
    leftBrow.position.set(-0.16, 2.82, 0.58);
    const rightBrow = new THREE.Mesh(browGeo, browMat);
    rightBrow.position.set(0.16, 2.82, 0.58);
    dealerGroup.add(leftBrow);
    dealerGroup.add(rightBrow);

    // Multi-segmented articulate mask line & mouth structure
    const dealerMouthGroup = new THREE.Group();
    dealerMouthGroup.position.set(0, 2.52, 0.56);
    dealerGroup.add(dealerMouthGroup);

    const mouthCenterGeo = new THREE.BoxGeometry(0.12, 0.028, 0.05);
    const mouthSideMidGeo = new THREE.BoxGeometry(0.08, 0.024, 0.04);
    const mouthSideCornerGeo = new THREE.BoxGeometry(0.06, 0.022, 0.04);

    const mouthCenter = new THREE.Mesh(mouthCenterGeo, maskLineMat);
    mouthCenter.position.set(0, 0, 0);
    dealerMouthGroup.add(mouthCenter);

    const mouthLeftMid = new THREE.Mesh(mouthSideMidGeo, maskLineMat);
    mouthLeftMid.position.set(-0.08, 0, 0);
    dealerMouthGroup.add(mouthLeftMid);

    const mouthLeftCorner = new THREE.Mesh(mouthSideCornerGeo, maskLineMat);
    mouthLeftCorner.position.set(-0.14, 0, 0);
    dealerMouthGroup.add(mouthLeftCorner);

    const mouthLeft = mouthLeftCorner; // compatibility

    const mouthRightMid = new THREE.Mesh(mouthSideMidGeo, maskLineMat);
    mouthRightMid.position.set(0.08, 0, 0);
    dealerMouthGroup.add(mouthRightMid);

    const mouthRightCorner = new THREE.Mesh(mouthSideCornerGeo, maskLineMat);
    mouthRightCorner.position.set(0.14, 0, 0);
    dealerMouthGroup.add(mouthRightCorner);

    const mouthRight = mouthRightCorner; // compatibility

    // --- CYLINDER MONITOR (The big revolving visual indicator) ---
    const cylinderUIGroup = new THREE.Group();
    cylinderUIGroup.position.set(-2.0, 0.8, 0.2); // visible left corner
    scene.add(cylinderUIGroup);

    // Heavy iron support stand
    const standGeo = new THREE.BoxGeometry(0.7, 0.6, 0.7);
    const ironStand = new THREE.Mesh(standGeo, rustySteelMat);
    ironStand.position.set(0, -0.1, 0);
    ironStand.castShadow = true;
    cylinderUIGroup.add(ironStand);

    const revolvingChamberGroup = new THREE.Group();
    revolvingChamberGroup.position.set(0, 0.25, 0);
    cylinderUIGroup.add(revolvingChamberGroup);

    // Core revolving visual indicator drum
    const drumGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 6);
    const drumMat = new THREE.MeshStandardMaterial({
      color: 0x222728,
      roughness: 0.6,
      metalness: 0.8,
    });
    const drumMesh = new THREE.Mesh(drumGeo, drumMat);
    drumMesh.rotation.x = Math.PI / 2;
    drumMesh.castShadow = true;
    revolvingChamberGroup.add(drumMesh);

    // Golden brass rod in core
    const rodGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5);
    const rodMesh = new THREE.Mesh(rodGeo, brassMat);
    rodMesh.rotation.x = Math.PI / 2;
    revolvingChamberGroup.add(rodMesh);

    // Visual chamber cartridge indicator sockets
    const cartridges: THREE.Mesh[] = [];
    const cartridgeShellGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.32, 5);

    const updateCylinderShells = () => {
      cartridges.forEach((c) => revolvingChamberGroup.remove(c));
      cartridges.length = 0;

      const currentChambers = stateRef.current.chambers;
      for (let i = 0; i < 6; i++) {
        const chamber = currentChambers[i];
        if (!chamber) continue;

        const angle = (i / 6) * Math.PI * 2;
        const radius = 0.27;

        let mat = blankShellMat;
        if (chamber.isSpent) {
          mat = hollowShellMat;
        } else if (chamber.isLive) {
          mat = liveShellMat;
        }

        const cartridge = new THREE.Mesh(cartridgeShellGeo, mat);
        cartridge.position.set(
          Math.sin(angle) * radius,
          Math.cos(angle) * radius,
          0
        );
        cartridge.castShadow = true;
        revolvingChamberGroup.add(cartridge);
        cartridges.push(cartridge);
      }
    };

    updateCylinderShells();

    // Neon Active red arrow shining from above
    const pointerConeGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
    const redGlowMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const activePointer = new THREE.Mesh(pointerConeGeo, redGlowMat);
    activePointer.position.set(0, 0.9, 0);
    activePointer.rotation.z = Math.PI;
    cylinderUIGroup.add(activePointer);


    // --- REVOLVER MODEL (DETAILED ARTICULATED LOW-POLY DOUBLE-ACTION REVOLVER) ---
    const isHighPoly = activePolyTier === 'high' || activePolyTier === 'ultra';
    const drumSegments = initialPolySegs.drum;
    const barrelSegments = initialPolySegs.barrel;
    const torusSegments = initialPolySegs.torus;

    const polishedSteelMat = new THREE.MeshStandardMaterial({
      color: 0xc0c6ca,
      roughness: 0.18,
      metalness: 0.96,
      flatShading: true,
    });
    const brassAccentMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.25,
      metalness: 0.90,
      flatShading: true,
    });
    const rawCutSteelMat = new THREE.MeshStandardMaterial({
      color: 0xe5ecf4,
      metalness: 0.96,
      roughness: 0.25,
      envMapIntensity: 2.0,
      flatShading: true,
    });

    const revolverRig: RevolverRig = createDetailedRevolverModel({
      gunMetalMat,
      stockMat,
      darkLinerMat,
      polishedSteelMat,
      brassAccentMat,
      rawCutSteelMat,
      drumSegments,
      barrelSegments,
      torusSegments,
      isHighPoly,
    });

    const {
      gunGroup,
      cylinderSwingGroup,
      cylinderSpinGroup,
      revolverCylinderMesh,
      chamberCartridges,
      cylinderLatchMesh,
      hammerPivotGroup,
      triggerPivotGroup,
      guardMesh,
      barrelRearMesh,
      barrelFrontMesh,
      gunBarrelFrontGroup,
      cutFaceMat,
      gunBloodGroup,
      frontGunBloodGroup,
      updateChambersState,
    } = revolverRig;

    gunGroup.position.set(0, 0.57, -0.4); // center table rest
    scene.add(gunGroup);
    animRef.current.gunBarrelFrontGroup = gunBarrelFrontGroup;

    // Shared real-time planar reflector disc attached only during active MIRROR inspection
    let mirrorReflectorNode: any = null;
    let mirrorReflectorGeo: THREE.BufferGeometry | null = null;
    let mirrorReflectorMat: THREE.Material | null = null;
    let mirrorReflectorMesh: THREE.Mesh | null = null;
    try {
      mirrorReflectorNode = reflector({ resolutionScale: 0.5, bounces: false });
      const reflMat = new MeshBasicNodeMaterial();
      reflMat.colorNode = mirrorReflectorNode.mul(0.92);
      mirrorReflectorMat = reflMat;
      mirrorReflectorGeo = new THREE.CircleGeometry(0.118, 20);
      mirrorReflectorMesh = new THREE.Mesh(mirrorReflectorGeo, mirrorReflectorMat);
      mirrorReflectorMesh.name = 'mirrorReflectorSurface';
      mirrorReflectorMesh.position.set(0, 0.25, 0.004);
      mirrorReflectorMesh.add(mirrorReflectorNode.target);
      mirrorReflectorMesh.visible = false;
      scene.add(mirrorReflectorMesh);
    } catch (reflErr) {
      console.warn('Planar mirror reflector fallback to metallic silver plate:', reflErr);
    }

    const createSeveredBarrelPiece = (): THREE.Group =>
      createDetailedSeveredBarrelPiece(
        gunMetalMat,
        polishedSteelMat,
        darkLinerMat,
        rawCutSteelMat,
        getPolySegments(activePolyTier).barrel
      );

    // Persistent faceted low-poly wound systems on Dealer and foreground player wrist
    const dealerWounds = createDealerWoundsSystem(dealerGroup);
    const wristWound = createWristSlashWoundGroup();
    scene.add(wristWound.group);
    const medkitArm = createMedkitForearmSystem();
    scene.add(medkitArm.group);

    const tvGroup = new THREE.Group();
    tvGroup.position.set(2.4, 1.85, -2.5); // Placed perfectly to the right side of the dealer, fully visible
    tvGroup.rotation.set(0.08, -0.55, 0); // Leaned slightly down and rotated inwards to face the player/camera
    scene.add(tvGroup);

    // Suspended heavy supporting iron pipe extending upward
    const tvPipeGeo = new THREE.CylinderGeometry(0.045, 0.045, 4.0, 8);
    const tvPipeMesh = new THREE.Mesh(tvPipeGeo, rustySteelMat);
    tvPipeMesh.position.set(0, 2.0, 0);
    tvPipeMesh.castShadow = true;
    tvGroup.add(tvPipeMesh);

    // Retro CRT monitor body/chassis
    const tvCaseGeo = new THREE.BoxGeometry(2.3, 1.45, 1.20); // Slightly reduced depth to move front face back to Z=0.60
    const tvCaseMat = new THREE.MeshStandardMaterial({
      color: 0x161514,
      roughness: 0.88,
      metalness: 0.72,
    });
    const tvCase = new THREE.Mesh(tvCaseGeo, tvCaseMat);
    tvCase.castShadow = true;
    tvCase.receiveShadow = true;
    tvGroup.add(tvCase);

    // Protective heavy steel grill bars
    const tvGrillGeo = new THREE.CylinderGeometry(0.015, 0.015, 2.2, 4);
    tvGrillGeo.rotateZ(Math.PI / 2);
    
    const tvGrateTop = new THREE.Mesh(tvGrillGeo, rustySteelMat);
    tvGrateTop.position.set(0, 0.65, 0.635);
    tvGrateTop.castShadow = true;
    tvGroup.add(tvGrateTop);

    const tvGrateBottom = new THREE.Mesh(tvGrillGeo, rustySteelMat);
    tvGrateBottom.position.set(0, -0.65, 0.635);
    tvGrateBottom.castShadow = true;
    tvGroup.add(tvGrateBottom);

    // TV Dark glass CRT screen panel
    const tvScreenGeo = new THREE.PlaneGeometry(2.1, 1.25);
    const tvScreenMat = new THREE.MeshStandardMaterial({
      color: 0x050404,
      roughness: 0.18,
      metalness: 0.88,
    });
    const tvScreenMesh = new THREE.Mesh(tvScreenGeo, tvScreenMat);
    tvScreenMesh.position.set(0, 0, 0.605); // Barely above case front (0.600)
    tvGroup.add(tvScreenMesh);

    // Screen vertical split divider
    const tvDividerGeo = new THREE.BoxGeometry(0.015, 1.15, 0.005);
    const tvDividerMat = new THREE.MeshBasicMaterial({ color: 0x130e0e });
    const tvDivider = new THREE.Mesh(tvDividerGeo, tvDividerMat);
    tvDivider.position.set(0, 0, 0.610); // Above screen
    tvGroup.add(tvDivider);

    // Dynamic numeric update routines
    const updateDealerNumericTex = (hp: number, max: number) => {
      const ctx = tvDValueCtx;
      if (!ctx) return;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 128, 64);
      ctx.strokeStyle = '#330000';
      ctx.lineWidth = 4;
      ctx.strokeRect(3, 3, 122, 58);
      ctx.fillStyle = '#180a0a';
      ctx.fillRect(5, 5, 118, 54);
      ctx.font = 'bold 24px monospace';
      ctx.fillStyle = '#ff1111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(hp)}/${Math.round(max)} HP`, 64, 32);
      tvDValueTex.needsUpdate = true;
    };

    const updatePlayerNumericTex = (hp: number, max: number) => {
      const ctx = tvPValueCtx;
      if (!ctx) return;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 128, 64);
      ctx.strokeStyle = '#001122';
      ctx.lineWidth = 4;
      ctx.strokeRect(3, 3, 122, 58);
      ctx.fillStyle = '#0a1018';
      ctx.fillRect(5, 5, 118, 54);
      ctx.font = 'bold 24px monospace';
      ctx.fillStyle = '#00bbff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(hp)}/${Math.round(max)} HP`, 64, 32);
      tvPValueTex.needsUpdate = true;
    };

    // Static Plates with "DEALER" and "YOU" labels
    const tvDLabelTex = createTextTexture("DEALER", "#330000", "#ff0000", 40);
    const tvDLabelMat = new THREE.MeshBasicMaterial({ map: tvDLabelTex, transparent: true, depthWrite: false });
    const tvDLabelPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.42), tvDLabelMat);
    tvDLabelPlane.position.set(-0.52, 0.38, 0.615); // Layered to sit cleanly above screen
    tvGroup.add(tvDLabelPlane);

    const tvPLabelTex = createTextTexture("YOU", "#001122", "#00aaff", 46);
    const tvPLabelMat = new THREE.MeshBasicMaterial({ map: tvPLabelTex, transparent: true, depthWrite: false });
    const tvPLabelPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.42), tvPLabelMat);
    tvPLabelPlane.position.set(-0.52, -0.22, 0.615);
    tvGroup.add(tvPLabelPlane);

    // Dynamic numeric canvas textures and plates
    const tvDValueCanvas = document.createElement('canvas');
    tvDValueCanvas.width = 128;
    tvDValueCanvas.height = 64;
    const tvDValueCtx = tvDValueCanvas.getContext('2d');
    const tvDValueTex = new THREE.CanvasTexture(tvDValueCanvas);
    tvDValueTex.generateMipmaps = false;
    tvDValueTex.minFilter = THREE.LinearFilter;

    const tvDValueMat = new THREE.MeshBasicMaterial({ map: tvDValueTex, transparent: true, depthWrite: false });
    const tvDValuePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.35), tvDValueMat);
    tvDValuePlane.position.set(0.52, 0.38, 0.615);
    tvGroup.add(tvDValuePlane);

    const tvPValueCanvas = document.createElement('canvas');
    tvPValueCanvas.width = 128;
    tvPValueCanvas.height = 64;
    const tvPValueCtx = tvPValueCanvas.getContext('2d');
    const tvPValueTex = new THREE.CanvasTexture(tvPValueCanvas);
    tvPValueTex.generateMipmaps = false;
    tvPValueTex.minFilter = THREE.LinearFilter;

    const tvPValueMat = new THREE.MeshBasicMaterial({ map: tvPValueTex, transparent: true, depthWrite: false });
    const tvPValuePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.35), tvPValueMat);
    tvPValuePlane.position.set(0.52, -0.22, 0.615);
    tvGroup.add(tvPValuePlane);

    // Initial renders to establish correct textures immediately
    updateDealerNumericTex(stateRef.current.dealer.health, stateRef.current.dealer.maxHealth);
    updatePlayerNumericTex(stateRef.current.player.health, stateRef.current.player.maxHealth);

    // Sub-groove backing plates
    const tvBackingGeo = new THREE.BoxGeometry(1.72, 0.14, 0.002); // Thin flat mesh to prevent overlapping depth
    const tvDBackingMat = new THREE.MeshStandardMaterial({ color: 0x220505, roughness: 0.65 });
    const tvDBack = new THREE.Mesh(tvBackingGeo, tvDBackingMat);
    tvDBack.position.set(0, 0.08, 0.610);
    tvGroup.add(tvDBack);

    const tvPBackingMat = new THREE.MeshStandardMaterial({ color: 0x050d22, roughness: 0.65 });
    const tvPBack = new THREE.Mesh(tvBackingGeo, tvPBackingMat);
    tvPBack.position.set(0, -0.52, 0.610);
    tvGroup.add(tvPBack);

    // Thick glass protection tubes
    const tvGlassTubeGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.70, 8);
    tvGlassTubeGeo.rotateZ(Math.PI / 2);
    const tvGlassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.95,
    });

    const tvDGlass = new THREE.Mesh(tvGlassTubeGeo, tvGlassMat);
    tvDGlass.position.set(0, 0.08, 0.625);
    tvDGlass.castShadow = true;
    tvGroup.add(tvDGlass);

    const tvPGlass = new THREE.Mesh(tvGlassTubeGeo, tvGlassMat);
    tvPGlass.position.set(0, -0.52, 0.625);
    tvPGlass.castShadow = true;
    tvGroup.add(tvPGlass);

    // Pivot containers scaling cylinders from the left edge (X = -0.85)
    const tvDHealthGroup = new THREE.Group();
    tvDHealthGroup.position.set(-0.85, 0.08, 0.620);
    tvGroup.add(tvDHealthGroup);

    const tvPHealthGroup = new THREE.Group();
    tvPHealthGroup.position.set(-0.85, -0.52, 0.620);
    tvGroup.add(tvPHealthGroup);

    // Emissive cylinders that scale on X axis
    const tvHealthTubeGeo = new THREE.CylinderGeometry(0.065, 0.065, 1.0, 8);
    tvHealthTubeGeo.rotateZ(Math.PI / 2);
    tvHealthTubeGeo.translate(0.5, 0, 0); // Translate so scaling centers around the left-most edge

    const tvDGlowMat = new THREE.MeshStandardMaterial({
      color: 0xff1100,
      emissive: 0xff0000,
      emissiveIntensity: 6.0,
      roughness: 0.1,
    });
    const tvDGlowMesh = new THREE.Mesh(tvHealthTubeGeo, tvDGlowMat);
    tvDGlowMesh.castShadow = true;
    tvDHealthGroup.add(tvDGlowMesh);

    const tvPGlowMat = new THREE.MeshStandardMaterial({
      color: 0x0088ff,
      emissive: 0x0055ff,
      emissiveIntensity: 6.0,
      roughness: 0.1,
    });
    const tvPGlowMesh = new THREE.Mesh(tvHealthTubeGeo, tvPGlowMat);
    tvPGlowMesh.castShadow = true;
    tvPHealthGroup.add(tvPGlowMesh);

    // PointLight casting a live diagnostic floor glow
    const tvGlowLight = new THREE.PointLight(0xff0000, 5.0, 12);
    tvGlowLight.position.set(0, -0.2, 1.3);
    tvGroup.add(tvGlowLight);

    let lastTvPlayerHP = -1;
    let lastTvPlayerMax = -1;
    let lastTvDealerHP = -1;
    let lastTvDealerMax = -1;


    // --- SHARED THREE.JS ASSET POOLS AND RESOURCE PROTECTION SYSTEMS ---
    const goreGeos = createGoreGeometries();
    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const unitCircleGeo = new THREE.CircleGeometry(1, 7);
    const unitSmokeSphereGeo = new THREE.SphereGeometry(0.5, 6, 5);
    const unitSmokeQuadGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const unitShellCylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    const unitBulletGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 8);
    const unitPixelSplatGeo = new THREE.BoxGeometry(1, 1, 0.05);
    const unitQuadSplatGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.002, 4);
    const unitHexSplatGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.002, 6);
    const unitOctagonSplatGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.002, 8);

    const sharedBloodMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      roughness: 0.14, 
      metalness: 0.08,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: true
    });
    const sharedDarkBloodMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      roughness: 0.22, 
      metalness: 0.05,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: true
    });
    const sharedBrightBloodMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      roughness: 0.12, 
      metalness: 0.10,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: true
    });
    const sharedAirborneBloodMat = new THREE.MeshStandardMaterial({ 
      color: 0x330202, 
      roughness: 0.12, 
      metalness: 0.12,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: true
    });
    const sharedGoreChunkMat = new THREE.MeshStandardMaterial({
      color: 0x450505,
      roughness: 0.20,
      metalness: 0.08,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: true,
    });
    const sharedGoreClotMat = new THREE.MeshStandardMaterial({
      color: 0x1d0102,
      roughness: 0.14,
      metalness: 0.10,
      flatShading: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: true,
    });
    const sharedSparkMat = new THREE.MeshBasicMaterial({ 
      color: 0xffcc00 
    });
    const sharedSmokeMat = new THREE.MeshBasicMaterial({ 
      color: 0xb8bec6, 
      map: proceduralTextures.smokeSpriteMap,
      transparent: true, 
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const sharedHighSmokeMat = new THREE.MeshStandardMaterial({ 
      color: 0xc8d0d8, 
      map: proceduralTextures.smokeSpriteMap,
      transparent: true, 
      opacity: 0.22, 
      roughness: 0.96,
      metalness: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
    const sharedLiquidMat = new THREE.MeshBasicMaterial({ 
      color: 0xbf7713, 
      transparent: true, 
      opacity: 0.8 
    });
    const sharedDebrisMat = new THREE.MeshStandardMaterial({ 
      color: 0x5a2d0c, 
      roughness: 0.8 
    });
    const sharedSplatMat = new THREE.MeshBasicMaterial({ 
      color: 0x2e0101, 
      transparent: true, 
      opacity: 0.95, 
      depthWrite: false, 
      depthTest: false 
    });
    const sharedBrassShellMat = new THREE.MeshStandardMaterial({ 
      color: 0xd4af37, 
      metalness: 0.92, 
      roughness: 0.22 
    });
    const sharedBlankShellMat = new THREE.MeshStandardMaterial({ 
      color: 0x1e8bc3, 
      metalness: 0.45, 
      roughness: 0.28 
    });
    const sharedBulletMat = new THREE.MeshStandardMaterial({ 
      color: 0xcc9900, 
      metalness: 0.95, 
      roughness: 0.15 
    });

    const sharedMaterials = new Set<THREE.Material>([
      rustySteelMat, brassMat, darkMetalStyle, cloakMat, maskLineMat,
      gunMetalMat, stockMat, darkLinerMat, liveShellMat, blankShellMat,
      hollowShellMat, shelfMat, tableMat, selfPadMat, etchMat,
      scalMat, defibYMat, darkSteelMat, leftEyeMat, rightEyeMat,
      bulbGlowMat, floorMat, boothWallMat, blackCavityMat, redGlowMat,
      polishedSteelMat, brassAccentMat, rawCutSteelMat,
      ...revolverRig.ownedMaterials,
      ...dealerWounds.ownedMaterials,
      ...wristWound.ownedMaterials,
      ...medkitArm.ownedMaterials,
      sharedBloodMat, sharedDarkBloodMat, sharedBrightBloodMat, sharedAirborneBloodMat,
      sharedGoreChunkMat, sharedGoreClotMat,
      sharedSparkMat, sharedSmokeMat, sharedHighSmokeMat, sharedLiquidMat, sharedDebrisMat, sharedSplatMat,
      sharedBrassShellMat, sharedBlankShellMat, sharedBulletMat,
      shopHitBoxMat,
      ...(mirrorReflectorMat ? [mirrorReflectorMat] : [])
    ]);

    const sharedGeometries = new Set<THREE.BufferGeometry>([
      tableLegsGeo, wireGeo, bulbGeo, bulbGlowGeo, tableTopGeo, floorGeo,
      boothWallGeo, shelfGeo, tagGeo, shopHitBoxGeo, cloakGeo, hoodGeo, faceCavityGeo,
      eyeGeo, standGeo, drumGeo, rodGeo, cartridgeShellGeo, pointerConeGeo,
      ...revolverRig.ownedGeometries,
      ...dealerWounds.ownedGeometries,
      ...wristWound.ownedGeometries,
      ...medkitArm.ownedGeometries,
      goreGeos.goreShardGeo, goreGeos.goreRibbonGeo, goreGeos.bloodDropGeo, goreGeos.irregularSplatGeo, goreGeos.lensStreakGeo,
      unitBoxGeo, unitCircleGeo, unitSmokeSphereGeo, unitSmokeQuadGeo,
      unitShellCylinderGeo, unitBulletGeo, unitPixelSplatGeo, unitQuadSplatGeo, unitHexSplatGeo, unitOctagonSplatGeo,
      ...(mirrorReflectorGeo ? [mirrorReflectorGeo] : [])
    ]);

    const disposeNode = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry && !sharedGeometries.has(child.geometry)) {
            child.geometry.dispose();
          }
          if (child.material) {
            const disposeMaterial = (mat: THREE.Material) => {
              if (!sharedMaterials.has(mat)) {
                if ((mat as any).map) (mat as any).map.dispose();
                if ((mat as any).lightMap) (mat as any).lightMap.dispose();
                if ((mat as any).aoMap) (mat as any).aoMap.dispose();
                if ((mat as any).emissiveMap) (mat as any).emissiveMap.dispose();
                if ((mat as any).bumpMap) (mat as any).bumpMap.dispose();
                if ((mat as any).normalMap) (mat as any).normalMap.dispose();
                if ((mat as any).displacementMap) (mat as any).displacementMap.dispose();
                if ((mat as any).roughnessMap) (mat as any).roughnessMap.dispose();
                if ((mat as any).metalnessMap) (mat as any).metalnessMap.dispose();
                if ((mat as any).alphaMap) (mat as any).alphaMap.dispose();
                mat.dispose();
              }
            };
            if (Array.isArray(child.material)) {
              child.material.forEach(disposeMaterial);
            } else {
              disposeMaterial(child.material);
            }
          }
        }
      });
    };


    // --- ITEM RACK REPRESENTATIONS ---
    const playerItemsGrp = new THREE.Group();
    playerItemsGrp.position.set(0.6, 0.6, 0.8); // user bottom-right hand
    scene.add(playerItemsGrp);

    const dealerItemsGrp = new THREE.Group();
    dealerItemsGrp.position.set(-0.8, 0.6, -1.6); // dealer top-left hand
    scene.add(dealerItemsGrp);

    let instantiatedPlayerCount = 0;
    let instantiatedDealerCount = 0;

    const playerItemMeshes: THREE.Group[] = [];
    const dealerItemMeshes: THREE.Group[] = [];

    const rebuildItemsOnTable = () => {
      // Safely dispose of unique materials and geometries inside old child meshes
      [...playerItemsGrp.children].forEach((child) => disposeNode(child));
      [...dealerItemsGrp.children].forEach((child) => disposeNode(child));

      while (playerItemsGrp.children.length > 0)
        playerItemsGrp.remove(playerItemsGrp.children[0]);
      while (dealerItemsGrp.children.length > 0)
        dealerItemsGrp.remove(dealerItemsGrp.children[0]);

      playerItemMeshes.length = 0;
      dealerItemMeshes.length = 0;

      const pItems = stateRef.current.player.items;
      const dItems = stateRef.current.dealer.items;

      // Arrange player items: 2 rows of 4
      pItems.forEach((type, idx) => {
        const itemObj = createItemMesh(type);
        const col = idx % 4;
        const row = Math.floor(idx / 4);

        const px = -0.5 + col * 0.35;
        const pz = -row * 0.45;

        itemObj.position.set(px, 0, pz);

        // Stamp interactive metadata on all sub-meshes for recursive hit validation
        itemObj.userData = { isPlayerItem: true, index: idx };

        playerItemsGrp.add(itemObj);
        playerItemMeshes.push(itemObj);
      });

      // Arrange dealer items of tabletop
      dItems.forEach((type, idx) => {
        const itemObj = createItemMesh(type);
        const col = idx % 4;
        const row = Math.floor(idx / 4);

        const px = -0.5 + col * 0.35;
        const pz = row * 0.45;

        itemObj.position.set(px, 0, pz);
        dealerItemsGrp.add(itemObj);
        dealerItemMeshes.push(itemObj);
      });

      instantiatedPlayerCount = pItems.length;
      instantiatedDealerCount = dItems.length;

      // Sync counts to animRef
      animRef.current.instantiatedPlayerCount = instantiatedPlayerCount;
      animRef.current.instantiatedDealerCount = instantiatedDealerCount;
    };

    rebuildItemsOnTable();

    // --- RAYCASTER TARGET SCANNER ---
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredMesh: THREE.Object3D | null = null;

    const getRaycastTargets = () => {
      const list: THREE.Object3D[] = [];
      list.push(dealerGroup);
      list.push(...playerItemMeshes);
      const isClassic = stateRef.current.branch === 'CLASSIC';
      list.push(...shopItemMeshes.filter(m => !isClassic || m.userData?.type !== 'SCALPEL'));
      return list;
    };


    // --- INSTANCED LANDED BLOOD SYSTEM & PARTICLE POOLING ---
    const MAX_LANDED_BLOOD = 4000;
    const landedCoreBloodIM = new THREE.InstancedMesh(goreGeos.irregularSplatGeo, sharedBloodMat, MAX_LANDED_BLOOD);
    const landedDarkBloodIM = new THREE.InstancedMesh(goreGeos.irregularSplatGeo, sharedDarkBloodMat, MAX_LANDED_BLOOD);
    const landedBrightBloodIM = new THREE.InstancedMesh(unitHexSplatGeo, sharedBrightBloodMat, MAX_LANDED_BLOOD);

    landedCoreBloodIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANDED_BLOOD * 3), 3);
    landedDarkBloodIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANDED_BLOOD * 3), 3);
    landedBrightBloodIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANDED_BLOOD * 3), 3);

    landedCoreBloodIM.count = 0;
    landedDarkBloodIM.count = 0;
    landedBrightBloodIM.count = 0;

    landedCoreBloodIM.receiveShadow = true;
    landedDarkBloodIM.receiveShadow = true;
    landedBrightBloodIM.receiveShadow = true;

    landedCoreBloodIM.renderOrder = 5;
    landedDarkBloodIM.renderOrder = 4;
    landedBrightBloodIM.renderOrder = 6;

    scene.add(landedCoreBloodIM);
    scene.add(landedDarkBloodIM);
    scene.add(landedBrightBloodIM);

    let landedCoreCount = 0;
    let landedDarkCount = 0;
    let landedBrightCount = 0;

    interface LandedSplatData {
      birthTime: number;
      initialR: number;
      initialG: number;
      initialB: number;
      targetR: number;
      targetG: number;
      targetB: number;
      pos: THREE.Vector3;
      rotY: number;
      baseScale: THREE.Vector3;
    }

    const landedCoreSplats: LandedSplatData[] = [];
    const landedDarkSplats: LandedSplatData[] = [];
    const landedBrightSplats: LandedSplatData[] = [];

    const dummyMatrix = new THREE.Matrix4();
    const dummyQuat = new THREE.Quaternion();
    const dummyEuler = new THREE.Euler();

    const addLandedSplat = (
      type: 'CORE' | 'DARK' | 'BRIGHT',
      pos: THREE.Vector3,
      rotY: number,
      scale: THREE.Vector3,
      colorHex: number = 0x2a0000
    ): number => {
      dummyEuler.set(0, rotY, 0);
      dummyQuat.setFromEuler(dummyEuler);
      dummyMatrix.compose(pos, dummyQuat, scale);

      // Realistic, gritty, dark visceral blood or authentic amber whiskey stain
      const freshCol = new THREE.Color(colorHex);
      const isWhiskeyColor = colorHex === 0x8c3409 || colorHex === 0x6e2806 || colorHex === 0xb85214;
      let targetR: number;
      let targetG: number;
      let targetB: number;

      if (isWhiskeyColor) {
        if (colorHex === 0x6e2806) {
          freshCol.setRGB(0.19 + Math.random() * 0.04, 0.042 + Math.random() * 0.015, 0.004);
        } else if (colorHex === 0xb85214) {
          freshCol.setRGB(0.38 + Math.random() * 0.08, 0.115 + Math.random() * 0.03, 0.012);
        } else {
          freshCol.setRGB(0.26 + Math.random() * 0.07, 0.068 + Math.random() * 0.022, 0.007 + Math.random() * 0.004);
        }
        // Whiskey gently soaks & darkens into wood/concrete over time while keeping its amber-brown hue
        targetR = Math.max(0.06, freshCol.r * 0.48);
        targetG = Math.max(0.016, freshCol.g * 0.42);
        targetB = Math.max(0.003, freshCol.b * 0.35);
      } else {
        if (colorHex === 0x2a0000 || colorHex === 0x8b0000 || colorHex === 0x3a0000) {
          // Deep gritty dark venous/arterial red (approx #320303 - #3f0404)
          const darkRed = 0.20 + Math.random() * 0.08;
          const darkGreen = 0.008 + Math.random() * 0.006;
          const darkBlue = 0.008 + Math.random() * 0.006;
          freshCol.setRGB(darkRed, darkGreen, darkBlue);
        } else {
          // Normalize any explicit hex to stay within gritty dark realistic bounds
          freshCol.r = Math.min(0.28, freshCol.r * 0.45);
          freshCol.g = Math.min(0.015, freshCol.g * 0.3);
          freshCol.b = Math.min(0.015, freshCol.b * 0.3);
        }
        // Calculate realistic aged oxidized target color (congealed, dried dark brownish-black scab/crust)
        targetR = Math.max(0.038, freshCol.r * 0.22 + (Math.random() * 0.01));
        targetG = Math.max(0.008, freshCol.g * 0.4 + 0.003); // natural rust/brownish oxidation
        targetB = Math.max(0.005, freshCol.b * 0.3);
      }

      const splatData: LandedSplatData = {
        birthTime: animRef.current.time,
        initialR: freshCol.r,
        initialG: freshCol.g,
        initialB: freshCol.b,
        targetR,
        targetG,
        targetB,
        pos: pos.clone(),
        rotY,
        baseScale: scale.clone()
      };

      if (type === 'CORE' && landedCoreCount < MAX_LANDED_BLOOD) {
        const idx = landedCoreCount;
        landedCoreBloodIM.setMatrixAt(idx, dummyMatrix);
        landedCoreBloodIM.setColorAt(idx, freshCol);
        landedCoreSplats[idx] = splatData;
        landedCoreCount++;
        landedCoreBloodIM.count = landedCoreCount;
        landedCoreBloodIM.instanceMatrix.needsUpdate = true;
        if (landedCoreBloodIM.instanceColor) landedCoreBloodIM.instanceColor.needsUpdate = true;
        return idx;
      } else if (type === 'DARK' && landedDarkCount < MAX_LANDED_BLOOD) {
        const idx = landedDarkCount;
        landedDarkBloodIM.setMatrixAt(idx, dummyMatrix);
        landedDarkBloodIM.setColorAt(idx, freshCol);
        landedDarkSplats[idx] = splatData;
        landedDarkCount++;
        landedDarkBloodIM.count = landedDarkCount;
        landedDarkBloodIM.instanceMatrix.needsUpdate = true;
        if (landedDarkBloodIM.instanceColor) landedDarkBloodIM.instanceColor.needsUpdate = true;
        return idx;
      } else if (type === 'BRIGHT' && landedBrightCount < MAX_LANDED_BLOOD) {
        const idx = landedBrightCount;
        landedBrightBloodIM.setMatrixAt(idx, dummyMatrix);
        landedBrightBloodIM.setColorAt(idx, freshCol);
        landedBrightSplats[idx] = splatData;
        landedBrightCount++;
        landedBrightBloodIM.count = landedBrightCount;
        landedBrightBloodIM.instanceMatrix.needsUpdate = true;
        if (landedBrightBloodIM.instanceColor) landedBrightBloodIM.instanceColor.needsUpdate = true;
        return idx;
      }
      return -1;
    };

    // Active blood puddles that ooze / creep slightly outward before coagulating
    const activeBloodPools: {
      idx: number;
      age: number;
      maxAge: number;
    }[] = [];

    // Pre-allocated object pool for airborne blood & gore chunk particle meshes
    const airborneBloodPool: THREE.Mesh[] = [];
    const getAirborneBloodMesh = (
      size: number,
      bloodMat: THREE.Material,
      geo: THREE.BufferGeometry = goreGeos.bloodDropGeo
    ): THREE.Mesh => {
      let m = airborneBloodPool.pop();
      const matToUse = bloodMat === sharedBloodMat ? sharedAirborneBloodMat : bloodMat;
      if (!m) {
        m = new THREE.Mesh(geo, matToUse);
      } else {
        m.geometry = geo;
        m.material = matToUse;
        m.visible = true;
      }
      m.userData = { size, isPooled: true };
      return m;
    };

    // --- PARTICLES SPARK EMITTER SYSTEM ---
    const activeParticles: {
      mesh: THREE.Mesh;
      velocity: THREE.Vector3;
      rotVelocity?: THREE.Vector3;
      life: number;
      maxLife: number;
      gravity: number;
      type: 'BLOOD' | 'SPARK' | 'SMOKE' | 'SHELL' | 'DEBRIS' | 'LIQUID' | 'BULLET';
      hasLanded: boolean;
      bounceCount: number;
      fromDripEmitter?: boolean;
    }[] = [];

    // --- SURFACE-TENSION BLOOD DRIP EMITTER SYSTEM ---
    // Swells hanging droplets on table apron edges, bloody revolver barrel, and wounds before detaching under gravity
    const bloodDripEmitters: {
      beadMesh: THREE.Mesh;
      anchor: THREE.Vector3;
      attachToGun: boolean;
      progress: number;
      intervalMs: number;
      remainingDrips: number;
      createdAtMs: number;
    }[] = [];

    const registerBloodDripEmitter = (
      worldPos: THREE.Vector3,
      remainingDrips: number = 4,
      attachToGun: boolean = false
    ) => {
      const ctrl = getControllerSettings();
      if (ctrl.bloodEffectsEnabled === false) return;
      const q = ctrl.particleQuality || 'low';
      const maxEmitters = q === 'ultra' ? 8 : q === 'high' ? 7 : q === 'medium' ? 6 : 5;
      if (bloodDripEmitters.length >= maxEmitters) {
        // Retire oldest emitter to recycle its bead cleanly
        const oldest = bloodDripEmitters.shift();
        if (oldest) {
          if (oldest.beadMesh.parent) oldest.beadMesh.parent.remove(oldest.beadMesh);
          oldest.beadMesh.visible = false;
          airborneBloodPool.push(oldest.beadMesh);
        }
      }

      const beadMesh = getAirborneBloodMesh(0.012, sharedBloodMat, goreGeos.bloodDropGeo);
      beadMesh.scale.set(0.008, 0.01, 0.008);
      beadMesh.rotation.set(0, 0, 0);
      scene.add(beadMesh);

      const anchor = attachToGun
        ? gunGroup.worldToLocal(worldPos.clone())
        : worldPos.clone();

      bloodDripEmitters.push({
        beadMesh,
        anchor,
        attachToGun,
        progress: Math.random() * 0.45,
        intervalMs: 220 + Math.random() * 210,
        remainingDrips: Math.max(1, Math.min(6, remainingDrips)),
        createdAtMs: Date.now()
      });
    };

    // --- DYNAMIC BLOOD AGING SYSTEM ---
    // Slowly congeals and oxidizes blood over time: from fresh glistening arterial crimson to dark, coagulated, dried scab crust
    const tempAgeCol = new THREE.Color();
    const BLOOD_OXIDATION_TIME = 35.0; // Seconds to reach mature dried blood stage

    const updateBloodAging = (currentTime: number) => {
      let coreUpdated = false;
      for (let i = 0; i < landedCoreCount; i++) {
        const s = landedCoreSplats[i];
        if (!s) continue;
        const age = Math.max(0, currentTime - s.birthTime);
        const t = Math.min(1.0, 1.0 - Math.exp(-age / (BLOOD_OXIDATION_TIME * 0.45)));
        if (t > 0.002) {
          const r = s.initialR + (s.targetR - s.initialR) * t;
          const g = s.initialG + (s.targetG - s.initialG) * t;
          const b = s.initialB + (s.targetB - s.initialB) * t;
          tempAgeCol.setRGB(r, g, b);
          landedCoreBloodIM.setColorAt(i, tempAgeCol);
          coreUpdated = true;
        }
      }
      if (coreUpdated && landedCoreBloodIM.instanceColor) {
        landedCoreBloodIM.instanceColor.needsUpdate = true;
      }

      let darkUpdated = false;
      for (let i = 0; i < landedDarkCount; i++) {
        const s = landedDarkSplats[i];
        if (!s) continue;
        const age = Math.max(0, currentTime - s.birthTime);
        const t = Math.min(1.0, 1.0 - Math.exp(-age / (BLOOD_OXIDATION_TIME * 0.45)));
        if (t > 0.002) {
          const r = s.initialR + (s.targetR - s.initialR) * t;
          const g = s.initialG + (s.targetG - s.initialG) * t;
          const b = s.initialB + (s.targetB - s.initialB) * t;
          tempAgeCol.setRGB(r, g, b);
          landedDarkBloodIM.setColorAt(i, tempAgeCol);
          darkUpdated = true;
        }
      }
      if (darkUpdated && landedDarkBloodIM.instanceColor) {
        landedDarkBloodIM.instanceColor.needsUpdate = true;
      }

      let brightUpdated = false;
      for (let i = 0; i < landedBrightCount; i++) {
        const s = landedBrightSplats[i];
        if (!s) continue;
        const age = Math.max(0, currentTime - s.birthTime);
        const t = Math.min(1.0, 1.0 - Math.exp(-age / (BLOOD_OXIDATION_TIME * 0.45)));
        if (t > 0.002) {
          const r = s.initialR + (s.targetR - s.initialR) * t;
          const g = s.initialG + (s.targetG - s.initialG) * t;
          const b = s.initialB + (s.targetB - s.initialB) * t;
          tempAgeCol.setRGB(r, g, b);
          landedBrightBloodIM.setColorAt(i, tempAgeCol);
          brightUpdated = true;
        }
      }
      if (brightUpdated && landedBrightBloodIM.instanceColor) {
        landedBrightBloodIM.instanceColor.needsUpdate = true;
      }
    };

    const clearBloodSplatters = () => {
      sharedBloodMat.opacity = 1.0;
      sharedDarkBloodMat.opacity = 1.0;
      sharedBrightBloodMat.opacity = 1.0;
      sharedAirborneBloodMat.opacity = 1.0;
      
      // 1. Reset instanced landed blood counts and splat metadata
      landedCoreCount = 0;
      landedDarkCount = 0;
      landedBrightCount = 0;
      landedCoreSplats.length = 0;
      landedDarkSplats.length = 0;
      landedBrightSplats.length = 0;
      landedCoreBloodIM.count = 0;
      landedDarkBloodIM.count = 0;
      landedBrightBloodIM.count = 0;
      landedCoreBloodIM.instanceMatrix.needsUpdate = true;
      landedDarkBloodIM.instanceMatrix.needsUpdate = true;
      landedBrightBloodIM.instanceMatrix.needsUpdate = true;

      // 2. Remove all active airborne blood particles and return to pool
      for (let i = activeParticles.length - 1; i >= 0; i--) {
        const pt = activeParticles[i];
        if (pt.type === 'BLOOD' || pt.type === 'LIQUID') {
          if (pt.mesh) {
            if (pt.mesh.parent) pt.mesh.parent.remove(pt.mesh);
            if (pt.mesh.userData?.isPooled) {
              pt.mesh.visible = false;
              airborneBloodPool.push(pt.mesh);
            } else {
              disposeNode(pt.mesh);
            }
          }
          activeParticles.splice(i, 1);
        }
      }

      // 2b. Remove hanging drip emitters, pool creep trackers, and GPU compute blood
      for (let i = bloodDripEmitters.length - 1; i >= 0; i--) {
        const em = bloodDripEmitters[i];
        if (em.beadMesh.parent) em.beadMesh.parent.remove(em.beadMesh);
        em.beadMesh.visible = false;
        airborneBloodPool.push(em.beadMesh);
      }
      bloodDripEmitters.length = 0;
      activeBloodPools.length = 0;
      animRef.current.gunBloodyUntil = 0;
      gunBloodGroup.visible = false;
      frontGunBloodGroup.visible = false;
      cutFaceMat.emissive.setHex(0x000000);
      cutFaceMat.emissiveIntensity = 0;
      dealerWounds.reset();
      wristWound.reset();
      medkitArm.reset();
      if (computeBloodSystem) computeBloodSystem.clear();

      // 3. Clean up camera lens attached splats
      if (camera.children.length > 0) {
        const camChildren = [...camera.children];
        camChildren.forEach((child) => {
          if (child instanceof THREE.Mesh && child.userData?.isCameraSplat) {
            camera.remove(child);
            disposeNode(child);
          }
        });
      }

      // 4. Reset 2D UI screen splat overlays
      setScreenSplats([]);
    };

    const spawnParticles = (
      origin: THREE.Vector3,
      particleColor: number,
      count = 20,
      speed = 0.15,
      gravityFactor = 0.003,
      type: 'BLOOD' | 'SPARK' | 'SMOKE' | 'SHELL' | 'DEBRIS' | 'LIQUID' | 'BULLET' = 'SPARK',
      customDirection?: THREE.Vector3
    ) => {
      const ctrlSettings = getControllerSettings();
      const isBloodEnabled = ctrlSettings.bloodEffectsEnabled !== false;

      // Particle Quality Density Multiplier
      const pQuality = ctrlSettings.particleQuality || 'low';
      let pMult = 1.0;
      switch (pQuality) {
        case 'low': pMult = 0.35; break;
        case 'medium': pMult = 0.65; break;
        case 'high': pMult = 1.0; break;
        case 'ultra': pMult = 1.75; break;
      }

      if (type === 'BLOOD') {
        if (!isBloodEnabled) return;
        particleColor = 0x2a0000;
        if (count <= 0) count = 1;
      } else if (type === 'SMOKE') {
        count = Math.max(1, Math.min(18, Math.round(count * Math.min(1.25, pMult))));
      } else {
        // Non-blood particles (SPARK, DEBRIS, LIQUID) obey settings
        count = Math.max(1, Math.round(count * pMult));
      }

      if (count <= 0) return;

      // WebGPU Compute Shader Particle Bursts
      if (type === 'BLOOD' && computeBloodSystem && ctrlSettings.gpuComputePhysics !== false) {
        const spreadFactor = customDirection ? 0.55 : (count > 100 ? 1.0 : 0.45);
        const dir = customDirection
          ? customDirection.clone().normalize()
          : new THREE.Vector3(
              (Math.random() - 0.5) * spreadFactor,
              Math.random() * 0.8 + 0.3,
              (Math.random() - 0.5) * spreadFactor
            ).normalize();
        computeBloodSystem.emitBurst(
          origin,
          dir,
          Math.min(Math.round(count * 2.5), 512),
          speed * 18.0,
          spreadFactor,
          count > 100 ? 9.0 : 5.0
        );
      } else if (type === 'SPARK' && computeSparksSystem && ctrlSettings.gpuComputePhysics !== false) {
        const dir = customDirection
          ? customDirection.clone().normalize()
          : new THREE.Vector3(
              (Math.random() - 0.5) * 0.8,
              Math.random() * 0.9 + 0.2,
              (Math.random() - 0.5) * 0.8
            ).normalize();
        computeSparksSystem.emitSparks(
          origin,
          dir,
          Math.min(Math.round(count * 2.0), 128),
          speed * 20.0,
          customDirection ? 0.35 : 0.8,
          1.2
        );
      } else if (type === 'SMOKE' && volumetricSmokeSystem && ctrlSettings.volumetricSmokeEnabled !== false) {
        const smokeDir = customDirection ? customDirection.clone() : new THREE.Vector3(0, 0.4, 0);
        volumetricSmokeSystem.emitPuff(
          origin,
          smokeDir,
          Math.min(Math.round(count * 1.5), 32),
          speed * 3.0,
          4.5
        );
      }

      // 1. Psychological horror camera lens low-poly crimson droplet splash on heavy hits
      if (type === 'BLOOD' && count >= 125) {
        const splatCount = 16 + Math.floor(Math.random() * 12);
        for (let s = 0; s < splatCount; s++) {
          const pxSize = 0.005 + Math.random() * 0.011;
          const splatMesh = new THREE.Mesh(goreGeos.lensStreakGeo, sharedSplatMat);
          const pxWidth = pxSize * (0.85 + Math.random() * 0.8);
          const pxHeight = pxSize * (1.1 + Math.random() * 1.5);
          splatMesh.scale.set(pxWidth, pxHeight, 1);
          splatMesh.userData = { initialScaleX: pxWidth, initialScaleY: pxHeight, isCameraSplat: true };

          const rx = (Math.random() - 0.5) * 0.20;
          const ry = (Math.random() - 0.5) * 0.13;
          splatMesh.position.set(rx, ry, -0.11);
          splatMesh.rotation.z = (Math.random() - 0.5) * 0.7;

          camera.add(splatMesh);

          const splatMaxLife = 160 + Math.random() * 200;
          activeParticles.push({
            mesh: splatMesh,
            velocity: new THREE.Vector3(0, -0.00022 - Math.random() * 0.00032, 0),
            life: 0,
            maxLife: splatMaxLife,
            gravity: 0,
            type: 'BLOOD',
            hasLanded: true,
            bounceCount: 0
          });
        }
      }

      for (let i = 0; i < count; i++) {
        let mesh: THREE.Mesh;
        let maxLife = 20 + Math.random() * 30;
        let gravity = gravityFactor * (0.8 + Math.random() * 0.5);
        let rotVel: THREE.Vector3 | undefined = undefined;

        switch (type) {
          case 'BLOOD': {
            const isFineDroplet = count <= 8 && speed <= 0.06;
            const roll = isFineDroplet ? 0.0 : Math.random();
            const baseSize = (0.011 + Math.random() * 0.022) * (isFineDroplet ? 0.68 : 1.0);

            if (roll < 0.40) {
              // Faceted 5-sided low-poly blood teardrop
              mesh = getAirborneBloodMesh(baseSize, sharedBloodMat, goreGeos.bloodDropGeo);
              mesh.scale.set(baseSize, baseSize * (1.4 + Math.random() * 1.2), baseSize);
            } else if (roll < 0.78) {
              // Jagged low-poly flesh / coagulated clot shard
              const shardSize = baseSize * (1.1 + Math.random() * 0.7);
              const matChoice = Math.random() < 0.45 ? sharedGoreClotMat : sharedGoreChunkMat;
              mesh = getAirborneBloodMesh(shardSize, matChoice, goreGeos.goreShardGeo);
              mesh.scale.set(
                shardSize * (0.8 + Math.random() * 0.6),
                shardSize * (1.0 + Math.random() * 1.0),
                shardSize * (0.8 + Math.random() * 0.6)
              );
              rotVel = new THREE.Vector3(
                (Math.random() - 0.5) * 0.28,
                (Math.random() - 0.5) * 0.28,
                (Math.random() - 0.5) * 0.28
              );
            } else {
              // Shredded arterial tissue ribbon
              const ribSize = baseSize * (1.3 + Math.random() * 0.8);
              mesh = getAirborneBloodMesh(ribSize, sharedGoreChunkMat, goreGeos.goreRibbonGeo);
              mesh.scale.set(ribSize * 0.65, ribSize * 1.55, ribSize * 0.55);
              rotVel = new THREE.Vector3(
                (Math.random() - 0.5) * 0.36,
                (Math.random() - 0.5) * 0.36,
                (Math.random() - 0.5) * 0.36
              );
            }

            mesh.rotation.set(
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2
            );

            maxLife = 1200 + Math.random() * 600;
            break;
          }
          case 'SPARK': {
            const size = 0.015 + Math.random() * 0.02;
            mesh = new THREE.Mesh(unitBoxGeo, sharedSparkMat);
            mesh.scale.set(size, size, size * 2);
            mesh.renderOrder = 10;
            maxLife = 10 + Math.random() * 15;
            gravity = 0.001; 
            break;
          }
          case 'SHELL': {
            mesh = new THREE.Mesh(
              unitShellCylinderGeo, 
              particleColor === 0x1e8bc3 ? sharedBlankShellMat : sharedBrassShellMat
            );
            mesh.scale.set(0.042, 0.13, 0.042);
            mesh.rotation.z = Math.PI / 2;
            maxLife = 240;
            gravity = 0.0038;
            break;
          }
          case 'BULLET': {
            mesh = new THREE.Mesh(unitBulletGeo, sharedBulletMat);
            mesh.scale.set(0.03, 0.12, 0.03);
            maxLife = 28;
            gravity = 0.0001;
            break;
          }
          case 'SMOKE': {
            const ctrlSmoke = getControllerSettings();
            const isHighSettings = ctrlSmoke.postProcessing === 'high' || ctrlSmoke.postProcessing === 'cinematic' || ctrlSmoke.materialQuality === 'high' || ctrlSmoke.materialQuality === 'ultra';
            const size = isHighSettings
              ? 0.065 + Math.random() * 0.065
              : 0.048 + Math.random() * 0.045;

            const baseMat = isHighSettings ? sharedHighSmokeMat : sharedSmokeMat;
            const smokeMat = baseMat.clone();
            if (particleColor && particleColor !== 0xffcc00 && particleColor !== 0xaaaaaa) {
              smokeMat.color.setHex(particleColor);
            }

            const baseOpacity = isHighSettings ? 0.22 : 0.26;
            smokeMat.opacity = 0; // Starts transparent, fades in smoothly
            smokeMat.transparent = true;
            smokeMat.depthWrite = false;

            mesh = new THREE.Mesh(unitSmokeQuadGeo, smokeMat);
            mesh.renderOrder = 10; // Render above blood splatters on table
            mesh.quaternion.copy(camera.quaternion);

            const sx = size * (0.9 + Math.random() * 0.3);
            const sy = size * (0.9 + Math.random() * 0.3);
            mesh.scale.set(sx, sy, 1);
            const initialRoll = Math.random() * Math.PI * 2;
            mesh.rotateZ(initialRoll);
            mesh.userData = {
              isSmokeSprite: true,
              rollAngle: initialRoll,
              initialScaleX: sx,
              initialScaleY: sy,
              initialScaleZ: 1,
              baseOpacity,
              rotSpeedZ: (Math.random() - 0.5) * 0.025,
            };

            maxLife = isHighSettings
              ? 125 + Math.random() * 60
              : 85 + Math.random() * 40;
            gravity = -0.0004 - Math.random() * 0.0004; // Gentle thermal upward draft
            break;
          }
          case 'LIQUID': {
            const size = 0.015 + Math.random() * 0.02;
            const mat = sharedLiquidMat.clone();
            mat.color.setHex(particleColor);
            mesh = new THREE.Mesh(unitBoxGeo, mat);
            mesh.scale.set(size, size, size);
            maxLife = 60 + Math.random() * 30;
            gravity = 0.0015; // Positive gravity so it falls into mouth/down
            break;
          }
          default: {
            const size = 0.03 + Math.random() * 0.03;
            mesh = new THREE.Mesh(unitBoxGeo, sharedDebrisMat);
            mesh.scale.set(size, size, size);
            maxLife = 60 + Math.random() * 40;
            break;
          }
        }

        mesh.position.copy(origin);
        scene.add(mesh);

        const angle = Math.random() * Math.PI * 2;
        const spread = type === 'BLOOD' 
          ? (0.12 + Math.random() * 0.65) 
          : (type === 'SMOKE' ? (0.02 + Math.random() * 0.15) : (type === 'LIQUID' ? 0.05 + Math.random() * 0.05 : Math.random() - 0.5));
        
        let velocity = new THREE.Vector3(
          Math.cos(angle) * spread * speed * 1.5,
          type === 'BLOOD'
            ? (Math.random() - 0.70) * speed * 1.8 - 0.08
            : (Math.random() - 0.15) * speed * 2.0 + (type === 'SMOKE' ? 0.005 : (type === 'LIQUID' ? -0.1 : 0.05)),
          Math.sin(angle) * spread * speed * 1.5
        );

        if (type === 'SHELL') {
          // Eject casing out of chamber port with angular spin and realistic arc physics
          const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(gunGroup.quaternion).normalize();
          const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(gunGroup.quaternion).normalize();
          const backVec = new THREE.Vector3(0, 0, -1).applyQuaternion(gunGroup.quaternion).normalize();

          velocity = rightVec.clone().multiplyScalar(0.08 + Math.random() * 0.04)
            .addScaledVector(upVec, 0.12 + Math.random() * 0.05)
            .addScaledVector(backVec, 0.02 + Math.random() * 0.03);

          rotVel = new THREE.Vector3(
            (Math.random() - 0.5) * 0.45,
            (Math.random() - 0.5) * 0.45,
            (Math.random() - 0.5) * 0.45
          );
        } else if (type === 'BULLET') {
          // High velocity forward trajectory along gun barrel direction
          const forwardVec = new THREE.Vector3(0, 0, 1).applyQuaternion(gunGroup.quaternion).normalize();
          velocity = forwardVec.multiplyScalar(0.85 + Math.random() * 0.1);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forwardVec);
        } else if (type === 'BLOOD' && customDirection) {
          const bloodDir = customDirection.clone().normalize();
          const coneSpread = speed * 0.55;
          velocity = bloodDir.multiplyScalar(speed * (0.75 + Math.random() * 0.85)).add(
            new THREE.Vector3(
              (Math.random() - 0.5) * coneSpread,
              (Math.random() - 0.35) * coneSpread,
              (Math.random() - 0.5) * coneSpread
            )
          );
        } else if (type === 'SPARK' && customDirection) {
          const sparkDir = customDirection.clone().normalize();
          velocity = sparkDir.multiplyScalar(speed * (0.7 + Math.random() * 0.8)).add(
            new THREE.Vector3(
              (Math.random() - 0.5) * speed * 0.55,
              (Math.random() - 0.3) * speed * 0.55,
              (Math.random() - 0.5) * speed * 0.55
            )
          );
        } else if (type === 'SMOKE') {
          if (customDirection) {
            velocity = customDirection.clone().multiplyScalar(speed * (0.65 + Math.random() * 0.55)).add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.008,
                (Math.random() - 0.2) * 0.006,
                (Math.random() - 0.5) * 0.008
              )
            );
          } else {
            // Project barrel smoke forward along the muzzle pointing vector direction
            const forwardVec = new THREE.Vector3(0, 0, 1).applyQuaternion(gunGroup.quaternion).normalize();
            velocity.addScaledVector(forwardVec, 0.01 + Math.random() * 0.016);
          }
        }

        activeParticles.push({
          mesh,
          velocity,
          rotVelocity: rotVel,
          life: 0,
          maxLife,
          gravity,
          type,
          hasLanded: false,
          bounceCount: 0
        });
      }
    };

    // --- PHYSICS-DRIVEN ITEM DISCARD SYSTEM ---
    const discardItemPhysics = (itemObj: THREE.Group | null, user: 'player' | 'dealer' = 'player') => {
      zippoFlameLight.intensity = 0;
      if (mirrorReflectorMesh && mirrorReflectorMesh.parent === itemObj) {
        mirrorReflectorMesh.visible = false;
        scene.add(mirrorReflectorMesh);
      }
      if (!itemObj) return;
      const isPlayer = user === 'player';
      
      // Calculate realistic tossing impulse velocity
      const vx = (Math.random() - 0.5) * 0.12 + (isPlayer ? 0.04 : -0.04);
      const vy = 0.05 + Math.random() * 0.05; // upward arc toss
      const vz = (isPlayer ? -0.08 : 0.08) + (Math.random() - 0.5) * 0.06;

      const rotVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.35,
        (Math.random() - 0.5) * 0.35
      );

      activeParticles.push({
        mesh: itemObj as any,
        velocity: new THREE.Vector3(vx, vy, vz),
        rotVelocity,
        life: 0,
        maxLife: 350, // stays on table/floor realistically before cleanup
        gravity: 0.0035,
        hasLanded: false,
        type: 'DEBRIS',
        bounceCount: 0,
      });
    };


    // --- ANIMATION / INTERACTION STATES moved to animRef ---
    const ar = animRef.current;

    // Table resting coordinates: physically resting flat on its side on the table surface
    const initialGunPos = new THREE.Vector3(0, 0.57, -0.4);
    const initialGunRot = new THREE.Euler(0.06, Math.PI / 2 + 0.12, Math.PI / 2); // Lying flat on the table, slightly angled
    const initialGunQuat = new THREE.Quaternion().setFromEuler(initialGunRot);
    gunGroup.position.copy(initialGunPos);
    gunGroup.quaternion.copy(initialGunQuat);

    const rebuildAdaptiveGeometry = (tier: 'low' | 'medium' | 'high' | 'ultra') => {
      if (tier === activePolyTier) return;
      activePolyTier = tier;
      const segs = getPolySegments(tier);

      const swapMeshGeometry = (mesh: THREE.Mesh, nextGeo: THREE.BufferGeometry) => {
        const prev = mesh.geometry;
        sharedGeometries.delete(prev);
        mesh.geometry = nextGeo;
        sharedGeometries.add(nextGeo);
        prev.dispose();
      };

      const nextCloak = new THREE.CylinderGeometry(0.1, 0.9, 1.8, segs.cloak, 1, false);
      swapMeshGeometry(cloakMesh, nextCloak);

      const nextDrum = new THREE.CylinderGeometry(0.165, 0.165, 0.36, segs.drum);
      nextDrum.rotateX(Math.PI / 2);
      swapMeshGeometry(revolverCylinderMesh, nextDrum);

      const nextRear = new THREE.CylinderGeometry(0.070, 0.068, 0.24, segs.barrel);
      nextRear.rotateX(Math.PI / 2);
      swapMeshGeometry(barrelRearMesh, nextRear);

      const nextFront = new THREE.CylinderGeometry(0.064, 0.068, 0.52, segs.barrel);
      nextFront.rotateX(Math.PI / 2);
      swapMeshGeometry(barrelFrontMesh, nextFront);

      const nextGuard = new THREE.TorusGeometry(0.082, 0.016, segs.torus, segs.torus * 2, Math.PI);
      nextGuard.rotateY(Math.PI / 2);
      nextGuard.rotateX(Math.PI);
      swapMeshGeometry(guardMesh, nextGuard);
    };

    // Grid Scaling layout handlers
    handleResize = () => {
      if (!renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;

      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const isMobileDevice = false;
      isDesktopHQ = true;

      const graphics = getControllerSettings();
      const upscalingPreset = graphics.webGpuUpscalingPreset || 'quality';
      const sharpening = graphics.webGpuSharpening !== undefined ? graphics.webGpuSharpening : 0.6;

      // Determine internal render scale from spatial upscaling preset
      let scale = 0.77;
      switch (upscalingPreset) {
        case 'native': scale = 1.0; break;
        case 'ultra_quality': scale = 0.88; break;
        case 'quality': scale = 0.77; break;
        case 'balanced': scale = 0.67; break;
        case 'performance': scale = 0.50; break;
      }

      if (scenePass && typeof scenePass.setResolutionScale === 'function') {
        scenePass.setResolutionScale(scale);
      }

      // Convert user sharpening slider (0.0..1.0) to Robust Contrast-Adaptive Sharpening strength (0.0 = max, 1.8 = soft)
      const contrastAdaptiveSharpness = Math.max(0.0, (1.0 - sharpening) * 1.8);

      if (advancedPipeline) {
        advancedPipeline.rebuildGraph(graphics, scale);
      } else if (renderPipeline && scenePass) {
        const aaSetting = graphics.antiAliasing || 'fxaa';
        const postKey = `${upscalingPreset}_${sharpening}_${aaSetting}_${contrastAdaptiveSharpness.toFixed(2)}`;
        if (postKey !== currentPostprocessingKey) {
          currentPostprocessingKey = postKey;
          try {
            if (currentPostprocessingNode && currentPostprocessingNode !== scenePass && typeof currentPostprocessingNode.dispose === 'function') {
              try { currentPostprocessingNode.dispose(); } catch (e) {}
            }
            let node: any = scenePass;
            if (aaSetting === 'smaa') {
              node = smaa(node);
            } else if (aaSetting === 'fxaa') {
              node = fxaa(node);
            }
            if (upscalingPreset !== 'native') {
              node = fsr1(node, contrastAdaptiveSharpness);
            }
            currentPostprocessingNode = node;
            renderPipeline.outputNode = currentPostprocessingNode;
            renderPipeline.needsUpdate = true;
          } catch (e) {
            console.warn('Spatial upscaling & contrast-adaptive sharpening postprocessing node error:', e);
            renderPipeline.outputNode = scenePass;
          }
        }
      }

      // Sync compute particle / volumetric smoke densities to preset quality
      const computeQ = graphics.computePhysicsQuality || 'low';
      computeBloodSystem?.setQuality(computeQ);
      computeSparksSystem?.setQuality(computeQ);
      volumetricSmokeSystem?.setQuality(graphics.volumetricSmokeQuality || 'low');

      // Live rebuild adaptive low-poly segments when polygonCount setting updates
      rebuildAdaptiveGeometry(graphics.polygonCount || 'high');

      // Proper 4-tier Shadow Quality Mapping
      const shadowQ = graphics.shadowQuality || 'medium';
      const targetShadowSize =
        shadowQ === 'ultra' ? 4096 :
        shadowQ === 'high' ? 2048 :
        shadowQ === 'medium' ? 1024 : 512;
      const targetShadowType = (shadowQ === 'high' || shadowQ === 'ultra')
        ? THREE.PCFSoftShadowMap
        : THREE.PCFShadowMap;

      renderer.shadowMap.enabled = !isMobileDevice;
      if (!isMobileDevice && renderer.shadowMap.type !== targetShadowType) {
        renderer.shadowMap.type = targetShadowType;
      }

      const refQuality = graphics.reflectionQuality || 'low';
      let envIntensity = 0.28;
      switch (refQuality) {
        case 'low': envIntensity = 0.28; break;
        case 'medium': envIntensity = 0.62; break;
        case 'high': envIntensity = 0.95; break;
        case 'ultra': envIntensity = 1.35; break;
      }
      const matQ = graphics.materialQuality || 'low';
      const bumpStrength = !graphics.materialEnhancements ? 0.0 :
        matQ === 'ultra' ? 0.032 :
        matQ === 'high' ? 0.022 :
        matQ === 'medium' ? 0.012 : 0.004;

      if ('environmentIntensity' in scene) {
        (scene as any).environmentIntensity = graphics.materialEnhancements ? envIntensity : envIntensity * 0.45;
      }

      const maxAniso = renderer.capabilities?.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
      const targetAniso = isMobileDevice ? 1 : Math.min(graphics.textureFiltering || 2, maxAniso);
      const nextMatConfigKey = `${refQuality}_${matQ}_${graphics.materialEnhancements !== false}_${targetAniso}`;
      const shouldUpdateMaterials = nextMatConfigKey !== lastMaterialConfigKey;
      lastMaterialConfigKey = nextMatConfigKey;

      scene.traverse((child) => {
        if (child instanceof THREE.SpotLight || child instanceof THREE.PointLight || child instanceof THREE.DirectionalLight) {
          if (child.userData?.noShadow || child.name?.includes('shelf') || child.name?.includes('shopAmbient') || child.name?.includes('fill') || child.name?.includes('flame') || child.name?.includes('zippo') || child.name?.includes('Rim') || child.name?.includes('muzzleFlash')) {
            child.castShadow = false;
          } else {
            child.castShadow = !isMobileDevice;
            if (child.castShadow && (child.shadow.mapSize.width !== targetShadowSize || child.shadow.mapSize.height !== targetShadowSize)) {
              child.shadow.mapSize.set(targetShadowSize, targetShadowSize);
              if (child.shadow.map) {
                try { child.shadow.map.dispose(); } catch (e) {}
                child.shadow.map = null;
              }
            }
          }
        }

        if (shouldUpdateMaterials && child instanceof THREE.Mesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            const mat = m as THREE.MeshStandardMaterial;
            [mat.map, mat.bumpMap, mat.roughnessMap].forEach((tex) => {
              if (tex) {
                tex.anisotropy = targetAniso;
                tex.needsUpdate = true;
              }
            });
            if (mat.bumpMap) {
              mat.bumpScale = bumpStrength;
            }
            if (mat.roughness !== undefined) {
              mat.envMapIntensity = graphics.materialEnhancements ? envIntensity : envIntensity * 0.45;
              mat.needsUpdate = true;
            }
          });
        }
      });

      if (renderer) {
        renderer.setSize(w, h, false);
      }
    };

    if (handleResize) handleResize();

    const resizeObserver = new ResizeObserver(() => {
      if (handleResize) handleResize();
    });
    resizeObserver.observe(container);

    // Subscribe to settings changes synchronously so cleanup can unsubscribe without leaks
    const unsubscribeSettings = subscribeControllerSettings((updatedSettings) => {
      watchdog.updateSettings(updatedSettings);
      if (handleResize) handleResize();
      setDebugToggle(p => p + 1);
    });

    // --- INTERACTIONS HOVER & CLICKS LIST_DURS ---
    const getIntersectionTargetRaw = (clientX: number, clientY: number): THREE.Object3D | null => {
      const rect = activeCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      const isClassic = stateRef.current.branch === 'CLASSIC';
      const isShopOpen =
        isLookingAtShopRef.current &&
        stateRef.current.player.health > 0 &&
        stateRef.current.gameState === 'PLAYER_TURN';

      const availableShopHitBoxes = isClassic
        ? shopHitBoxes.filter(hb => hb.userData?.targetShopItem?.userData?.type !== 'SCALPEL')
        : shopHitBoxes;
      const availableShopMeshes = isClassic
        ? shopItemMeshes.filter(m => m.userData?.type !== 'SCALPEL')
        : shopItemMeshes;

      const targets: THREE.Object3D[] = isShopOpen
        ? [...availableShopHitBoxes, ...availableShopMeshes]
        : [dealerGroup, ...playerItemMeshes];

      const intersects = raycaster.intersectObjects(targets, true);

      if (intersects.length > 0) {
        const firstObj = intersects[0].object;
        let curr: THREE.Object3D | null = firstObj;
        while (curr && curr !== scene) {
          if (curr.userData?.isShopHitBox && curr.userData.targetShopItem) {
            return curr.userData.targetShopItem;
          }
          if (
            curr.userData &&
            (curr.userData.isPlayerItem ||
              curr.userData.isShopItem)
          ) {
            return curr;
          }
          curr = curr.parent;
        }
      }
      return null;
    };

    const getIntersectionTarget = (e: MouseEvent): THREE.Object3D | null => {
      return getIntersectionTargetRaw(e.clientX, e.clientY);
    };

    const handleMouseMoveRaw = (clientX: number, clientY: number) => {
      const target = getIntersectionTargetRaw(clientX, clientY);
      hoveredMesh = target;

      if (target) {
        document.body.style.cursor = 'pointer';

        if (target.userData.isPlayerItem) {
          const idx = target.userData.index;
          const userItemsArr = stateRef.current.player.items;
          const itemName = userItemsArr[idx];
          const itemDesc = getItemDescription(itemName, stateRef.current.branch);

          setHoveredInfo({
            type: 'ITEM',
            name: itemName,
            description: itemDesc,
            index: idx,
          });
        } else if (target.userData.isShopItem) {
           const { type, cost } = target.userData;
           const isAffordable = stateRef.current.bloodCurrency >= cost;
           setHoveredInfo({
              type: 'SHOP_ITEM',
              name: `${type} (${isAffordable ? 'AFFORDABLE' : 'TOO DEAR'})`,
              description: `${getItemDescription(type, stateRef.current.branch)} COST: ${cost} BLOOD. CLICKS TO PURCHASE.`
           });
        }
      } else {
        document.body.style.cursor = '';
        setHoveredInfo(null);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isSyntheticMouseFromTouch()) return;
      markMouseOrKeyActivity();

      // Mouse move hides HUD smoothly and starts a 3-second inactivity timer to show it back
      if (mouseInactivityTimerRef.current) {
        clearTimeout(mouseInactivityTimerRef.current);
      }
      setShowKeyboardHud(false);
      mouseInactivityTimerRef.current = setTimeout(() => {
        setShowKeyboardHud(true);
      }, 3000);

      const targetEl = e.target as HTMLElement | null;
      if (
        !targetEl ||
        !renderer?.domElement ||
        (targetEl !== renderer.domElement && !renderer.domElement.contains(targetEl)) ||
        targetEl.closest('.settings-panel, button, input, select, label, a, [data-ui]') ||
        document.querySelector('.settings-panel')
      ) {
        document.body.style.cursor = '';
        setHoveredInfo(null);
        return;
      }

      if (getControllerSettings().inputType === 'gamepad') return; // Prevent KBM overriding active gamepad
      handleMouseMoveRaw(e.clientX, e.clientY);
    };

    const handleMouseUpRaw = (clientX: number, clientY: number) => {
      const target = getIntersectionTargetRaw(clientX, clientY);
      if (target) {
        if (target.userData.isPlayerItem && stateRef.current.showControls) {
          const idx = target.userData.index;
          useItem(idx, 'player');
          hoveredMesh = null;
          setHoveredInfo(null);
        } else if (target.userData.isShopItem) {
           const { type, cost } = target.userData;
           if (stateRef.current.bloodCurrency >= cost && stateRef.current.player.items.length < 8) {
              buyItem(type, cost);
              playPurchaseSound();
           }
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isSyntheticMouseFromTouch()) return;
      const targetEl = e.target as HTMLElement | null;
      if (
        !targetEl ||
        !renderer?.domElement ||
        (targetEl !== renderer.domElement && !renderer.domElement.contains(targetEl)) ||
        targetEl.closest('.settings-panel, button, input, select, label, a, [data-ui]') ||
        document.querySelector('.settings-panel')
      ) {
        return;
      }
      if (getControllerSettings().inputType === 'gamepad') return;
      handleMouseUpRaw(e.clientX, e.clientY);
    };

    // --- FIRST-CLASS MOBILE TOUCHSCREEN CONTROLS (Drag camera look + Tap to inspect / Tap again to use/buy) ---
    let touchActiveId: number | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastY = 0;
    let touchStartMs = 0;
    let touchMovedDist = 0;
    let lastTouchTapConfirmTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerTargetAction = (target: THREE.Object3D): boolean => {
      const latest = stateRef.current;
      if (target.userData.isPlayerItem && latest.showControls) {
        useItem(target.userData.index, 'player');
        hoveredMesh = null;
        setHoveredInfo(null);
        return true;
      }
      if (target.userData.isShopItem) {
        const { type, cost } = target.userData;
        if (latest.bloodCurrency >= cost && latest.player.items.length < 8) {
          buyItem(type, cost);
          playPurchaseSound();
          return true;
        }
      }
      return false;
    };

    const handleTouchStart = (e: TouchEvent) => {
      markTouchActivity();
      if (document.querySelector('.settings-panel')) return;
      const targetEl = e.target as HTMLElement | null;
      if (targetEl && targetEl.closest('button, input, select, a, [data-ui]')) {
        return;
      }
      const touch = e.changedTouches[0];
      if (!touch) return;
      touchActiveId = touch.identifier;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchLastX = touch.clientX;
      touchLastY = touch.clientY;
      touchStartMs = performance.now();
      touchMovedDist = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchActiveId === null) return;
      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchActiveId) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;

      const dx = touch.clientX - touchLastX;
      const dy = touch.clientY - touchLastY;
      touchMovedDist += Math.hypot(dx, dy);
      touchLastX = touch.clientX;
      touchLastY = touch.clientY;

      if (touchMovedDist > 6) {
        if (e.cancelable) e.preventDefault();
        const rect = activeCanvas.getBoundingClientRect();
        const touchSens = getControllerSettings().touchLookSensitivity ?? 1.0;
        if (rect.width > 0 && rect.height > 0) {
          mouse.x = Math.max(-1, Math.min(1, mouse.x + (dx / rect.width) * 2.4 * touchSens));
          mouse.y = Math.max(-1, Math.min(1, mouse.y - (dy / rect.height) * 2.4 * touchSens));
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchActiveId === null) return;
      let touch: Touch | undefined;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchActiveId) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;
      touchActiveId = null;

      const elapsedMs = performance.now() - touchStartMs;
      if (touchMovedDist >= 14 || elapsedMs > 420) return;

      const targetEl = e.target as HTMLElement | null;
      if (targetEl && targetEl.closest('button, input, select, a, [data-ui]')) {
        return;
      }
      if (document.querySelector('.settings-panel')) return;

      markTouchActivity();
      const tapped = getIntersectionTargetRaw(touch.clientX, touch.clientY);
      if (tapped) {
        if (hoveredMesh === tapped) {
          triggerTargetAction(tapped);
          if (lastTouchTapConfirmTimer) clearTimeout(lastTouchTapConfirmTimer);
        } else {
          hoveredMesh = tapped;
          if (tapped.userData.isPlayerItem) {
            const idx = tapped.userData.index;
            const itemName = stateRef.current.player.items[idx];
            setHoveredInfo({
              type: 'ITEM',
              name: itemName,
              description: getItemDescription(itemName, stateRef.current.branch),
              index: idx,
            });
          } else if (tapped.userData.isShopItem) {
            const { type, cost } = tapped.userData;
            const isAffordable = stateRef.current.bloodCurrency >= cost;
            setHoveredInfo({
              type: 'SHOP_ITEM',
              name: `${type} (${isAffordable ? 'AFFORDABLE' : 'TOO DEAR'})`,
              description: `${getItemDescription(type, stateRef.current.branch)} COST: ${cost} BLOOD.`,
              shopType: type,
              cost,
            });
          }
          playTapSound();
          if (lastTouchTapConfirmTimer) clearTimeout(lastTouchTapConfirmTimer);
          lastTouchTapConfirmTimer = setTimeout(() => {
            if (hoveredMesh === tapped) {
              hoveredMesh = null;
              setHoveredInfo(null);
            }
          }, 6000);
        }
      } else {
        hoveredMesh = null;
        setHoveredInfo(null);
      }
    };

    const handleTouchCancel = () => {
      touchActiveId = null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Pressing any key shows the keyboard shortcuts HUD immediately
      if (mouseInactivityTimerRef.current) {
        clearTimeout(mouseInactivityTimerRef.current);
        mouseInactivityTimerRef.current = null;
      }
      setShowKeyboardHud(true);

      if (
        document.querySelector('.settings-panel') ||
        (document.activeElement &&
         (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.tagName === 'SELECT' ||
          document.activeElement.closest('.settings-panel')))
      ) {
        return;
      }


      const key = e.key;
      const code = e.code;
      const lowerKey = key.toLowerCase();
      const latest = stateRef.current;

      // 1. Market / Shop View Toggle
      if (lowerKey === 'q' || lowerKey === 'e' || lowerKey === 'b') {
        e.preventDefault();
        if (latest.player.health <= 0 || latest.gameState !== 'PLAYER_TURN') return;
        isLookingAtShopRef.current = !isLookingAtShopRef.current;
        hoveredMesh = null;
        setHoveredInfo(null);
        setDebugToggle(p => p + 1);
        vibrateGamepad('click');
        return;
      }

      if (code === 'ArrowDown' && !isLookingAtShopRef.current) {
        e.preventDefault();
        if (latest.player.health <= 0 || latest.gameState !== 'PLAYER_TURN') return;
        isLookingAtShopRef.current = true;
        hoveredMesh = null;
        setHoveredInfo(null);
        setDebugToggle(p => p + 1);
        vibrateGamepad('click');
        return;
      }

      if (code === 'ArrowUp' && isLookingAtShopRef.current) {
        e.preventDefault();
        isLookingAtShopRef.current = false;
        hoveredMesh = null;
        setHoveredInfo(null);
        setDebugToggle(p => p + 1);
        vibrateGamepad('click');
        return;
      }

      // 2. Direct Item usage via Number Keys (1-8)
      if (code.startsWith('Digit') || (code.startsWith('Numpad') && !isNaN(Number(key)))) {
        const digitNum = parseInt(key, 10);
        if (digitNum >= 1 && digitNum <= 8) {
          const itemIdx = digitNum - 1;
          if (latest.player.items && latest.player.items[itemIdx] !== undefined && latest.showControls) {
            e.preventDefault();
            useItem(itemIdx, 'player');
            setHoveredInfo(null);
            vibrateGamepad('click');
            return;
          }
        }
      }

      // 3. Direct Action Shortcuts: 'S' -> Shoot Self, 'D' -> Shoot Dealer (Revamped only)
      if (latest.showControls && !isLookingAtShopRef.current) {
        if (lowerKey === 's' || code === 'KeyS') {
          e.preventDefault();
          fireGun('player', 'player');
          setHoveredInfo(null);
          vibrateGamepad('click');
          return;
        }
        if (latest.branch !== 'CLASSIC' && (lowerKey === 'd' || code === 'KeyD' || lowerKey === 'f')) {
          e.preventDefault();
          fireGun('dealer', 'player');
          setHoveredInfo(null);
          vibrateGamepad('click');
          return;
        }
      }

      // 4. Arrow Keys / A / D Arena Navigation & Target Cycling
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyA' || code === 'KeyD') {
        e.preventDefault();
        const allTargets = getRaycastTargets();
        
        let targets = allTargets.filter(t => 
          isLookingAtShopRef.current ? t.userData.isShopItem : t.userData.isPlayerItem
        );

        targets.sort((a, b) => {
          const posA = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
          const posB = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
          if (isLookingAtShopRef.current) {
            const shelfDiff = Math.round((posB.y - posA.y) * 2);
            return shelfDiff !== 0 ? shelfDiff : posA.z - posB.z;
          }
          return posA.x - posB.x;
        });

        if (targets.length > 0) {
          const dx = (code === 'ArrowRight' || code === 'ArrowDown' || code === 'KeyD') ? 1 : -1;
          let currIdx = targets.findIndex(t => t === hoveredMesh);
          
          if (currIdx === -1) {
            currIdx = dx > 0 ? 0 : targets.length - 1;
          } else {
            currIdx = (currIdx + dx + targets.length) % targets.length;
          }

          const target = targets[currIdx];
          hoveredMesh = target;

          if (target) {
            if (target.userData.isPlayerItem) {
              const idx = target.userData.index;
              const userItemsArr = latest.player.items;
              const itemName = userItemsArr[idx];
              const itemDesc = getItemDescription(itemName, latest.branch);
              setHoveredInfo({
                type: 'ITEM',
                name: itemName || 'UNDEFINED',
                description: itemDesc,
                index: idx,
              });
            } else if (target.userData.isShopItem) {
              const { type, cost } = target.userData;
              const isAffordable = latest.bloodCurrency >= cost;
              setHoveredInfo({
                type: 'SHOP_ITEM',
                name: `${type} (${isAffordable ? 'AFFORDABLE' : 'TOO DEAR'})`,
                description: `${getItemDescription(type, latest.branch)} COST: ${cost} BLOOD. PRESS SPACE TO PURCHASE.`
              });
            }
          }
          vibrateGamepad('click');
          setDebugToggle(p => p + 1);
          return;
        }
      }

      // 5. Primary Action / Confirm: Space or Enter
      if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        if (hoveredMesh) {
          if (hoveredMesh.userData.isPlayerItem && latest.showControls) {
            const idx = hoveredMesh.userData.index;
            useItem(idx, 'player');
            setHoveredInfo(null);
            vibrateGamepad('click');
            return;
          } else if (hoveredMesh.userData.isShopItem) {
            const { type, cost } = hoveredMesh.userData;
            if (latest.bloodCurrency >= cost && latest.player.items.length < 8) {
              buyItem(type, cost);
              playPurchaseSound();
              vibrateGamepad('click');
              return;
            }
          }
        }

        if (latest.showControls && !isLookingAtShopRef.current) {
          fireGun(latest.branch === 'CLASSIC' ? 'player' : 'dealer', 'player');
          setHoveredInfo(null);
          vibrateGamepad('click');
          return;
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    // --- PLAY TICK LOOP ---
    let frameId = 0;
    
    // Gamepad state for native D-pad/stick targeting & right-stick camera look
    let gamepadTargetIndex = 0;
    let lastDPadX = 0;
    let lastGamepadConfirm = false;
    let virtualCursorActive = false;
    let virtualX = window.innerWidth / 2;
    let virtualY = window.innerHeight / 2;
    let lastGamepadView = false;
    let lastGamepadLB = false;
    let lastGamepadRB = false;
    let lastGamepadNorth = false;
    let lastGamepadLT = false;
    let lastGamepadRT = false;
    let lastGamepadCancel = false;
    let isTargetingActive = false;
    let lastPentagramRumbleTime = 0;

    let lastFrameTime = performance.now();
    let lastRawFrameTime = performance.now();
    const watchdog = new WebGPUWatchdog();
    let roughHardwareProfile: RoughHardwareProfile | null = null;
    let activeIsWebGLSession = false;
    let isFallbackTransitioning = false;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (webGpuErrorRef.current) {
        return; // Halt render engine if critical error occurs (WebGL fallback failed)
      }
      const now = performance.now();
      const rawIntervalMs = now - lastRawFrameTime;
      lastRawFrameTime = now;
      let frameDiffMs = now - lastFrameTime;
      if (frameDiffMs > 250) {
        // Prevent huge frame jumps after tab switching or temporary system freeze
        frameDiffMs = 16.6;
      }
      // Allow rawDt to accurately reflect real elapsed time down to 5 FPS (0.20s),
      // ensuring animations and movement remain buttery smooth and 100% real-time speed at 20 FPS and lower.
      const rawDt = Math.max(0.001, Math.min(frameDiffMs / 1000, 0.20));
      lastFrameTime = now;

      ar.tickCount++;
      ar.time += rawDt * 1.25;
      const time = ar.time;
      // Exact framerate-scaling factor (1.0 = 60 FPS, 3.0 = 20 FPS, 6.0 = 10 FPS)
      const deltaScale = rawDt * 60.0;

      const damp = (factor: number) => {
        const clampedFactor = Math.min(0.999, Math.max(0.001, factor));
        return 1 - Math.pow(1 - clampedFactor, deltaScale);
      };

      const latest = stateRef.current;

      // Update progressive blood oxidation & drying aging system
      if (ar.tickCount % 2 === 0) {
        updateBloodAging(time);
      }

      // Calculate frame-to-frame barrel/muzzle position delta for realistic fluid continuation
      gunGroup.updateMatrixWorld(true);
      const currentMuzzleWorldPos = new THREE.Vector3(
        0,
        0.208,
        (!!latest.doubleDamageActive || ar.isSawedOff) ? 0.38 : 0.90
      ).applyMatrix4(gunGroup.matrixWorld);
      const muzzleDelta = new THREE.Vector3();
      if (ar.prevMuzzleWorldPos) {
        muzzleDelta.copy(currentMuzzleWorldPos).sub(ar.prevMuzzleWorldPos);
      } else {
        ar.prevMuzzleWorldPos = new THREE.Vector3();
      }
      ar.prevMuzzleWorldPos.copy(currentMuzzleWorldPos);

      if (!latest.showControls && !isLookingAtShopRef.current) {
         if (isTargetingActive) {
            isTargetingActive = false;
            hoveredMesh = null;
            setHoveredInfo(null);
         }
      }

      // Continuous low rumble when pentagram is active (during animation)
      if (ar.activeItemAnimType === 'PENTAGRAM') {
        if (Date.now() - lastPentagramRumbleTime > 100) {
          lastPentagramRumbleTime = Date.now();
          vibrateGamepad('rumble', { duration: 120, weak: 0.35, strong: 0.05 });
        }
      }


      const gp = pollGamepadAutoSwitch();
      const cursorEl = document.getElementById('virtual-cursor');
      const settingsOpenNow = Boolean(document.querySelector('.settings-panel'));

      if (gp && !settingsOpenNow) {
        const gpSettings = getControllerSettings();
        const sem = readSemanticGamepad(gp, gpSettings.controllerLayout);

        // Right Stick Camera Look (seamless analog camera look around the room)
        const rSens = gpSettings.rightStickSensitivity ?? 1.0;
        if (Math.abs(sem.rStickX) > 0.01 || Math.abs(sem.rStickY) > 0.01) {
          mouse.x = Math.max(-1, Math.min(1, mouse.x + sem.rStickX * 1.9 * rSens * rawDt));
          mouse.y = Math.max(-1, Math.min(1, mouse.y - sem.rStickY * 1.5 * rSens * rawDt));
        } else {
          // Gentle return toward center when right stick rests
          mouse.x *= Math.pow(0.25, rawDt);
          mouse.y *= Math.pow(0.25, rawDt);
        }

        if (sem.select && !lastGamepadView) {
          virtualCursorActive = !virtualCursorActive;
          vibrateGamepad('click');
        }
        lastGamepadView = sem.select;

        // North button (Y on Xbox / Triangle on PS / X on Nintendo): Toggle Market / Back
        if (sem.north && !lastGamepadNorth) {
          if (latest.player.health > 0 && latest.gameState === 'PLAYER_TURN') {
            isLookingAtShopRef.current = !isLookingAtShopRef.current;
            isTargetingActive = false;
            hoveredMesh = null;
            setHoveredInfo(null);
            setDebugToggle(p => p + 1);
            vibrateGamepad('click');
          }
        }
        lastGamepadNorth = sem.north;

        if (sem.lt && !lastGamepadLT && latest.showControls && !isLookingAtShopRef.current) {
          fireGun('player', 'player');
          setHoveredInfo(null);
          vibrateGamepad('click');
        }
        lastGamepadLT = sem.lt;

        if (sem.rt && !lastGamepadRT && latest.showControls && !isLookingAtShopRef.current && latest.branch !== 'CLASSIC') {
          fireGun('dealer', 'player');
          setHoveredInfo(null);
          vibrateGamepad('click');
        }
        lastGamepadRT = sem.rt;

        if (virtualCursorActive) {
          if (cursorEl) cursorEl.style.display = 'flex';
          const lx = sem.stickX;
          const ly = sem.stickY;

          let moved = false;
          if (Math.abs(lx) > 0.05 || Math.abs(ly) > 0.05) {
            virtualX += lx * 16.0 * deltaScale;
            virtualY += ly * 16.0 * deltaScale;
            moved = true;
          }

          const rect = activeCanvas.getBoundingClientRect();
          virtualX = Math.max(rect.left, Math.min(rect.right, virtualX));
          virtualY = Math.max(rect.top, Math.min(rect.bottom, virtualY));

          if (cursorEl) {
            cursorEl.style.left = `${virtualX}px`;
            cursorEl.style.top = `${virtualY}px`;
          }

          if (moved || ar.tickCount % 5 === 0) {
            handleMouseMoveRaw(virtualX, virtualY);
          }

          if (sem.confirm && !lastGamepadConfirm) {
            handleMouseUpRaw(virtualX, virtualY);
            const domTarget = document.elementFromPoint(virtualX, virtualY);
            if (domTarget instanceof HTMLElement) {
              if (domTarget.tagName.toLowerCase() === 'select') {
                const select = domTarget as HTMLSelectElement;
                select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
                select.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                domTarget.click();
              }
            }
            vibrateGamepad('click');
          }
          lastGamepadConfirm = sem.confirm;
          if (sem.cancel && !lastGamepadCancel) {
            virtualCursorActive = false;
            vibrateGamepad('click');
          }
          lastGamepadCancel = sem.cancel;
        } else {
          // Native item & market cycle targeting mode
          if (cursorEl) cursorEl.style.display = 'none';

          const allTargets = getRaycastTargets();
          const targets = allTargets.filter(t =>
            isLookingAtShopRef.current ? t.userData.isShopItem : t.userData.isPlayerItem
          );

          targets.sort((a, b) => {
            const posA = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
            const posB = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
            if (isLookingAtShopRef.current) {
              const shelfDiff = Math.round((posB.y - posA.y) * 2);
              return shelfDiff !== 0 ? shelfDiff : posA.z - posB.z;
            }
            return posA.x - posB.x;
          });

          if (sem.cancel && !lastGamepadCancel) {
            if (targets.length > 0 || isTargetingActive) {
              isTargetingActive = !isTargetingActive;
              vibrateGamepad('click');
              if (!isTargetingActive) {
                hoveredMesh = null;
                setHoveredInfo(null);
              }
            } else if (isLookingAtShopRef.current) {
              isLookingAtShopRef.current = false;
              setDebugToggle(p => p + 1);
              vibrateGamepad('click');
            }
          }
          lastGamepadCancel = sem.cancel;

          let dx = 0;
          if (sem.anyRight) {
            dx = 1;
          } else if (sem.anyLeft) {
            dx = -1;
          } else if (sem.rb && !lastGamepadRB) {
            dx = 1;
          } else if (sem.lb && !lastGamepadLB) {
            dx = -1;
          }

          lastGamepadLB = sem.lb;
          lastGamepadRB = sem.rb;

          // Instantly enter item/shop targeting when pressing D-Pad / LB / RB
          if (!isTargetingActive && dx !== 0 && lastDPadX === 0 && targets.length > 0 && (latest.showControls || isLookingAtShopRef.current)) {
            isTargetingActive = true;
            gamepadTargetIndex = dx > 0 ? 0 : targets.length - 1;
            vibrateGamepad('click');
          } else if (isTargetingActive && dx !== 0 && lastDPadX === 0 && targets.length > 0) {
            gamepadTargetIndex = (gamepadTargetIndex + dx + targets.length) % targets.length;
            vibrateGamepad('click');
          }

          if (isTargetingActive && targets.length > 0) {
            const target = targets[gamepadTargetIndex % targets.length];
            hoveredMesh = target;

            if (target) {
              if (target.userData.isPlayerItem) {
                const idx = target.userData.index;
                const userItemsArr = latest.player.items;
                const itemName = userItemsArr[idx];
                const itemDesc = getItemDescription(itemName, latest.branch);
                setHoveredInfo({
                  type: 'ITEM',
                  name: itemName || 'UNDEFINED',
                  description: itemDesc,
                  index: idx,
                });
              } else if (target.userData.isShopItem) {
                const { type, cost } = target.userData;
                const isAffordable = latest.bloodCurrency >= cost;
                setHoveredInfo({
                  type: 'SHOP_ITEM',
                  name: `${type} (${isAffordable ? 'AFFORDABLE' : 'TOO DEAR'})`,
                  description: `${getItemDescription(type, latest.branch)} COST: ${cost} BLOOD.`,
                });
              }
            }

            if (sem.confirm && !lastGamepadConfirm && target) {
              if (target.userData.isPlayerItem && latest.showControls) {
                useItem(target.userData.index, 'player');
                setHoveredInfo(null);
              } else if (target.userData.isShopItem) {
                const { type, cost } = target.userData;
                if (latest.bloodCurrency >= cost && latest.player.items.length < 8) {
                  buyItem(type, cost);
                  playPurchaseSound();
                }
              }
              vibrateGamepad('click');
            }
            lastGamepadConfirm = sem.confirm;
          } else {
            isTargetingActive = false;
            if (gpSettings.inputType === 'gamepad') {
              hoveredMesh = null;
              setHoveredInfo(null);
            }
            if (sem.confirm && !lastGamepadConfirm && latest.branch === 'CLASSIC' && latest.showControls && !isLookingAtShopRef.current) {
              fireGun('player', 'player');
              vibrateGamepad('click');
            }
            lastGamepadConfirm = sem.confirm;
          }
          lastDPadX = dx;
        }
      } else {
        if (cursorEl) cursorEl.style.display = 'none';
      }

      // Initialize starting state on first frame
      if (!ar.hasInitializedRound) {
        ar.previousRoundsSurvived = latest.roundsSurvived;
        ar.wasPlayerDead = latest.player.health <= 0;
        ar.wasDealerDead = latest.dealer.health <= 0;
        ar.hasInitializedRound = true;
      }

      // Track death events
      if (latest.player.health <= 0) {
        ar.wasPlayerDead = true;
      }
      if (latest.dealer.health <= 0) {
        ar.wasDealerDead = true;
      }

      // Game round state changes & blood clearing
      // STRICT RULE: Only remove blood stains when:
      // 1. Returning to the main MENU
      // 2. The player respawns after dying (wasPlayerDead is true and now starts a new game / LOADING)
      // 3. Starting a new round (after defeating the dealer: wasDealerDead is true and now LOADING next round, or roundsSurvived increases)
      if (latest.gameState !== ar.previousGameState) {
        if (latest.gameState === 'MENU' || latest.gameState === 'GAME_OVER') {
          ar.isFirstShotAfterLoad = false;
          ar.animSuppressCockAudio = false;
          ar.pliersEjectChamberIdx = -1;
        }
        if (latest.gameState === 'MENU') {
          clearBloodSplatters();
          ar.wasPlayerDead = false;
          ar.wasDealerDead = false;
          ar.previousRoundsSurvived = latest.roundsSurvived;
          ar.isPlayerDeathGunDropping = false;
          ar.wasPlayerSelfLiveShot = false;
          ar.gunFallSettled = false;
          ar.gunFallBounceCount = 0;
          ar.gunFallSettleFrames = 0;
        } else if (latest.gameState === 'LOADING') {
          ar.isFirstShotAfterLoad = true;
          ar.animSuppressCockAudio = false;
          ar.pliersEjectChamberIdx = -1;
          ar.isPlayerDeathGunDropping = false;
          ar.wasPlayerSelfLiveShot = false;
          ar.gunFallSettled = false;
          ar.gunFallBounceCount = 0;
          ar.gunFallSettleFrames = 0;
          const isRespawnAfterDeath = ar.wasPlayerDead && latest.player.health > 0;
          const isNewRoundAfterWin = ar.wasDealerDead || (latest.roundsSurvived > ar.previousRoundsSurvived);
          const isFreshRunReset = ar.previousGameState === 'GAME_OVER' && latest.roundsSurvived === 0;

          if (isRespawnAfterDeath || isNewRoundAfterWin || isFreshRunReset) {
            clearBloodSplatters();
            ar.wasPlayerDead = false;
            ar.wasDealerDead = false;
            ar.previousRoundsSurvived = latest.roundsSurvived;
          }
          // Note: If both survived and cylinder is reloaded, isRespawnAfterDeath and isNewRoundAfterWin are false.
          // Blood stains on table and floor remain completely untouched and continue aging naturally!
        }
        ar.previousGameState = latest.gameState;
      }

      // Also detect if roundsSurvived increments while in game
      if (latest.roundsSurvived > ar.previousRoundsSurvived && ar.previousRoundsSurvived >= 0) {
        clearBloodSplatters();
        ar.wasDealerDead = false;
        ar.previousRoundsSurvived = latest.roundsSurvived;
      }

      // Rebuild components detection
      if (
        latest.player.items.length !== ar.instantiatedPlayerCount ||
        latest.dealer.items.length !== ar.instantiatedDealerCount
      ) {
        rebuildItemsOnTable();
      }

      if (latest.chambers !== ar.previousChambers) {
        updateCylinderShells();
        ar.previousChambers = latest.chambers;
      }

      // Overhanging spotlight sway mechanics
      spotLight.position.x = Math.sin(time * 0.7) * 0.38;
      spotLight.position.z = Math.cos(time * 0.5) * 0.22;
      spotLightTarget.position.x = Math.sin(time * 0.4) * 0.2;

      bulbMesh.position.x = spotLight.position.x;
      wireMesh.position.x = spotLight.position.x;
      bulbGlow.position.x = spotLight.position.x;

      bulbMesh.rotation.z = Math.sin(time * 0.7) * 0.08;
      wireMesh.rotation.z = Math.sin(time * 0.7) * 0.04;

      // Fixed baseline lighting (100% brightness)
      const bMult = 1.0;
      ambientLight.intensity = 1.2 * bMult;
      fillLight.intensity = 1.5 * bMult;

      // Dim light flickering
      if (Math.random() < 0.012 * deltaScale) {
        spotLight.intensity = (4.0 + Math.random() * 8.0) * bMult;
        bulbGlowMat.color.setHex(0x3a2510);
      } else {
        const targetSpotIntensity = 28.0 * bMult;
        spotLight.intensity = spotLight.intensity * (1 - damp(0.05)) + targetSpotIntensity * damp(0.05);
        bulbGlowMat.color.setHex(0xffeaad);
      }

      // Shop Lamp flickering & shop ambient lights dynamic updates
      shopSpotLight.intensity = (25.0 + Math.sin(time * 12) * 5.0 + (Math.random() > 0.98 ? -10 : 0)) * bMult;
      shopAmbient.intensity = 25.0 * bMult;
      shelfBottomLight.intensity = 12.0 * bMult;
      shelfTopLight.intensity = 12.0 * bMult;

      // Smooth muzzle flash decay (exponential off-peak decay for crisp gunfire illumination)
      ar.muzzleFlashIntensity = (ar.muzzleFlashIntensity || 0) * Math.exp(-28 * rawDt);
      muzzleFlashLight.intensity = ar.muzzleFlashIntensity > 0.05 ? ar.muzzleFlashIntensity : 0;

      // Force shop view off when player dies or during action / dealer turn
      if (latest.player.health <= 0 || latest.gameState !== 'PLAYER_TURN') {
        isLookingAtShopRef.current = false;
      }

      // --- CAMERA TARGET & POSITION INTERPOLATION ---
      const dealerTarget = new THREE.Vector3(0, ar.lookTargetY, -1);
      const shopTarget = new THREE.Vector3(-15, 1.2, 0);
      const activeLookTarget = isLookingAtShopRef.current ? shopTarget : dealerTarget;

      const dealerCamPos = new THREE.Vector3(0, 3.4, 5.5);
      const shopCamPos = new THREE.Vector3(-8.5, 2.8, 0);
      const activeCamPos = isLookingAtShopRef.current ? shopCamPos : dealerCamPos;

      if (!stateRef.current.lookTargetVec) {
        stateRef.current.lookTargetVec = dealerTarget.clone();
      }
      if (!stateRef.current.camPosVec) {
        stateRef.current.camPosVec = dealerCamPos.clone();
      }

      const targetArc = isLookingAtShopRef.current ? 1 : 0;
      const prevArc = ar.shopTransitionArc ?? 0;
      ar.shopTransitionArc = THREE.MathUtils.damp(prevArc, targetArc, 7.5, rawDt);
      const transitionMid = Math.sin(ar.shopTransitionArc * Math.PI);

      const lerpSpeed = isLookingAtShopRef.current ? 0.14 : 0.20;
      stateRef.current.lookTargetVec.lerp(activeLookTarget, damp(lerpSpeed));
      stateRef.current.camPosVec.lerp(activeCamPos, damp(lerpSpeed));
      // Subtle grounded upward arc during head turn between table and booth
      stateRef.current.camPosVec.y += transitionMid * 0.18 * damp(lerpSpeed);

      // Check if the gun barrel needs to show as sawed-off (double damage active or active scalpel cut)
      const isCuttingScalpel = ar.activeItemAnimType === 'SCALPEL';
      if (!latest.doubleDamageActive && !isCuttingScalpel) {
        animRef.current.isSawedOff = false;
        animRef.current.hasSpawnedSeveredBarrel = false;
      }
      const isSawedActive = !!latest.doubleDamageActive || (isCuttingScalpel && animRef.current.isSawedOff);
      if (animRef.current.gunBarrelFrontGroup) {
        animRef.current.gunBarrelFrontGroup.visible = !isSawedActive;
      }

      // Check if dealer is being hovered via the top screen DOM zone
      let isShootDealerHovered = (window as any).dealerDomHovered === true;

      // Handle Dealer Death Visuals: eyes turn to X and he falls
      if (latest.dealer.health <= 0) {
        leftEye.scale.set(1.4, 0.2, 1);
        leftEye.rotation.z = Math.PI / 4;
        rightEye.scale.set(1.4, 0.2, 1);
        rightEye.rotation.z = -Math.PI / 4;
        
        // Add crossed bars as direct siblings in dealerGroup to form perfect X shapes
        if (!leftEye.userData.isCrossed) {
          const crossBarL = new THREE.Mesh(eyeGeo, leftEye.material);
          crossBarL.position.copy(leftEye.position);
          crossBarL.scale.set(1.4, 0.2, 1);
          crossBarL.rotation.z = -Math.PI / 4;
          dealerGroup.add(crossBarL);

          const crossBarR = new THREE.Mesh(eyeGeo, rightEye.material);
          crossBarR.position.copy(rightEye.position);
          crossBarR.scale.set(1.4, 0.2, 1);
          crossBarR.rotation.z = Math.PI / 4;
          dealerGroup.add(crossBarR);

          leftEye.userData.isCrossed = true;
          leftEye.userData.crossBarMesh = crossBarL;
          rightEye.userData.crossBarMesh = crossBarR;

          if (leftEye.material instanceof THREE.MeshBasicMaterial) {
            leftEye.material.color.setHex(0xffffff); // Dead white eyes
          }
          if (rightEye.material instanceof THREE.MeshBasicMaterial) {
            rightEye.material.color.setHex(0xffffff); // Dead white eyes
          }
        }
      }

      if (latest.dealer.health < latest.dealer.maxHealth) {
        const dealerDmgRatio = 1 - Math.max(0, latest.dealer.health) / Math.max(1, latest.dealer.maxHealth);
        dealerWounds.update(dealerDmgRatio);
      } else {
        dealerWounds.reset();
      }

      // Hooded Dealer slow idling breathing + smooth smile transitions + flaring eye squints
      if (latest.dealer.health > 0) {
        ar.dealerDeathStartTime = 0;
        ar.hasThumpedDealerFall = false;
        if (leftEye.userData.isCrossed) {
          leftEye.userData.isCrossed = false;
          // Clean up cross bars safely from dealerGroup
          if (leftEye.userData.crossBarMesh) {
            dealerGroup.remove(leftEye.userData.crossBarMesh);
            leftEye.userData.crossBarMesh = null;
          }
          if (rightEye.userData.crossBarMesh) {
            dealerGroup.remove(rightEye.userData.crossBarMesh);
            rightEye.userData.crossBarMesh = null;
          }
          if (leftEye.material instanceof THREE.MeshBasicMaterial) {
            leftEye.material.color.setHex(0xff0000); 
          }
          if (rightEye.material instanceof THREE.MeshBasicMaterial) {
            rightEye.material.color.setHex(0xff0000); 
          }
          leftEye.rotation.z = 0;
          rightEye.rotation.z = 0;
        }

        const dealerHPPct = latest.dealer.health / latest.dealer.maxHealth;
        const playerHPPct = latest.player.health / latest.player.maxHealth;
        let personality = 'NORMAL';
        if (dealerHPPct <= 0.35) personality = 'DESPERATE';
        else if (dealerHPPct >= 0.6 && playerHPPct <= 0.4) personality = 'ARROGANT';

        let breathSpeed = 1.8;
        let breathAmp = 0.035;
        let twitchX = 0;
        let twitchY = 0;
        let twitchZ = 0;
        let jitterRotX = 0;
        let jitterRotY = 0;
        let jitterRotZ = 0;
        let leanZ = 0;

        if (personality === 'DESPERATE') {
          breathSpeed = 3.0; // slightly faster tense breathing
          breathAmp = 0.025;
          // Very subtle smooth micro-tremor instead of wild random jitter
          twitchX = Math.sin(time * 14.0) * 0.004;
          twitchY = Math.cos(time * 11.0) * 0.003;
          twitchZ = Math.sin(time * 9.0) * 0.002;
          
          jitterRotX = Math.sin(time * 10.0) * 0.008;
          jitterRotY = Math.cos(time * 12.0) * 0.008;
          jitterRotZ = Math.sin(time * 8.0) * 0.006;
          
          leanZ = -0.05; // slightly recoiled back in tense focus
        } else if (personality === 'ARROGANT') {
          breathSpeed = 1.2;
          breathAmp = 0.02;
          leanZ = 0.15; // leaning forward confidently
        }

        const flinchTimeElapsed = Date.now() - latest.dealerFlinchTime;

        dealerGroup.position.x = (personality === 'DESPERATE' ? twitchX : (flinchTimeElapsed >= 400 ? 0 : dealerGroup.position.x));
        dealerGroup.position.y = -0.4 + Math.sin(time * breathSpeed) * breathAmp + twitchY;

        // Smoothly restore scale & base parameters when resurrected or alive
        if (dealerGroup.scale.x < 0.999) {
          dealerGroup.scale.setScalar(dealerGroup.scale.x * (1 - damp(0.1)) + 1.0 * damp(0.1));
        } else {
          dealerGroup.scale.setScalar(1.0);
        }
        
        // Ambient breathing, wary hover lean-back, and recoil rotation
        const targetRotY = Math.sin(time * 0.9) * 0.04;
        let targetRotX = Math.sin(time * breathSpeed) * 0.014;
        if (isShootDealerHovered && latest.showControls) {
          leanZ -= 0.06;
          targetRotX -= 0.03;
        }

        // VISCERAL DEALER RECOIL & FLINCH WHEN DAMAGED / SHOT
        let flinchZ = 0;
        if (flinchTimeElapsed < 650) {
          const t = flinchTimeElapsed / 650;
          // Explosive backward impulse with elastic spring recoil
          const impulse = Math.sin(Math.pow(t, 0.35) * Math.PI);
          flinchZ = -0.72 * impulse; // Heavy visceral backward blowback
          targetRotX = -0.35 * impulse; // Torso & head throw back
          jitterRotZ += (Math.sin(time * 35) * 0.08) * (1.0 - t); // Spasmic muscle shiver
          
          // Expressive recoil reaction: Head throws back, mouth opens in shock, eyebrows furrow
          ar.dealerHeadTiltFactor = Math.max(ar.dealerHeadTiltFactor, 0.9 * impulse);
          ar.dealerMouthOpenFactor = Math.max(ar.dealerMouthOpenFactor, 0.7 * impulse);
          ar.dealerSmileFactor *= (1.0 - impulse);
        } else {
          if (personality !== 'DESPERATE') dealerGroup.position.x = 0;
          dealerGroup.rotation.z = Math.cos(time * 1.2) * 0.025;
        }

        const tiltFactor = ar.dealerHeadTiltFactor || 0.0;
        const combinedRotX = targetRotX + jitterRotX - 0.22 * tiltFactor;

        // Apply smoothed head/body tracking rotations + head tilt + frantic desperation jitter
        dealerGroup.rotation.x = THREE.MathUtils.damp(dealerGroup.rotation.x, combinedRotX, 10.0, rawDt);
        dealerGroup.rotation.y = THREE.MathUtils.damp(dealerGroup.rotation.y, targetRotY + jitterRotY, 10.0, rawDt);
        dealerGroup.rotation.z = (flinchTimeElapsed >= 400 ? Math.cos(time * 1.2) * 0.025 : dealerGroup.rotation.z) + jitterRotZ;

        // Natural periodic blinking logic
        if (ar.nextBlinkTime === 0) {
          ar.nextBlinkTime = time + 1.5 + Math.random() * 3.0;
        }

        if (time >= ar.nextBlinkTime) {
          ar.blinkStartTime = time;
          ar.blinkDuration = 0.13 + Math.random() * 0.05; // 130ms - 180ms natural blink
          ar.nextBlinkTime = time + 2.2 + Math.random() * 4.2; // Next blink in 2.2 - 6.4 seconds
          if (Math.random() < 0.2) {
            ar.isDoubleBlinkPending = true;
          }
        }

        let blinkScaleY = 1.0;
        const blinkElapsed = time - ar.blinkStartTime;
        if (blinkElapsed >= 0 && blinkElapsed <= ar.blinkDuration) {
          const blinkT = blinkElapsed / ar.blinkDuration;
          blinkScaleY = Math.max(0.05, 1.0 - Math.sin(blinkT * Math.PI) * 0.95);
        } else if (ar.isDoubleBlinkPending && blinkElapsed > ar.blinkDuration + 0.08) {
          ar.isDoubleBlinkPending = false;
          ar.blinkStartTime = time;
          ar.blinkDuration = 0.11;
        }

        dealerGroup.position.z = THREE.MathUtils.damp(dealerGroup.position.z, -3.2 + flinchZ + leanZ + twitchZ, 12.0, rawDt);
        if (isShootDealerHovered && latest.showControls) {
          leftEye.scale.set(1.0, 1.0 * blinkScaleY, 1.0);
          rightEye.scale.set(1.0, 1.0 * blinkScaleY, 1.0);
          if (leftEye.material instanceof THREE.Material) {
            (leftEye.material as any).color.setHex(0xff3333); // flaring high hostile red
          }
        } else {
          leftEye.scale.set(1.0, 1.0 * blinkScaleY, 1.0);
          rightEye.scale.set(1.0, 1.0 * blinkScaleY, 1.0);
          if (leftEye.material instanceof THREE.Material) {
            (leftEye.material as any).color.setHex(0xff0000); // stable blood red
          }
        }

        // Check if the dealer should actually smile (smoothly transition mask mouth segments)
        const msgLower = latest.message.toLowerCase();
        const subLower = (latest.subMessage || "").toLowerCase();
        
        const isBlankOutcome = msgLower.includes("empty") || msgLower.includes("click") || subLower.includes("empty") || subLower.includes("click");
        const playerIsDead = latest.gameState === 'GAME_OVER' && latest.player.health <= 0;
        
        // 1. Explicit message instructions to smile or stretch grin
        const explicitSmile = msgLower.includes("dealer smiles") || msgLower.includes("the dealer smiles") || msgLower.includes("mask glitches") || subLower.includes("tilts his head") || subLower.includes("grin stretches");
        
        // 2. Player tries to shoot themselves (during any phase of shooting at themselves inside SHOOTING state)
        const tryingToShootSelf = (ar.animShooter === 'player' && ar.animTarget === 'player' && latest.gameState === 'SHOOTING');
        
        // 3. Player fires an empty chamber at the dealer
        const emptyShotAtDealer = (ar.animShooter === 'player' && ar.animTarget === 'dealer' && isBlankOutcome && latest.gameState === 'SHOOTING');
        
        // 4. Any completed empty self shot
        const emptyShotAtSelf = (ar.animShooter === 'player' && ar.animTarget === 'player' && isBlankOutcome);

        const shouldSmile = explicitSmile || tryingToShootSelf || emptyShotAtDealer || emptyShotAtSelf || playerIsDead || personality === 'ARROGANT' || latest.retaliationActive;
        
        if (personality === 'DESPERATE') {
          ar.dealerSmileFactor = 0.0; // Strictly NEVER smile in desperate mode
        } else if (shouldSmile) {
          ar.dealerSmileFactor = ar.dealerSmileFactor * (1 - damp(0.12)) + 1.0 * damp(0.12);
        } else {
          ar.dealerSmileFactor = ar.dealerSmileFactor * (1 - damp(0.05)) + 0.0 * damp(0.05);
        }

        const openFactor = ar.dealerMouthOpenFactor || 0.0;

        // Smoothly decay mouth open and head tilt back to resting position
        ar.dealerMouthOpenFactor *= (1 - damp(0.08));
        ar.dealerHeadTiltFactor *= (1 - damp(0.08));

        // Multi-jointed angular mask line translations (Smile + Speaking/Opening Movement)
        const smile = ar.dealerSmileFactor;
        const talkMutter = (latest.gameState === 'DEALER_TURN' || latest.gameState === 'AI_THINKING') ? Math.sin(time * 18) * 0.03 : 0;
        const totalOpen = Math.max(0, openFactor + talkMutter);

        // Single clean center bar
        mouthCenter.position.y = -0.015 * smile - 0.04 * totalOpen;

        // Mid lip joints bend smoothly with smile curve
        mouthLeftMid.position.x = -0.075;
        mouthLeftMid.position.y = 0.028 * smile - 0.03 * totalOpen;
        mouthLeftMid.rotation.z = -0.45 * smile + 0.2 * totalOpen;

        mouthRightMid.position.x = 0.075;
        mouthRightMid.position.y = 0.028 * smile - 0.03 * totalOpen;
        mouthRightMid.rotation.z = 0.45 * smile - 0.2 * totalOpen;

        // Outer corner joints bow outward & flare up into sinister wide grin
        mouthLeftCorner.position.x = -0.135;
        mouthLeftCorner.position.y = 0.065 * smile - 0.02 * totalOpen;
        mouthLeftCorner.rotation.z = -0.75 * smile + 0.3 * totalOpen;

        mouthRightCorner.position.x = 0.135;
        mouthRightCorner.position.y = 0.065 * smile - 0.02 * totalOpen;
        mouthRightCorner.rotation.z = 0.75 * smile - 0.3 * totalOpen;

        // Dynamic Eyebrow Expression Mechanics (smoothly damped rather than snapping)
        let targetBrowAngleL = -0.12;
        let targetBrowAngleR = 0.12;
        let targetBrowY = 2.82;

        if (isShootDealerHovered && latest.showControls) {
          // Threat/Flinch response: Angry, hostile V-furrowed brow
          targetBrowAngleL = -0.38;
          targetBrowAngleR = 0.38;
          targetBrowY = 2.79;
        } else if (personality === 'DESPERATE') {
          // Panicked / distressed inward slope
          targetBrowAngleL = 0.22;
          targetBrowAngleR = -0.22;
          targetBrowY = 2.81;
        } else if (smile > 0.1) {
          // Asymmetric arrogant/smug raised eyebrow
          targetBrowAngleL = 0.28;
          targetBrowAngleR = -0.12;
          targetBrowY = 2.84;
        }

        leftBrow.position.y = THREE.MathUtils.damp(leftBrow.position.y, targetBrowY, 14.0, rawDt);
        leftBrow.rotation.z = THREE.MathUtils.damp(leftBrow.rotation.z, targetBrowAngleL, 14.0, rawDt);
        rightBrow.position.y = THREE.MathUtils.damp(rightBrow.position.y, targetBrowY, 14.0, rawDt);
        rightBrow.rotation.z = THREE.MathUtils.damp(rightBrow.rotation.z, targetBrowAngleR, 14.0, rawDt);

        const isDealerHigh = latest.dealerDamageReductionEnd && Date.now() < latest.dealerDamageReductionEnd;

        const squint = ar.dealerSmileFactor > 0.001 ? (1.0 - 0.55 * ar.dealerSmileFactor) : 1.0;
        const baseScale = 1.0;

        if (latest.retaliationActive) {
          maskLineMat.color.setHex(Math.sin(time * 15) > 0 ? 0xff0000 : 0x220000);
          leftEye.scale.set(baseScale, baseScale * squint * blinkScaleY, baseScale);
          rightEye.scale.set(baseScale, baseScale * squint * blinkScaleY, baseScale);
        } else {
          maskLineMat.color.setHex(0xff0000);
          leftEye.scale.set(baseScale, baseScale * squint * blinkScaleY, baseScale);
          rightEye.scale.set(baseScale, baseScale * squint * blinkScaleY, baseScale);
        }

        // Glossy Eye Glaze
        if (leftEye.material instanceof THREE.MeshBasicMaterial) {
          if (isDealerHigh) {
            (leftEye.material as THREE.MeshBasicMaterial).color.setHex(0xffaaaa); // glazed hazy pink
            (rightEye.material as THREE.MeshBasicMaterial).color.setHex(0xffaaaa);
            leftEye.scale.setScalar(1.15 + Math.sin(time * 5) * 0.05);
            rightEye.scale.setScalar(1.15 + Math.sin(time * 5) * 0.05);
          } else if (isShootDealerHovered && latest.showControls) {
            (leftEye.material as THREE.MeshBasicMaterial).color.setHex(0xff3333);
            (rightEye.material as THREE.MeshBasicMaterial).color.setHex(0xff3333);
          } else {
            (leftEye.material as THREE.MeshBasicMaterial).color.setHex(0xff0000);
            (rightEye.material as THREE.MeshBasicMaterial).color.setHex(0xff0000);
          }
        }
        // Subtle secondary hood lag / breathing settle when alive
        hoodMesh.position.set(0, 2.7 + Math.sin(time * breathSpeed - 0.4) * 0.006, 0.1);
        hoodMesh.rotation.set(Math.sin(time * breathSpeed - 0.5) * 0.015, 0, 0);
        ar.dealerDeathStartTime = 0;
        ar.hasThumpedDealerFall = false;
      } else {
        // --- VISCERAL BACKWARD RAGDOLL PHYSICS COLLAPSE ANIMATION ---
        if (ar.dealerDeathStartTime === 0) ar.dealerDeathStartTime = Date.now();
        const deathElapsed = (Date.now() - ar.dealerDeathStartTime) / 1000;

        // Total collapse timeline: ~2.5 seconds
        // Phase 1 (0.0s - 0.4s): Kinetic Bullet Impact & Violent Backward Torso Snap
        // Phase 2 (0.4s - 1.35s): Gravitational Freefall Backward & Chair Flipping
        // Phase 3 (1.35s - 1.85s): Concrete Floor Impact & Elastic Ragdoll Rebound
        // Phase 4 (1.85s+): Sprawled Limp Resting State

        if (deathElapsed < 0.4) {
          // Phase 1: Sudden Kinetic Impact - Chest arches back, head snaps violently back
          const t1 = deathElapsed / 0.4;
          const ease1 = t1 * t1;

          dealerGroup.position.x = (Math.random() - 0.5) * 0.06 * (1 - t1) + Math.sin(time * 30) * 0.03 * (1 - t1);
          dealerGroup.position.y = -0.4 - (0.18 * ease1);
          dealerGroup.position.z = -3.2 - (0.35 * ease1); // Driven backward by impact
          dealerGroup.rotation.x = -0.45 * ease1; // Torso thrown backward
          dealerGroup.rotation.z = 0.12 * ease1; // Asymmetric shoulder drop

          // Head snaps backward limply on neck
          hoodMesh.position.z = 0.1 - 0.20 * ease1;
          hoodMesh.rotation.x = -0.55 * ease1;
          hoodMesh.rotation.z = 0.15 * ease1;

          // Eye glow flickers out instantly
          const flicker = Math.max(0, (1.0 - t1) * (0.8 + Math.sin(time * 50) * 0.2));
          leftEye.scale.setScalar(flicker);
          rightEye.scale.setScalar(flicker);

          const chair = scene.getObjectByName('dealerChairGroup');
          if (chair) {
            chair.rotation.x = -0.28 * ease1; // Chair begins tipping back
            chair.position.z = -3.2 - (0.18 * ease1);
          }
        } else if (deathElapsed < 1.35) {
          // Phase 2: Full Gravitational Fall Backward & Chair Tipping Over
          const t2 = (deathElapsed - 0.4) / 0.95;
          const gravityAccel = Math.pow(t2, 2.2); // Heavy exponential acceleration

          const targetY = -0.58 - (1.45 * gravityAccel);
          const targetZ = -3.55 - (1.35 * gravityAccel);
          
          const shiver = (1.0 - t2) * 0.04;
          dealerGroup.position.x = (Math.random() - 0.5) * shiver + Math.sin(time * 20) * shiver;
          dealerGroup.position.y = targetY;
          dealerGroup.position.z = targetZ;

          // Rotates flat backward onto spine
          dealerGroup.rotation.x = -0.45 - (1.25 * gravityAccel);
          dealerGroup.rotation.z = 0.12 + (0.28 * gravityAccel);

          // Neck & head ragdoll back then flop sideways onto shoulder
          hoodMesh.position.z = -0.10 - (0.15 * t2);
          hoodMesh.rotation.x = -0.55 - (0.35 * gravityAccel);
          hoodMesh.rotation.y = 0.42 * gravityAccel;
          hoodMesh.rotation.z = -0.35 * gravityAccel;

          leftEye.scale.setScalar(0);
          rightEye.scale.setScalar(0);

          const chair = scene.getObjectByName('dealerChairGroup');
          if (chair) {
            const chairFall = Math.pow(t2, 2.0);
            chair.rotation.x = -0.28 - (Math.PI / 1.8 - 0.28) * chairFall;
            chair.rotation.z = 0.18 * chairFall; // Twisted angle as chair crashes back
            chair.position.y = -1.2 + Math.sin(t2 * Math.PI) * 0.18;
            chair.position.z = -3.38 - (0.85 * chairFall);
          }
        } else if (deathElapsed < 1.85) {
          // Phase 3: Heavy Floor Impact & Ragdoll Rebound
          const t3 = deathElapsed - 1.35;

          if (!ar.hasThumpedDealerFall) {
            ar.hasThumpedDealerFall = true;
            import('../audio').then(a => a.playThumpSound());
            playBloodImpactSplatter(0.75);
            vibrateGamepad('jolt', { duration: 250, weak: 1.0, strong: 1.0 });

            // Violent impact screen shake & camera kick
            ar.cameraShakeIntensity = 1.2;
            ar.cameraKickZ = 0.15;

            const impactPos = new THREE.Vector3(0, -0.9, -4.8);
            spawnParticles(impactPos, 0x111111, 30, 0.18, -0.001, 'SMOKE');
            spawnParticles(impactPos, 0x2a0000, 75, 0.16, -0.002, 'BLOOD', new THREE.Vector3(0, 0.25, -0.8));
            registerBloodDripEmitter(new THREE.Vector3(-0.18, -0.78, -4.65), 8, false);
            registerBloodDripEmitter(new THREE.Vector3(0.22, -0.78, -4.92), 7, false);
          }

          // Ragdoll dampening bounce off concrete floor
          const bounceFactor = Math.exp(-6.0 * t3) * Math.sin(16 * t3) * 0.12;

          dealerGroup.position.x = 0.06;
          dealerGroup.position.y = -1.98 + bounceFactor;
          dealerGroup.position.z = -4.85;

          dealerGroup.rotation.x = -1.62 - (bounceFactor * 0.8);
          dealerGroup.rotation.z = 0.22 + (bounceFactor * 0.3);

          const flopT = Math.min(1.0, t3 / 0.35);
          hoodMesh.position.set(0, 2.7, -0.05);
          hoodMesh.rotation.x = -0.75;
          hoodMesh.rotation.z = -0.52 * flopT;
          hoodMesh.rotation.y = 0.45 * flopT;

          leftEye.scale.setScalar(0);
          rightEye.scale.setScalar(0);

          const chair = scene.getObjectByName('dealerChairGroup');
          if (chair) {
            const chairBounce = Math.exp(-7.0 * t3) * Math.sin(14 * t3) * 0.08;
            chair.rotation.x = -Math.PI / 1.8 + chairBounce;
            chair.rotation.z = 0.18;
            chair.position.y = -1.2 + Math.abs(chairBounce) * 0.6;
            chair.position.z = -4.20;
          }
        } else {
          // Phase 4: Final Sprawled Limp Resting State
          const settleT = deathElapsed - 1.85;
          const residualTremor = Math.exp(-3.5 * settleT) * Math.sin(18 * settleT) * 0.004;

          dealerGroup.position.set(0.06 + residualTremor, -1.98, -4.85);
          dealerGroup.rotation.set(-1.62, 0, 0.22);

          hoodMesh.position.set(0, 2.7, -0.05);
          hoodMesh.rotation.set(-0.75, 0.45, -0.52);

          leftEye.scale.setScalar(0);
          rightEye.scale.setScalar(0);

          const chair = scene.getObjectByName('dealerChairGroup');
          if (chair) {
            chair.rotation.set(-Math.PI / 1.8, 0, 0.18);
            chair.position.set(0, -1.2, -4.20);
          }
        }
      }

      const chair = scene.getObjectByName('dealerChairGroup');
      if (chair && latest.dealer.health > 0) {
         chair.rotation.x = THREE.MathUtils.damp(chair.rotation.x, 0, 8.0, rawDt);
         chair.rotation.z = THREE.MathUtils.damp(chair.rotation.z, 0, 8.0, rawDt);
         chair.position.y = THREE.MathUtils.damp(chair.position.y, -1.2, 8.0, rawDt);
         chair.position.z = THREE.MathUtils.damp(chair.position.z, -3.2, 8.0, rawDt);
      }

      // Visual holographic cylinder indicator rotational snapping
      if (latest.gameState === 'LOADING') {
        revolvingChamberGroup.rotation.z += 0.42 * deltaScale;
        ar.localCylinderAngle = revolvingChamberGroup.rotation.z;
        cylinderUIGroup.position.y = cylinderUIGroup.position.y * (1 - damp(0.1)) + 1.15 * damp(0.1);
      } else {
        cylinderUIGroup.position.y = cylinderUIGroup.position.y * (1 - damp(0.08)) + 0.8 * damp(0.08);

        const targetDrumAngle = (latest.currentChamberIndex / 6) * Math.PI * 2;
        let angleDiff = targetDrumAngle - ar.localCylinderAngle;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

        ar.localCylinderAngle += angleDiff * damp(0.15);
        revolvingChamberGroup.rotation.z = ar.localCylinderAngle;
      }

      // Cylindrical drum spinning of the weapon revolver itself!
      if (cylinderSpinGroup) {
        const shootLiftMs = ar.activeShootStartTime ? (Date.now() - ar.activeShootStartTime) * 1.25 : 9999;
        if (latest.gameState === 'LOADING') {
          cylinderSpinGroup.rotation.z += 0.35 * deltaScale;
        } else if (ar.activeShootAnimationState === 'RAISING' && shootLiftMs < 420) {
          cylinderSpinGroup.rotation.z += 0.05 * deltaScale;
        } else {
          const spinTargetIdx =
            latest.gameState === 'ITEM_USE' &&
            ar.activeItemAnimType === 'PLIERS' &&
            !ar.hasEjectedPliers &&
            ar.pliersEjectChamberIdx >= 0
              ? ar.pliersEjectChamberIdx
              : latest.currentChamberIndex;
          const twoPi = Math.PI * 2;
          cylinderSpinGroup.rotation.z = ((cylinderSpinGroup.rotation.z % twoPi) + twoPi) % twoPi;
          const targetDrumAngle = ((spinTargetIdx % 6) / 6) * twoPi;
          let drumDiff = targetDrumAngle - cylinderSpinGroup.rotation.z;
          while (drumDiff < -Math.PI) drumDiff += twoPi;
          while (drumDiff > Math.PI) drumDiff -= twoPi;
          cylinderSpinGroup.rotation.z += drumDiff * damp(0.2);
        }
      }


      const getCamBasis = () => {
        const bCam = stateRef.current.camPosVec || new THREE.Vector3(0, 3.4, 5.5);
        const bLook = stateRef.current.lookTargetVec || new THREE.Vector3(0, 0.6, -1);
        const fwd = bLook.clone().sub(bCam).normalize();
        const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(rgt, fwd).normalize();
        return { bCam, bLook, fwd, rgt, up };
      };
      const makeGunBasisQuat = (forwardDir: THREE.Vector3, upHint: THREE.Vector3) => {
        const zAxis = forwardDir.clone().normalize();
        const xAxis = new THREE.Vector3().crossVectors(upHint, zAxis).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
        return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      };

      const stepPlayerDeathGunFall = () => {
        if (!ar.isPlayerDeathGunDropping) return;
        if (!ar.gunFallSettled) {
          const isSawedFall = !!latest.doubleDamageActive || ar.isSawedOff;
          const tipZ = isSawedFall ? 0.38 : 0.90;
          const hullPts = [
            new THREE.Vector3(-0.165, 0.11, -0.05),
            new THREE.Vector3(0.165, 0.11, -0.05),
            new THREE.Vector3(0.0, 0.30, -0.14),
            new THREE.Vector3(-0.068, 0.208, tipZ),
            new THREE.Vector3(0.068, 0.208, tipZ),
            new THREE.Vector3(0.0, 0.140, tipZ),
            new THREE.Vector3(-0.085, -0.33, -0.46),
            new THREE.Vector3(0.085, -0.33, -0.46),
            new THREE.Vector3(0.0, -0.05, 0.12),
          ];
          const comLocal = new THREE.Vector3(0, 0.04, 0.02);
          const dt = Math.min(rawDt, 0.05);
          const fallElapsedMs = ar.gunFallStartTime > 0 ? Date.now() - ar.gunFallStartTime : 0;
          const subSteps = 4;
          const subDt = dt / subSteps;
          const gravity = 14.8;
          const invMass = 1.0;
          const invInertia = 12.0;
          let hadFloorContact = false;

          for (let s = 0; s < subSteps; s++) {
            ar.gunFallVel.y -= gravity * subDt;
            ar.gunFallPos.addScaledVector(ar.gunFallVel, subDt);

            const angSpeed = ar.gunFallAngVel.length();
            if (angSpeed > 1e-4) {
              const axis = ar.gunFallAngVel.clone().divideScalar(angSpeed);
              const dq = new THREE.Quaternion().setFromAxisAngle(axis, angSpeed * subDt);
              ar.gunFallQuat.premultiply(dq).normalize();
            }

            const comWorld = comLocal.clone().applyQuaternion(ar.gunFallQuat).add(ar.gunFallPos);

            // Resolve all penetrating contact points across 2 solver passes to prevent rocking chatter
            for (let iter = 0; iter < 2; iter++) {
              let maxDepthPass = 0;
              let iterHadContact = false;

              for (let p = 0; p < hullPts.length; p++) {
                const wp = hullPts[p].clone().applyQuaternion(ar.gunFallQuat).add(ar.gunFallPos);
                const overTableXZ =
                  Math.abs(wp.x) <= 3.25 &&
                  wp.z >= -2.80 &&
                  wp.z <= 1.60 &&
                  ar.gunFallPos.y > 0.35;
                const surfaceY = overTableXZ ? 0.55 : -0.90;
                const depth = surfaceY - wp.y;
                if (depth <= 0) continue;

                hadFloorContact = true;
                iterHadContact = true;
                if (depth > maxDepthPass) maxDepthPass = depth;

                const contactWorld = wp.clone();
                contactWorld.y += depth;
                const r = contactWorld.sub(comWorld);
                const w = ar.gunFallAngVel;
                const vContactY = ar.gunFallVel.y + (w.z * r.x - w.x * r.z);

                if (vContactY < -0.02) {
                  const impactSpeed = -vContactY;
                  const restitution =
                    impactSpeed < 0.72 || ar.gunFallBounceCount >= 3
                      ? 0
                      : overTableXZ
                        ? Math.max(0, 0.22 - ar.gunFallBounceCount * 0.08)
                        : Math.max(0, 0.28 - ar.gunFallBounceCount * 0.10);

                  const denom = invMass + invInertia * (r.x * r.x + r.z * r.z);
                  const j = ((1 + restitution) * impactSpeed) / denom;

                  ar.gunFallVel.y += j * invMass;
                  ar.gunFallAngVel.x += -r.z * j * invInertia * 0.85;
                  ar.gunFallAngVel.z += r.x * j * invInertia * 0.85;

                  const vTanX = ar.gunFallVel.x + (w.y * r.z - w.z * r.y);
                  const vTanZ = ar.gunFallVel.z + (w.x * r.y - w.y * r.x);
                  const tanSpeed = Math.hypot(vTanX, vTanZ);
                  if (tanSpeed > 1e-4) {
                    const tx = vTanX / tanSpeed;
                    const tz = vTanZ / tanSpeed;
                    const crossY = r.z * tx - r.x * tz;
                    const tanDenom = invMass + invInertia * (r.y * r.y + crossY * crossY);
                    const mu = overTableXZ ? 0.45 : 0.62;
                    const maxFricJ = mu * j;
                    const fricScale = Math.min(maxFricJ, tanSpeed / tanDenom);
                    const fx = -tx * fricScale;
                    const fz = -tz * fricScale;
                    ar.gunFallVel.x += fx * invMass;
                    ar.gunFallVel.z += fz * invMass;
                    ar.gunFallAngVel.x += r.y * fz * invInertia * 0.75;
                    ar.gunFallAngVel.y += (r.z * fx - r.x * fz) * invInertia * 0.75;
                    ar.gunFallAngVel.z += -r.y * fx * invInertia * 0.75;
                  }

                  // Hard-capped clatter audio: at most 3 distinct impacts within 1.8s, never endlessly repeating
                  const nowImpactMs = Date.now();
                  const minImpactThreshold = ar.gunFallBounceCount === 0 ? 0.58 : 0.92;
                  const minClatterGapMs = 95 + ar.gunFallBounceCount * 45;
                  if (
                    ar.gunFallBounceCount < 3 &&
                    fallElapsedMs < 1800 &&
                    impactSpeed > minImpactThreshold &&
                    nowImpactMs - ar.gunFallLastClatterMs > minClatterGapMs
                  ) {
                    ar.gunFallLastClatterMs = nowImpactMs;
                    const soundIntensity = Math.min(1.05, impactSpeed / 6.2);
                    if (overTableXZ) {
                      playGunDropSound();
                    } else {
                      playGunFloorClatter(soundIntensity, ar.gunFallBounceCount);
                    }
                    if (impactSpeed > 1.8 && ar.gunFallBounceCount === 0) {
                      vibrateGamepad('jolt', { duration: 65, weak: 0.35, strong: 0.45 });
                      spawnParticles(wp.clone(), 0x888888, 6, 0.13, 0.0025, 'SPARK');
                      if (ar.gunBloodyUntil > nowImpactMs) {
                        spawnParticles(wp.clone(), 0x2a0000, 10, 0.10, 0.003, 'BLOOD');
                      }
                    }
                    ar.gunFallBounceCount++;
                  }
                }
              }

              if (maxDepthPass > 0) {
                ar.gunFallPos.y += maxDepthPass * 0.92;
              }
              if (!iterHadContact) break;
            }

            if (hadFloorContact) {
              // Strong contact friction & rotational settle damping so the revolver comes to rest cleanly
              const extraRestDamp = ar.gunFallBounceCount >= 1 && ar.gunFallVel.lengthSq() < 0.12 ? 10.5 : 6.2;
              const slideDamp = Math.exp(-extraRestDamp * subDt);
              const spinDamp = Math.exp(-(extraRestDamp + 1.5) * subDt);
              ar.gunFallVel.x *= slideDamp;
              ar.gunFallVel.z *= slideDamp;
              ar.gunFallAngVel.multiplyScalar(spinDamp);
            }
          }

          const isSlowEnoughToSleep =
            hadFloorContact && ar.gunFallVel.lengthSq() < 0.015 && ar.gunFallAngVel.lengthSq() < 0.16;
          if (isSlowEnoughToSleep) {
            ar.gunFallSettleFrames++;
          } else {
            ar.gunFallSettleFrames = 0;
          }

          if (
            ar.gunFallSettleFrames >= 6 ||
            (hadFloorContact && fallElapsedMs > 1700) ||
            fallElapsedMs > 2800
          ) {
            ar.gunFallSettled = true;
            ar.gunFallVel.set(0, 0, 0);
            ar.gunFallAngVel.set(0, 0, 0);
          }
        }

        gunGroup.position.copy(ar.gunFallPos);
        gunGroup.quaternion.copy(ar.gunFallQuat);
        hammerPivotGroup.rotation.x = 0;
        triggerPivotGroup.rotation.x = THREE.MathUtils.damp(triggerPivotGroup.rotation.x, 0.0, 16.0, rawDt);
      };

      const initPlayerDeathGunDrop = () => {
        ar.isPlayerDeathGunDropping = true;
        ar.gunFallSettled = false;
        ar.gunFallBounceCount = 0;
        ar.gunFallSettleFrames = 0;
        ar.gunFallLastClatterMs = 0;
        ar.gunFallStartTime = Date.now();
        ar.gunFallPos.copy(gunGroup.position);
        ar.gunFallQuat.copy(gunGroup.quaternion);
        ar.gunFallVel.set(
          0.22 + (Math.random() - 0.5) * 0.22,
          0.28 + Math.random() * 0.16,
          -1.50 - Math.random() * 0.35
        );
        ar.gunFallAngVel.set(
          3.2 + (Math.random() - 0.5) * 2.4,
          (Math.random() - 0.5) * 4.0,
          (Math.random() > 0.5 ? 1 : -1) * (5.8 + Math.random() * 2.4)
        );
      };

      if (latest.player.health > 0) {
        if (ar.isPlayerDeathGunDropping) {
          ar.isPlayerDeathGunDropping = false;
          ar.gunFallSettled = false;
          ar.gunFallBounceCount = 0;
          ar.gunFallSettleFrames = 0;
        }
        if (latest.gameState !== 'SHOOTING') {
          ar.wasPlayerSelfLiveShot = false;
        }
      }

      // --- GUN ANIMATION SYSTEM ---
      if (latest.gameState === 'SHOOTING') {
          if (ar.activeShootAnimationState === 'IDLE') {
          ar.activeShootAnimationState = 'RAISING';
          ar.activeShootStartTime = Date.now();
          ar.hasDischarged = false;
          ar.hasCockingSoundPlayed = false;
          ar.animSuppressCockAudio = ar.isFirstShotAfterLoad;
          ar.isFirstShotAfterLoad = false;

          ar.animShooter = latest.shooter || 'player';
          ar.animTarget = latest.target || 'dealer';
          ar.animIsLive = latest.chambers[latest.currentChamberIndex]?.isLive || false;
          ar.wasPlayerSelfLiveShot =
            ar.animShooter === 'player' && ar.animTarget === 'player' && ar.animIsLive;
        }

        updateChambersState(latest.chambers, null);

        const elapsedMs = (Date.now() - ar.activeShootStartTime) * 1.25;
        const { bCam, fwd, rgt, up } = getCamBasis();
        const isSawedAim = !!latest.doubleDamageActive || ar.isSawedOff;
        const muzzleLocalLen = isSawedAim ? 0.38 : 0.90;

        // Compute close, personal first-person or Dealer aiming transforms
        const finalAimPos = new THREE.Vector3();
        let finalAimQuat = new THREE.Quaternion();
        const dealerMouthWorld = new THREE.Vector3(0, 2.12, -2.64);
        dealerMouthGroup.updateWorldMatrix(true, false);
        dealerMouthGroup.getWorldPosition(dealerMouthWorld);

        if (ar.animShooter === 'player') {
          if (ar.animTarget === 'player') {
            // Pressed intimately beneath player's chin / directly toward eyes
            const muzzleTarget = bCam.clone()
              .addScaledVector(fwd, 0.72)
              .addScaledVector(up, -0.125)
              .addScaledVector(rgt, 0.018);
            const faceTarget = bCam.clone().addScaledVector(up, -0.045);
            const selfDir = faceTarget.sub(muzzleTarget).normalize();
            const selfUpHint = up.clone().addScaledVector(rgt, -0.20).normalize();
            finalAimQuat = makeGunBasisQuat(selfDir, selfUpHint);
            const muzzleOffsetWorld = new THREE.Vector3(0, 0.208, muzzleLocalLen).applyQuaternion(finalAimQuat);
            finalAimPos.copy(muzzleTarget).sub(muzzleOffsetWorld);
          } else {
            // Heavy close-up first-person sight picture downrange at Dealer
            finalAimPos.copy(bCam)
              .addScaledVector(fwd, 1.44)
              .addScaledVector(up, -0.27)
              .addScaledVector(rgt, 0.13);
            const dealerHeadTarget = new THREE.Vector3(0, 2.22, -3.2);
            const aimDir = dealerHeadTarget.sub(finalAimPos).normalize();
            const aimUpHint = up.clone().addScaledVector(rgt, -0.06).normalize();
            finalAimQuat = makeGunBasisQuat(aimDir, aimUpHint);
          }
        } else {
          if (ar.animTarget === 'player') {
            finalAimPos.set(0, 1.45, -1.85);
            const dirToCam = bCam.clone().sub(finalAimPos).normalize();
            finalAimQuat = makeGunBasisQuat(dirToCam, new THREE.Vector3(0, 1, 0));
          } else {
            // Pin muzzle cleanly under Dealer's jaw for both full-length and sawed-off barrels
            const muzzleTarget = dealerMouthWorld.clone().add(new THREE.Vector3(0.02, -0.11, 0.14));
            const faceTarget = dealerMouthWorld.clone().add(new THREE.Vector3(0, 0.10, -0.05));
            const dealerSelfDir = faceTarget.sub(muzzleTarget).normalize();
            finalAimQuat = makeGunBasisQuat(dealerSelfDir, new THREE.Vector3(0.16, 1, 0).normalize());
            const muzzleOffsetWorld = new THREE.Vector3(0, 0.208, muzzleLocalLen).applyQuaternion(finalAimQuat);
            finalAimPos.copy(muzzleTarget).sub(muzzleOffsetWorld);
          }
        }

        if (elapsedMs < 1800) {
          // --- RAISING & COCKING & AIMING PHASE ---
          if (elapsedMs < 750) {
            // Phase 1: Grounded wrist pickup arc directly from table into close-up personal grip
            const liftT = Math.min(1.0, elapsedMs / 750);
            const easeLift = 1 - Math.pow(1 - liftT, 3);
            const arcLiftY = Math.sin(liftT * Math.PI) * 0.16;
            const pickupPos = new THREE.Vector3().lerpVectors(initialGunPos, finalAimPos, easeLift);
            pickupPos.y += arcLiftY;

            const pickupQuat = new THREE.Quaternion().slerpQuaternions(initialGunQuat, finalAimQuat, easeLift);

            gunGroup.position.lerp(pickupPos, damp(0.28));
            gunGroup.quaternion.slerp(pickupQuat, damp(0.26));

            if (ar.animSuppressCockAudio) {
              // Revolver was already cocked on cylinder load — keep hammer locked back silently
              hammerPivotGroup.rotation.x = -0.68;
            } else if (elapsedMs > 50) {
              if (!ar.hasCockingSoundPlayed) {
                ar.hasCockingSoundPlayed = true;
                playCockSound();
                if (ar.animShooter === 'player') {
                  vibrateGamepad('jolt', { duration: 55, weak: 0.15, strong: 0.85 });
                }
              }
              const t = Math.min(1.0, (elapsedMs - 50) / 350);
              const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
              hammerPivotGroup.rotation.x = -0.68 * easeT;
            } else {
              hammerPivotGroup.rotation.x = 0;
            }
            triggerPivotGroup.rotation.x = THREE.MathUtils.damp(triggerPivotGroup.rotation.x, 0.0, 12.0, rawDt);

            if (ar.animShooter === 'player') {
              const leanGoal = ar.animTarget === 'player'
                ? up.clone().multiplyScalar(0.015 * easeLift).addScaledVector(fwd, -0.025 * easeLift)
                : fwd.clone().multiplyScalar(0.055 * easeLift).addScaledVector(up, -0.018 * easeLift);
              ar.actionCamOffset.lerp(leanGoal, damp(0.14));
              ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, (ar.animTarget === 'player' ? -3.5 : -2.5) * easeLift, 8.0, rawDt);
            }
          } else {
            // Phase 2: Bearing down / breath-hold / progressive trigger squeeze
            hammerPivotGroup.rotation.x = -0.68; // Locked back

            const squeezeT = Math.min(1.0, Math.max(0.0, (elapsedMs - 1100) / 670));
            const easedSqueeze = squeezeT * squeezeT;
            triggerPivotGroup.rotation.x = easedSqueeze * 0.44;

            gunGroup.position.lerp(finalAimPos, damp(0.24));
            gunGroup.quaternion.slerp(finalAimQuat, damp(0.24));

            if (ar.animShooter === 'player') {
              const breathGrip = ar.animTarget === 'player'
                ? up.clone().multiplyScalar(0.024).addScaledVector(fwd, -0.045)
                : fwd.clone().multiplyScalar(0.085).addScaledVector(up, -0.025);
              ar.actionCamOffset.lerp(breathGrip, damp(0.12));
              ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, ar.animTarget === 'player' ? -3.8 : -2.8, 8.0, rawDt);
              if (ar.animTarget === 'dealer') {
                ar.actionLookOffset.lerp(new THREE.Vector3(0, 0.04, 0), damp(0.12));
              }
            } else if (ar.animTarget === 'dealer') {
              ar.dealerHeadTiltFactor = 0.45;
              ar.dealerMouthOpenFactor = 0.32;
            }
          }

          // Organic multi-harmonic hand tremor & heartbeat micro-pulse under aim tension (after 880ms)
          if (elapsedMs > 880) {
            const tension = Math.min(1.0, (elapsedMs - 880) / 920);
            const closeScale = ar.animShooter === 'player' ? 0.0055 : 0.010;
            const tremorAmp = tension * closeScale;
            const heartPulse = Math.pow(Math.max(0, Math.sin(time * 5.6)), 6) * 0.004 * tension;

            gunGroup.position.x += (Math.sin(time * 13.7) * 0.65 + Math.cos(time * 24.3) * 0.35) * tremorAmp;
            gunGroup.position.y += (Math.cos(time * 11.4) * 0.65 + Math.sin(time * 21.1) * 0.35) * tremorAmp + heartPulse;
            gunGroup.position.z += Math.sin(time * 9.2) * tremorAmp * 0.5;

            const tremorPitch = (Math.sin(time * 16.0) * 0.006 + Math.cos(time * 29.0) * 0.003) * tension;
            const tremorYaw = (Math.cos(time * 14.5) * 0.005 + Math.sin(time * 26.0) * 0.003) * tension;
            gunGroup.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tremorPitch, tremorYaw, 0)));

            ar.cameraShakeIntensity = THREE.MathUtils.damp(ar.cameraShakeIntensity, tension * 0.018, 6.0, rawDt);
          }

          if (ar.animShooter === 'player') {
            const now = Date.now();
            if (elapsedMs < 900) {
              if (!ar.lastAimVibrateTime || now - ar.lastAimVibrateTime >= 450) {
                ar.lastAimVibrateTime = now;
                vibrateGamepad('rumble', { duration: 80, weak: 0.10, strong: 0.01 });
              }
            } else {
              const shakeFactor = Math.min(1.0, (elapsedMs - 900) / 900);
              const interval = 150 - (shakeFactor * 60);
              if (now - ar.lastAimVibrateTime >= interval) {
                ar.lastAimVibrateTime = now;
                const weakIntensity = 0.12 + (shakeFactor * 0.22);
                const strongIntensity = 0.02 + (shakeFactor * 0.06);
                vibrateGamepad('rumble', {
                  duration: Math.round(interval * 0.8),
                  weak: weakIntensity,
                  strong: strongIntensity
                });
              }
            }
          }
        } else {
          // --- THE DISCHARGE OR DRY BLANK CLICK MOMENTS ---
          hammerPivotGroup.rotation.x = 0; // hammer snaps forward instantly onto firing pin
          triggerPivotGroup.rotation.x = THREE.MathUtils.damp(triggerPivotGroup.rotation.x, 0.0, 18.0, rawDt);

          if (!ar.hasDischarged) {
            ar.hasDischarged = true;
            ar.lastFireTime = Date.now();
            gunGroup.updateMatrixWorld(true);

            if (ar.animIsLive) {
              ar.lastFireIsLive = true;

              if (ar.animTarget === 'player') {
                ar.cameraKickZ = 0.65;
                ar.cameraKickPitch = -0.42;
                ar.cameraKickRoll = (Math.random() > 0.5 ? 0.24 : -0.24);
                ar.cameraShakeIntensity = 5.2;

                spawnScreenSplat();
                setTimeout(spawnScreenSplat, 100);
                setTimeout(spawnScreenSplat, 250);
                vibrateGamepad('jolt', { duration: 250, weak: 1.0, strong: 1.0 });
              } else {
                ar.cameraKickZ = 0.42;
                ar.cameraKickPitch = -0.28;
                ar.cameraKickRoll = (Math.random() > 0.5 ? 0.11 : -0.11);
                ar.cameraShakeIntensity = 3.9;

                vibrateGamepad('jolt', { duration: 180, weak: 0.85, strong: 0.95 });
              }

              const isTargetDealer = ar.animTarget === 'dealer';
              const targetImpactPos = isTargetDealer
                ? (ar.animShooter === 'dealer'
                    ? dealerMouthWorld.clone().add(new THREE.Vector3(-0.03, 0.08, 0.02))
                    : new THREE.Vector3(-0.08, 1.85, -2.55))
                : bCam.clone().addScaledVector(fwd, 0.45).addScaledVector(up, -0.08);

              if (isTargetDealer) {
                stateRef.current.dealerFlinchTime = Date.now();
              }

              const isSawed = !!latest.doubleDamageActive || ar.isSawedOff;
              const muzzleZ = isSawed ? 0.38 : 0.9;
              const muzzleWorldPos = new THREE.Vector3(0, 0.208, muzzleZ).applyMatrix4(gunGroup.matrixWorld);
              const chamberWorldPos = new THREE.Vector3(0.12, 0.12, -0.15).applyMatrix4(gunGroup.matrixWorld);

              muzzleFlashLight.position.copy(muzzleWorldPos);
              ar.muzzleFlashIntensity = isSawed ? 26.0 : 21.0;

              spawnParticles(muzzleWorldPos, 0xcc9900, 1, 0.85, 0.0001, 'BULLET');
              spawnParticles(chamberWorldPos, 0xd4af37, 1, 0.16, 0.0038, 'SHELL');
              spawnParticles(muzzleWorldPos, 0xffaa00, isSawed ? 130 : 85, 0.55, 0.001, 'SPARK');
              spawnParticles(muzzleWorldPos, 0xaaaaaa, isSawed ? 90 : 65, 0.7, -0.0018, 'SMOKE');

              ar.gunBloodyUntil = Date.now() + 26000;
              gunBloodGroup.visible = true;
              if (!isSawed) frontGunBloodGroup.visible = true;

              playBloodImpactSplatter(1.0);
              spawnParticles(targetImpactPos, 0x2a0000, 340, 0.45, 0.004, 'BLOOD');

              if (isTargetDealer) {
                // Directional exit-wound arterial spray backward + forward table blowback
                spawnParticles(
                  targetImpactPos.clone().add(new THREE.Vector3(0, 0.05, -0.35)),
                  0x2a0000,
                  140,
                  0.42,
                  0.004,
                  'BLOOD',
                  new THREE.Vector3(0, 0.14, -1)
                );
                spawnParticles(
                  targetImpactPos.clone().add(new THREE.Vector3(0, -0.05, 0.15)),
                  0x2a0000,
                  80,
                  0.30,
                  0.004,
                  'BLOOD',
                  new THREE.Vector3(0, -0.05, 1)
                );
              }

              const midPoint = targetImpactPos.clone().add(muzzleWorldPos).multiplyScalar(0.5);
              spawnParticles(midPoint, 0x2a0000, 200, 0.35, 0.004, 'BLOOD');
              spawnParticles(muzzleWorldPos, 0x2a0000, 140, 0.28, 0.004, 'BLOOD');

              gunGroup.updateMatrixWorld(true);
              const dripMuzzleWorld = new THREE.Vector3(0, 0.155, isSawed ? 0.34 : 0.78).applyMatrix4(gunGroup.matrixWorld);
              const dripLugWorld = new THREE.Vector3(0, 0.10, isSawed ? 0.18 : 0.42).applyMatrix4(gunGroup.matrixWorld);
              registerBloodDripEmitter(dripMuzzleWorld, 9, true);
              registerBloodDripEmitter(dripLugWorld, 7, true);
              if (isTargetDealer) {
                const dealerDmgRatio = Math.max(
                  0.12,
                  1 - Math.max(0, latest.dealer.health) / Math.max(1, latest.dealer.maxHealth)
                );
                dealerWounds.update(dealerDmgRatio);
                dealerGroup.updateMatrixWorld(true);
                const woundAnchors = dealerWounds.getActiveDripLocalAnchors();
                if (woundAnchors.length > 0) {
                  for (let w = 0; w < Math.min(3, woundAnchors.length); w++) {
                    const worldAnchor = woundAnchors[w].clone().applyMatrix4(dealerGroup.matrixWorld);
                    registerBloodDripEmitter(worldAnchor, 9, false);
                  }
                } else {
                  registerBloodDripEmitter(targetImpactPos.clone().add(new THREE.Vector3(-0.08, -0.15, 0.14)), 10, false);
                  registerBloodDripEmitter(targetImpactPos.clone().add(new THREE.Vector3(0.09, -0.22, 0.16)), 8, false);
                }
              }
            } else {
              // Dry blank click -> crisp cold flinch & mechanical click
              ar.lastFireIsLive = false;
              ar.cameraShakeIntensity = 0.045;
              ar.cameraKickZ = ar.animShooter === 'player' ? 0.018 : 0.005;
              ar.cameraKickPitch = ar.animShooter === 'player' ? -0.012 : -0.003;

              const chamberWorldPos = new THREE.Vector3(0.12, 0.12, -0.15).applyMatrix4(gunGroup.matrixWorld);
              spawnParticles(chamberWorldPos, 0x1e8bc3, 1, 0.12, 0.0038, 'SHELL');
            }
          }

          // --- RECOIL SETTLE AND RETURNING HOME ---
          const recoilAge = Math.max(0, elapsedMs - 1800);

          // On lethal self-shot by the player, limp fingers release the revolver right after the recoil jolt
          if (
            !ar.isPlayerDeathGunDropping &&
            ar.animShooter === 'player' &&
            ar.animTarget === 'player' &&
            ar.hasDischarged &&
            ar.lastFireIsLive &&
            latest.player.health <= 0 &&
            recoilAge >= 65
          ) {
            initPlayerDeathGunDrop();
          }

          if (ar.isPlayerDeathGunDropping) {
            stepPlayerDeathGunFall();
          } else if (recoilAge < 520) {
            const barrelForwardWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(finalAimQuat).normalize();
            const gunRightWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(finalAimQuat).normalize();
            const recoilGoalPos = finalAimPos.clone();
            let recoilQuat = finalAimQuat.clone();

            if (ar.lastFireIsLive) {
              const kickForce = recoilAge <= 55
                ? Math.sin((recoilAge / 55) * (Math.PI / 2))
                : Math.pow(Math.max(0, 1.0 - (recoilAge - 55) / 465), 2.5);

              // Kick backward opposite barrel pointing vector + pitch muzzle up around local X
              const kickBackDist = ar.animShooter === 'player' ? 0.24 : 0.55;
              recoilGoalPos.addScaledVector(barrelForwardWorld, -kickBackDist * kickForce);
              recoilGoalPos.y += 0.14 * kickForce;
              const kickPitchQuat = new THREE.Quaternion().setFromAxisAngle(gunRightWorld, (ar.animTarget === 'player' ? 0.55 : -0.68) * kickForce);
              recoilQuat = kickPitchQuat.multiply(finalAimQuat);
            } else {
              // Subtle cold dry-fire hammer snap flinch
              const flinch = recoilAge <= 45
                ? Math.sin((recoilAge / 45) * (Math.PI / 2))
                : Math.pow(Math.max(0, 1.0 - (recoilAge - 45) / 220), 2);
              recoilGoalPos.addScaledVector(barrelForwardWorld, -0.022 * flinch);
              if (ar.animShooter === 'player') {
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.12));
                ar.actionLookOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.12));
              }
            }

            gunGroup.position.lerp(recoilGoalPos, damp(0.42));
            gunGroup.quaternion.slerp(recoilQuat, damp(0.36));
          } else {
            // Heavy, grounded return arc onto wooden tabletop with subtle contact bounce
            const returnT = Math.min(1.0, (recoilAge - 520) / 460);
            const easeRet = returnT * returnT * (3 - 2 * returnT);
            const tableImpactBounce = returnT > 0.65
              ? Math.abs(Math.sin((returnT - 0.65) * Math.PI * 2.2)) * Math.exp(-5.0 * (returnT - 0.65)) * 0.018
              : 0;
            const settleGoal = new THREE.Vector3().lerpVectors(finalAimPos, initialGunPos, easeRet);
            settleGoal.y += Math.sin(returnT * Math.PI) * 0.08 + tableImpactBounce;

            const restQuat = new THREE.Quaternion().setFromEuler(initialGunRot);
            const targetReturnQuat = new THREE.Quaternion().slerpQuaternions(finalAimQuat, restQuat, easeRet);

            gunGroup.position.lerp(settleGoal, damp(0.24));
            gunGroup.quaternion.slerp(targetReturnQuat, damp(0.22));
            if (ar.animShooter === 'player') {
              ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
              ar.actionLookOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
              ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, 0, 8.0, rawDt);
            }
          }
        }

      } else {
        // --- IDLE STATE ---
        ar.activeShootAnimationState = 'IDLE';
        ar.activeShootStartTime = 0;
        ar.hasDischarged = false;
        
        const isGunControlledByItem =
          latest.gameState === 'ITEM_USE' &&
          (ar.activeItemAnimType === 'MIRROR' ||
            ar.activeItemAnimType === 'PLIERS' ||
            ar.activeItemAnimType === 'SCALPEL');

        // Keep hammer cocked on table if cylinder reload already cocked it for the first shot
        hammerPivotGroup.rotation.x =
          !isGunControlledByItem && latest.gameState !== 'LOADING' && ar.isFirstShotAfterLoad
            ? -0.68
            : 0;
        triggerPivotGroup.rotation.x = THREE.MathUtils.damp(triggerPivotGroup.rotation.x, 0.0, 14.0, rawDt);

        if (ar.gunBloodyUntil > 0 && Date.now() > ar.gunBloodyUntil) {
          gunBloodGroup.visible = false;
          frontGunBloodGroup.visible = false;
          ar.gunBloodyUntil = 0;
        }

        // Maintain barrel visibility based on sawed-off / double damage state
        const isCuttingScalpelResting = ar.activeItemAnimType === 'SCALPEL';
        if (!latest.doubleDamageActive && !isCuttingScalpelResting) {
          ar.isSawedOff = false;
          ar.hasSpawnedSeveredBarrel = false;
        }
        const isSawedActiveResting = !!latest.doubleDamageActive || (isCuttingScalpelResting && ar.isSawedOff);
        if (ar.gunBarrelFrontGroup) {
          ar.gunBarrelFrontGroup.visible = !isSawedActiveResting;
        }

        if (
          !ar.isPlayerDeathGunDropping &&
          latest.gameState === 'GAME_OVER' &&
          latest.player.health <= 0 &&
          ar.wasPlayerSelfLiveShot
        ) {
          initPlayerDeathGunDrop();
        }

        if (ar.isPlayerDeathGunDropping && latest.player.health <= 0 && latest.gameState !== 'MENU' && latest.gameState !== 'LOADING') {
          stepPlayerDeathGunFall();
        } else if (!isGunControlledByItem && latest.gameState !== 'LOADING') {
          // Perfectly flat wooden table top resting orientation via quaternion slerp (prevents Euler gimbal spinning)
          gunGroup.position.lerp(initialGunPos, damp(0.16));
          gunGroup.quaternion.slerp(initialGunQuat, damp(0.18));
          if (1 - Math.abs(gunGroup.quaternion.dot(initialGunQuat)) < 1e-6) {
            gunGroup.quaternion.copy(initialGunQuat);
          }
          cylinderSwingGroup.rotation.z = THREE.MathUtils.damp(cylinderSwingGroup.rotation.z, 0, 12.0, rawDt);
          cylinderLatchMesh.position.z = THREE.MathUtils.damp(cylinderLatchMesh.position.z, -0.315, 12.0, rawDt);
          for (let c = 0; c < chamberCartridges.length; c++) {
            chamberCartridges[c].position.z = 0;
          }
          updateChambersState(latest.chambers, null);
        }
      }


      // --- REALISTIC GROUNDED INVENTORY ITEMS ON TABLE SURFACE WITH TACTILE INSPECTION LIFT ---
      const nowTime = performance.now() * 0.001;

      playerItemMeshes.forEach((mesh, itemIdx) => {
        const isHovered = hoveredMesh === mesh;
        const isSelected = isHovered && latest.showControls;

        const targetScale = isSelected ? 1.09 : 1.0;
        const targetY = isSelected ? 0.024 : 0.0;
        const targetTiltX = isSelected ? 0.14 : 0.0;
        const targetInspectYaw = isSelected ? Math.sin(nowTime * 2.1 + itemIdx) * 0.05 : 0.0;
        const targetEmissive = isSelected ? 1.0 : 0.0;

        mesh.userData.currScale = THREE.MathUtils.damp(mesh.userData.currScale ?? 1.0, targetScale, 14.0, rawDt);
        mesh.userData.currY = THREE.MathUtils.damp(mesh.userData.currY ?? 0.0, targetY, 14.0, rawDt);
        mesh.userData.currTiltX = THREE.MathUtils.damp(mesh.userData.currTiltX ?? 0.0, targetTiltX, 12.0, rawDt);
        mesh.userData.currInspectYaw = THREE.MathUtils.damp(mesh.userData.currInspectYaw ?? 0.0, targetInspectYaw, 10.0, rawDt);
        mesh.userData.currEmissive = THREE.MathUtils.damp(mesh.userData.currEmissive ?? 0.0, targetEmissive, 14.0, rawDt);

        mesh.scale.setScalar(mesh.userData.currScale);
        mesh.position.y = mesh.userData.currY;
        mesh.rotation.x = mesh.userData.currTiltX;
        mesh.rotation.y = mesh.userData.currInspectYaw;

        const pulse = 0.85 + (isSelected ? 0.15 * Math.sin(nowTime * 4.5) : 0);
        const redVal = 0.16 * mesh.userData.currEmissive * pulse;
        const greenVal = 0.05 * mesh.userData.currEmissive * pulse;
        const blueVal = 0.02 * mesh.userData.currEmissive * pulse;

        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if ('emissive' in mat && (mat as any).emissive) {
                const baseE = child.userData.baseEmissive || new THREE.Color(0, 0, 0);
                (mat as any).emissive.setRGB(
                  Math.min(1.0, baseE.r + redVal),
                  Math.min(1.0, baseE.g + greenVal),
                  Math.min(1.0, baseE.b + blueVal)
                );
              }
            });
          }
        });
      });

      // Dealer items resting flat on tabletop surface (no floating)
      dealerItemMeshes.forEach((mesh) => {
        mesh.position.y = 0;
      });

      // Shop item meshes smooth tactile inspection lift on shelves
      shopItemMeshes.forEach((mesh, shopIdx) => {
        const isDisabledInClassic = latest.branch === 'CLASSIC' && mesh.userData.type === 'SCALPEL';
        mesh.visible = !isDisabledInClassic;
        if (mesh.userData.priceTag) {
          mesh.userData.priceTag.visible = !isDisabledInClassic;
        }
        if (isDisabledInClassic) return;

        const isHovered = hoveredMesh === mesh;
        const isSelected = isHovered && isLookingAtShopRef.current;

        const targetScale = isSelected ? 1.10 : 1.0;
        const targetY = isSelected ? 0.022 : 0.0;
        const targetInspectYaw = isSelected ? Math.sin(nowTime * 2.0 + shopIdx) * 0.06 : 0.0;
        const targetEmissive = isSelected ? 1.0 : 0.0;

        mesh.userData.currScale = THREE.MathUtils.damp(mesh.userData.currScale ?? 1.0, targetScale, 14.0, rawDt);
        mesh.userData.currY = THREE.MathUtils.damp(mesh.userData.currY ?? 0.0, targetY, 14.0, rawDt);
        mesh.userData.currInspectYaw = THREE.MathUtils.damp(mesh.userData.currInspectYaw ?? 0.0, targetInspectYaw, 10.0, rawDt);
        mesh.userData.currEmissive = THREE.MathUtils.damp(mesh.userData.currEmissive ?? 0.0, targetEmissive, 14.0, rawDt);

        const baseScale = mesh.userData.baseScale ?? 1.5;
        mesh.scale.setScalar(baseScale * (mesh.userData.currScale ?? 1.0));
        mesh.position.y = (mesh.userData.shelfY ?? 0.565) + (mesh.userData.currY ?? 0.0);
        mesh.rotation.y = (mesh.userData.baseRotY ?? 0) + (mesh.userData.currInspectYaw ?? 0);

        const redVal = 0.16 * mesh.userData.currEmissive;
        const greenVal = 0.11 * mesh.userData.currEmissive;
        const blueVal = 0.03 * mesh.userData.currEmissive;

        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if ('emissive' in mat && (mat as any).emissive) {
                const baseE = child.userData.baseEmissive || new THREE.Color(0, 0, 0);
                (mat as any).emissive.setRGB(
                  Math.min(1.0, baseE.r + redVal),
                  Math.min(1.0, baseE.g + greenVal),
                  Math.min(1.0, baseE.b + blueVal)
                );
              }
            });
          }
        });
      });


      // --- IMMERSIVE REALISTIC ITEM ANIMATIONS ENGINE ---
      if (latest.gameState === 'ITEM_USE') {
        if (!ar.activeItemAnimType) {
          // Parse which item is being used from latest.message
          // Format is: "You used MIRROR." or "The Dealer used MIRROR."
          const msg = latest.message;
          const userStr = msg.includes("The Dealer") ? 'dealer' : 'player';
          
          let foundType: ItemType | null = null;
          const itemsList: ItemType[] = ['MIRROR', 'PLIERS', 'WHISKEY', 'TOURNIQUET', 'PENTAGRAM', 'CIGARETTE', 'SCALPEL', 'DEFIBRILLATOR', 'SYRINGE', 'RAZORBLADE', 'MEDKIT'];
          for (const item of itemsList) {
            if (msg.includes(item)) {
              foundType = item;
              break;
            }
          }
          
          if (foundType) {
            ar.activeItemAnimType = foundType;
            ar.hasEjectedPliers = false;
            ar.pliersEjectChamberIdx = foundType === 'PLIERS' ? (latest.currentChamberIndex % 6) : -1;
            ar.hasSlammedSyringe = false;
            ar.hasWithdrawnSyringeBlood = false;
            ar.hasCappedSyringe = false;
            ar.hasTappedSyringe = false;
            ar.hasTappedSyringe2 = false;
            ar.hasSlicedRazor = false;
            ar.hasLitCigarette = false;
            ar.hasOpenedZippo = false;
            ar.hasStruckZippo = false;
            ar.hasClosedZippo = false;
            ar.hasDraggedCigarette = false;
            ar.hasShedCigAsh = false;
            ar.hasExhaledSmoke = false;
            ar.hasPlayedMirrorSound = false;
            ar.hasPlayedMirrorCurseSpark = false;
            ar.hasPlayedWhiskeySound = false;
            ar.hasPlayedTourniquetSound = false;
            ar.hasPlayedPentagramSound = false;
            ar.hasPlayedDefibSound = false;
            ar.hasPlayedMedkitSetDown = false;
            ar.hasPlayedMedkitSound = false;
            ar.hasPlayedMedkitUnlatchR = false;
            ar.hasPlayedMedkitOpenLid = false;
            ar.hasPlayedMedkitSprayShake = false;
            ar.hasPlayedMedkitSpray = false;
            ar.hasPlayedMedkitSpray2 = false;
            ar.hasPlayedMedkitGauze = false;
            ar.hasPlayedMedkitGauzeWrap = false;
            ar.hasPlayedMedkitPills = false;
            ar.hasPlayedMedkitPillPour = false;
            ar.hasPlayedMedkitSwallow = false;
            ar.hasPlayedMedkitClose = false;
            ar.hasPlayedPliersOpen = false;
            ar.hasPlayedPliersGrip = false;
            ar.hasPlayedPliersClose = false;
            ar.hasPlayedScalpelSawSound = false;
            ar.hasSpawnedSeveredBarrel = false;
            ar.whiskeyVolume = 1.0;
            ar.whiskeySloshAngleX = 0;
            ar.whiskeySloshAngleZ = 0;
            ar.whiskeySloshVelX = 0;
            ar.whiskeySloshVelZ = 0;
            ar.syringeBubblePos = 0.28;
            ar.syringeBubblePosX = 0.008;
            ar.syringeBubblePosZ = 0;
            ar.syringeBubbleVel = 0;
            ar.syringeBubbleVelX = 0;
            ar.syringeBubbleVelZ = 0;
            ar.syringeFluidVolume = 1.0;
            ar.syringeFluidOscillation = 0;
            ar.syringeFluidOscVel = 0;
            ar.prevItemPos.set(0, 0, 0);
            ar.prevItemRot.set(0, 0, 0);
            ar.activeItemAnimUser = userStr;
            ar.activeItemAnimStartTime = Date.now();

            if (ar.activeZippoGroup) {
              if (ar.activeZippoGroup.parent) ar.activeZippoGroup.parent.remove(ar.activeZippoGroup);
              disposeNode(ar.activeZippoGroup);
              ar.activeZippoGroup = null;
            }
            
            // Build the floating item mesh representation
            ar.activeItemAnimGroup = createItemMesh(foundType);
            scene.add(ar.activeItemAnimGroup);

            if (foundType === 'MIRROR' && mirrorReflectorMesh) {
              ar.activeItemAnimGroup.add(mirrorReflectorMesh);
              mirrorReflectorMesh.position.set(0, 0.25, 0.004);
              mirrorReflectorMesh.visible = true;
            }

            if (foundType === 'CIGARETTE') {
              const tableZippo = ar.activeItemAnimGroup.getObjectByName('tableZippoGroup');
              if (tableZippo) tableZippo.visible = false;
              const zippo = createZippoMesh();
              zippo.name = 'activeHandZippo';
              zippo.visible = false;
              scene.add(zippo);
              ar.activeZippoGroup = zippo;
            }
            
            // Initial positioning
            if (userStr === 'player') {
              ar.activeItemAnimGroup.position.set(0.6, 0.6, 0.8); // player's hand side
            } else {
              ar.activeItemAnimGroup.position.set(-0.8, 0.6, -1.6); // dealer's side
            }
          }
        }
      } else {
        // Not in ITEM_USE state, toss active item into physics if present
        if (ar.activeItemAnimGroup) {
          discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
          ar.activeItemAnimGroup = null;
        }
        if (mirrorReflectorMesh && mirrorReflectorMesh.visible) {
          mirrorReflectorMesh.visible = false;
          if (mirrorReflectorMesh.parent !== scene) scene.add(mirrorReflectorMesh);
        }
        if (ar.activeZippoGroup) {
          if (ar.activeZippoGroup.parent) ar.activeZippoGroup.parent.remove(ar.activeZippoGroup);
          disposeNode(ar.activeZippoGroup);
          ar.activeZippoGroup = null;
        }
        ar.activeItemAnimType = null;
        ar.activeItemAnimStartTime = 0;
        ar.pliersEjectChamberIdx = -1;
        zippoFlameLight.intensity = 0;
        wristWound.reset();
        medkitArm.reset();
      }

      if (ar.activeItemAnimType !== 'RAZORBLADE') {
        wristWound.reset();
      }
      if (ar.activeItemAnimType !== 'MEDKIT') {
        medkitArm.reset();
      }
      if (ar.activeItemAnimType !== 'SCALPEL' && cutFaceMat.emissiveIntensity > 0.002) {
        cutFaceMat.emissiveIntensity = THREE.MathUtils.damp(cutFaceMat.emissiveIntensity, 0, 6.0, rawDt);
      }

      // Anim loop calculations for used item
      if (ar.activeItemAnimType && ar.activeItemAnimGroup) {
        const rawSec = (Date.now() - ar.activeItemAnimStartTime) / 1000.0;
        const elapsedSec = rawSec * 1.25;
        
        const { bCam, fwd, rgt, up } = getCamBasis();
        const playerHandStart = bCam.clone().addScaledVector(fwd, 0.85).addScaledVector(up, -0.45).addScaledVector(rgt, 0.38);

        switch (ar.activeItemAnimType) {
          case 'MIRROR': {
            const isPlayer = ar.activeItemAnimUser === 'player';
            const activeChamberIdx = latest.currentChamberIndex % 6;

            // Bring revolver close and crack the cylinder slightly open so chambers & active bullet are reflected cleanly
            const inspectGunPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 1.48).addScaledVector(up, -0.30).addScaledVector(rgt, -0.12)
              : new THREE.Vector3(0, 0.86, -0.78);
            const inspectGunQuat = isPlayer
              ? makeGunBasisQuat(
                  fwd.clone().multiplyScalar(0.55).addScaledVector(rgt, 0.80).addScaledVector(up, 0.22).normalize(),
                  up.clone().addScaledVector(rgt, -0.65).normalize()
                )
              : makeGunBasisQuat(new THREE.Vector3(0.45, 0.35, -0.82).normalize(), new THREE.Vector3(-0.3, 0.95, 0));

            const mirrorTargetP = isPlayer
              ? inspectGunPos.clone().addScaledVector(rgt, 0.34).addScaledVector(up, 0.09).addScaledVector(fwd, -0.16)
              : new THREE.Vector3(0.18, 1.08, -0.96);

            // Compute optical reflection normal half-way between camera view vector and the cylinder chambers
            gunGroup.updateMatrixWorld(true);
            const cylReflectWorld = new THREE.Vector3();
            if (chamberCartridges[activeChamberIdx]) {
              chamberCartridges[activeChamberIdx].getWorldPosition(cylReflectWorld);
            } else {
              revolverCylinderMesh.getWorldPosition(cylReflectWorld);
            }
            const toCamDir = bCam.clone().sub(mirrorTargetP).normalize();
            const toCylDir = cylReflectWorld.clone().sub(mirrorTargetP).normalize();
            const mirrorOpticalNormal = toCamDir.add(toCylDir).normalize();
            const mirrorTargetQuat = isPlayer
              ? makeGunBasisQuat(mirrorOpticalNormal, up.clone().addScaledVector(rgt, 0.08).normalize())
              : makeGunBasisQuat(
                  new THREE.Vector3(-0.35, 0.35, 0.86).normalize(),
                  new THREE.Vector3(0, 1, 0)
                );

            if (elapsedSec >= 0.38 && !ar.hasPlayedMirrorSound) {
              ar.hasPlayedMirrorSound = true;
              playMirrorInspect();
              vibrateGamepad('weak', { duration: 110 });
            }

            if (latest.branch === 'CLASSIC' && elapsedSec >= 0.92 && !ar.hasPlayedMirrorCurseSpark) {
              ar.hasPlayedMirrorCurseSpark = true;
              spawnParticles(mirrorTargetP, 0xc81d25, 9, 0.055, 0.0008, 'SPARK');
              spawnParticles(cylReflectWorld, 0xc81d25, 7, 0.045, 0.0008, 'SPARK');
            }

            // Swing cylinder slightly out during inspection and highlight the active chamber (RED = live, BLUE = blank)
            const isInspectingWindow = elapsedSec >= 0.20 && elapsedSec < 3.05;
            const targetSwing = isInspectingWindow ? 0.56 : 0.0;
            const targetLatchZ = isInspectingWindow ? -0.265 : -0.315;
            cylinderSwingGroup.rotation.z = THREE.MathUtils.damp(cylinderSwingGroup.rotation.z, targetSwing, 12.0, rawDt);
            cylinderLatchMesh.position.z = THREE.MathUtils.damp(cylinderLatchMesh.position.z, targetLatchZ, 12.0, rawDt);

            const inspectHighlightIndex = (elapsedSec >= 0.35 && elapsedSec < 3.15) ? activeChamberIdx : null;
            updateChambersState(latest.chambers, inspectHighlightIndex);

            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            if (elapsedSec < 0.95) {
              const t = elapsedSec / 0.95;
              const easeT = 1 - Math.pow(1 - t, 3);
              const arcPos = new THREE.Vector3().lerpVectors(startPos, mirrorTargetP, easeT);
              arcPos.y += Math.sin(t * Math.PI) * 0.10;
              ar.activeItemAnimGroup.position.copy(arcPos);
              const startMQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, isPlayer ? -0.4 : 0.4));
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(startMQuat, mirrorTargetQuat, easeT);

              if (isPlayer) {
                const gPos = new THREE.Vector3().lerpVectors(initialGunPos, inspectGunPos, easeT);
                gPos.y += Math.sin(t * Math.PI) * 0.12;
                gunGroup.position.lerp(gPos, damp(0.26));
                gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(initialGunQuat, inspectGunQuat, easeT), damp(0.26));
                ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.18 * easeT).addScaledVector(up, -0.05 * easeT), damp(0.14));
              } else {
                ar.dealerHeadTiltFactor = easeT * -0.25;
              }
            } else if (elapsedSec < 3.05) {
              const holdT = (elapsedSec - 0.95) / 2.10;
              const angleSweep = Math.sin(holdT * Math.PI * 1.2) * 0.06;
              ar.activeItemAnimGroup.position.copy(mirrorTargetP);
              ar.activeItemAnimGroup.position.y += Math.sin(time * 2.4) * 0.0025;
              ar.activeItemAnimGroup.position.x += Math.cos(time * 2.0) * 0.0018;
              const sweepQuat = new THREE.Quaternion().setFromAxisAngle(up, angleSweep);
              ar.activeItemAnimGroup.quaternion.copy(mirrorTargetQuat).premultiply(sweepQuat);

              if (isPlayer) {
                gunGroup.position.lerp(inspectGunPos, damp(0.24));
                gunGroup.quaternion.slerp(inspectGunQuat, damp(0.24));
                ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.20).addScaledVector(up, -0.06), damp(0.12));
              } else {
                ar.dealerHeadTiltFactor = -0.28;
                ar.dealerMouthOpenFactor = 0.08;
              }
            } else if (elapsedSec < 3.65) {
              const retT = (elapsedSec - 3.05) / 0.60;
              const easeR = retT * retT;
              ar.activeItemAnimGroup.position.lerpVectors(mirrorTargetP, startPos, easeR);
              if (mirrorReflectorMesh) mirrorReflectorMesh.visible = false;
              if (isPlayer) {
                gunGroup.position.lerp(new THREE.Vector3().lerpVectors(inspectGunPos, initialGunPos, easeR), damp(0.24));
                gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(inspectGunQuat, initialGunQuat, easeR), damp(0.24));
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
              }
            } else {
              updateChambersState(latest.chambers, null);
              cylinderSwingGroup.rotation.z = 0;
              cylinderLatchMesh.position.z = -0.315;
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'PLIERS': {
            const isPlayer = ar.activeItemAnimUser === 'player';
            const targetCartIdx = ar.pliersEjectChamberIdx >= 0 ? ar.pliersEjectChamberIdx : (latest.currentChamberIndex % 6);

            // Opening the cylinder resets hammer to uncocked so the next shooter cocks the gun upon pickup
            ar.isFirstShotAfterLoad = false;
            hammerPivotGroup.rotation.x = THREE.MathUtils.damp(hammerPivotGroup.rotation.x, 0, 16.0, rawDt);

            // Keep extracted shell visibly seated right up until pliers yank it out at p2 >= 0.42
            const pliersChambers = latest.chambers.map((ch, idx) =>
              idx === targetCartIdx
                ? (ar.hasEjectedPliers ? { ...ch, isSpent: true, isEjected: true } : { ...ch, isSpent: false, isEjected: false })
                : ch
            );
            updateChambersState(pliersChambers, null);

            const inspectGunPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 1.54).addScaledVector(up, -0.30).addScaledVector(rgt, -0.06)
              : new THREE.Vector3(0, 0.85, -0.68);
            const inspectGunQuat = isPlayer
              ? makeGunBasisQuat(
                  fwd.clone().multiplyScalar(0.55).addScaledVector(rgt, -0.78).addScaledVector(up, 0.16).normalize(),
                  up.clone().addScaledVector(rgt, 0.72).normalize()
                )
              : makeGunBasisQuat(new THREE.Vector3(-0.35, 0.25, -0.90).normalize(), new THREE.Vector3(0.4, 0.92, 0));

            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            const pliersGripQuat = isPlayer
              ? makeGunBasisQuat(
                  fwd.clone().multiplyScalar(0.6).addScaledVector(rgt, -0.7).normalize(),
                  up.clone().addScaledVector(rgt, 0.3).normalize()
                )
              : new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 5, 0, 0));

            if (elapsedSec < 1.05) {
              const t = elapsedSec / 1.05;
              const easeT = 1 - Math.pow(1 - t, 3);

              // Thumb latch slides forward & cylinder crane swings out cleanly
              const latchT = Math.min(1, t * 2.5);
              cylinderLatchMesh.position.z = THREE.MathUtils.lerp(-0.315, -0.265, latchT);
              const swingT = Math.max(0, Math.min(1, (t - 0.22) / 0.78));
              cylinderSwingGroup.rotation.z = 0.85 * (1 - Math.pow(1 - swingT, 2));

              if (t >= 0.14 && !ar.hasPlayedPliersOpen) {
                ar.hasPlayedPliersOpen = true;
                playCylinderLatchSound('open');
                vibrateGamepad('click', { duration: 35, weak: 0.25, strong: 0.1 });
              }

              if (isPlayer) {
                gunGroup.position.lerp(new THREE.Vector3().lerpVectors(initialGunPos, inspectGunPos, easeT), damp(0.24));
                gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(initialGunQuat, inspectGunQuat, easeT), damp(0.24));
                ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.16 * easeT).addScaledVector(up, -0.05 * easeT), damp(0.14));
              } else {
                ar.dealerHeadTiltFactor = -easeT * 0.22;
              }

              gunGroup.updateMatrixWorld(true);
              const cylinderRimWorld = new THREE.Vector3(-0.12, 0.14, -0.24).applyMatrix4(gunGroup.matrixWorld);
              const arcP = new THREE.Vector3().lerpVectors(startPos, cylinderRimWorld, easeT);
              arcP.y += Math.sin(t * Math.PI) * 0.12;
              ar.activeItemAnimGroup.position.copy(arcP);
              const startQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0));
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(startQ, pliersGripQuat, easeT);
            } else if (elapsedSec < 2.65) {
              const p2 = (elapsedSec - 1.05) / 1.60; // 0 -> 1
              const squeezeT = Math.min(1, p2 / 0.38);
              const pullT = Math.max(0, Math.min(1, (p2 - 0.38) / 0.32));
              const yankImpulse = pullT > 0 ? Math.sin(pullT * Math.PI) : 0;

              cylinderLatchMesh.position.z = -0.265;
              cylinderSwingGroup.rotation.z = 0.85;

              if (squeezeT >= 0.85 && !ar.hasPlayedPliersGrip) {
                ar.hasPlayedPliersGrip = true;
                playPliersGripSound();
                vibrateGamepad('click', { duration: 40, weak: 0.45, strong: 0.2 });
              }

              if (isPlayer) {
                const tugGunPos = inspectGunPos.clone().addScaledVector(rgt, 0.03 * yankImpulse);
                gunGroup.position.lerp(tugGunPos, damp(0.26));
                gunGroup.quaternion.slerp(inspectGunQuat, damp(0.26));
                ar.actionCamOffset.lerp(
                  fwd.clone().multiplyScalar(0.16 - 0.05 * yankImpulse).addScaledVector(up, -0.05),
                  damp(0.18)
                );
              } else {
                ar.dealerHeadTiltFactor = -0.22 + pullT * 0.35;
                ar.dealerMouthOpenFactor = 0.14;
              }

              gunGroup.updateMatrixWorld(true);
              const cylinderRimWorld = new THREE.Vector3(-0.12, 0.14, -0.24).applyMatrix4(gunGroup.matrixWorld);

              const gripPos = cylinderRimWorld.clone()
                .addScaledVector(rgt, (isPlayer ? 0.22 : -0.18) * pullT)
                .addScaledVector(up, 0.08 * pullT);
              gripPos.x += Math.sin(time * 28) * 0.004 * (1 - pullT);
              ar.activeItemAnimGroup.position.copy(gripPos);
              ar.activeItemAnimGroup.quaternion.copy(pliersGripQuat);

              // Squeeze jaws tightly onto rim
              ar.activeItemAnimGroup.children.forEach(child => {
                if (child.position.x < 0) child.rotation.z = Math.max(0.06, 0.35 - squeezeT * 0.30);
                if (child.position.x > 0) child.rotation.z = Math.min(-0.06, -0.35 + squeezeT * 0.30);
              });

              // Ejection moment when yank peaks
              if (p2 >= 0.42 && !ar.hasEjectedPliers) {
                ar.hasEjectedPliers = true;
                if (chamberCartridges[targetCartIdx]) {
                  chamberCartridges[targetCartIdx].visible = false;
                }
                playPliersSound();
                vibrateGamepad('rumble', { duration: 140, weak: 0.9, strong: 0.35 });
                spawnParticles(cylinderRimWorld, 0xdd8833, 10, 0.09, 0.002, 'SPARK');

                const brassGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8);
                const brassMatOnEject = new THREE.MeshStandardMaterial({ color: 0xcca300, metalness: 0.9, roughness: 0.2 });
                const brassC = new THREE.Mesh(brassGeo, brassMatOnEject);
                brassC.position.copy(cylinderRimWorld);
                scene.add(brassC);

                const ejectVelocity = new THREE.Vector3(
                  (isPlayer ? 0.14 : -0.14) + (Math.random() - 0.5) * 0.05,
                  0.10 + Math.random() * 0.06,
                  (isPlayer ? -0.06 : 0.06) + (Math.random() - 0.5) * 0.04
                );

                activeParticles.push({
                  mesh: brassC,
                  velocity: ejectVelocity,
                  rotVelocity: new THREE.Vector3(0.32, 0.25, 0.40),
                  life: 0,
                  maxLife: 130,
                  gravity: 0.004,
                  hasLanded: false,
                  type: 'SHELL',
                  bounceCount: 0
                });
              }
            } else if (elapsedSec < 3.55) {
              const retT = (elapsedSec - 2.65) / 0.90;
              const easeR = retT * retT;
              const prevSwing = cylinderSwingGroup.rotation.z;
              const closeT = Math.min(1, retT / 0.55);
              cylinderSwingGroup.rotation.z = 0.85 * (1 - closeT * closeT);
              cylinderLatchMesh.position.z = THREE.MathUtils.lerp(-0.265, -0.315, closeT);
              if (prevSwing > 0.04 && cylinderSwingGroup.rotation.z <= 0.04 && !ar.hasPlayedPliersClose) {
                ar.hasPlayedPliersClose = true;
                playCylinderLatchSound('close');
                vibrateGamepad('click', { duration: 45, weak: 0.4, strong: 0.25 });
              }

              gunGroup.updateMatrixWorld(true);
              const cylinderRimWorld = new THREE.Vector3(-0.12, 0.14, -0.24).applyMatrix4(gunGroup.matrixWorld);
              ar.activeItemAnimGroup.position.lerpVectors(cylinderRimWorld.clone().addScaledVector(rgt, 0.20), startPos, easeR);
              if (isPlayer) {
                gunGroup.position.lerp(new THREE.Vector3().lerpVectors(inspectGunPos, initialGunPos, easeR), damp(0.22));
                gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(inspectGunQuat, initialGunQuat, easeR), damp(0.22));
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
              }
            } else {
              cylinderSwingGroup.rotation.z = 0;
              cylinderLatchMesh.position.z = -0.315;
              hammerPivotGroup.rotation.x = 0;
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'WHISKEY': {
            const isPlayer = ar.activeItemAnimUser === 'player';
            const dealerMouthWorld = new THREE.Vector3(0, 2.12, -2.64);
            if (!isPlayer) {
              dealerMouthGroup.updateWorldMatrix(true, false);
              dealerMouthGroup.getWorldPosition(dealerMouthWorld);
              dealerMouthWorld.y -= 0.03;
              dealerMouthWorld.z += 0.06;
            }
            const lipsPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 0.64).addScaledVector(up, -0.145).addScaledVector(rgt, 0.032)
              : dealerMouthWorld;
            const localSpout = new THREE.Vector3(0, 0.46, 0);

            let liquidMesh: THREE.Mesh | null = null;
            let meniscusMesh: THREE.Mesh | null = null;
            let corkMesh: THREE.Mesh | null = null;
            ar.activeItemAnimGroup.traverse((child) => {
              if (child.name === 'whiskeyLiquidMesh') liquidMesh = child as THREE.Mesh;
              if (child.name === 'whiskeyMeniscus') meniscusMesh = child as THREE.Mesh;
              if (child.name === 'whiskeyCork') corkMesh = child as THREE.Mesh;
            });

            const dt = Math.min(0.033, Math.max(0.005, deltaScale / 60.0));
            const currentPos = ar.activeItemAnimGroup.position;
            const linVel = currentPos.clone().sub(ar.prevItemPos).divideScalar(dt);
            ar.prevItemPos.copy(currentPos);

            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            if (elapsedSec < 0.95) {
              const t = elapsedSec / 0.95;
              const easeT = 1 - Math.pow(1 - t, 3);
              ar.activeItemAnimGroup.rotation.set((isPlayer ? 0.35 : -0.45) * easeT, 0, (isPlayer ? 0.12 : -0.12) * easeT);

              const targetSpoutOffset = localSpout.clone().applyEuler(ar.activeItemAnimGroup.rotation);
              const targetGroupPos = lipsPos.clone().sub(targetSpoutOffset).addScaledVector(up, -0.05);
              const arcP = new THREE.Vector3().lerpVectors(startPos, targetGroupPos, easeT);
              arcP.y += Math.sin(t * Math.PI) * 0.08;
              ar.activeItemAnimGroup.position.copy(arcP);

              if (!isPlayer) {
                ar.dealerMouthOpenFactor = easeT * 0.45;
                ar.dealerHeadTiltFactor = easeT * 0.25;
              }
            } else if (elapsedSec < 3.05) {
              // Pop cork crisply right as bottle reaches mouth
              if (corkMesh && corkMesh.visible) {
                corkMesh.visible = false;
                playTapSound();
                const corkWorldPos = new THREE.Vector3(0, 0.46, 0).applyMatrix4(ar.activeItemAnimGroup.matrixWorld);
                spawnParticles(corkWorldPos, 0x8b5a2b, 1, 0.15, 0.003, 'SHELL');
              }

              if (elapsedSec >= 1.05 && !ar.hasPlayedWhiskeySound) {
                ar.hasPlayedWhiskeySound = true;
                playWhiskeyDrink();
                vibrateGamepad('weak', { duration: 160 });
              }

              const tiltT = Math.min(1.0, (elapsedSec - 0.95) / 0.65);
              const gulpBob = Math.sin((elapsedSec - 0.95) * 9.5) * 0.035;
              const rotX = isPlayer
                ? (0.35 + tiltT * Math.PI * 0.46 + gulpBob)
                : (-0.45 - tiltT * Math.PI * 0.48 - gulpBob);

              ar.activeItemAnimGroup.rotation.set(
                rotX,
                0,
                tiltT * (isPlayer ? 0.28 : -0.28)
              );

              const currentSpoutOffset = localSpout.clone().applyEuler(ar.activeItemAnimGroup.rotation);
              ar.activeItemAnimGroup.position.copy(lipsPos).sub(currentSpoutOffset);

              if (isPlayer) {
                // Realistic head tilt upward & gentle gulp cadence
                ar.actionLookOffset.lerp(new THREE.Vector3(0, 0.24 * tiltT + gulpBob * 0.4, 0), damp(0.14));
                ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(-0.04 * tiltT).addScaledVector(up, 0.03 * tiltT), damp(0.14));
              } else {
                ar.dealerMouthOpenFactor = 0.92;
                ar.dealerHeadTiltFactor = 0.85 + tiltT * 0.2;
              }
            } else if (elapsedSec < 3.60) {
              const lowerT = (elapsedSec - 3.05) / 0.55;
              const easeL = lowerT * lowerT;
              ar.activeItemAnimGroup.rotation.set((isPlayer ? Math.PI * 0.48 : -Math.PI * 0.48) * (1 - easeL * 0.6), 0, 0);
              const currentSpoutOffset = localSpout.clone().applyEuler(ar.activeItemAnimGroup.rotation);
              const loweredGoal = lipsPos.clone().sub(currentSpoutOffset).add(new THREE.Vector3(isPlayer ? 0.25 : -0.25, -0.22, 0));
              ar.activeItemAnimGroup.position.lerp(loweredGoal, damp(0.25));
              if (isPlayer) {
                ar.actionLookOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.16));
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.16));
              }
            } else {
              ar.actionLookOffset.set(0, 0, 0);
              ar.actionCamOffset.set(0, 0, 0);
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
              break;
            }

            // --- FULL FLUID PHYSICS ENGINE FOR WHISKEY BOTTLE ---
            const invQuat = ar.activeItemAnimGroup.quaternion.clone().invert();
            const localGravity = new THREE.Vector3(0, -1, 0).applyQuaternion(invQuat);
            const targetSloshX = -Math.atan2(localGravity.z, -localGravity.y);
            const targetSloshZ = Math.atan2(localGravity.x, -localGravity.y);
            const inertiaForceX = -linVel.z * 0.14;
            const inertiaForceZ = linVel.x * 0.14;
            const springK = 42.0;
            const dampK = 6.2;

            const accelX = springK * (targetSloshX - ar.whiskeySloshAngleX) - dampK * ar.whiskeySloshVelX + inertiaForceX;
            const accelZ = springK * (targetSloshZ - ar.whiskeySloshAngleZ) - dampK * ar.whiskeySloshVelZ + inertiaForceZ;

            ar.whiskeySloshVelX += accelX * dt;
            ar.whiskeySloshVelZ += accelZ * dt;
            ar.whiskeySloshAngleX += ar.whiskeySloshVelX * dt;
            ar.whiskeySloshAngleZ += ar.whiskeySloshVelZ * dt;

            if (elapsedSec >= 1.0 && ar.whiskeyVolume > 0.001) {
              const drinkProgress = Math.min(1.0, (elapsedSec - 1.0) / 1.95);
              ar.whiskeyVolume = Math.max(0.001, 1.0 - drinkProgress);

              if (drinkProgress < 0.96 && Math.random() < 0.72) {
                const spoutWorldPos = localSpout.clone().applyMatrix4(ar.activeItemAnimGroup.matrixWorld);
                spawnParticles(spoutWorldPos, 0x8c3409, 2, 0.035, 0.003, 'LIQUID');
              }
            }

            if (liquidMesh && meniscusMesh) {
              const vol = ar.whiskeyVolume;
              if (vol <= 0.005) {
                liquidMesh.visible = false;
                meniscusMesh.visible = false;
              } else {
                liquidMesh.visible = true;
                meniscusMesh.visible = true;

                const invertedFactor = Math.max(0, localGravity.y + 1.0) / 2.0;
                const baseMinY = 0.015;
                const baseMaxY = 0.35 - 0.28 * vol;
                const liquidBaseY = THREE.MathUtils.lerp(baseMinY, baseMaxY, Math.pow(invertedFactor, 1.2));

                liquidMesh.position.y = liquidBaseY;
                liquidMesh.scale.y = Math.max(0.001, vol);
                liquidMesh.scale.x = 1.0;
                liquidMesh.scale.z = 1.0;
                liquidMesh.rotation.set(0, 0, 0);

                const topY = liquidBaseY + 0.28 * vol;
                meniscusMesh.position.y = topY;

                const sloshX = THREE.MathUtils.clamp(ar.whiskeySloshAngleX, -0.28, 0.28);
                const sloshZ = THREE.MathUtils.clamp(ar.whiskeySloshAngleZ, -0.28, 0.28);

                meniscusMesh.rotation.x = -Math.PI / 2 + sloshX;
                meniscusMesh.rotation.z = sloshZ;

                const scaleFactorX = Math.max(0.80, Math.cos(sloshZ));
                const scaleFactorZ = Math.max(0.80, Math.cos(sloshX));
                meniscusMesh.scale.set(scaleFactorX, scaleFactorZ, 1.0);
              }
            }
            break;
          }
          case 'TOURNIQUET': {
            const isPlayer = ar.activeItemAnimUser === 'player';
            const armPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 0.72).addScaledVector(up, -0.22).addScaledVector(rgt, -0.10)
              : new THREE.Vector3(-0.22, 1.65, -2.0);
            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            if (elapsedSec >= 0.65 && !ar.hasPlayedTourniquetSound) {
              ar.hasPlayedTourniquetSound = true;
              playTourniquetTighten();
              vibrateGamepad('weak', { duration: 240, weak: 0.65, strong: 0.4 });
            }

            if (elapsedSec < 0.85) {
              const t = elapsedSec / 0.85;
              const easeT = 1 - Math.pow(1 - t, 3);
              const arcP = new THREE.Vector3().lerpVectors(startPos, armPos, easeT);
              arcP.y += Math.sin(t * Math.PI) * 0.08;
              ar.activeItemAnimGroup.position.copy(arcP);
              ar.activeItemAnimGroup.rotation.set(isPlayer ? 0.55 : 0.2, t * 1.4, isPlayer ? 0.45 : 0);
            } else if (elapsedSec < 2.95) {
              const cinchT = (elapsedSec - 0.85) / 2.10;
              // Two crisp manual tightening tugs across forearm
              const tug1 = Math.sin(Math.min(1, cinchT * 2.2) * Math.PI);
              const tug2 = cinchT > 0.45 ? Math.sin(Math.min(1, (cinchT - 0.45) * 2.2) * Math.PI) : 0;
              const squeeze = 1.0 - (tug1 * 0.14 + tug2 * 0.18);

              ar.activeItemAnimGroup.position.copy(armPos);
              ar.activeItemAnimGroup.position.x -= (tug1 + tug2) * 0.025;
              ar.activeItemAnimGroup.scale.set(squeeze, 1.0, squeeze);
              ar.activeItemAnimGroup.rotation.set(isPlayer ? 0.55 : 0.2, 1.4 + cinchT * 0.8, (isPlayer ? 0.45 : 0) + (tug1 + tug2) * 0.12);

              if (isPlayer) {
                ar.actionCamOffset.lerp(
                  up.clone().multiplyScalar(-0.02 * (tug1 + tug2)).addScaledVector(fwd, -0.02 * (tug1 + tug2)),
                  damp(0.16)
                );
              } else {
                ar.dealerHeadTiltFactor = -0.18;
              }
              if ((tug1 > 0.7 || tug2 > 0.7) && Math.random() < 0.28) {
                const targetWorldPos = new THREE.Vector3();
                ar.activeItemAnimGroup.getWorldPosition(targetWorldPos);
                spawnParticles(targetWorldPos, 0xffaa00, 2, 0.06, 0.001, 'SPARK');
              }
            } else if (elapsedSec < 3.55) {
              ar.activeItemAnimGroup.scale.set(0.86, 1.0, 0.86);
              const retT = (elapsedSec - 2.95) / 0.60;
              ar.activeItemAnimGroup.position.lerpVectors(armPos, startPos, retT * retT);
              if (isPlayer) ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.16));
            } else {
              ar.activeItemAnimGroup.scale.set(1, 1, 1);
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'PENTAGRAM': {
            const isPlayer = ar.activeItemAnimUser === 'player';
            const closeInspectPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 0.95).addScaledVector(up, -0.06)
              : new THREE.Vector3(0, 1.65, -2.0);
            const ritualPos = new THREE.Vector3(0, 1.45, -0.6);
            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            if (elapsedSec >= 0.45 && !ar.hasPlayedPentagramSound) {
              ar.hasPlayedPentagramSound = true;
              playPentagramChant();
              vibrateGamepad('rumble', { duration: 420, weak: 0.85, strong: 0.85 });
            }

            if (elapsedSec < 0.85) {
              // Hold close before eyes / hand first, then thrust outward to center table
              const t = elapsedSec / 0.85;
              const easeT = 1 - Math.pow(1 - t, 3);
              ar.activeItemAnimGroup.position.lerpVectors(startPos, closeInspectPos, easeT);
              ar.activeItemAnimGroup.rotation.set(isPlayer ? -0.25 : 0.25, t * 1.8, 0);
            } else if (elapsedSec < 1.35) {
              const thrustT = (elapsedSec - 0.85) / 0.50;
              const easeTh = 1 - Math.pow(1 - thrustT, 3);
              ar.activeItemAnimGroup.position.lerpVectors(closeInspectPos, ritualPos, easeTh);
              ar.activeItemAnimGroup.rotation.set(0, 1.8 + thrustT * 6, 0);
            } else if (elapsedSec < 3.45) {
              ar.activeItemAnimGroup.rotation.y = time * 35;
              ar.activeItemAnimGroup.position.set(0, 1.45 + Math.sin(time * 18) * 0.04, -0.6);

              if (Math.random() < 0.38) {
                for (let i = 0; i < 5; i++) {
                  const angle = (i / 5) * Math.PI * 2;
                  const px = Math.cos(angle) * 1.5;
                  const pz = Math.sin(angle) * 1.5 - 0.6;
                  spawnParticles(new THREE.Vector3(px, 0.45, pz), 0x330808, 2, 0.03, -0.0012, 'SMOKE');
                }
              }
            } else {
              const targetWorldPos = new THREE.Vector3();
              ar.activeItemAnimGroup.getWorldPosition(targetWorldPos);
              spawnParticles(targetWorldPos, 0xff3333, 40, 0.35, 0.001, 'SPARK');
              spawnParticles(targetWorldPos, 0x3a0808, 18, 0.08, -0.001, 'SMOKE');

              if (ar.activeItemAnimGroup.parent) ar.activeItemAnimGroup.parent.remove(ar.activeItemAnimGroup);
              disposeNode(ar.activeItemAnimGroup);
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'CIGARETTE': {
            const isPlayerUser = ar.activeItemAnimUser === 'player';

            // Compute camera & world lip anchors dynamically
            const baseCam = stateRef.current.camPosVec || new THREE.Vector3(0, 3.4, 5.5);
            const baseLook = stateRef.current.lookTargetVec || new THREE.Vector3(0, 0.6, -1);
            const camForward = baseLook.clone().sub(baseCam).normalize();
            const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
            const camUp = new THREE.Vector3().crossVectors(camRight, camForward).normalize();

            const lipsAnchor = new THREE.Vector3();
            const cigDir = new THREE.Vector3();
            const exhaleDir = new THREE.Vector3();
            const lowerRestPos = new THREE.Vector3();
            const lowerRestDir = new THREE.Vector3();

            if (isPlayerUser) {
              // First-person mouth corner: sits naturally in lower-right foreground well past near=0.1
              lipsAnchor.copy(baseCam)
                .addScaledVector(camForward, 0.56)
                .addScaledVector(camUp, -0.145)
                .addScaledVector(camRight, 0.052);
              cigDir.copy(camForward).multiplyScalar(0.84)
                .addScaledVector(camRight, 0.44)
                .addScaledVector(camUp, -0.26)
                .normalize();
              exhaleDir.copy(camForward).multiplyScalar(0.85)
                .addScaledVector(camUp, 0.24)
                .addScaledVector(camRight, 0.06)
                .normalize();
              lowerRestPos.copy(lipsAnchor)
                .addScaledVector(camUp, -0.17)
                .addScaledVector(camRight, 0.14)
                .addScaledVector(camForward, 0.06);
              lowerRestDir.copy(camForward).multiplyScalar(0.65)
                .addScaledVector(camRight, 0.62)
                .addScaledVector(camUp, 0.32)
                .normalize();
            } else {
              // Dynamic world tracking of the Dealer's segmented mask mouth
              dealerMouthGroup.updateWorldMatrix(true, false);
              dealerMouthGroup.getWorldPosition(lipsAnchor);
              lipsAnchor.x += 0.032;
              lipsAnchor.y -= 0.010;
              lipsAnchor.z += 0.025;
              cigDir.set(0.28, -0.22, 0.93).normalize();
              exhaleDir.set(0.05, 0.26, 0.96).normalize();
              lowerRestPos.copy(lipsAnchor).add(new THREE.Vector3(0.22, -0.34, 0.16));
              lowerRestDir.set(0.45, 0.32, 0.83).normalize();
            }

            const cigGroupInner = ar.activeItemAnimGroup.getObjectByName('cigGroupInner');
            const cigPaper = ar.activeItemAnimGroup.getObjectByName('cigPaper') as THREE.Mesh | undefined;
            const cigTobacco = ar.activeItemAnimGroup.getObjectByName('cigTobacco');
            const cigCharRing = ar.activeItemAnimGroup.getObjectByName('cigCharRing');
            const cigAshTip = ar.activeItemAnimGroup.getObjectByName('cigAshTip');
            const emberTip = ar.activeItemAnimGroup.getObjectByName('emberTip') as THREE.Mesh | undefined;
            const tableZippo = ar.activeItemAnimGroup.getObjectByName('tableZippoGroup');
            if (tableZippo) tableZippo.visible = false;

            let zippoGroup = ar.activeZippoGroup;
            if (!zippoGroup) {
              zippoGroup = createZippoMesh();
              zippoGroup.name = 'activeHandZippo';
              scene.add(zippoGroup);
              ar.activeZippoGroup = zippoGroup;
            }
            const zippoCap = zippoGroup.getObjectByName('zippoCap');
            const zippoCamLever = zippoGroup.getObjectByName('zippoCamLever');
            const zippoFlintWheel = zippoGroup.getObjectByName('zippoFlintWheel');
            const zippoFlame = zippoGroup.getObjectByName('zippoFlame');

            const startPos = isPlayerUser
              ? baseCam.clone().addScaledVector(camForward, 0.65).addScaledVector(camUp, -0.42).addScaledVector(camRight, 0.34)
              : new THREE.Vector3(-0.55, 1.45, -1.95);

            // Progressive burn state (0 = pristine 172mm paper, 0.26 = smoked down during inhale)
            let burnProgress = 0;
            if (elapsedSec >= 1.35 && elapsedSec < 2.38) {
              burnProgress = THREE.MathUtils.clamp((elapsedSec - 1.35) / 1.03, 0, 1) * 0.045;
            } else if (elapsedSec >= 2.38 && elapsedSec < 3.35) {
              burnProgress = 0.045 + THREE.MathUtils.clamp((elapsedSec - 2.38) / 0.97, 0, 1) * 0.215;
            } else if (elapsedSec >= 3.35) {
              burnProgress = 0.26;
            }

            const burnFrontLocalY = 0.071 + 0.172 * (1 - burnProgress);
            if (cigPaper) cigPaper.scale.y = Math.max(0.15, 1 - burnProgress);
            if (cigCharRing) cigCharRing.position.y = burnFrontLocalY - 0.002;
            if (emberTip) emberTip.position.y = burnFrontLocalY + 0.003;
            if (cigAshTip) {
              cigAshTip.position.y = burnFrontLocalY + 0.004;
              const ashGrowth = Math.max(0.05, Math.min(1.0, (burnProgress - 0.02) * 4.2));
              const shedMult = ar.hasShedCigAsh ? 0.35 : 1.0;
              cigAshTip.scale.set(1, ashGrowth * shedMult, 1);
            }

            const upVec = new THREE.Vector3(0, 1, 0);
            const targetQuat = new THREE.Quaternion().setFromUnitVectors(upVec, cigDir);
            const restQuat = new THREE.Quaternion().setFromUnitVectors(upVec, lowerRestDir);

            // Zippo flame target position in world space (kisses underneath the cigarette tip)
            const curTipDist = burnFrontLocalY + 0.006;
            const cigTipPos = lipsAnchor.clone().addScaledVector(cigDir, curTipDist);
            const zippoLitPos = cigTipPos.clone()
              .addScaledVector(camRight, isPlayerUser ? 0.014 : -0.016)
              .add(new THREE.Vector3(0, -0.192, isPlayerUser ? 0.012 : -0.012));
            const zippoHiddenPos = zippoLitPos.clone()
              .add(new THREE.Vector3(isPlayerUser ? -0.14 : -0.12, -0.36, isPlayerUser ? 0.10 : 0.12));

            const zippoBaseEuler = isPlayerUser
              ? new THREE.Euler(0.18, -0.38, 0.16)
              : new THREE.Euler(-0.14, Math.PI + 0.38, -0.16);

            // Default subtle micro-sway on held cigarette
            const swayX = Math.sin(time * 2.3) * 0.0018;
            const swayY = Math.cos(time * 1.9) * 0.0016;

            if (elapsedSec < 0.58) {
              // Phase 1: Curved pickup arc from resting hand to mouth corner
              const t = elapsedSec / 0.58;
              const easeT = 1 - Math.pow(1 - t, 3);
              const arcPos = new THREE.Vector3().lerpVectors(startPos, lipsAnchor, easeT);
              arcPos.y += Math.sin(t * Math.PI) * 0.08;

              ar.activeItemAnimGroup.position.copy(arcPos);
              const startQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, isPlayerUser ? 0.45 : -0.45));
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(startQuat, targetQuat, easeT);

              if (cigGroupInner) {
                cigGroupInner.rotation.z = (Math.PI / 2) * (1 - easeT);
                cigGroupInner.position.y = 0.02 * (1 - easeT);
              }
              if (cigTobacco) cigTobacco.visible = true;
              if (cigCharRing) cigCharRing.visible = false;
              if (cigAshTip) cigAshTip.visible = false;
              if (emberTip) {
                emberTip.visible = false;
                if (emberTip.material instanceof THREE.MeshStandardMaterial) emberTip.material.emissiveIntensity = 0;
              }

              zippoGroup.visible = false;
              zippoFlameLight.intensity = 0;

              if (!isPlayerUser) {
                ar.dealerMouthOpenFactor = easeT * 0.34;
                ar.dealerHeadTiltFactor = -easeT * 0.16;
              }
            } else if (elapsedSec < 1.02) {
              // Phase 2: Zippo rises cleanly and snaps open with hinged lid spring bounce
              ar.activeItemAnimGroup.position.copy(lipsAnchor);
              ar.activeItemAnimGroup.position.x += swayX;
              ar.activeItemAnimGroup.position.y += swayY;
              ar.activeItemAnimGroup.quaternion.copy(targetQuat);
              if (cigGroupInner) {
                cigGroupInner.rotation.z = 0;
                cigGroupInner.position.y = 0;
              }

              const p2 = (elapsedSec - 0.58) / 0.44;
              const riseT = Math.min(1, p2 / 0.48);
              const easeRise = 1 - Math.pow(1 - riseT, 3);

              zippoGroup.visible = true;
              zippoGroup.position.lerpVectors(zippoHiddenPos, zippoLitPos, easeRise);
              zippoGroup.rotation.copy(zippoBaseEuler);

              if (p2 >= 0.34) {
                if (!ar.hasOpenedZippo) {
                  ar.hasOpenedZippo = true;
                  playZippoOpen();
                  vibrateGamepad('weak', { duration: 40, weak: 0.35, strong: 0.15 });
                }
                const lidT = Math.min(1, (p2 - 0.34) / 0.46);
                const overshoot = Math.exp(-lidT * 7.5) * Math.sin(lidT * 18.0) * 0.18;
                const lidAngle = -Math.PI * 0.74 * Math.min(1, lidT * 1.45) - overshoot * Math.min(1, lidT * 3);
                if (zippoCap) zippoCap.rotation.z = lidAngle;
                if (zippoCamLever) zippoCamLever.rotation.z = -0.35 * Math.min(1, lidT * 2);
              } else {
                if (zippoCap) zippoCap.rotation.z = 0;
                if (zippoCamLever) zippoCamLever.rotation.z = 0;
              }
              if (zippoFlame) zippoFlame.visible = false;
              zippoFlameLight.intensity = 0;

              if (!isPlayerUser) {
                ar.dealerMouthOpenFactor = 0.34;
                ar.dealerHeadTiltFactor = -0.18;
              }
            } else if (elapsedSec < 1.88) {
              // Phase 3: Flint strike sparks, flame bloom, airflow suction bend & 2 primer puffs
              const p3 = elapsedSec - 1.02; // 0 -> 0.86s
              ar.activeItemAnimGroup.position.copy(lipsAnchor);
              ar.activeItemAnimGroup.position.x += swayX;
              ar.activeItemAnimGroup.position.y += swayY;
              ar.activeItemAnimGroup.quaternion.copy(targetQuat);

              zippoGroup.visible = true;
              zippoGroup.position.copy(zippoLitPos);
              zippoGroup.rotation.copy(zippoBaseEuler);
              if (zippoCap) zippoCap.rotation.z = -Math.PI * 0.74;
              if (zippoCamLever) zippoCamLever.rotation.z = -0.35;

              if (!ar.hasStruckZippo) {
                ar.hasStruckZippo = true;
                playZippoStrike();
                vibrateGamepad('weak', { duration: 95, weak: 0.55, strong: 0.2 });
              }

              // Rapid flint wheel strike rotation & directional tangential sparks
              if (p3 < 0.22) {
                if (zippoFlintWheel) zippoFlintWheel.rotation.y -= deltaScale * 0.9;
                if (zippoFlintWheel && Math.random() < 0.9) {
                  const wheelWorld = new THREE.Vector3();
                  zippoFlintWheel.getWorldPosition(wheelWorld);
                  const sparkDir = cigDir.clone().multiplyScalar(0.6).add(new THREE.Vector3(isPlayerUser ? 0.35 : -0.35, 0.45, 0)).normalize();
                  spawnParticles(wheelWorld, 0xffbb33, 5, 0.085, 0.0025, 'SPARK', sparkDir);
                }
              }

              // Flame ignition + primer puff airflow suction bend
              const flameActive = p3 >= 0.10;
              const bloomT = flameActive ? Math.min(1, (p3 - 0.10) / 0.09) : 0;
              const puffFactor = p3 >= 0.20 ? Math.pow(Math.max(0, Math.sin(((p3 - 0.20) / 0.66) * Math.PI * 2)), 2) : 0;

              if (zippoFlame) {
                zippoFlame.visible = flameActive;
                const flicker = 0.88 + Math.sin(elapsedSec * 44.0) * 0.12 + Math.cos(elapsedSec * 29.0) * 0.08;
                const suctionStretch = 1.0 + puffFactor * 0.28;
                zippoFlame.scale.set(
                  bloomT * flicker * (1.0 - puffFactor * 0.12),
                  bloomT * flicker * suctionStretch,
                  bloomT * flicker
                );
                // Bend flame tip horizontally toward the glowing tobacco during primer puffs
                zippoFlame.rotation.set(puffFactor * (isPlayerUser ? -0.32 : 0.32), 0, puffFactor * (isPlayerUser ? -0.25 : 0.25));
                zippoFlame.getWorldPosition(zippoFlameLight.position);
                zippoFlameLight.intensity = 2.6 * bloomT * flicker * (1.0 + puffFactor * 0.25);
              }

              // Tobacco chars & ember catches warm orange glow on primer puffs
              if (p3 >= 0.22) {
                if (!ar.hasLitCigarette) {
                  ar.hasLitCigarette = true;
                }
                if (cigTobacco) cigTobacco.visible = false;
                if (cigCharRing) cigCharRing.visible = true;
                if (emberTip) {
                  emberTip.visible = true;
                  if (emberTip.material instanceof THREE.MeshStandardMaterial) {
                    const catchT = Math.min(1, (p3 - 0.22) / 0.64);
                    emberTip.material.emissiveIntensity = catchT * 1.4 + puffFactor * 3.1 + Math.sin(elapsedSec * 26) * 0.3;
                  }
                }
                if (Math.random() < 0.22) {
                  spawnParticles(cigTipPos, 0x9aa8b8, 1, 0.012, -0.0005, 'SMOKE', new THREE.Vector3(0, 0.35, 0));
                }
              }

              if (isPlayerUser) {
                const lean = Math.sin(Math.min(1, p3 / 0.86) * Math.PI);
                ar.actionCamOffset.lerp(new THREE.Vector3(0, -0.022 * lean, -0.042 * lean), damp(0.18));
                ar.actionLookOffset.lerp(new THREE.Vector3(0, -0.018 * lean, 0), damp(0.18));
              } else {
                ar.dealerMouthOpenFactor = 0.24 - puffFactor * 0.10;
                ar.dealerHeadTiltFactor = -0.22 - puffFactor * 0.06;
              }
            } else if (elapsedSec < 2.38) {
              // Phase 4: Snap Zippo lid shut, extinguish flame, lower lighter smoothly
              const p4 = (elapsedSec - 1.88) / 0.50;
              ar.activeItemAnimGroup.position.copy(lipsAnchor);
              ar.activeItemAnimGroup.position.x += swayX;
              ar.activeItemAnimGroup.position.y += swayY;
              ar.activeItemAnimGroup.quaternion.copy(targetQuat);

              const closeT = Math.min(1, p4 / 0.24);
              if (zippoCap) zippoCap.rotation.z = -Math.PI * 0.74 * (1 - closeT);
              if (zippoCamLever) zippoCamLever.rotation.z = -0.35 * (1 - closeT);
              if (p4 >= 0.22 && !ar.hasClosedZippo) {
                ar.hasClosedZippo = true;
                playZippoClose();
                vibrateGamepad('weak', { duration: 35, weak: 0.3, strong: 0.15 });
              }

              if (zippoFlame) zippoFlame.visible = false;
              const lowerT = Math.max(0, (p4 - 0.18) / 0.82);
              const easeLower = lowerT * lowerT;
              zippoGroup.position.lerpVectors(zippoLitPos, zippoHiddenPos, easeLower);
              zippoGroup.rotation.copy(zippoBaseEuler);
              zippoGroup.visible = lowerT < 0.96;

              // Subtle lingering ember glow at tip
              zippoFlameLight.position.copy(cigTipPos);
              zippoFlameLight.intensity = 0.32;
              if (emberTip && emberTip.material instanceof THREE.MeshStandardMaterial) {
                emberTip.material.emissiveIntensity = 1.6 + Math.sin(elapsedSec * 14) * 0.2;
              }

              if (isPlayerUser) {
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
                ar.actionLookOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
              } else {
                ar.dealerMouthOpenFactor = 0.22;
                ar.dealerHeadTiltFactor = THREE.MathUtils.lerp(-0.18, 0.12, p4);
              }
            } else if (elapsedSec < 3.35) {
              // Phase 5: Deep calm inhale drag — cherry flares hot, paper burns back, lung lift
              const dragT = (elapsedSec - 2.38) / 0.97;
              const dragBell = Math.sin(dragT * Math.PI);

              zippoGroup.visible = false;
              if (zippoFlame) zippoFlame.visible = false;

              if (!ar.hasDraggedCigarette) {
                ar.hasDraggedCigarette = true;
                playCigaretteDrag();
                vibrateGamepad('weak', { duration: 220, weak: 0.22, strong: 0.05 });
              }

              ar.activeItemAnimGroup.position.copy(lipsAnchor);
              ar.activeItemAnimGroup.position.addScaledVector(cigDir, -0.014 * dragBell);
              ar.activeItemAnimGroup.position.x += swayX * 0.6;
              ar.activeItemAnimGroup.position.y += swayY * 0.6;
              ar.activeItemAnimGroup.quaternion.copy(targetQuat);

              if (cigAshTip) cigAshTip.visible = true;
              if (emberTip && emberTip.material instanceof THREE.MeshStandardMaterial) {
                emberTip.material.emissiveIntensity = 1.6 + dragBell * 5.2 + Math.sin(elapsedSec * 24) * 0.35;
              }

              zippoFlameLight.position.copy(cigTipPos);
              zippoFlameLight.intensity = 0.35 + dragBell * 0.95;

              // Delicate curling sidestream smoke rising from hot cherry
              if (Math.random() < 0.30) {
                spawnParticles(cigTipPos, 0x9aaab8, 1, 0.014, -0.0005, 'SMOKE', new THREE.Vector3(0, 0.35, 0));
              }

              if (isPlayerUser) {
                // Smooth lung inhale chest rise & slight upward gaze instead of noisy jitter
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0.032 * dragBell, 0.016 * dragBell), damp(0.14));
                ar.actionLookOffset.lerp(new THREE.Vector3(0, 0.025 * dragBell, 0), damp(0.14));
              } else {
                ar.dealerMouthOpenFactor = 0.16;
                ar.dealerHeadTiltFactor = 0.12 + dragT * 0.45;
              }
            } else if (elapsedSec < 4.45) {
              // Phase 6: Lower cigarette in resting arc, tap ash, hold, then exhale directed smoke plume
              const p6 = (elapsedSec - 3.35) / 1.10; // 0 -> 1
              zippoGroup.visible = false;

              const lowerArcT = Math.min(1, p6 / 0.35);
              const easeLowerArc = 1 - Math.pow(1 - lowerArcT, 3);
              const flickDip = p6 >= 0.22 && p6 <= 0.34 ? Math.sin(((p6 - 0.22) / 0.12) * Math.PI) * 0.035 : 0;

              ar.activeItemAnimGroup.position.lerpVectors(lipsAnchor, lowerRestPos, easeLowerArc);
              ar.activeItemAnimGroup.position.y -= flickDip;
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(targetQuat, restQuat, easeLowerArc);

              // Tap off excess ash delicately on finger flick
              if (p6 >= 0.26 && !ar.hasShedCigAsh) {
                ar.hasShedCigAsh = true;
                spawnParticles(cigTipPos, 0x555555, 3, 0.018, 0.003, 'DEBRIS');
              }

              if (emberTip && emberTip.material instanceof THREE.MeshStandardMaterial) {
                emberTip.material.emissiveIntensity = Math.max(0.85, 2.2 * (1 - p6 * 0.6));
              }
              zippoFlameLight.position.copy(cigTipPos);
              zippoFlameLight.intensity = 0.22;

              // Trailing sidestream wisp from lowered cigarette
              if (Math.random() < 0.22) {
                const loweredTip = ar.activeItemAnimGroup.position.clone().addScaledVector(lowerRestDir, curTipDist);
                spawnParticles(loweredTip, 0x9aaab8, 1, 0.012, -0.0005, 'SMOKE', new THREE.Vector3(0, 0.35, 0));
              }

              // Brief calm hold -> Exhale directed smoke stream (0.28 -> 0.88 of phase 6)
              if (p6 >= 0.28) {
                const exhaleT = Math.min(1, (p6 - 0.28) / 0.60);
                const exhaleBell = Math.sin(exhaleT * Math.PI);

                if (!ar.hasExhaledSmoke) {
                  ar.hasExhaledSmoke = true;
                  playSmokeExhale();
                }

                if (!isPlayerUser) {
                  ar.dealerMouthOpenFactor = 0.72 * exhaleBell;
                  ar.dealerHeadTiltFactor = 0.55 + exhaleBell * 0.25;
                } else {
                  ar.actionCamOffset.lerp(new THREE.Vector3(0, -0.012 * exhaleBell, 0), damp(0.12));
                  ar.actionLookOffset.lerp(new THREE.Vector3(0, 0.03 * exhaleBell, 0), damp(0.12));
                }

                if (exhaleT < 0.92 && Math.random() < 0.72) {
                  const mouthEmitOrigin = lipsAnchor.clone().addScaledVector(exhaleDir, 0.04);
                  spawnParticles(mouthEmitOrigin, 0xb8c6d4, 2, 0.042, -0.0007, 'SMOKE', exhaleDir);
                }
              } else {
                if (!isPlayerUser) {
                  ar.dealerMouthOpenFactor = 0.14;
                  ar.dealerHeadTiltFactor = 0.55;
                }
              }
            } else {
              if (ar.activeZippoGroup) {
                if (ar.activeZippoGroup.parent) ar.activeZippoGroup.parent.remove(ar.activeZippoGroup);
                disposeNode(ar.activeZippoGroup);
                ar.activeZippoGroup = null;
              }
              zippoFlameLight.intensity = 0;
              ar.actionCamOffset.set(0, 0, 0);
              ar.actionLookOffset.set(0, 0, 0);
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'SCALPEL': {
            const isPlayer = ar.activeItemAnimUser === 'player';

            const sawGunPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 1.48).addScaledVector(up, -0.34).addScaledVector(rgt, -0.14)
              : initialGunPos.clone();
            const sawGunQuat = isPlayer
              ? makeGunBasisQuat(
                  fwd.clone().multiplyScalar(0.35).addScaledVector(rgt, 0.90).addScaledVector(up, 0.10).normalize(),
                  up.clone().addScaledVector(rgt, -0.25).normalize()
                )
              : new THREE.Quaternion().setFromEuler(initialGunRot);

            gunGroup.updateMatrixWorld(true);
            const barrelCutWorldPos = new THREE.Vector3(0, 0.258, 0.38).applyMatrix4(gunGroup.matrixWorld);
            const approachPos = barrelCutWorldPos.clone().add(
              isPlayer ? up.clone().multiplyScalar(0.18).addScaledVector(rgt, 0.08) : new THREE.Vector3(-0.12, 0.22, -0.15)
            );
            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.65, 0.65, -1.55);

            if (elapsedSec < 0.85) {
              const t = elapsedSec / 0.85;
              const easeT = 1 - Math.pow(1 - t, 3);

              if (isPlayer) {
                gunGroup.position.lerp(new THREE.Vector3().lerpVectors(initialGunPos, sawGunPos, easeT), damp(0.24));
                const restQ = new THREE.Quaternion().setFromEuler(initialGunRot);
                gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(restQ, sawGunQuat, easeT), damp(0.24));
                ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.22 * easeT).addScaledVector(up, -0.07 * easeT), damp(0.14));
              } else {
                ar.dealerHeadTiltFactor = -easeT * 0.25;
              }

              const arcP = new THREE.Vector3().lerpVectors(startPos, approachPos, easeT);
              arcP.y += Math.sin(t * Math.PI) * 0.10;
              ar.activeItemAnimGroup.position.copy(arcP);
              ar.activeItemAnimGroup.rotation.set(
                (isPlayer ? -1.15 : -1.95) * easeT,
                (isPlayer ? 0.45 : -0.45) * easeT,
                (isPlayer ? 1.45 : -1.45) * easeT
              );
            } else if (elapsedSec < 2.55) {
              const sawT = (elapsedSec - 0.85) / 1.70;

              if (!ar.hasPlayedScalpelSawSound) {
                ar.hasPlayedScalpelSawSound = true;
                playScalpelCut();
              }

              if (isPlayer) {
                gunGroup.position.lerp(sawGunPos, damp(0.28));
                gunGroup.quaternion.slerp(sawGunQuat, damp(0.28));
                ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.24).addScaledVector(up, -0.08), damp(0.14));
              } else {
                ar.dealerHeadTiltFactor = -0.25;
                ar.dealerMouthOpenFactor = 0.12;
              }

              const strokeCycles = 4.5;
              const strokePhase = sawT * strokeCycles * Math.PI * 2;
              const strokeOffset = Math.sin(strokePhase) * 0.042;
              const cutDepth = Math.min(0.036, sawT * 0.036);

              const currentBladePos = barrelCutWorldPos.clone();
              currentBladePos.x += (isPlayer ? 1 : -1) * strokeOffset * 0.7;
              currentBladePos.y += -0.012 - cutDepth + Math.abs(Math.sin(strokePhase)) * 0.004;
              currentBladePos.z += (isPlayer ? 1 : -1) * strokeOffset * 0.65;

              ar.activeItemAnimGroup.position.copy(currentBladePos);
              ar.activeItemAnimGroup.rotation.set(
                (isPlayer ? -1.15 : -1.95) + Math.cos(strokePhase) * 0.18,
                (isPlayer ? 0.45 : -0.45) + Math.sin(strokePhase) * 0.08,
                (isPlayer ? 1.45 : -1.45) + Math.sin(strokePhase) * 0.14
              );

              gunGroup.position.x += (Math.random() - 0.5) * 0.003;
              gunGroup.position.y += (Math.random() - 0.5) * 0.002;
              gunGroup.quaternion.multiply(
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 0.008)
              );

              if (Math.random() < 0.48) {
                spawnParticles(currentBladePos, 0xffbb44, 3, 0.085, 0.001, 'SPARK');
              }
              if (Math.random() < 0.24) {
                spawnParticles(currentBladePos, 0x888888, 2, 0.03, -0.001, 'SMOKE');
              }

              if (Math.sin(strokePhase) > 0.85 && Math.random() < 0.3) {
                vibrateGamepad('weak', { duration: 60, weak: 0.5 });
              }

              if (isPlayer) {
                ar.cameraShakeIntensity = 0.26;
                ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, -2.2, 8.0, rawDt);
              }
              cutFaceMat.emissive.setHex(0xff3b00);
              cutFaceMat.emissiveIntensity = Math.min(1.1, sawT * 1.25);
            } else if (elapsedSec < 3.15) {
              if (!ar.hasSpawnedSeveredBarrel) {
                ar.hasSpawnedSeveredBarrel = true;
                ar.isSawedOff = true;

                if (ar.gunBarrelFrontGroup) {
                  ar.gunBarrelFrontGroup.visible = false;
                }

                const severedPiece = createSeveredBarrelPiece();
                severedPiece.position.copy(barrelCutWorldPos);
                severedPiece.quaternion.copy(gunGroup.quaternion);
                scene.add(severedPiece);

                const popDirX = isPlayer ? 0.055 : -0.045;
                const bounceVel = new THREE.Vector3(
                  popDirX + (Math.random() - 0.5) * 0.03,
                  0.08 + Math.random() * 0.035,
                  0.04 + (Math.random() - 0.5) * 0.03
                );
                activeParticles.push({
                  mesh: severedPiece as any,
                  velocity: bounceVel,
                  rotVelocity: new THREE.Vector3(0.22, 0.35, 0.18),
                  life: 0,
                  maxLife: 450,
                  gravity: 0.0036,
                  hasLanded: false,
                  type: 'DEBRIS',
                  bounceCount: 0
                });

                spawnParticles(barrelCutWorldPos, 0xffaa00, 44, 0.19, 0.002, 'SPARK');
                spawnParticles(barrelCutWorldPos, 0x888888, 16, 0.05, -0.001, 'SMOKE');

                vibrateGamepad('jolt', { duration: 170, weak: 0.9, strong: 0.85 });
                if (isPlayer) {
                  ar.cameraShakeIntensity = 0.85;
                  ar.cameraKickZ = 0.08;
                }
              }

              const snapT = (elapsedSec - 2.55) / 0.60;
              const shearPos = barrelCutWorldPos.clone();
              shearPos.y -= 0.07 * Math.sin(snapT * Math.PI * 0.5);
              ar.activeItemAnimGroup.position.copy(shearPos);

              if (isPlayer) {
                gunGroup.position.lerp(sawGunPos, damp(0.22));
                gunGroup.quaternion.slerp(sawGunQuat, damp(0.22));
              } else {
                ar.dealerHeadTiltFactor = 0.35;
              }
            } else if (elapsedSec < 4.20) {
              const discardT = (elapsedSec - 3.15) / 1.05;
              const liftPos = barrelCutWorldPos.clone();
              liftPos.y += 0.22 * (1 - Math.pow(1 - discardT, 2));
              liftPos.z += (isPlayer ? 0.22 : -0.25) * discardT;

              ar.activeItemAnimGroup.position.copy(liftPos);
              ar.activeItemAnimGroup.rotation.x += discardT * 0.4;

              if (isPlayer) {
                const restQ = new THREE.Quaternion().setFromEuler(initialGunRot);
                gunGroup.position.lerp(new THREE.Vector3().lerpVectors(sawGunPos, initialGunPos, discardT), damp(0.22));
                gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(sawGunQuat, restQ, discardT), damp(0.22));
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
                ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, 0, 8.0, rawDt);
              } else {
                ar.dealerHeadTiltFactor = 0.35 * (1 - discardT);
                ar.dealerMouthOpenFactor = 0.12 * (1 - discardT);
              }
              cutFaceMat.emissiveIntensity = Math.max(0.2, 1.1 * (1 - discardT * 0.8));
            } else {
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'DEFIBRILLATOR': {
            const isPlayer = ar.activeItemAnimUser === 'player';
            const chestPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 0.58).addScaledVector(up, -0.22)
              : new THREE.Vector3(0, 1.45, -2.1);
            const paddleQuat = isPlayer
              ? makeGunBasisQuat(fwd.clone().multiplyScalar(-0.7).addScaledVector(up, 0.7).normalize(), up)
              : new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 4, 0, 0));
            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            if (elapsedSec < 0.90) {
              const t = elapsedSec / 0.90;
              const easeT = 1 - Math.pow(1 - t, 3);
              const arcP = new THREE.Vector3().lerpVectors(startPos, chestPos, easeT);
              arcP.y += Math.sin(t * Math.PI) * 0.08;
              ar.activeItemAnimGroup.position.copy(arcP);
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(new THREE.Quaternion(), paddleQuat, easeT);

              if (!isPlayer) ar.dealerHeadTiltFactor = easeT * -0.2;
            } else if (elapsedSec < 2.15) {
              // Rub & charge paddles closely in front of sternum
              const chargeT = (elapsedSec - 0.90) / 1.25;
              const rubOffset = Math.sin(chargeT * Math.PI * 6) * 0.03 * (1 - chargeT * 0.7);
              const currentP = chestPos.clone().addScaledVector(rgt, rubOffset);
              currentP.x += Math.sin(time * 60) * 0.004 * chargeT;
              currentP.y += Math.cos(time * 60) * 0.004 * chargeT;
              ar.activeItemAnimGroup.position.copy(currentP);
              ar.activeItemAnimGroup.quaternion.copy(paddleQuat);

              if (isPlayer) {
                ar.actionCamOffset.lerp(up.clone().multiplyScalar(-0.025 * chargeT), damp(0.14));
              } else {
                ar.dealerHeadTiltFactor = -0.3;
                ar.dealerMouthOpenFactor = 0.4;
              }
            } else if (elapsedSec < 3.05) {
              // SLAM firmly into chest + high-voltage discharge!
              const shockT = (elapsedSec - 2.15) / 0.90;
              const slamBell = Math.sin(Math.min(1, shockT * 2.5) * Math.PI);
              const currentP = chestPos.clone().addScaledVector(fwd, isPlayer ? -0.14 * slamBell : 0.12 * slamBell);
              ar.activeItemAnimGroup.position.copy(currentP);
              ar.activeItemAnimGroup.quaternion.copy(paddleQuat);

              if (!ar.hasPlayedDefibSound && elapsedSec >= 2.18) {
                ar.hasPlayedDefibSound = true;
                playDefibrillatorShock();
                vibrateGamepad('strong', { duration: 360 });
                if (isPlayer) {
                  ar.cameraKickZ = 0.34;
                  ar.cameraKickPitch = -0.18;
                  ar.cameraShakeIntensity = 0.85;
                }
              }

              if (shockT < 0.25) {
                if (Math.random() < 0.75) {
                  spawnParticles(ar.activeItemAnimGroup.position, 0x2288ff, 5, 0.16, 0.001, 'SPARK');
                }
                if (!isPlayer) {
                  ar.dealerHeadTiltFactor = 0.65;
                  ar.dealerMouthOpenFactor = 1.0;
                }
              } else {
                if (isPlayer) {
                  ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.12));
                } else {
                  ar.dealerHeadTiltFactor = 0.1;
                  ar.dealerMouthOpenFactor = 0.2;
                }
              }
            } else {
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'SYRINGE': {
            let fluidMesh: THREE.Mesh | null = null;
            let meniscusMesh: THREE.Mesh | null = null;
            let bubbleMesh: THREE.Mesh | null = null;
            let bubble2Mesh: THREE.Mesh | null = null;
            let stopperMesh: THREE.Mesh | null = null;
            let plungerMesh: THREE.Mesh | null = null;

            ar.activeItemAnimGroup.traverse((child) => {
              if (child.name === 'syringeFluid') fluidMesh = child as THREE.Mesh;
              if (child.name === 'syringeMeniscus') meniscusMesh = child as THREE.Mesh;
              if (child.name === 'syringeBubble') bubbleMesh = child as THREE.Mesh;
              if (child.name === 'syringeBubble2') bubble2Mesh = child as THREE.Mesh;
              if (child.name === 'syringeStopper') stopperMesh = child as THREE.Mesh;
              if (child.name === 'syringePlunger') plungerMesh = child as THREE.Mesh;
            });

            const isPlayer = ar.activeItemAnimUser === 'player';
            const dt = Math.min(0.033, Math.max(0.005, deltaScale / 60.0));
            const currentPos = ar.activeItemAnimGroup.position;
            const linVel = currentPos.clone().sub(ar.prevItemPos).divideScalar(dt);
            ar.prevItemPos.copy(currentPos);

            const dealerMouthWorld = new THREE.Vector3(-0.15, 1.9, -2.5);
            if (!isPlayer) {
              dealerMouthGroup.updateWorldMatrix(true, false);
              dealerMouthGroup.getWorldPosition(dealerMouthWorld);
              dealerMouthWorld.x -= 0.16;
              dealerMouthWorld.y -= 0.22;
              dealerMouthWorld.z += 0.05;
            }

            const inspectPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 0.62).addScaledVector(up, -0.14).addScaledVector(rgt, 0.12)
              : dealerMouthWorld;
            const injectPos = isPlayer
              ? bCam.clone().addScaledVector(fwd, 0.56).addScaledVector(up, -0.22).addScaledVector(rgt, 0.08)
              : dealerMouthWorld;

            const startPos = isPlayer ? playerHandStart : new THREE.Vector3(-0.8, 0.6, -1.6);

            if (elapsedSec < 0.95) {
              // Phase 1: Raise close in front of eyes, double-tap glass barrel to settle bubbles, uncap
              const t = elapsedSec / 0.95;
              const easeT = 1 - Math.pow(1 - t, 3);
              const arcP = new THREE.Vector3().lerpVectors(startPos, inspectPos, easeT);
              arcP.y += Math.sin(t * Math.PI) * 0.06;

              const tap1 = elapsedSec >= 0.42 && elapsedSec <= 0.54 ? Math.sin(((elapsedSec - 0.42) / 0.12) * Math.PI) * 0.015 : 0;
              const tap2 = elapsedSec >= 0.60 && elapsedSec <= 0.72 ? Math.sin(((elapsedSec - 0.60) / 0.12) * Math.PI) * 0.015 : 0;
              arcP.x += tap1 + tap2;

              if (elapsedSec >= 0.44 && !ar.hasTappedSyringe) {
                ar.hasTappedSyringe = true;
                playTapSound();
                ar.syringeBubbleVel += 0.12;
                ar.syringeFluidOscVel = 0.08;
              }
              if (elapsedSec >= 0.62 && !ar.hasTappedSyringe2) {
                ar.hasTappedSyringe2 = true;
                playTapSound();
                ar.syringeBubbleVel += 0.10;
                ar.syringeFluidOscVel = 0.07;
              }
              if (elapsedSec >= 0.78 && !ar.hasCappedSyringe) {
                ar.hasCappedSyringe = true;
                playSyringeCap();
              }

              ar.activeItemAnimGroup.position.copy(arcP);
              ar.activeItemAnimGroup.rotation.set(
                isPlayer ? -0.22 * easeT : -0.45 * easeT,
                isPlayer ? -0.25 : Math.PI,
                (isPlayer ? 0.18 : 0) + (tap1 + tap2) * 3.0
              );

              if (!isPlayer) {
                ar.dealerMouthOpenFactor = easeT * 0.35;
                ar.dealerHeadTiltFactor = -easeT * 0.2;
              }
            } else if (elapsedSec < 1.35) {
              // Phase 2: Rotate needle inward toward collarbone/neck & draw back briefly
              const rotT = (elapsedSec - 0.95) / 0.40;
              const easeRot = rotT < 0.5 ? 2 * rotT * rotT : -1 + (4 - 2 * rotT) * rotT;
              ar.activeItemAnimGroup.position.lerpVectors(inspectPos, injectPos, easeRot);
              ar.activeItemAnimGroup.rotation.set(
                THREE.MathUtils.lerp(isPlayer ? -0.22 : -0.45, isPlayer ? 1.15 : -1.25, easeRot),
                isPlayer ? -0.25 : Math.PI,
                isPlayer ? 0.25 * easeRot : 0
              );
            } else if (elapsedSec < 3.15) {
              // Phase 3: Jab into neck/chest & steadily depress plunger
              const slamPhase = Math.min(1.0, (elapsedSec - 1.35) / 0.16);
              const slamBell = slamPhase < 0.45
                ? -(slamPhase / 0.45) * 0.06
                : -0.06 + ((slamPhase - 0.45) / 0.55) * 0.14;

              const currentP = injectPos.clone().addScaledVector(fwd, isPlayer ? -slamBell : slamBell);
              currentP.x += Math.sin(time * 36) * 0.0018;
              ar.activeItemAnimGroup.position.copy(currentP);
              ar.activeItemAnimGroup.rotation.set(
                isPlayer ? 1.15 : -1.25,
                isPlayer ? -0.25 : Math.PI,
                isPlayer ? 0.25 : 0
              );

              if (!isPlayer) {
                ar.dealerMouthOpenFactor = 0.78;
                ar.dealerHeadTiltFactor = 0.45;
              }

              if (elapsedSec >= 1.48 && !ar.hasSlammedSyringe) {
                ar.hasSlammedSyringe = true;
                playSyringeSlam();
                vibrateGamepad(isPlayer ? 'strong' : 'weak');
                ar.syringeFluidOscVel = 0.18;

                // Subtle, realistic puncture blood droplets at the injection site (no gore chunks or screen splatter)
                ar.activeItemAnimGroup.updateMatrixWorld(true);
                const needleTipWorldPos = new THREE.Vector3(0, -0.10, 0).applyMatrix4(ar.activeItemAnimGroup.matrixWorld);
                playBloodDrip(isPlayer ? 'table' : 'floor', 0.35);
                spawnParticles(needleTipWorldPos, 0x2a0000, 5, 0.045, 0.0032, 'BLOOD');

                if (isPlayer) {
                  ar.cameraShakeIntensity = 0.42;
                  ar.cameraKickZ = 0.09;
                  ar.cameraKickPitch = 0.05;
                  ar.actionFovOffset = -2.0;
                }
              }

              if (elapsedSec >= 1.56) {
                const plungeProgress = Math.min(1.0, (elapsedSec - 1.56) / 1.35);
                ar.syringeFluidVolume = Math.max(0.001, 1.0 - plungeProgress);

                if (plungerMesh) plungerMesh.position.y = 0.48 - plungeProgress * 0.11;
                if (stopperMesh) stopperMesh.position.y = 0.32 - plungeProgress * 0.20;

                if (isPlayer) {
                  ar.actionCamOffset.lerp(up.clone().multiplyScalar(0.028 * plungeProgress), damp(0.12));
                  ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, -2.0 * (1 - plungeProgress * 0.4), 6.0, rawDt);
                }
              }
            } else if (elapsedSec < 3.65) {
              const withdrawT = (elapsedSec - 3.15) / 0.50;
              ar.activeItemAnimGroup.position.lerpVectors(injectPos, startPos, withdrawT * withdrawT);
              if (!ar.hasWithdrawnSyringeBlood) {
                ar.hasWithdrawnSyringeBlood = true;
                ar.activeItemAnimGroup.updateMatrixWorld(true);
                const needleTipWorldPos = new THREE.Vector3(0, -0.10, 0).applyMatrix4(ar.activeItemAnimGroup.matrixWorld);
                spawnParticles(needleTipWorldPos, 0x2a0000, 2, 0.025, 0.0032, 'BLOOD');
              }
              if (isPlayer) {
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
                ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, 0, 8.0, rawDt);
              }
            } else {
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
              break;
            }

            // --- HYDRAULIC & BUOYANT BUBBLE PHYSICS FOR SYRINGE ---
            const invQuat = ar.activeItemAnimGroup.quaternion.clone().invert();
            const localGravity = new THREE.Vector3(0, -1, 0).applyQuaternion(invQuat);

            const springK = 85.0;
            const dampK = 8.5;
            const oscAccel = -springK * ar.syringeFluidOscillation - dampK * ar.syringeFluidOscVel;
            ar.syringeFluidOscVel += oscAccel * dt;
            ar.syringeFluidOscillation += ar.syringeFluidOscVel * dt;

            const stopperY = (stopperMesh as THREE.Mesh | null) ? (stopperMesh as THREE.Mesh).position.y : (0.32 - Math.min(1.0, Math.max(0, (elapsedSec - 1.56) / 1.35)) * 0.20);
            const plungeRatio = Math.max(0, Math.min(1.0, (0.32 - stopperY) / 0.20));
            const vol = Math.max(0.0, 1.0 - plungeRatio);
            const fluidHeight = vol * 0.22;
            const fluidBottomY = 0.09;
            const fluidTopY = fluidBottomY + fluidHeight;

            const buoyX = -localGravity.x * 0.10;
            const buoyY = -localGravity.y * 0.10;
            const buoyZ = -localGravity.z * 0.10;
            const inertX = -linVel.x * 0.03;
            const inertY = -linVel.y * 0.05;
            const inertZ = -linVel.z * 0.03;
            const dragX = -ar.syringeBubbleVelX * 5.0;
            const dragY = -ar.syringeBubbleVel * 5.0;
            const dragZ = -ar.syringeBubbleVelZ * 5.0;

            ar.syringeBubbleVelX += (buoyX + inertX + dragX) * dt;
            ar.syringeBubbleVel += (buoyY + inertY + dragY) * dt;
            ar.syringeBubbleVelZ += (buoyZ + inertZ + dragZ) * dt;

            ar.syringeBubblePosX += ar.syringeBubbleVelX * dt;
            ar.syringeBubblePos += ar.syringeBubbleVel * dt;
            ar.syringeBubblePosZ += ar.syringeBubbleVelZ * dt;

            const distR = Math.sqrt(ar.syringeBubblePosX * ar.syringeBubblePosX + ar.syringeBubblePosZ * ar.syringeBubblePosZ);
            if (distR > 0.024) {
              const norm = 0.024 / distR;
              ar.syringeBubblePosX *= norm;
              ar.syringeBubblePosZ *= norm;
              ar.syringeBubbleVelX *= -0.3;
              ar.syringeBubbleVelZ *= -0.3;
            }

            const minBubbleY = fluidBottomY + 0.012;
            const maxBubbleY = fluidTopY - 0.012;
            if (maxBubbleY > minBubbleY) {
              if (ar.syringeBubblePos < minBubbleY) {
                ar.syringeBubblePos = minBubbleY;
                ar.syringeBubbleVel *= -0.3;
              } else if (ar.syringeBubblePos > maxBubbleY) {
                ar.syringeBubblePos = maxBubbleY;
                ar.syringeBubbleVel *= -0.3;
              }
            }

            if (vol <= 0.005) {
              if (fluidMesh) fluidMesh.visible = false;
              if (meniscusMesh) meniscusMesh.visible = false;
              if (bubbleMesh) bubbleMesh.visible = false;
              if (bubble2Mesh) bubble2Mesh.visible = false;
            } else {
              if (fluidMesh) {
                fluidMesh.visible = true;
                fluidMesh.position.y = fluidBottomY;
                fluidMesh.scale.y = Math.max(0.001, fluidHeight / 0.22);
                const osc = THREE.MathUtils.clamp(ar.syringeFluidOscillation, -0.02, 0.02);
                fluidMesh.scale.x = 1.0 + osc;
                fluidMesh.scale.z = 1.0 - osc;
              }
              if (meniscusMesh) {
                meniscusMesh.visible = true;
                meniscusMesh.position.y = fluidTopY - 0.002;
                const tiltX = THREE.MathUtils.clamp(-localGravity.z * 0.15 + ar.syringeFluidOscillation * 0.5, -0.2, 0.2);
                const tiltZ = THREE.MathUtils.clamp(localGravity.x * 0.15, -0.2, 0.2);
                meniscusMesh.rotation.x = -Math.PI / 2 + tiltX;
                meniscusMesh.rotation.z = tiltZ;
                meniscusMesh.scale.set(Math.cos(tiltZ), Math.cos(tiltX), 1.0);
              }
              if (bubbleMesh) {
                if (maxBubbleY <= minBubbleY || vol <= 0.08) {
                  bubbleMesh.visible = false;
                } else {
                  bubbleMesh.visible = true;
                  bubbleMesh.position.set(ar.syringeBubblePosX, ar.syringeBubblePos, ar.syringeBubblePosZ);
                  bubbleMesh.scale.setScalar(Math.min(1.0, vol * 1.1));
                }
              }
              if (bubble2Mesh) {
                if (maxBubbleY <= minBubbleY || vol <= 0.12) {
                  bubble2Mesh.visible = false;
                } else {
                  bubble2Mesh.visible = true;
                  const b2Y = THREE.MathUtils.clamp(ar.syringeBubblePos - 0.035 + Math.sin(time * 6) * 0.008, minBubbleY, maxBubbleY);
                  const b2X = THREE.MathUtils.clamp(-ar.syringeBubblePosX + Math.cos(time * 5) * 0.004, -0.02, 0.02);
                  const b2Z = THREE.MathUtils.clamp(-ar.syringeBubblePosZ + Math.sin(time * 4) * 0.004, -0.02, 0.02);
                  bubble2Mesh.position.set(b2X, b2Y, b2Z);
                  bubble2Mesh.scale.setScalar(Math.min(0.8, vol * 0.9));
                }
              }
            }
            break;
          }
          case 'RAZORBLADE': {
            const isPlayerUser = ar.activeItemAnimUser === 'player';
            const dealerArmPos = new THREE.Vector3(-0.02, 1.98, -2.45);
            if (!isPlayerUser) {
              dealerMouthGroup.updateWorldMatrix(true, false);
              dealerMouthGroup.getWorldPosition(dealerArmPos);
              dealerArmPos.y -= 0.45;
              dealerArmPos.z += 0.18;
            }
            const basePos = isPlayerUser
              ? bCam.clone().addScaledVector(fwd, 0.56).addScaledVector(up, -0.175).addScaledVector(rgt, -0.04)
              : dealerArmPos;
            const startPos = isPlayerUser ? playerHandStart : new THREE.Vector3(-0.6, 0.6, -1.7);

            // Position & orient close-up low-poly wrist slash mesh directly beneath blade drag path for player
            if (isPlayerUser) {
              wristWound.group.visible = elapsedSec >= 0.45 && elapsedSec < 3.10;
              wristWound.group.position.copy(basePos).addScaledVector(up, -0.024);
              wristWound.group.quaternion.copy(
                makeGunBasisQuat(
                  fwd.clone().negate().addScaledVector(up, 0.38).normalize(),
                  up.clone().addScaledVector(fwd, 0.35).normalize()
                )
              );
            } else {
              wristWound.reset();
            }

            if (elapsedSec < 0.90) {
              const t = elapsedSec / 0.90;
              const easeT = 1 - Math.pow(1 - t, 3);
              const currentPos = new THREE.Vector3().lerpVectors(startPos, basePos, easeT);
              currentPos.x += Math.sin(time * 32.0) * 0.0025 * easeT;
              currentPos.y += Math.cos(time * 28.0) * 0.0025 * easeT;

              ar.activeItemAnimGroup.position.copy(currentPos);
              if (isPlayerUser) {
                wristWound.setSlashProgress(0.01, 0);
                ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, -2.0 * easeT, 8.0, rawDt);
              } else {
                ar.dealerMouthOpenFactor = easeT * 0.2;
                ar.dealerHeadTiltFactor = -easeT * 0.15;
              }
              ar.activeItemAnimGroup.rotation.set(
                (isPlayerUser ? Math.PI / 3.1 : -Math.PI / 3) + Math.sin(time * 20.0) * 0.04,
                isPlayerUser ? Math.PI / 6 : -Math.PI / 6,
                isPlayerUser ? Math.PI / 8 : -Math.PI / 8
              );
            } else if (elapsedSec < 2.25) {
              const tSlice = Math.min(1.0, (elapsedSec - 0.90) / 1.35);
              const dragWidth = isPlayerUser ? 0.22 : 0.34;
              const sliceX = (tSlice - 0.5) * dragWidth;
              const currentPos = basePos.clone().addScaledVector(rgt, isPlayerUser ? sliceX : -sliceX);

              const frictionShudder = Math.sin(tSlice * 62.0) * 0.0035;
              currentPos.y += frictionShudder - (tSlice > 0.08 && tSlice < 0.92 ? 0.024 : 0);
              currentPos.z += Math.cos(tSlice * 45.0) * 0.002;
              ar.activeItemAnimGroup.position.copy(currentPos);

              if (isPlayerUser) {
                const arterialPulse = Math.max(0, Math.sin(elapsedSec * 9.5));
                wristWound.setSlashProgress(tSlice, arterialPulse);
                ar.actionCamOffset.lerp(
                  fwd.clone().multiplyScalar(-0.045).addScaledVector(up, 0.022),
                  damp(0.18)
                );
                ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, -3.2, 8.0, rawDt);
                ar.cameraShakeIntensity = 0.28;
              } else {
                ar.dealerMouthOpenFactor = 0.65;
                ar.dealerHeadTiltFactor = 0.45;
              }

              ar.activeItemAnimGroup.rotation.set(
                isPlayerUser ? Math.PI / 2.2 : -Math.PI / 2.2,
                (isPlayerUser ? 1 : -1) * (Math.PI / 4 + tSlice * 0.25),
                (isPlayerUser ? 1 : -1) * (Math.PI / 6 + frictionShudder * 6.0)
              );

              if (!ar.hasSlicedRazor) {
                ar.hasSlicedRazor = true;
                playRazorSlice();
                spawnParticles(currentPos.clone().add(new THREE.Vector3(0, -0.02, 0)), 0x3b0202, 24, 0.09, 0.0035, 'BLOOD');
                registerBloodDripEmitter(basePos.clone().add(new THREE.Vector3(0, -0.05, 0)), 9, false);
                registerBloodDripEmitter(basePos.clone().addScaledVector(rgt, isPlayerUser ? 0.06 : -0.06).add(new THREE.Vector3(0, -0.05, 0)), 7, false);
                if (isPlayerUser) spawnScreenSplat();
                vibrateGamepad(isPlayerUser ? 'strong' : 'weak', { duration: 250, weak: 0.4, strong: 1.0 });
              }

              if (Math.random() < 0.85) {
                const particlePos = currentPos.clone();
                particlePos.y -= 0.015;
                spawnParticles(particlePos, 0x480000, 5, 0.055, 0.0035, 'BLOOD');
              }
            } else if (elapsedSec < 3.45) {
              const tRetreat = (elapsedSec - 2.25) / 1.20;
              const retreatPos = basePos.clone();
              retreatPos.y += 0.14 * Math.sin(tRetreat * Math.PI * 0.6);
              retreatPos.addScaledVector(fwd, 0.12 * tRetreat);

              ar.activeItemAnimGroup.position.copy(retreatPos);
              ar.activeItemAnimGroup.rotation.set(
                (isPlayerUser ? 1 : -1) * (Math.PI / 3 + tRetreat * Math.PI * 0.8),
                tRetreat * Math.PI * 1.5,
                0
              );
              if (isPlayerUser) {
                wristWound.setSlashProgress(1.0, Math.max(0, Math.sin(elapsedSec * 8.0)) * (1 - tRetreat));
                if (tRetreat > 0.75) wristWound.reset();
                ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
                ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, 0, 8.0, rawDt);
              }

              if (tRetreat < 0.65 && Math.random() < 0.58) {
                spawnParticles(ar.activeItemAnimGroup.position, 0x5c0000, 3, 0.03, 0.003, 'BLOOD');
              }
            } else {
              wristWound.reset();
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }
            break;
          }
          case 'MEDKIT': {
            const isPlayerUser = ar.activeItemAnimUser === 'player';

            // Grounded oak tabletop resting poses (table top plane y = 0.55)
            const tableKitPos = isPlayerUser
              ? new THREE.Vector3(0.14, 0.552, 0.34)
              : new THREE.Vector3(0.0, 0.552, -1.68);
            const medQuat = isPlayerUser
              ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.22, 0))
              : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.16, 0));
            const startPos = isPlayerUser
              ? new THREE.Vector3(0.58, 0.88, 0.92)
              : new THREE.Vector3(-0.68, 0.78, -1.78);
            const startQuat = isPlayerUser
              ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.45, -0.18))
              : new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0.42, 0.14));

            // Player leans down & forward over oak tabletop beside their injured left forearm
            const leanInT = Math.min(1, elapsedSec / 0.85);
            const leanOutT = elapsedSec > 7.25 ? Math.min(1, (elapsedSec - 7.25) / 0.85) : 0;
            const leanAlpha =
              (1 - Math.pow(1 - leanInT, 3)) * (1 - leanOutT * leanOutT * (3 - 2 * leanOutT));

            const forearmBasePos = new THREE.Vector3(-0.19, 0.596, 0.44);
            if (isPlayerUser) {
              medkitArm.group.visible = elapsedSec >= 0.08 && elapsedSec < 8.10;
              medkitArm.group.position.copy(forearmBasePos);
              medkitArm.group.position.y -= (1 - leanAlpha) * 0.14;
              medkitArm.group.rotation.set(0, 0.36, 0);
            } else {
              medkitArm.reset();
            }

            let lidMesh: THREE.Object3D | null = null;
            let latchL: THREE.Object3D | null = null;
            let latchR: THREE.Object3D | null = null;
            let sprayBottle: THREE.Object3D | null = null;
            let sprayCap: THREE.Object3D | null = null;
            let sprayTip: THREE.Object3D | null = null;
            let bandageRoll: THREE.Object3D | null = null;
            let gauzeTab: THREE.Object3D | null = null;
            let gauzeStrip: THREE.Object3D | null = null;
            let pillBottle: THREE.Object3D | null = null;
            let pillCap: THREE.Object3D | null = null;
            let pill1: THREE.Object3D | null = null;
            let pill2: THREE.Object3D | null = null;

            ar.activeItemAnimGroup.traverse((child) => {
              if (child.name === 'medkitLid') lidMesh = child;
              else if (child.name === 'medkitLatchL') latchL = child;
              else if (child.name === 'medkitLatchR') latchR = child;
              else if (child.name === 'medkitSprayBottle') sprayBottle = child;
              else if (child.name === 'medkitSprayCap') sprayCap = child;
              else if (child.name === 'medkitSprayTip') sprayTip = child;
              else if (child.name === 'medkitBandageRoll') bandageRoll = child;
              else if (child.name === 'medkitGauzeTab') gauzeTab = child;
              else if (child.name === 'medkitGauzeStrip') gauzeStrip = child;
              else if (child.name === 'medkitPillBottle') pillBottle = child;
              else if (child.name === 'medkitPillCap') pillCap = child;
              else if (child.name === 'medkitPill1') pill1 = child;
              else if (child.name === 'medkitPill2') pill2 = child;
            });

            const resetTrayItem = (obj: THREE.Object3D | null) => {
              if (!obj) return;
              if (obj.userData.restPos) obj.position.copy(obj.userData.restPos);
              if (obj.userData.restQuat) obj.quaternion.copy(obj.userData.restQuat);
            };
            resetTrayItem(sprayBottle);
            resetTrayItem(bandageRoll);
            resetTrayItem(pillBottle);
            if (sprayCap) sprayCap.position.y = 0.066;
            if (pillCap) {
              pillCap.position.set(0, 0.048, 0);
              pillCap.rotation.set(0, 0, 0);
            }
            if (gauzeStrip) {
              gauzeStrip.visible = false;
              gauzeStrip.scale.set(1, 0.01, 1);
            }
            if (gauzeTab) {
              gauzeTab.visible = elapsedSec < 4.35;
              if (gauzeTab.userData.restPos) gauzeTab.position.copy(gauzeTab.userData.restPos);
              if (gauzeTab.userData.restRot) gauzeTab.rotation.copy(gauzeTab.userData.restRot);
            }
            if (pill1) pill1.visible = false;
            if (pill2) pill2.visible = false;

            const placeSubItemFromTray = (
              obj: THREE.Object3D | null,
              worldTargetPos: THREE.Vector3,
              worldTargetQuat: THREE.Quaternion,
              liftAlpha: number
            ) => {
              if (!obj || !obj.userData.restPos || !obj.userData.restQuat || !ar.activeItemAnimGroup) return;
              const clamped = Math.max(0, Math.min(1, liftAlpha));
              ar.activeItemAnimGroup.updateMatrixWorld(true);
              const invKitMat = ar.activeItemAnimGroup.matrixWorld.clone().invert();
              const localTargetPos = worldTargetPos.clone().applyMatrix4(invKitMat);
              const invKitQuat = ar.activeItemAnimGroup.quaternion.clone().invert();
              const localTargetQuat = invKitQuat.clone().multiply(worldTargetQuat);
              obj.position.lerpVectors(obj.userData.restPos, localTargetPos, clamped);
              obj.quaternion.slerpQuaternions(obj.userData.restQuat, localTargetQuat, clamped);
            };

            const placeLoosePillWorld = (obj: THREE.Object3D | null, worldPos: THREE.Vector3, rotEuler: THREE.Euler) => {
              if (!obj || !ar.activeItemAnimGroup) return;
              ar.activeItemAnimGroup.updateMatrixWorld(true);
              const invKitMat = ar.activeItemAnimGroup.matrixWorld.clone().invert();
              obj.visible = true;
              obj.position.copy(worldPos.clone().applyMatrix4(invKitMat));
              obj.rotation.copy(rotEuler);
            };

            const dealerMouthWorld = new THREE.Vector3(0, 1.92, -2.52);
            if (!isPlayerUser) {
              dealerMouthGroup.updateWorldMatrix(true, false);
              dealerMouthGroup.getWorldPosition(dealerMouthWorld);
              dealerMouthWorld.y -= 0.04;
              dealerMouthWorld.z += 0.14;
            }

            // Track forearm dressing progression across phases
            let sprayWetness = 0;
            let wrapProgress = 0;
            if (elapsedSec >= 2.52) {
              const w1 = THREE.MathUtils.clamp((elapsedSec - 2.52) / 0.32, 0, 1) * 0.55;
              const w2 = elapsedSec >= 2.98 ? THREE.MathUtils.clamp((elapsedSec - 2.98) / 0.30, 0, 1) * 0.45 : 0;
              sprayWetness = w1 + w2;
            }
            if (elapsedSec >= 4.35) {
              wrapProgress = THREE.MathUtils.clamp((elapsedSec - 4.35) / 1.02, 0, 1);
            }
            if (isPlayerUser) {
              medkitArm.setTreatmentState(sprayWetness, wrapProgress);
            }

            // Base camera pose offsets (overridden subtly during swallow/flinch)
            let extraCamX = 0;
            let extraCamY = 0;
            let extraLookX = 0;
            let extraLookY = 0;

            if (elapsedSec < 0.82) {
              // Phase 0: Lift heavy steel kit and set it solidly onto the oak tabletop
              const setT = Math.min(1, elapsedSec / 0.60);
              const easeSet = 1 - Math.pow(1 - setT, 3);
              const arcY = Math.sin(setT * Math.PI) * 0.14;
              const settleBounce =
                elapsedSec >= 0.58 && elapsedSec <= 0.74
                  ? Math.abs(Math.sin(((elapsedSec - 0.58) / 0.16) * Math.PI * 1.5)) *
                    Math.exp(-8 * (elapsedSec - 0.58)) *
                    0.012
                  : 0;
              ar.activeItemAnimGroup.position.lerpVectors(startPos, tableKitPos, easeSet);
              ar.activeItemAnimGroup.position.y += arcY + settleBounce;
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(startQuat, medQuat, easeSet);

              if (elapsedSec >= 0.58 && !ar.hasPlayedMedkitSetDown) {
                ar.hasPlayedMedkitSetDown = true;
                playMedkitSupplySound('SET_DOWN');
                vibrateGamepad('weak', { duration: 75 });
              }
              if (elapsedSec >= 0.58 && elapsedSec <= 0.72) {
                extraCamY = -0.008 * Math.sin(((elapsedSec - 0.58) / 0.14) * Math.PI);
              }
            } else if (elapsedSec < 1.82) {
              // Phase 1: Unlatch left clasp, pause, unlatch right clasp, hinge lid open cleanly
              ar.activeItemAnimGroup.position.copy(tableKitPos);
              ar.activeItemAnimGroup.quaternion.copy(medQuat);

              const lT = THREE.MathUtils.clamp((elapsedSec - 0.82) / 0.18, 0, 1);
              const rT = THREE.MathUtils.clamp((elapsedSec - 1.04) / 0.18, 0, 1);
              if (latchL) latchL.rotation.x = -1.32 * (1 - Math.pow(1 - lT, 2));
              if (latchR) latchR.rotation.x = -1.32 * (1 - Math.pow(1 - rT, 2));

              if (elapsedSec >= 0.84 && !ar.hasPlayedMedkitSound) {
                ar.hasPlayedMedkitSound = true;
                playMedkitSupplySound('UNLATCH_L');
                vibrateGamepad('click', { duration: 35 });
              }
              if (elapsedSec >= 1.06 && !ar.hasPlayedMedkitUnlatchR) {
                ar.hasPlayedMedkitUnlatchR = true;
                playMedkitSupplySound('UNLATCH_R');
                vibrateGamepad('click', { duration: 35 });
              }

              const lidT = THREE.MathUtils.clamp((elapsedSec - 1.28) / 0.40, 0, 1);
              const easeLid = lidT * lidT * (3 - 2 * lidT);
              const lidSettle = lidT > 0.75 ? Math.sin(((lidT - 0.75) / 0.25) * Math.PI) * 0.035 : 0;
              if (lidMesh) lidMesh.rotation.x = -1.94 * easeLid - lidSettle;

              if (elapsedSec >= 1.28 && !ar.hasPlayedMedkitOpenLid) {
                ar.hasPlayedMedkitOpenLid = true;
                playMedkitSupplySound('OPEN_LID');
                vibrateGamepad('weak', { duration: 60 });
              }
            } else if (elapsedSec < 3.65) {
              // Phase 2: Lift antiseptic spray canister, shake twice, apply two deliberate mist bursts, return to slot
              const pT = elapsedSec - 1.82; // 0 -> 1.83s
              ar.activeItemAnimGroup.position.copy(tableKitPos);
              ar.activeItemAnimGroup.quaternion.copy(medQuat);
              if (lidMesh) lidMesh.rotation.x = -1.94;
              if (latchL) latchL.rotation.x = -1.32;
              if (latchR) latchR.rotation.x = -1.32;

              const liftAlpha =
                pT < 0.36
                  ? 1 - Math.pow(1 - pT / 0.36, 3)
                  : pT > 1.48
                  ? 1 - Math.pow((pT - 1.48) / 0.35, 2)
                  : 1.0;

              // Wrist shake (0.36 -> 0.66s)
              const isShaking = pT >= 0.36 && pT <= 0.66;
              const shakeEnv = isShaking ? Math.sin(((pT - 0.36) / 0.30) * Math.PI) : 0;
              const shakeOffset = shakeEnv * Math.sin((pT - 0.36) * 28.0) * 0.022;
              if (pT >= 0.36 && !ar.hasPlayedMedkitSprayShake) {
                ar.hasPlayedMedkitSprayShake = true;
                playMedkitSupplySound('SPRAY_SHAKE');
              }

              // Two deliberate spray bursts at forearm laceration
              const burst1 = pT >= 0.68 && pT <= 1.00 ? Math.sin(((pT - 0.68) / 0.32) * Math.PI) : 0;
              const burst2 = pT >= 1.14 && pT <= 1.46 ? Math.sin(((pT - 1.14) / 0.32) * Math.PI) : 0;
              const pressAmt = Math.max(burst1, burst2);
              const passShift = pT >= 1.02 ? THREE.MathUtils.clamp((pT - 1.02) / 0.14, 0, 1) * 0.038 : 0;

              const woundWorld = isPlayerUser
                ? forearmBasePos.clone().add(new THREE.Vector3(-0.02 + passShift, 0.034, 0.01))
                : new THREE.Vector3(-0.06, 1.58, -2.34);
              const sprayHoverWorld = isPlayerUser
                ? forearmBasePos.clone().add(new THREE.Vector3(0.05 + passShift, 0.175 + shakeOffset, -0.05))
                : new THREE.Vector3(0.10, 1.66, -2.18 + shakeOffset * 0.4);

              const aimDir = woundWorld.clone().sub(sprayHoverWorld).normalize();
              const sprayQuat = makeGunBasisQuat(aimDir, up);
              placeSubItemFromTray(sprayBottle, sprayHoverWorld, sprayQuat, liftAlpha);

              if (sprayCap) sprayCap.position.y = 0.066 - pressAmt * 0.0068;

              if (pT >= 0.68 && !ar.hasPlayedMedkitSpray) {
                ar.hasPlayedMedkitSpray = true;
                playMedkitSupplySound('SPRAY');
                vibrateGamepad('weak', { duration: 65 });
              }
              if (pT >= 1.14 && !ar.hasPlayedMedkitSpray2) {
                ar.hasPlayedMedkitSpray2 = true;
                playMedkitSupplySound('SPRAY');
                vibrateGamepad('weak', { duration: 75 });
              }

              if (pressAmt > 0.22 && sprayTip) {
                ar.activeItemAnimGroup.updateMatrixWorld(true);
                const tipWorld = new THREE.Vector3();
                sprayTip.getWorldPosition(tipWorld);
                if (Math.random() < 0.78) {
                  spawnParticles(tipWorld, 0xd8e4e8, 1, 0.036, -0.0002, 'SMOKE', aimDir);
                }
              }

              if (isPlayerUser) {
                extraCamX = -0.035 * liftAlpha;
                extraCamY = -0.015 * pressAmt;
                extraLookX = -0.08 * liftAlpha;
              } else {
                ar.dealerHeadTiltFactor = -0.18 * liftAlpha;
              }
            } else if (elapsedSec < 5.75) {
              // Phase 3: Pick up gauze roll, tear foil wrapper tab, wrap forearm methodically twice, tuck & return
              const pT = elapsedSec - 3.65; // 0 -> 2.10s
              ar.activeItemAnimGroup.position.copy(tableKitPos);
              ar.activeItemAnimGroup.quaternion.copy(medQuat);
              if (lidMesh) lidMesh.rotation.x = -1.94;
              if (latchL) latchL.rotation.x = -1.32;
              if (latchR) latchR.rotation.x = -1.32;

              const liftAlpha =
                pT < 0.35
                  ? 1 - Math.pow(1 - pT / 0.35, 3)
                  : pT > 1.75
                  ? 1 - Math.pow((pT - 1.75) / 0.35, 2)
                  : 1.0;

              // Tear sterile wrapper tab cleanly between 0.35 -> 0.70s
              if (gauzeTab && pT >= 0.35 && pT < 0.70) {
                const tearT = (pT - 0.35) / 0.35;
                gauzeTab.visible = true;
                if (gauzeTab.userData.restPos) {
                  gauzeTab.position.copy(gauzeTab.userData.restPos).add(new THREE.Vector3(tearT * 0.04, tearT * 0.02 - tearT * tearT * 0.06, tearT * 0.05));
                }
                gauzeTab.rotation.z = 0.08 + tearT * 1.1;
              }
              if (pT >= 0.36 && !ar.hasPlayedMedkitGauze) {
                ar.hasPlayedMedkitGauze = true;
                playMedkitSupplySound('GAUZE_RIP');
                vibrateGamepad('click', { duration: 40 });
              }

              // Orbit/wrap pass around forearm (0.70 -> 1.72s)
              const wrapPhaseT = THREE.MathUtils.clamp((pT - 0.70) / 1.02, 0, 1);
              const orbitAngle = wrapPhaseT * Math.PI * 4.0; // two deliberate full revolutions
              const sinOrb = Math.sin(orbitAngle);
              const cosOrb = Math.cos(orbitAngle);

              const gauzeTargetWorld = isPlayerUser
                ? forearmBasePos.clone().add(
                    new THREE.Vector3(
                      -0.02 + wrapPhaseT * 0.06,
                      0.075 + Math.abs(cosOrb) * 0.032,
                      sinOrb * 0.065
                    )
                  )
                : new THREE.Vector3(-0.05 + sinOrb * 0.06, 1.62 + cosOrb * 0.03, -2.24);

              const gauzeWorldQuat = isPlayerUser
                ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 * cosOrb, 0.36, 0.22 * sinOrb))
                : new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.35 * sinOrb, 0.25 * sinOrb));

              placeSubItemFromTray(bandageRoll, gauzeTargetWorld, gauzeWorldQuat, liftAlpha);

              if (gauzeStrip && pT >= 0.42 && pT <= 1.72) {
                gauzeStrip.visible = true;
                const stripLen = pT < 1.45 ? Math.min(1.0, (pT - 0.42) / 0.40) : Math.max(0.06, 1 - (pT - 1.45) / 0.27);
                gauzeStrip.scale.set(1, stripLen, 1);
              }
              if (bandageRoll && pT > 1.55) {
                bandageRoll.scale.set(1, 0.84, 0.84);
              }

              if (pT >= 0.70 && !ar.hasPlayedMedkitGauzeWrap) {
                ar.hasPlayedMedkitGauzeWrap = true;
                playMedkitSupplySound('GAUZE_WRAP');
                vibrateGamepad('weak', { duration: 95 });
              }

              if (isPlayerUser) {
                extraCamX = -0.04 * liftAlpha;
                extraLookX = -0.10 * liftAlpha;
                extraCamY = -0.010 * Math.abs(cosOrb) * liftAlpha;
              } else {
                ar.dealerHeadTiltFactor = -0.26 * liftAlpha;
              }
            } else if (elapsedSec < 7.38) {
              // Phase 4: Lift amber vial, depress & twist cap, pour two tablets out, tilt back & swallow, return vial
              const pT = elapsedSec - 5.75; // 0 -> 1.63s
              ar.activeItemAnimGroup.position.copy(tableKitPos);
              ar.activeItemAnimGroup.quaternion.copy(medQuat);
              if (lidMesh) lidMesh.rotation.x = -1.94;
              if (latchL) latchL.rotation.x = -1.32;
              if (latchR) latchR.rotation.x = -1.32;
              if (bandageRoll) bandageRoll.scale.set(1, 0.84, 0.84);

              const liftAlpha =
                pT < 0.33
                  ? 1 - Math.pow(1 - pT / 0.33, 3)
                  : pT > 1.32
                  ? 1 - Math.pow((pT - 1.32) / 0.31, 2)
                  : 1.0;

              // Pour tilt (0.67 -> 1.07s) -> dry swallow head-back (1.07 -> 1.37s)
              const pourAlpha = pT >= 0.65 && pT <= 1.07 ? Math.sin(((pT - 0.65) / 0.42) * Math.PI) : 0;
              const swallowAlpha = pT >= 1.02 && pT <= 1.38 ? Math.sin(((pT - 1.02) / 0.36) * Math.PI) : 0;

              const pillTargetWorld = isPlayerUser
                ? new THREE.Vector3(0.06 - pourAlpha * 0.02, 1.32 + pourAlpha * 0.06 - swallowAlpha * 0.08, 1.36 + pourAlpha * 0.04)
                : dealerMouthWorld.clone().add(new THREE.Vector3(0.03, -0.06 + swallowAlpha * 0.06, 0.07 - swallowAlpha * 0.04));

              const uprightQuat = isPlayerUser
                ? makeGunBasisQuat(new THREE.Vector3(0, 0, 1), up)
                : makeGunBasisQuat(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
              const tipAngle = (isPlayerUser ? 1.95 : -1.78) * pourAlpha;
              const tipQuat = uprightQuat
                .clone()
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tipAngle));

              placeSubItemFromTray(pillBottle, pillTargetWorld, tipQuat, liftAlpha);

              // Cap twist & pop off cleanly while pouring
              if (pillCap) {
                const capPop = pT >= 0.35 && pT <= 1.24 ? 1.0 : 0.0;
                const pushTwist = pT >= 0.30 && pT < 0.45 ? (pT - 0.30) / 0.15 : 0;
                pillCap.position.set(0.015 * capPop, 0.048 - 0.005 * pushTwist + 0.028 * capPop, 0);
                pillCap.rotation.set(0, pushTwist * 1.4, -0.68 * capPop);
              }

              // Animate two visible white tablets tipping out of the bottle neck during pour
              if (pT >= 0.72 && pT < 1.12 && pillBottle) {
                const dropT = Math.min(1, (pT - 0.72) / 0.38);
                const mouthBase = pillTargetWorld.clone().add(new THREE.Vector3(0, -0.045, isPlayerUser ? 0.045 : 0.02));
                const palmOffset1 = new THREE.Vector3(-0.012, -dropT * 0.055, isPlayerUser ? dropT * 0.04 : -dropT * 0.03);
                const palmOffset2 = new THREE.Vector3(0.011, -Math.max(0, dropT - 0.14) * 0.060, isPlayerUser ? dropT * 0.035 : -dropT * 0.025);
                placeLoosePillWorld(pill1, mouthBase.clone().add(palmOffset1), new THREE.Euler(dropT * 1.4, 0.4, dropT * 0.8));
                if (dropT > 0.14) {
                  placeLoosePillWorld(pill2, mouthBase.clone().add(palmOffset2), new THREE.Euler(dropT * 1.8, -0.6, dropT * 1.1));
                }
              }

              if (pT >= 0.34 && !ar.hasPlayedMedkitPills) {
                ar.hasPlayedMedkitPills = true;
                playMedkitSupplySound('PILL_CAP');
                vibrateGamepad('click', { duration: 40 });
              }
              if (pT >= 0.72 && !ar.hasPlayedMedkitPillPour) {
                ar.hasPlayedMedkitPillPour = true;
                playMedkitSupplySound('PILL_POUR');
              }
              if (pT >= 1.06 && !ar.hasPlayedMedkitSwallow) {
                ar.hasPlayedMedkitSwallow = true;
                playMedkitSupplySound('SWALLOW');
                vibrateGamepad('weak', { duration: 45 });
              }

              if (isPlayerUser) {
                extraCamX = 0.03 * liftAlpha;
                extraCamY = 0.06 * swallowAlpha;
                extraLookY = 0.75 * swallowAlpha + 0.18 * liftAlpha;
              } else {
                ar.dealerHeadTiltFactor = 0.42 * swallowAlpha;
                ar.dealerMouthOpenFactor = 0.65 * swallowAlpha;
              }
            } else if (elapsedSec < 8.15) {
              // Phase 5: Lower gasket lid cleanly, snap both clasps shut, slide steel case away as camera sits up
              const pT = elapsedSec - 7.38; // 0 -> 0.77s
              if (bandageRoll) bandageRoll.scale.set(1, 0.84, 0.84);

              const closeT = Math.min(1, pT / 0.24);
              const slamImpact = pT >= 0.22 && pT <= 0.34 ? Math.sin(((pT - 0.22) / 0.12) * Math.PI) * 0.008 : 0;
              if (lidMesh) lidMesh.rotation.x = -1.94 * (1 - closeT * closeT);

              const latchCloseT = Math.max(0, Math.min(1, (pT - 0.22) / 0.14));
              const latchAngle = -1.32 * (1 - latchCloseT);
              if (latchL) latchL.rotation.x = latchAngle;
              if (latchR) latchR.rotation.x = latchAngle;

              if (pT >= 0.23 && !ar.hasPlayedMedkitClose) {
                ar.hasPlayedMedkitClose = true;
                playMedkitSupplySound('CLOSE');
                vibrateGamepad('strong', { duration: 55 });
              }

              const retreatT = Math.max(0, Math.min(1, (pT - 0.38) / 0.39));
              const easeRetreat = retreatT * retreatT;
              ar.activeItemAnimGroup.position.lerpVectors(tableKitPos, startPos, easeRetreat);
              ar.activeItemAnimGroup.position.y += Math.sin(retreatT * Math.PI) * 0.08 - slamImpact;
              ar.activeItemAnimGroup.quaternion.slerpQuaternions(medQuat, startQuat, easeRetreat);

              if (!isPlayerUser) {
                ar.dealerHeadTiltFactor = THREE.MathUtils.damp(ar.dealerHeadTiltFactor, 0, 10.0, rawDt);
                ar.dealerMouthOpenFactor = THREE.MathUtils.damp(ar.dealerMouthOpenFactor, 0, 10.0, rawDt);
              }
            } else {
              medkitArm.reset();
              if (isPlayerUser) {
                ar.actionCamOffset.set(0, 0, 0);
                ar.actionLookOffset.set(0, 0, 0);
                ar.actionFovOffset = 0;
              }
              discardItemPhysics(ar.activeItemAnimGroup, ar.activeItemAnimUser || 'player');
              ar.activeItemAnimGroup = null;
            }

            if (isPlayerUser && elapsedSec < 8.15) {
              const targetCamOff = new THREE.Vector3(-0.04 * leanAlpha + extraCamX, -1.78 * leanAlpha + extraCamY, -3.52 * leanAlpha);
              const targetLookOff = new THREE.Vector3(0.04 * leanAlpha + extraLookX, -0.46 * leanAlpha + extraLookY, 0);
              ar.actionCamOffset.lerp(targetCamOff, damp(0.14));
              ar.actionLookOffset.lerp(targetLookOff, damp(0.14));
              ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, -5.5 * leanAlpha, 8.0, rawDt);
            }
            break;
          }
        }
      }





      // --- SCREENSPACE ACCURATE HOVER OVERLAYS SYSTEM ---
      const popupEl = popupRef.current;
      const popupNameEl = popupNameRef.current;
      const popupDescEl = popupDescRef.current;

      let activeTargetMesh: THREE.Object3D | null = null;
      let activeTargetType: 'ITEM' | 'SHOP_ITEM' = 'ITEM';
      let activeTargetName = '';
      let activeTargetDesc = '';

      if (latest.showControls || isLookingAtShopRef.current) {
        if (hoveredMesh) {
          activeTargetMesh = hoveredMesh;
          const isTouchMode = stateRef.current.isTouchActive;
          const isGpMode = getControllerSettings().inputType === 'gamepad';
          const touchPrompt = isTouchMode ? ' [TAP ONCE]' : '';

          if (hoveredMesh.userData.isPlayerItem) {
            activeTargetType = 'ITEM';
            const idx = hoveredMesh.userData.index;
            const itemName = latest.player.items[idx];
            if (!itemName) {
              activeTargetName = 'EMPTY SLOT';
              activeTargetDesc = 'ERROR - NO ITEM DETECTED.';
            } else {
              const meta = ITEM_METADATA[itemName];
              const rarityTag = meta ? ` [${meta.rarity}]` : '';
              activeTargetName = `USE ${meta ? meta.name : itemName}${rarityTag}`;
              const buyPrompt = isGpMode ? ' [CONFIRM] TO USE' : '';
              activeTargetDesc = (meta ? meta.description.toUpperCase() : ITEM_DESCS[itemName] || '') + buyPrompt + touchPrompt;
            }
          } else if (hoveredMesh.userData.isShopItem) {
             activeTargetType = 'SHOP_ITEM';
             const { type, cost } = hoveredMesh.userData;
             const meta = ITEM_METADATA[type as ItemType];
             const rarityTag = meta ? ` [${meta.rarity}]` : '';
             const isAffordable = latest.bloodCurrency >= cost;
             activeTargetName = `${meta ? meta.name : type}${rarityTag} (${isAffordable ? 'AFFORDABLE' : 'TOO EXPENSIVE'})`;
             const buyPrompt = isGpMode ? ' [CONFIRM] TO BUY' : '';
             activeTargetDesc = `${meta ? meta.description.toUpperCase() : ITEM_DESCS[type]}. COST: ${cost} BLOOD.${buyPrompt}${touchPrompt}`;
          }
        }
      }

      if (popupEl && popupNameEl && popupDescEl) {
        if (activeTargetMesh) {
          popupNameEl.textContent = activeTargetName;
          const activeLayout = stateRef.current.controllerLayout || 'xbox';
          let stylizedDesc = activeTargetDesc;
          if (stylizedDesc.includes('[CONFIRM]')) {
             stylizedDesc = stylizedDesc.replace(/\[CONFIRM\]/g, getControllerGlyphHtml('confirm', activeLayout, 'xs'));
          }
          if (stylizedDesc.includes('[LT]')) {
             stylizedDesc = stylizedDesc.replace(/\[LT\]/g, getControllerGlyphHtml('lt', activeLayout, 'xs'));
          }
          if (stylizedDesc.includes('[RT]')) {
             stylizedDesc = stylizedDesc.replace(/\[RT\]/g, getControllerGlyphHtml('rt', activeLayout, 'xs'));
          }
          if (stylizedDesc.includes('[TAP ONCE]')) {
             stylizedDesc = stylizedDesc.replace(/\[TAP ONCE\]/g, ' <span style="display:inline-block;padding:1px 6px;background:rgba(153,27,27,0.9);border:1px solid #ef4444;color:#fff;font-size:8px;font-weight:700;letter-spacing:0.08em;vertical-align:middle;margin-left:3px;">TAP AGAIN TO TRIGGER</span>');
          }
          popupDescEl.innerHTML = stylizedDesc;

          const targetWorldPos = new THREE.Vector3();
          activeTargetMesh.getWorldPosition(targetWorldPos);

          // Fine-tuned custom visual offsets based on type for perfect alignments
          if (activeTargetType === 'ITEM') {
            targetWorldPos.y += 0.42;
          } else if (activeTargetType === 'SHOP_ITEM') {
            targetWorldPos.y += 0.35; 
          }

          targetWorldPos.project(camera);
          
          const rawX = (targetWorldPos.x * 0.5 + 0.5) * container.clientWidth;
          const rawY = (-(targetWorldPos.y * 0.5) + 0.5) * container.clientHeight;
          const x = Math.max(120, Math.min(container.clientWidth - 120, rawX));
          const y = Math.max(96, Math.min(container.clientHeight - 56, rawY));

          popupEl.style.left = `${Math.round(x)}px`;
          popupEl.style.top = `${Math.round(y)}px`;
          popupEl.style.opacity = '1';
          popupEl.style.visibility = 'visible';
        } else {
          popupEl.style.opacity = '0';
          popupEl.style.visibility = 'hidden';
        }
      } else {
        if (popupEl) {
          popupEl.style.opacity = '0';
          popupEl.style.visibility = 'hidden';
        }
      }


      // --- INTERMITTENT MUZZLE SMOKE OVER 2 SECONDS AFTER SHOOTING (LIVE ROUNDS ONLY) ---
      const nowMs = Date.now();
      if (ar.lastFireTime && ar.lastFireIsLive && nowMs - ar.lastFireTime < 2000) {
        const fireAge = nowMs - ar.lastFireTime;
        const fadeRatio = 1.0 - (fireAge / 2000);
        
        // Live round gets extremely thick and continuous smoky puffs
        const spawnOdds = 0.38 * fadeRatio * deltaScale;
        if (Math.random() < spawnOdds) {
          const barrelWorldPos = new THREE.Vector3(
            0,
            0.208,
            (!!latest.doubleDamageActive || ar.isSawedOff) ? 0.38 : 0.90
          ).applyMatrix4(gunGroup.matrixWorld);
          
          spawnParticles(
            barrelWorldPos, 
            0x888888, 
            1, 
            0.024 * fadeRatio, 
            -0.0018, 
            'SMOKE'
          );
        }
      }


      // --- SURFACE-TENSION BLOOD DRIP EMITTERS & PUDDLE CREEP ---
      const nowDripMs = Date.now();
      for (let e = bloodDripEmitters.length - 1; e >= 0; e--) {
        const em = bloodDripEmitters[e];
        if (nowDripMs - em.createdAtMs > 5400 || (em.attachToGun && nowDripMs > ar.gunBloodyUntil)) {
          if (em.beadMesh.parent) em.beadMesh.parent.remove(em.beadMesh);
          em.beadMesh.visible = false;
          airborneBloodPool.push(em.beadMesh);
          bloodDripEmitters.splice(e, 1);
          continue;
        }

        const worldAnchor = em.attachToGun
          ? em.anchor.clone().applyMatrix4(gunGroup.matrixWorld)
          : em.anchor;

        em.progress += (rawDt * 1000) / em.intervalMs;
        const swell = Math.min(1.0, em.progress);
        // Hanging teardrop visibly swells downward as gravity overcomes surface tension
        const beadW = 0.007 + swell * 0.011;
        const beadH = 0.009 + swell * swell * 0.026;
        em.beadMesh.scale.set(beadW, beadH, beadW);
        em.beadMesh.position.set(worldAnchor.x, worldAnchor.y - beadH * 0.45, worldAnchor.z);

        if (em.progress >= 1.0) {
          // Detach droplet into real gravity-accelerated fall!
          if (activeParticles.length < 850) {
            const dropSize = 0.011 + Math.random() * 0.009;
            const dropMesh = getAirborneBloodMesh(dropSize, sharedBloodMat);
            dropMesh.position.set(worldAnchor.x, worldAnchor.y - beadH * 0.8, worldAnchor.z);
            dropMesh.scale.set(dropSize, dropSize * 1.6, dropSize);
            scene.add(dropMesh);

            activeParticles.push({
              mesh: dropMesh,
              velocity: new THREE.Vector3((Math.random() - 0.5) * 0.005, -0.022 - Math.random() * 0.012, (Math.random() - 0.5) * 0.005),
              life: 0,
              maxLife: 900,
              gravity: 0.0046,
              type: 'BLOOD',
              hasLanded: false,
              bounceCount: 0,
              fromDripEmitter: true
            });
          }

          em.remainingDrips--;
          if (em.remainingDrips <= 0) {
            if (em.beadMesh.parent) em.beadMesh.parent.remove(em.beadMesh);
            em.beadMesh.visible = false;
            airborneBloodPool.push(em.beadMesh);
            bloodDripEmitters.splice(e, 1);
          } else {
            em.progress = 0;
            em.intervalMs *= 1.14; // Slows naturally as wound/surface drains & clots
          }
        }
      }

      if (activeBloodPools.length > 0) {
        let poolMatrixDirty = false;
        for (let p = activeBloodPools.length - 1; p >= 0; p--) {
          const pool = activeBloodPools[p];
          const splat = landedCoreSplats[pool.idx];
          if (!splat) {
            activeBloodPools.splice(p, 1);
            continue;
          }
          pool.age += rawDt;
          const tCreep = Math.min(1.0, pool.age / pool.maxAge);
          const easeCreep = 1.0 - Math.pow(1.0 - tCreep, 2.2);
          const spreadFactor = 1.0 + easeCreep * 0.28;

          dummyEuler.set(0, splat.rotY, 0);
          dummyQuat.setFromEuler(dummyEuler);
          dummyMatrix.compose(
            splat.pos,
            dummyQuat,
            new THREE.Vector3(
              splat.baseScale.x * spreadFactor,
              splat.baseScale.y,
              splat.baseScale.z * spreadFactor
            )
          );
          landedCoreBloodIM.setMatrixAt(pool.idx, dummyMatrix);
          poolMatrixDirty = true;

          if (pool.age >= pool.maxAge) {
            activeBloodPools.splice(p, 1);
          }
        }
        if (poolMatrixDirty) {
          landedCoreBloodIM.instanceMatrix.needsUpdate = true;
        }
      }

      // --- PARTICLES LIFETIME PROCESSING ---
      for (let i = activeParticles.length - 1; i >= 0; i--) {
        const pt = activeParticles[i];
        
        // Handle Camera Screen-Lens blood splats sliding/dripping
        if (pt.mesh.parent === camera) {
          pt.mesh.position.addScaledVector(pt.velocity, deltaScale);
          // Stretch vertically to represent a real gravity-bound dripping trail
          pt.mesh.scale.y += 0.0035 * deltaScale;
          pt.mesh.scale.x *= Math.pow(0.996, deltaScale); // slightly slimmer

          const startDecayLife = pt.maxLife * 0.55;
          if (pt.life > startDecayLife) {
            const shrink = 1.0 - (pt.life - startDecayLife) / (pt.maxLife - startDecayLife);
            const initX = pt.mesh.userData.initialScaleX || 0.005;
            const initY = pt.mesh.userData.initialScaleY || 0.005;
            pt.mesh.scale.set(
              initX * shrink,
              initY * shrink + (pt.mesh.scale.y - initY * shrink) * 0.95, // scale drip naturally
              1
            );
          }
        } else if (!pt.hasLanded) {
          pt.mesh.position.addScaledVector(pt.velocity, deltaScale);
          pt.velocity.y -= pt.gravity * deltaScale;

          // Rotational torque tumbling physics for shells/debris
          if (pt.rotVelocity) {
            pt.mesh.rotation.x += pt.rotVelocity.x * deltaScale;
            pt.mesh.rotation.y += pt.rotVelocity.y * deltaScale;
            pt.mesh.rotation.z += pt.rotVelocity.z * deltaScale;
            pt.rotVelocity.multiplyScalar(Math.pow(0.985, deltaScale)); // air resistance drag
          }

          // Bullet supersonic vapor trails
          if (pt.type === 'BULLET') {
            if (Math.random() < 0.6 * deltaScale) {
              spawnParticles(pt.mesh.position.clone(), 0xdddddd, 1, 0.01, -0.0002, 'SMOKE');
            }
          }

          // Align blood/sparks/bullet mesh rotation with its trajectory vector & directional motion blur stretch
          if ((pt.type === 'BLOOD' || pt.type === 'SPARK' || pt.type === 'BULLET') && pt.velocity.lengthSq() > 0.0001) {
            const dir = pt.velocity.clone().normalize();
            pt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            if (pt.type === 'BLOOD') {
              const speed = pt.velocity.length();
              const sz = pt.mesh.userData.size || 0.016;
              pt.mesh.scale.set(sz, sz * (1.2 + Math.min(3.2, speed * 22.0)), sz);
            }
          }

          // Hit table surface or floor detection
          const pWorld = pt.mesh.position.clone();

          // Table surface Y is exactly 0.553. Check collision strictly when particle passes through table top plane.
          const hitsTableTop = (
            pt.mesh.position.y <= 0.558 &&
            pt.mesh.position.y >= 0.38 &&
            Math.abs(pt.mesh.position.x) <= 3.25 &&
            pt.mesh.position.z >= -2.80 &&
            pt.mesh.position.z <= 1.60
          );

          // Floor surface Y is -0.89 (floor mesh position y = -0.9)
          const hitsFloor = !hitsTableTop && (pt.mesh.position.y <= -0.88);

          if (hitsTableTop || hitsFloor) {
            const surfaceY = hitsTableTop ? 0.553 : -0.89;

            if (pt.type === 'BLOOD' || pt.type === 'LIQUID') {
              const isLiquidSplash = pt.type === 'LIQUID';
              const speed = pt.velocity.length();
              const trajAngle = Math.atan2(pt.velocity.x, pt.velocity.z || 0.001);
              let impactWorldPos = new THREE.Vector3(pWorld.x, surfaceY, pWorld.z);
              
              let ptColor = isLiquidSplash ? 0x8c3409 : 0x2a0000;
              if (pt.mesh.material && 'color' in pt.mesh.material) {
                 ptColor = (pt.mesh.material as any).color.getHex();
              }

              const clampToTable = (pos: THREE.Vector3) => {
                if (hitsTableTop) {
                  pos.x = Math.max(-3.18, Math.min(3.18, pos.x));
                  pos.z = Math.max(-2.73, Math.min(1.53, pos.z));
                }
                return pos;
              };

              if (hitsTableTop) {
                impactWorldPos = clampToTable(impactWorldPos);
              }

              // Procedural surface-synced liquid droplet impact SFX (never spam from splash clouds or infinite loops)
              if (pt.type === 'BLOOD' && (pt.fromDripEmitter || (pt.bounceCount === 0 && speed > 0.08 && Math.random() < 0.18))) {
                playBloodDrip(hitsTableTop ? 'table' : 'floor', Math.min(1.0, 0.35 + speed * 2.5));
              }

              const pxStep = hitsFloor ? 0.065 : 0.042;
              const wPx = pxStep * (2.8 + Math.random() * 2.2) * (isLiquidSplash ? 0.92 : 1.0);
              const lPx = pxStep * (3.0 + Math.min(5.0, speed * 35)) * (isLiquidSplash ? 0.92 : 1.0);

              // 1. Core Octagonal Puddle + register wet pool creep (persists on table/floor across turns just like blood)
              const coreIdx = addLandedSplat('CORE', new THREE.Vector3(impactWorldPos.x, surfaceY + 0.0004, impactWorldPos.z), trajAngle + (Math.floor(Math.random() * 4) * (Math.PI / 2)), new THREE.Vector3(wPx * 1.15, 0.001, lPx * 1.15), ptColor);
              if (coreIdx >= 0 && activeBloodPools.length < 45) {
                activeBloodPools.push({ idx: coreIdx, age: 0, maxAge: 2.2 });
              }

              // Wet dark inner pooling & glossy rim detail
              if (Math.random() < 0.45) {
                addLandedSplat('DARK', new THREE.Vector3(impactWorldPos.x, surfaceY + 0.0007, impactWorldPos.z), trajAngle, new THREE.Vector3(wPx * 0.65, 0.0012, lPx * 0.65), isLiquidSplash ? 0x6e2806 : 0x1a0000);
                if (Math.random() < 0.4) {
                  addLandedSplat('BRIGHT', new THREE.Vector3(impactWorldPos.x + (Math.random() - 0.5) * wPx * 0.3, surfaceY + 0.0009, impactWorldPos.z + (Math.random() - 0.5) * lPx * 0.3), trajAngle, new THREE.Vector3(wPx * 0.25, 0.0014, lPx * 0.25), isLiquidSplash ? 0xb85214 : 0x5c0404);
                }
              }

              // 2. Trajectory Stepped Drips
              const dripCount = 2 + Math.floor(Math.random() * 3);
              for (let d = 0; d < dripCount; d++) {
                const dW = wPx * (0.35 + Math.random() * 0.35);
                const dL = lPx * (0.4 + Math.random() * 0.5);
                const offZ = (lPx * 0.45) + (d * dL * 0.75);
                const offX = (Math.random() - 0.5) * wPx * 0.5;
                const dripPos = impactWorldPos.clone().add(new THREE.Vector3(offX, 0.0005, offZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), trajAngle));
                addLandedSplat('CORE', clampToTable(dripPos), trajAngle, new THREE.Vector3(dW, 0.002, dL), ptColor);
              }

              // 3. Satellite Micro-Pixel Voxels
              const satCount = 3 + Math.floor(Math.random() * 4);
              for (let s = 0; s < satCount; s++) {
                const sW = pxStep * (0.8 + Math.random() * 1.2);
                const sL = pxStep * (0.8 + Math.random() * 1.2);
                const dist = wPx * (0.8 + Math.random() * 1.1);
                const angle = Math.random() * Math.PI * 2;
                const satPos = impactWorldPos.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0.0005, Math.sin(angle) * dist));
                addLandedSplat('CORE', clampToTable(satPos), angle, new THREE.Vector3(sW, 0.002, sL), ptColor);
              }

              // 4. High-energy secondary splash droplets arcing off table surface
              if (pt.type === 'BLOOD' && !pt.fromDripEmitter && pt.bounceCount === 0 && speed > 0.14 && activeParticles.length < 750 && Math.random() < 0.42) {
                const splashCount = 2 + (Math.random() < 0.35 ? 1 : 0);
                for (let sp = 0; sp < splashCount; sp++) {
                  const sSize = 0.007 + Math.random() * 0.007;
                  const sMesh = getAirborneBloodMesh(sSize, sharedBloodMat);
                  sMesh.position.set(impactWorldPos.x, surfaceY + 0.015, impactWorldPos.z);
                  sMesh.scale.set(sSize, sSize, sSize);
                  scene.add(sMesh);
                  const spAngle = Math.random() * Math.PI * 2;
                  const spLat = 0.03 + Math.random() * 0.07;
                  activeParticles.push({
                    mesh: sMesh,
                    velocity: new THREE.Vector3(
                      pt.velocity.x * 0.25 + Math.cos(spAngle) * spLat,
                      0.035 + Math.random() * 0.055,
                      pt.velocity.z * 0.25 + Math.sin(spAngle) * spLat
                    ),
                    life: 0,
                    maxLife: 300,
                    gravity: 0.0044,
                    type: 'BLOOD',
                    hasLanded: false,
                    bounceCount: 1,
                    fromDripEmitter: true
                  });
                }
              }

              // 5. Register overhanging drip emitter just OUTSIDE tabletop edge (never self-retriggering)
              if (pt.type === 'BLOOD' && !pt.fromDripEmitter && pt.bounceCount === 0 && hitsTableTop && (Math.abs(impactWorldPos.x) > 2.55 || impactWorldPos.z > 1.05 || impactWorldPos.z < -2.35) && Math.random() < 0.34) {
                const edgePos = impactWorldPos.clone();
                if (Math.abs(edgePos.x) > 2.55) edgePos.x = Math.sign(edgePos.x) * 3.28;
                if (edgePos.z > 1.05) edgePos.z = 1.63;
                if (edgePos.z < -2.35) edgePos.z = -2.83;
                edgePos.y = 0.535;
                registerBloodDripEmitter(edgePos, 4 + Math.floor(Math.random() * 3), false);
              }

              // Recycle airborne droplet mesh
              if (pt.mesh.parent) pt.mesh.parent.remove(pt.mesh);
              if (pt.mesh.userData?.isPooled) {
                pt.mesh.visible = false;
                airborneBloodPool.push(pt.mesh);
              } else {
                disposeNode(pt.mesh);
              }
              activeParticles.splice(i, 1);
              continue;
            } else if (pt.type === 'BULLET') {
              // Bullet impact -> sparks & wood shrapnel
              spawnParticles(pt.mesh.position.clone(), 0xffaa00, 25, 0.35, 0.002, 'SPARK');
              spawnParticles(pt.mesh.position.clone(), 0x5a2d0c, 12, 0.25, 0.003, 'DEBRIS');
              pt.hasLanded = true;
              pt.life = pt.maxLife; // expire projectile
            } else if (pt.type === 'SPARK' || pt.type === 'SHELL' || pt.type === 'DEBRIS') {
              // Bouncing casing / debris physics
              pt.mesh.position.y = surfaceY;

              // Shatter glass whiskey bottle on first impact
              if (pt.type === 'DEBRIS' && pt.mesh.userData?.itemType === 'WHISKEY' && pt.bounceCount === 0) {
                import('../audio').then(a => a.playGlassBreakSound());
                
                // Realistically shatter into glass shards
                const numShards = 8 + Math.floor(Math.random() * 8);
                const glassMat = new THREE.MeshStandardMaterial({
                  color: 0x4a2a10,
                  roughness: 0.1,
                  metalness: 0.1,
                  transparent: true,
                  opacity: 0.8
                });
                
                for (let s = 0; s < numShards; s++) {
                  // Random shard geometry
                  const w = 0.02 + Math.random() * 0.06;
                  const h = 0.02 + Math.random() * 0.08;
                  const d = 0.01 + Math.random() * 0.03;
                  const shardGeo = new THREE.BoxGeometry(w, h, d);
                  // Give it some random jagged vertices if possible, but box is fine if rotated
                  const shardMesh = new THREE.Mesh(shardGeo, glassMat);
                  shardMesh.position.copy(pt.mesh.position);
                  shardMesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                  
                  activeParticles.push({
                    mesh: shardMesh as any,
                    velocity: new THREE.Vector3(
                      (Math.random() - 0.5) * 0.25,
                      Math.random() * 0.15,
                      (Math.random() - 0.5) * 0.25
                    ).add(pt.velocity.clone().multiplyScalar(0.3)),
                    rotVelocity: new THREE.Vector3(
                      (Math.random() - 0.5) * 0.5,
                      (Math.random() - 0.5) * 0.5,
                      (Math.random() - 0.5) * 0.5
                    ),
                    life: 0,
                    maxLife: 2.0 + Math.random(),
                    gravity: 0.0035,
                    type: 'DEBRIS',
                    hasLanded: false,
                    bounceCount: 0
                  });
                  scene.add(shardMesh);
                }

                // Splash whiskey liquid
                spawnParticles(pt.mesh.position.clone(), 0x8c3409, 25, 0.18, 0.002, 'LIQUID');
                
                if (pt.mesh.parent) pt.mesh.parent.remove(pt.mesh);
                disposeNode(pt.mesh);
                
                activeParticles.splice(i, 1);
                continue;
              }

              pt.velocity.y *= -0.45; // bounce dampening
              pt.velocity.x *= 0.65;
              pt.velocity.z *= 0.65;
              
              if (pt.rotVelocity) {
                pt.rotVelocity.set(
                  (Math.random() - 0.5) * 0.35,
                  (Math.random() - 0.5) * 0.35,
                  (Math.random() - 0.5) * 0.35
                );
              }

              pt.bounceCount++;
              if (pt.bounceCount > 3 || pt.velocity.lengthSq() < 0.0001) {
                pt.hasLanded = true;
                pt.velocity.set(0, 0, 0);
                if (pt.rotVelocity) pt.rotVelocity.set(0, 0, 0);
              }
            }
          }
        } else if (pt.type === 'BLOOD' || pt.type === 'LIQUID') {
          // Slow initial creep / oozing puddle expansion for first 35 frames
          if (pt.life < 35) {
            pt.mesh.scale.x += 0.00015 * deltaScale;
            pt.mesh.scale.z += 0.00015 * deltaScale;
          }

          // Dynamic falling droplets from table edge lip stains
          if (pt.mesh.userData?.isTableEdgeDrip && Math.random() < 0.018 * deltaScale && activeParticles.length < 850) {
            const edgeP = pt.mesh.userData.edgePos as THREE.Vector3;
            if (edgeP) {
              const dripOrigin = edgeP.clone();
              dripOrigin.y -= 0.15; // Start from bottom edge of table apron face
              spawnParticles(dripOrigin, 0x2a0000, 1, 0.01, 0.003, 'BLOOD');
            }
          }
          
          const startDecayLife = pt.maxLife * 0.85;
          if (pt.life > startDecayLife) {
            const shrink = 1.0 - (pt.life - startDecayLife) / (pt.maxLife - startDecayLife);
            if (!pt.mesh.userData.scaleBeforeDecayX) {
              pt.mesh.userData.scaleBeforeDecayX = pt.mesh.scale.x;
              pt.mesh.userData.scaleBeforeDecayY = pt.mesh.scale.y;
              pt.mesh.userData.scaleBeforeDecayZ = pt.mesh.scale.z;
            }
            const baseX = pt.mesh.userData.scaleBeforeDecayX;
            const baseY = pt.mesh.userData.scaleBeforeDecayY ?? pt.mesh.scale.y;
            const baseZ = pt.mesh.userData.scaleBeforeDecayZ;
            pt.mesh.scale.set(baseX * Math.max(0, shrink), baseY, baseZ * Math.max(0, shrink));
          }
        }

        // Custom realistic gaseous drift & expansion for drifting smoke
        if (pt.type === 'SMOKE') {
          const ageRatio = pt.life / pt.maxLife;

          // Smoke experiences a delicate atmospheric draft from the moving barrel
          const followFactor = Math.pow(Math.max(0.0, 1.0 - ageRatio), 2.5) * 0.12;
          pt.mesh.position.addScaledVector(muzzleDelta, followFactor);

          // Smooth gaseous cloud expansion into soft atmospheric wisps
          const expansion = 1.0 + Math.pow(ageRatio, 0.7) * 3.5;
          
          const initX = pt.mesh.userData.initialScaleX || pt.mesh.userData.initialScale || 0.024;
          const initY = pt.mesh.userData.initialScaleY || pt.mesh.userData.initialScale || 0.024;
          const initZ = pt.mesh.userData.initialScaleZ || pt.mesh.userData.initialScale || 0.024;
          
          pt.mesh.scale.set(
            initX * expansion,
            initY * expansion,
            initZ * expansion
          );

          // Smooth realistic alpha dissipation: fade in over first 12% of life, then smoothly fade out to 0
          let alpha = 1.0;
          if (ageRatio < 0.12) {
            alpha = ageRatio / 0.12;
          } else {
            alpha = Math.pow(1.0 - (ageRatio - 0.12) / 0.88, 1.6);
          }

          if (pt.mesh.material && 'opacity' in pt.mesh.material) {
            const baseOp = pt.mesh.userData.baseOpacity || 0.12;
            (pt.mesh.material as THREE.Material).opacity = Math.max(0, baseOp * alpha);
          }

          if (pt.mesh.userData.isSmokeSprite) {
            pt.mesh.quaternion.copy(camera.quaternion);
            pt.mesh.userData.rollAngle = (pt.mesh.userData.rollAngle ?? 0) + (pt.mesh.userData.rotSpeedZ || 0.01) * deltaScale;
            pt.mesh.rotateZ(pt.mesh.userData.rollAngle);
          } else {
            // Dynamic slow turbulent swirling rotation
            pt.mesh.rotation.x += (pt.mesh.userData.rotSpeedX || 0.01) * deltaScale;
            pt.mesh.rotation.y += (pt.mesh.userData.rotSpeedY || 0.01) * deltaScale;
            pt.mesh.rotation.z += (pt.mesh.userData.rotSpeedZ || 0.01) * deltaScale;
          }

          // Drift smoke on a delicate wavy atmospheric path
          pt.velocity.x += Math.sin(pt.life * 0.05 + pt.mesh.position.y * 10) * 0.00012 * deltaScale;
          pt.velocity.z += Math.cos(pt.life * 0.04 + pt.mesh.position.y * 8) * 0.00012 * deltaScale;

          // Air drag deceleration
          pt.velocity.x *= Math.pow(0.93, deltaScale);
          pt.velocity.z *= Math.pow(0.93, deltaScale);
          pt.velocity.y *= Math.pow(0.95, deltaScale);
        }
        
        if (pt.type === 'DEBRIS' || pt.type === 'SHELL') {
          const fadeStartLife = pt.maxLife * 0.8;
          if (pt.life > fadeStartLife) {
            const fade = Math.max(0, 1.0 - (pt.life - fadeStartLife) / (pt.maxLife - fadeStartLife));
            pt.mesh.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const cMesh = child as THREE.Mesh;
                if (cMesh.material) {
                  const applyFade = (mat: THREE.Material, idx?: number) => {
                    if (!mat.userData.isFadingClone) {
                      const clonedMat = mat.clone();
                      clonedMat.userData.isFadingClone = true;
                      if (idx !== undefined && Array.isArray(cMesh.material)) {
                        cMesh.material[idx] = clonedMat;
                      } else {
                        cMesh.material = clonedMat;
                      }
                      mat = clonedMat;
                    }
                    mat.transparent = true;
                    mat.opacity = fade;
                  };

                  if (Array.isArray(cMesh.material)) {
                    cMesh.material.forEach((m, i) => applyFade(m, i));
                  } else {
                    applyFade(cMesh.material as THREE.Material);
                  }
                }
              }
            });
            
            if (pt.mesh.userData.baseScaleBeforeFadeX === undefined) {
              pt.mesh.userData.baseScaleBeforeFadeX = pt.mesh.scale.x;
              pt.mesh.userData.baseScaleBeforeFadeY = pt.mesh.scale.y;
              pt.mesh.userData.baseScaleBeforeFadeZ = pt.mesh.scale.z;
            }
            pt.mesh.scale.set(
              pt.mesh.userData.baseScaleBeforeFadeX * fade,
              pt.mesh.userData.baseScaleBeforeFadeY * fade,
              pt.mesh.userData.baseScaleBeforeFadeZ * fade
            );
          }
        }

        pt.life += deltaScale;

        if (pt.life > pt.maxLife) {
          if (pt.mesh.parent) {
            pt.mesh.parent.remove(pt.mesh);
          } else {
            scene.remove(pt.mesh);
          }
          if (pt.mesh.userData?.isPooled) {
            pt.mesh.visible = false;
            airborneBloodPool.push(pt.mesh);
          } else {
            if (pt.mesh.geometry && !sharedGeometries.has(pt.mesh.geometry)) {
              pt.mesh.geometry.dispose();
            }
            if (pt.mesh.material) {
              const disposeMaterialComp = (mat: THREE.Material) => {
                if (!sharedMaterials.has(mat)) {
                  mat.dispose();
                }
              };
              if (Array.isArray(pt.mesh.material)) {
                pt.mesh.material.forEach(disposeMaterialComp);
              } else {
                disposeMaterialComp(pt.mesh.material);
              }
            }
          }
          activeParticles.splice(i, 1);
        }
      }


      // --- CAMERA DECELERATIONS AND SHAKE KICKS ---
      // --- PLAYER DEATH ANIMATION: INSTANT HEAVY PHYSICS & RAGDOLL POV COLLAPSE ---
      if (latest.player.health <= 0) {
        if (ar.deathAnimStartTime === 0) {
          ar.deathAnimStartTime = Date.now();
          // Instant visceral blood spray burst right in front of POV camera
          spawnParticles(new THREE.Vector3(camera.position.x, camera.position.y - 0.2, camera.position.z - 0.3), 0x4a0000, 70, 0.35, -0.003, 'BLOOD');
          spawnParticles(new THREE.Vector3(camera.position.x + 0.1, camera.position.y - 0.1, camera.position.z - 0.4), 0x520000, 45, 0.28, -0.002, 'BLOOD');
          vibrateGamepad('jolt', { duration: 300, weak: 1.0, strong: 1.0 });
          ar.cameraShakeIntensity = 1.5;
        }
        const rawDeath = (Date.now() - ar.deathAnimStartTime) / 1000;

        // Smooth mouse look inertia during dying sequence - heavy sluggish neck weight
        ar.smoothMouseX += (mouse.x - ar.smoothMouseX) * damp(0.035);
        ar.smoothMouseY += (mouse.y - ar.smoothMouseY) * damp(0.035);

        const lookWeight = Math.max(0.15, 1.0 - rawDeath * 0.25);
        const mouseLookX = ar.smoothMouseX * lookWeight;
        const mouseLookY = ar.smoothMouseY * lookWeight;
        
        // Heavy 2.9s Ragdoll POV death collapse
        if (rawDeath < 1.30 && Math.random() < 0.35 * deltaScale) {
          spawnParticles(
            new THREE.Vector3(camera.position.x + 0.08, camera.position.y - 0.18, camera.position.z - 0.25),
            0x3a0000,
            4,
            0.11,
            0.003,
            'BLOOD'
          );
        }
        if (rawDeath < 0.45) {
          // Phase 1: Sudden Kinetic Bullet Shock - head snaps backward limply
          const t1 = rawDeath / 0.45;
          const ease1 = t1 * t1;

          camera.position.y = 3.4 + (0.22 * Math.sin(t1 * Math.PI)) + mouseLookY * 0.12;
          camera.position.z = 5.5 + (0.42 * ease1); // Driven backward by impact force
          camera.position.x = mouseLookX * 0.25;
          camera.rotation.z = -0.24 * ease1 + mouseLookX * 0.12;
          camera.rotation.x = -0.48 * ease1 + mouseLookY * 0.12;
          ar.lookTargetY = 0.6 + (0.60 * ease1) + mouseLookY * 0.4;
        } else if (rawDeath < 1.30) {
          // Phase 2: Spinal Motor Failure & Heavy Chest Slump onto Table Edge
          const t2 = (rawDeath - 0.45) / 0.85;
          const ease2 = Math.pow(t2, 2.5); // Exponential mass gravitational drop

          const baseY = 3.4 - (2.55 * ease2); // Sags heavily down to tabletop surface (~0.85)
          const baseZ = 5.92 - (1.28 * ease2); // Slumps forward over table
          const baseX = 0.38 * ease2;

          camera.position.y = baseY + mouseLookY * 0.15;
          camera.position.z = baseZ;
          camera.position.x = baseX + mouseLookX * 0.3;

          camera.rotation.z = -0.24 + (0.42 * ease2) + mouseLookX * 0.15;
          camera.rotation.x = -0.48 + (0.92 * ease2) + mouseLookY * 0.15;
          ar.lookTargetY = 1.20 - (1.10 * ease2) + mouseLookY * 0.4;

          // First Impact: Cheek/Chest slams onto hardwood table
          if (t2 >= 0.80 && !ar.hasThumpedPlayerTable) {
            ar.hasThumpedPlayerTable = true;
            import('../audio').then(a => a.playThumpSound());
            playBloodImpactSplatter(0.55);
            vibrateGamepad('jolt', { duration: 180, weak: 0.85, strong: 0.95 });
            ar.cameraShakeIntensity = 0.9;
            spawnParticles(new THREE.Vector3(0, 0.85, 4.6), 0x450000, 48, 0.12, -0.002, 'BLOOD');
            spawnScreenSplat();
          }
        } else if (rawDeath < 2.10) {
          // Phase 3: Unconscious Inertia Sliding Sideways off Chair down to Floor
          const t3 = (rawDeath - 1.30) / 0.80;
          const ease3 = Math.pow(t3, 2.0);

          const baseY = 0.85 - (0.67 * ease3); // Drops down to floor tiles level (~0.18)
          const baseZ = 4.64 + (0.58 * ease3);
          const baseX = 0.38 + (0.42 * ease3);

          camera.position.y = baseY + mouseLookY * 0.10;
          camera.position.z = baseZ;
          camera.position.x = baseX + mouseLookX * 0.35;

          // Camera rolls onto side lying on cheek on cold floor
          camera.rotation.z = 0.18 - (1.68 * ease3) + mouseLookX * 0.18;
          camera.rotation.x = 0.44 - (0.64 * ease3) + mouseLookY * 0.18;
          ar.lookTargetY = 0.10 - (0.05 * ease3) + mouseLookY * 0.3;
        } else if (rawDeath < 2.90) {
          // Phase 4: Full Heavy Body Mass Floor Impact & Absorbed Rebound
          const t4 = rawDeath - 2.10;

          if (!ar.hasThumpedPlayerFall) {
            ar.hasThumpedPlayerFall = true;
            import('../audio').then(a => a.playThumpSound());
            playBloodImpactSplatter(0.8);
            vibrateGamepad('jolt', { duration: 260, weak: 1.0, strong: 1.0 });
            ar.cameraShakeIntensity = 1.4;
            spawnParticles(new THREE.Vector3(0.75, -0.75, 5.10), 0x2a0000, 55, 0.18, 0.003, 'BLOOD');
            registerBloodDripEmitter(new THREE.Vector3(0.72, -0.78, 5.12), 8, false);
          }

          // Heavy body mass dampening rebound
          const bounce = Math.exp(-6.5 * t4) * Math.sin(12 * t4) * 0.055;

          camera.position.y = 0.18 + bounce + mouseLookY * 0.08;
          camera.position.z = 5.22;
          camera.position.x = 0.80 + mouseLookX * 0.35;

          camera.rotation.z = -1.50 - (bounce * 0.5) + mouseLookX * 0.15;
          camera.rotation.x = -0.20 + mouseLookY * 0.15;
          ar.lookTargetY = 0.05 + mouseLookY * 0.25;
        } else {
          // Phase 5: Final Settled Resting Pose on Floor
          camera.position.set(0.80 + mouseLookX * 0.35, 0.18 + mouseLookY * 0.08, 5.22);
          camera.rotation.z = -1.50 + mouseLookX * 0.15;
          camera.rotation.x = -0.20 + mouseLookY * 0.15;
          ar.lookTargetY = 0.05 + mouseLookY * 0.25;
        }
      } else {
        ar.deathAnimStartTime = 0;
        ar.hasThumpedPlayerFall = false;
        ar.hasThumpedPlayerTable = false;
        camera.rotation.z = 0;
        camera.rotation.x = 0;
        ar.lookTargetY = 0.6;

        ar.cameraShakeIntensity *= Math.pow(0.88, deltaScale);
        const shakeX = (Math.random() - 0.5) * ar.cameraShakeIntensity * 0.45;
        const shakeY = (Math.random() - 0.5) * ar.cameraShakeIntensity * 0.45;
        const shakeZ = (Math.random() - 0.5) * ar.cameraShakeIntensity * 0.25;

        // Exponential decay of camera kickback
        ar.cameraKickZ = (ar.cameraKickZ || 0) * Math.pow(0.83, deltaScale);
        ar.cameraKickPitch = (ar.cameraKickPitch || 0) * Math.pow(0.81, deltaScale);
        ar.cameraKickRoll = (ar.cameraKickRoll || 0) * Math.pow(0.82, deltaScale);

        // Heavy, organic camera sway and mouse parallax when alive
        ar.smoothMouseX += (mouse.x - ar.smoothMouseX) * damp(0.04);
        ar.smoothMouseY += (mouse.y - ar.smoothMouseY) * damp(0.04);

        const handSwayX = Math.sin(time * 0.9) * 0.035;
        const handSwayY = Math.cos(time * 0.70) * 0.025;

        // Apply position and look-target parallax for a heavy, physical camera presence
        const parallaxX = ar.smoothMouseX * 0.38;
        const parallaxY = ar.smoothMouseY * 0.24;

        const isActionControllingCamera =
          latest.gameState === 'ITEM_USE' ||
          latest.gameState === 'SHOOTING' ||
          latest.gameState === 'LOADING';

        if (!isActionControllingCamera) {
          ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.10));
          ar.actionLookOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.10));
        }

        camera.position.copy(stateRef.current.camPosVec);
        camera.position.x += handSwayX + shakeX + parallaxX + ar.actionCamOffset.x;
        camera.position.y += handSwayY + shakeY + parallaxY + ar.actionCamOffset.y;
        camera.position.z += shakeZ + ar.cameraKickZ + ar.actionCamOffset.z;

        if (stateRef.current.lookTargetVec) {
          stateRef.current.lookTargetVec.x += ar.smoothMouseX * 0.65 * damp(0.12) + ar.actionLookOffset.x * damp(0.2);
          stateRef.current.lookTargetVec.y += ar.smoothMouseY * 0.45 * damp(0.12) + ar.actionLookOffset.y * damp(0.2);
        }
      }

      // --- LOADING ANIMATION: CLOSE-UP PERSONAL CYLINDER RELOAD ---
      if (latest.gameState === 'LOADING') {
        if (ar.loadingAnimStartTime === 0) {
          ar.loadingAnimStartTime = Date.now();
          ar.bulletLoadedFlags = [false, false, false, false, false, false];
          ar.hasSpunCylinder = false;
          ar.hasClosedCylinder = false;
        }
        const loadElapsed = (Date.now() - ar.loadingAnimStartTime) / 1000;
        const { bCam, fwd, rgt, up } = getCamBasis();

        const reloadClosePos = bCam.clone()
          .addScaledVector(fwd, 1.32)
          .addScaledVector(up, -0.22)
          .addScaledVector(rgt, -0.04);
        const reloadQuat = makeGunBasisQuat(
          fwd.clone().multiplyScalar(0.55).addScaledVector(rgt, 0.78).addScaledVector(up, 0.20).normalize(),
          up.clone().addScaledVector(rgt, -0.50).normalize()
        );
        const restQuat = new THREE.Quaternion().setFromEuler(initialGunRot);

        if (loadElapsed < 0.42) {
          // Raise revolver close up to chest/eyes, slide thumb latch & swing out crane
          const t = loadElapsed / 0.42;
          const easeT = 1 - Math.pow(1 - t, 3);
          const pos = new THREE.Vector3().lerpVectors(initialGunPos, reloadClosePos, easeT);
          pos.y += Math.sin(t * Math.PI) * 0.10;
          gunGroup.position.lerp(pos, damp(0.28));
          gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(restQuat, reloadQuat, easeT), damp(0.26));
          ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.08 * easeT).addScaledVector(up, -0.03 * easeT), damp(0.14));
          hammerPivotGroup.rotation.x = 0;

          const latchT = Math.min(1, t * 2.2);
          cylinderLatchMesh.position.z = THREE.MathUtils.lerp(-0.315, -0.265, latchT);
          const swingT = Math.max(0, Math.min(1, (t - 0.18) / 0.82));
          cylinderSwingGroup.rotation.z = 1.28 * (1 - Math.pow(1 - swingT, 2));
          updateChambersState(latest.chambers, null);
          for (let c = 0; c < chamberCartridges.length; c++) {
            chamberCartridges[c].visible = false;
            chamberCartridges[c].position.z = -0.24;
          }
        } else if (loadElapsed < 1.42) {
          // Sequential shell loading directly into open chambers in front of player
          const bulletTime = (loadElapsed - 0.42) / 1.00;
          const bulletIdx = Math.min(5, Math.floor(bulletTime * 6));
          const perBulletFrac = (bulletTime * 6) - bulletIdx;

          cylinderLatchMesh.position.z = -0.265;
          cylinderSwingGroup.rotation.z = 1.28;
          updateChambersState(latest.chambers, null);

          for (let c = 0; c < chamberCartridges.length; c++) {
            if (c < bulletIdx) {
              chamberCartridges[c].visible = true;
              chamberCartridges[c].position.z = 0;
            } else if (c === bulletIdx) {
              chamberCartridges[c].visible = true;
              const dropEase = 1 - Math.pow(1 - Math.min(1, perBulletFrac * 1.35), 2);
              chamberCartridges[c].position.z = THREE.MathUtils.lerp(-0.24, 0, dropEase);
            } else {
              chamberCartridges[c].visible = false;
              chamberCartridges[c].position.z = -0.24;
            }
          }

          if (!ar.bulletLoadedFlags[bulletIdx]) {
            ar.bulletLoadedFlags[bulletIdx] = true;
            playBulletLoad();
            gunGroup.updateMatrixWorld(true);
            const cylWorld = new THREE.Vector3(-0.14, 0.12, -0.10).applyMatrix4(gunGroup.matrixWorld);
            spawnParticles(cylWorld, 0xffcc44, 4, 0.045, 0.001, 'SPARK');
            vibrateGamepad('jolt', { duration: 40, weak: 0.12, strong: 0.9 });
          }

          const pulseDip = Math.abs(Math.sin(bulletTime * Math.PI * 6)) * 0.022;
          const loadPos = reloadClosePos.clone().addScaledVector(up, -pulseDip);
          gunGroup.position.lerp(loadPos, damp(0.32));
          gunGroup.quaternion.slerp(reloadQuat, damp(0.26));
          ar.actionCamOffset.lerp(fwd.clone().multiplyScalar(0.08).addScaledVector(up, -0.03), damp(0.14));

          cylinderSpinGroup.rotation.z += 0.12 * deltaScale;
          drumMesh.rotation.y += 0.12 * deltaScale;
        } else if (loadElapsed < 1.84) {
          // Crisp wrist flick spinning the cylinder & slamming crane locked shut
          const spinT = (loadElapsed - 1.42) / 0.42;
          const flickTilt = Math.sin(spinT * Math.PI) * 0.24;
          const flickQuat = new THREE.Quaternion().setFromAxisAngle(fwd, flickTilt).multiply(reloadQuat);

          updateChambersState(latest.chambers, null);
          for (let c = 0; c < chamberCartridges.length; c++) {
            chamberCartridges[c].position.z = 0;
          }

          if (spinT >= 0.62) {
            const closeEase = Math.min(1, (spinT - 0.62) / 0.28);
            cylinderSwingGroup.rotation.z = 1.28 * (1 - closeEase * closeEase);
            cylinderLatchMesh.position.z = THREE.MathUtils.lerp(-0.265, -0.315, closeEase);
          } else {
            cylinderSwingGroup.rotation.z = 1.28;
            cylinderLatchMesh.position.z = -0.265;
          }

          if (!ar.hasSpunCylinder) {
            ar.hasSpunCylinder = true;
            vibrateGamepad('weak', { duration: 180, weak: 0.45, strong: 0.2 });
          }
          if (spinT >= 0.78 && !ar.hasClosedCylinder) {
            ar.hasClosedCylinder = true;
            playCockSound();
            vibrateGamepad('jolt', { duration: 50, weak: 0.2, strong: 0.85 });
          }
          if (ar.hasClosedCylinder) {
            hammerPivotGroup.rotation.x = -0.68;
          }

          gunGroup.position.lerp(reloadClosePos, damp(0.28));
          gunGroup.quaternion.slerp(flickQuat, damp(0.32));

          const spinSpeed = 0.55 * (1 - spinT * 0.75);
          cylinderSpinGroup.rotation.z += spinSpeed * deltaScale;
          drumMesh.rotation.y += spinSpeed * deltaScale;
        } else {
          // Solidly return revolver back down onto wooden table
          cylinderSwingGroup.rotation.z = 0;
          cylinderLatchMesh.position.z = -0.315;
          updateChambersState(latest.chambers, null);
          for (let c = 0; c < chamberCartridges.length; c++) {
            chamberCartridges[c].position.z = 0;
          }
          hammerPivotGroup.rotation.x = -0.68;
          const lowerT = Math.min(1.0, (loadElapsed - 1.84) / 0.36);
          const easeL = lowerT * lowerT * (3 - 2 * lowerT);
          const bounce = lowerT > 0.7
            ? Math.abs(Math.sin((lowerT - 0.7) * Math.PI * 2.2)) * Math.exp(-5.0 * (lowerT - 0.7)) * 0.015
            : 0;
          const pos = new THREE.Vector3().lerpVectors(reloadClosePos, initialGunPos, easeL);
          pos.y += bounce;
          gunGroup.position.lerp(pos, damp(0.28));
          gunGroup.quaternion.slerp(new THREE.Quaternion().slerpQuaternions(reloadQuat, restQuat, easeL), damp(0.26));
          ar.actionCamOffset.lerp(new THREE.Vector3(0, 0, 0), damp(0.14));
          ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, 0, 8.0, rawDt);
        }
      } else {
        ar.loadingAnimStartTime = 0;
      }

      // --- DYNAMIC TV HEALTH MONITORS AND INDENT GLOW UPDATES ---
      const latestPlayerHP = latest.player.health;
      const latestPlayerMax = latest.player.maxHealth;
      const latestDealerHP = latest.dealer.health;
      const latestDealerMax = latest.dealer.maxHealth;

      // Render updated text readout sheets to textures only on mechanical health changes
      if (latestPlayerHP !== lastTvPlayerHP || latestPlayerMax !== lastTvPlayerMax) {
        lastTvPlayerHP = latestPlayerHP;
        lastTvPlayerMax = latestPlayerMax;
        updatePlayerNumericTex(latestPlayerHP, latestPlayerMax);
      }
      if (latestDealerHP !== lastTvDealerHP || latestDealerMax !== lastTvDealerMax) {
        lastTvDealerHP = latestDealerHP;
        lastTvDealerMax = latestDealerMax;
        updateDealerNumericTex(latestDealerHP, latestDealerMax);
      }

      // Fluid progression animations: dynamic ratio scaling
      const tvPHealthRatio = Math.max(0.0001, Math.min(1.0, latestPlayerHP / latestPlayerMax));
      const tvDHealthRatio = Math.max(0.0001, Math.min(1.0, latestDealerHP / latestDealerMax));

      // LERP scale to give an inert mercury-like dial rise/fall
      tvPGlowMesh.scale.x = tvPGlowMesh.scale.x * (1 - damp(0.12)) + (tvPHealthRatio * 1.70) * damp(0.12);
      tvDGlowMesh.scale.x = tvDGlowMesh.scale.x * (1 - damp(0.12)) + (tvDHealthRatio * 1.70) * damp(0.12);

      // Hide glow meshes entirely if health goes to 0 or below
      tvPGlowMesh.visible = latestPlayerHP > 0;
      tvDGlowMesh.visible = latestDealerHP > 0;

      // Flickering, breathing tubes representing heartbeat patterns
      const tvBreatheIntensity = 4.0 + Math.sin(time * 3.8) * 1.4;
      tvPGlowMat.emissiveIntensity = tvBreatheIntensity;
      tvDGlowMat.emissiveIntensity = tvBreatheIntensity;

      // Color mix the PointLight room glow based on participants' status ratios
      const glowRIntensity = tvDHealthRatio * 3.2;
      const glowBIntensity = tvPHealthRatio * 3.2;
      tvGlowLight.color.setRGB(glowRIntensity, 0, glowBIntensity);
      tvGlowLight.intensity = 4.0 + Math.sin(time * 1.8) * 0.6;

      const isHoldFov =
        latest.gameState === 'SHOOTING' ||
        (latest.gameState === 'ITEM_USE' &&
          (ar.activeItemAnimType === 'SCALPEL' ||
            ar.activeItemAnimType === 'SYRINGE' ||
            ar.activeItemAnimType === 'RAZORBLADE' ||
            ar.activeItemAnimType === 'MEDKIT'));
      if (!isHoldFov) {
        ar.actionFovOffset = THREE.MathUtils.damp(ar.actionFovOffset, 0, 7.5, rawDt);
      }
      const targetFov = 45 + (ar.actionFovOffset || 0);
      const prevFov = camera.fov;
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 10.0, rawDt);
      if (Math.abs(camera.fov - prevFov) > 0.005) {
        camera.updateProjectionMatrix();
      }

      if (stateRef.current.lookTargetVec) {
         camera.lookAt(stateRef.current.lookTargetVec);
      } else {
         camera.lookAt(0, 0.5, -1);
      }

      // Apply rotational kickback pitch & roll to camera orientation
      if (ar.cameraKickPitch || ar.cameraKickRoll) {
        camera.rotation.x += ar.cameraKickPitch;
        camera.rotation.z += ar.cameraKickRoll;
      }

      // Skip rendering during mid-gameplay WebGPU -> WebGL emergency swap while keeping gameplay/animations synchronized
      if (isFallbackTransitioning || !renderer) {
        return;
      }

      // Update WebGPU Compute Systems
      if (!activeIsWebGLSession) {
        if (computeBloodSystem && renderer) {
          try {
            computeBloodSystem.update(renderer, rawDt, time);
          } catch (e) {
            watchdog.recordRenderError(e);
          }
        }
        if (computeSparksSystem && renderer) {
          try {
            computeSparksSystem.update(renderer, rawDt);
          } catch (e) {
            watchdog.recordRenderError(e);
          }
        }
        if (volumetricSmokeSystem && renderer) {
          try {
            volumetricSmokeSystem.update(renderer, rawDt, time, camera);
          } catch (e) {
            watchdog.recordRenderError(e);
          }
        }
      }

      // Render with Advanced Pipeline (GTAO + SSR + Motion Blur + Spatial Upscaling)
      const renderStartMs = performance.now();
      let frameFailedCompletely = false;

      if (advancedPipeline) {
        const recoilKick = Math.abs(ar.cameraKickPitch || 0) + Math.abs(ar.cameraKickRoll || 0);
        advancedPipeline.updateFrame(
          rawDt, 
          stateRef.current.gameState, 
          ar.aimProgress || 0, 
          ar.cameraShakeIntensity || 0, 
          recoilKick
        );
        try {
          advancedPipeline.render();
        } catch (err) {
          if (!activeIsWebGLSession) watchdog.recordRenderError(err);
          try {
            if (renderer) renderer.render(scene, camera);
          } catch (e) {
            frameFailedCompletely = true;
            if (!activeIsWebGLSession) watchdog.recordRenderError(e);
          }
        }
      } else if (renderPipeline) {
        try {
          renderPipeline.render();
        } catch (err) {
          console.warn('RenderPipeline frame error during settings transition:', err);
          if (!activeIsWebGLSession) watchdog.recordRenderError(err);
          try {
            renderer.render(scene, camera);
          } catch (e) {
            frameFailedCompletely = true;
            if (!activeIsWebGLSession) watchdog.recordRenderError(e);
          }
        }
      } else if (renderer) {
        try {
          renderer.render(scene, camera);
        } catch (e) {
          frameFailedCompletely = true;
          if (!activeIsWebGLSession) watchdog.recordRenderError(e);
        }
      }

      if (!activeIsWebGLSession) {
        const renderCpuMs = performance.now() - renderStartMs;
        watchdog.recordFrame(now, rawIntervalMs, renderCpuMs, frameFailedCompletely);
      }
    };

    const yieldToMain = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const disposeActiveRendererStack = () => {
      if (computeBloodSystem) {
        try { computeBloodSystem.dispose(scene); } catch (e) {}
        computeBloodSystem = null;
      }
      if (computeSparksSystem) {
        try { computeSparksSystem.dispose(scene); } catch (e) {}
        computeSparksSystem = null;
      }
      if (volumetricSmokeSystem) {
        try { volumetricSmokeSystem.dispose(scene); } catch (e) {}
        volumetricSmokeSystem = null;
      }
      if (advancedPipeline) {
        try { advancedPipeline.dispose(); } catch (e) {}
        advancedPipeline = null;
      }
      if (currentPostprocessingNode && currentPostprocessingNode !== scenePass && typeof currentPostprocessingNode.dispose === 'function') {
        try { currentPostprocessingNode.dispose(); } catch (e) {}
      }
      currentPostprocessingNode = null;
      currentPostprocessingKey = '';
      if (renderPipeline && typeof renderPipeline.dispose === 'function') {
        try { renderPipeline.dispose(); } catch (e) {}
      }
      renderPipeline = null;
      scenePass = null;
      if (pmremEnvTarget) {
        try { pmremEnvTarget.dispose(); } catch (e) {}
        pmremEnvTarget = null;
      }
      if (pmremGenerator) {
        try { pmremGenerator.dispose(); } catch (e) {}
        pmremGenerator = null;
      }
      if (renderer) {
        try { renderer.dispose(); } catch (e) {}
        renderer = null;
      }
    };

    const configureRendererAndCompileShaders = async (
      r: any,
      isWebGLMode: boolean,
      isEmergencyRecompile: boolean,
      reportProgress: (stage: string, progress: number, compiled?: number, total?: number) => void
    ) => {
      const ctrlSettings = getControllerSettings();
      let compiledMeshes = 0;
      let totalMeshes = 0;

      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setClearColor(0x0c0404);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      if (r.shadowMap) {
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
      }

      // Clear any previous backend shadow map RenderTargets and refresh material cache flags on emergency recompile
      if (isEmergencyRecompile) {
        lastMaterialConfigKey = '';
        scene.traverse((obj) => {
          if ((obj as any).isLight && (obj as any).shadow) {
            const sh = (obj as any).shadow;
            if (sh.map && typeof sh.map.dispose === 'function') {
              try { sh.map.dispose(); } catch (e) {}
            }
            sh.map = null;
            sh.needsUpdate = true;
          }
          if ((obj as any).isMesh && (obj as any).material) {
            const mats = Array.isArray((obj as any).material)
              ? (obj as any).material
              : [(obj as any).material];
            mats.forEach((m: any) => {
              if (m) m.needsUpdate = true;
            });
          }
        });

        // Swap WebGPU planar reflector TSL node for a safe WebGL metallic silver surface
        if (mirrorReflectorMesh) {
          if (mirrorReflectorNode && typeof mirrorReflectorNode.dispose === 'function') {
            try { mirrorReflectorNode.dispose(); } catch (e) {}
          }
          if (mirrorReflectorNode?.target && mirrorReflectorMesh.children.includes(mirrorReflectorNode.target)) {
            mirrorReflectorMesh.remove(mirrorReflectorNode.target);
          }
          mirrorReflectorNode = null;
          if (mirrorReflectorMat) {
            try { mirrorReflectorMat.dispose(); } catch (e) {}
          }
          mirrorReflectorMat = new THREE.MeshStandardMaterial({
            color: 0xcfd6de,
            metalness: 0.96,
            roughness: 0.08,
            envMapIntensity: 1.35,
          });
          mirrorReflectorMesh.material = mirrorReflectorMat;
        }
      }

      reportProgress('BAKING ENVIRONMENT PROBES', 12, 0, 0);
      await yieldToMain();
      if (isCancelled) return;

      // Bake physically calibrated dark interrogation room PMREM environment map for PBR specular reflections
      try {
        pmremGenerator = new PMREMGenerator(r);
        const envScene = createArenaEnvironmentScene();
        pmremEnvTarget = pmremGenerator.fromScene(envScene, 0.04);
        scene.environment = pmremEnvTarget.texture;
        scene.environmentIntensity = 0.9;
        envScene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry?.dispose();
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material?.dispose();
          }
        });
      } catch (pmremErr) {
        console.warn('PMREM environment baking skipped:', pmremErr);
      }

      try {
        scenePass = pass(scene, camera);
        renderPipeline = new RenderPipeline(r);
        advancedPipeline = new WebGPUAdvancedPipeline(r, scene, camera);
        if (!isWebGLMode) {
          computeBloodSystem = new WebGPUComputeBloodSystem(scene);
          computeSparksSystem = new WebGPUComputeSparksSystem(scene);
          volumetricSmokeSystem = new WebGPUVolumetricSmokeSystem(scene);
          computeBloodSystem.setQuality(ctrlSettings.computePhysicsQuality || 'low');
          computeSparksSystem.setQuality(ctrlSettings.computePhysicsQuality || 'low');
          volumetricSmokeSystem.setQuality(ctrlSettings.volumetricSmokeQuality || 'low');
        }
      } catch (e) {
        console.warn('WebGPU Advanced Pipeline / Compute setup error:', e);
      }

      if (!(r as any).getCurrentViewport) {
        const vp = new THREE.Vector4();
        (r as any).getCurrentViewport = (target?: THREE.Vector4) => {
          const size = new THREE.Vector2();
          if (r.getSize) r.getSize(size);
          const res = target || vp;
          res.set(0, 0, size.x || window.innerWidth, size.y || window.innerHeight);
          return res;
        };
      }
      if (!(r as any).getClearColor) {
        (r as any).getClearColor = (target?: any) => {
          if (target && typeof target.set === 'function') {
            target.set(0x0c0404);
            return target;
          }
          return new THREE.Color(0x0c0404);
        };
      }
      if (!(r as any).getClearAlpha) {
        (r as any).getClearAlpha = () => 1.0;
      }

      // Bind renderer reference temporarily for handleResize configuration
      renderer = r;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width && height) {
        r.setSize(width, height, false);
      }
      if (typeof handleResize === 'function') {
        handleResize();
      }
      if (isCancelled) return;

      // Stage hidden, off-screen, instanced, and dynamic runtime meshes so every shader compiles upfront
      reportProgress('STAGING HIDDEN & DYNAMIC PIPELINES', 20, 0, 0);
      await yieldToMain();
      if (isCancelled) return;

      const savedFrustumCulled = new Map<THREE.Object3D, boolean>();
      const prevGunBloodVisible = gunBloodGroup.visible;
      const prevFrontBloodVisible = frontGunBloodGroup.visible;
      const prevWristVisible = wristWound.group.visible;
      const prevMedkitArmVisible = medkitArm.group.visible;
      const prevReflectorVisible = mirrorReflectorMesh ? mirrorReflectorMesh.visible : false;
      const prevCoreCount = landedCoreBloodIM.count;
      const prevDarkCount = landedDarkBloodIM.count;
      const prevBrightCount = landedBrightBloodIM.count;

      const shaderWarmupGroup = new THREE.Group();
      shaderWarmupGroup.name = 'shaderWarmupGroup';
      shaderWarmupGroup.position.set(0, -100, 0);
      shaderWarmupGroup.scale.set(0.0001, 0.0001, 0.0001);

      shaderWarmupGroup.add(new THREE.Mesh(goreGeos.bloodDropGeo, sharedAirborneBloodMat));
      shaderWarmupGroup.add(new THREE.Mesh(goreGeos.goreShardGeo, sharedGoreChunkMat));
      shaderWarmupGroup.add(new THREE.Mesh(goreGeos.goreRibbonGeo, sharedGoreClotMat));
      shaderWarmupGroup.add(new THREE.Mesh(goreGeos.lensStreakGeo, sharedSplatMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitBoxGeo, sharedSparkMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitSmokeQuadGeo, sharedSmokeMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitSmokeQuadGeo, sharedHighSmokeMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitBoxGeo, sharedLiquidMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitBoxGeo, sharedDebrisMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitPixelSplatGeo, sharedSplatMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitShellCylinderGeo, sharedBrassShellMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitShellCylinderGeo, sharedBlankShellMat));
      shaderWarmupGroup.add(new THREE.Mesh(unitBulletGeo, sharedBulletMat));

      const medkitWarmup = createItemMesh('MEDKIT');
      shaderWarmupGroup.add(medkitWarmup);

      scene.add(shaderWarmupGroup);
      gunBloodGroup.visible = true;
      frontGunBloodGroup.visible = true;
      wristWound.group.visible = true;
      medkitArm.group.visible = true;
      if (ar.activeItemAnimType !== 'MEDKIT') {
        medkitArm.setTreatmentState(0.5, 0.5);
      }
      if (mirrorReflectorMesh && mirrorReflectorMesh.parent !== ar.activeItemAnimGroup) {
        shaderWarmupGroup.add(mirrorReflectorMesh);
        mirrorReflectorMesh.visible = true;
      }
      dealerWounds.update(1.0);
      landedCoreBloodIM.count = Math.max(1, prevCoreCount);
      landedDarkBloodIM.count = Math.max(1, prevDarkCount);
      landedBrightBloodIM.count = Math.max(1, prevBrightCount);

      const compileNodes: THREE.Object3D[] = [];
      const compileMeshCounts: number[] = [];

      for (const child of scene.children) {
        let meshCount = 0;
        child.traverse((obj) => {
          savedFrustumCulled.set(obj, obj.frustumCulled);
          obj.frustumCulled = false;
          if ((obj as any).isMesh) {
            meshCount += 1;
          }
        });
        if (meshCount > 0) {
          compileNodes.push(child);
          compileMeshCounts.push(meshCount);
          totalMeshes += meshCount;
        }
      }
      scene.updateMatrixWorld(true);

      reportProgress('COMPILING SCENE SHADERS', 24, 0, totalMeshes);
      await yieldToMain();

      const restoreStagedScene = () => {
        if (mirrorReflectorMesh) {
          mirrorReflectorMesh.visible = prevReflectorVisible;
          if (mirrorReflectorMesh.parent === shaderWarmupGroup) {
            scene.add(mirrorReflectorMesh);
          }
        }
        scene.remove(shaderWarmupGroup);
        disposeNode(medkitWarmup);
        gunBloodGroup.visible = prevGunBloodVisible;
        frontGunBloodGroup.visible = prevFrontBloodVisible;
        wristWound.group.visible = prevWristVisible;
        if (ar.activeItemAnimType !== 'MEDKIT') {
          medkitArm.reset();
        }
        medkitArm.group.visible = prevMedkitArmVisible;
        if (stateRef.current.dealer.health >= stateRef.current.dealer.maxHealth) {
          dealerWounds.reset();
        } else {
          dealerWounds.update(
            1 - Math.max(0, stateRef.current.dealer.health) / Math.max(1, stateRef.current.dealer.maxHealth)
          );
        }
        landedCoreBloodIM.count = prevCoreCount;
        landedDarkBloodIM.count = prevDarkCount;
        landedBrightBloodIM.count = prevBrightCount;
        savedFrustumCulled.forEach((orig, obj) => { obj.frustumCulled = orig; });
      };

      if (isCancelled) {
        restoreStagedScene();
        return;
      }

      if (typeof (r as any).compileAsync === 'function') {
        for (let i = 0; i < compileNodes.length; i++) {
          if (isCancelled) break;
          const node = compileNodes[i];
          const weight = compileMeshCounts[i];
          await (r as any).compileAsync(node, camera, scene);
          compiledMeshes += weight;
          const frac = totalMeshes > 0 ? compiledMeshes / totalMeshes : (i + 1) / Math.max(1, compileNodes.length);
          reportProgress('COMPILING SCENE SHADERS', 24 + frac * 48, compiledMeshes, totalMeshes);
          await yieldToMain();
        }

        if (!isCancelled) {
          reportProgress('LINKING SCENE LIGHTING PIPELINES', 74, totalMeshes, totalMeshes);
          await (r as any).compileAsync(scene, camera);
        }
      }

      if (isCancelled) {
        restoreStagedScene();
        return;
      }

      if (!isWebGLMode) {
        reportProgress('COMPILING COMPUTE KERNELS', 78, totalMeshes, totalMeshes);
        await yieldToMain();
        if (computeBloodSystem) {
          await computeBloodSystem.precompile(r);
        }
        reportProgress('COMPILING COMPUTE KERNELS', 81, totalMeshes, totalMeshes);
        if (computeSparksSystem) {
          await computeSparksSystem.precompile(r);
        }
        if (volumetricSmokeSystem) {
          await volumetricSmokeSystem.precompile(r);
        }
        reportProgress('COMPILING COMPUTE KERNELS', 84, totalMeshes, totalMeshes);
        await yieldToMain();
        if (isCancelled) {
          restoreStagedScene();
          return;
        }
      }

      reportProgress('COMPILING POST-PROCESSING GRAPH', 88, totalMeshes, totalMeshes);
      await yieldToMain();
      if (isCancelled) {
        restoreStagedScene();
        return;
      }

      if (advancedPipeline) {
        try {
          advancedPipeline.render();
        } catch (e) {
          try { r.render(scene, camera); } catch (e2) {}
        }
      } else if (renderPipeline) {
        try {
          renderPipeline.render();
        } catch (e) {
          try { r.render(scene, camera); } catch (e2) {}
        }
      } else {
        try {
          r.render(scene, camera);
        } catch (e) {}
      }

      reportProgress('SYNCHRONIZING GPU PIPELINE QUEUE', 96, totalMeshes, totalMeshes);
      try {
        const device = (r as any).backend?.device;
        if (device?.queue && typeof device.queue.onSubmittedWorkDone === 'function') {
          await device.queue.onSubmittedWorkDone();
        } else {
          await yieldToMain();
        }
      } catch (e) {
        await yieldToMain();
      }

      restoreStagedScene();
    };

    const triggerEmergencyWebGLFallback = async (report: WebGPUFailureReport) => {
      if (isCancelled || isFallbackTransitioning || activeIsWebGLSession) return;
      isFallbackTransitioning = true;
      watchdog.detach();
      console.warn(`[WebGPUWatchdog] Emergency WebGL fallback triggered: ${report.reason} — ${report.details}`);
      activateWebGpuEmergencyFallback(report.reason);

      const updateFallbackHud = (stage: string, progress: number) => {
        if (isCancelled) return;
        setFallbackOverlay({
          phase: 'switching',
          reason: report.reason,
          progress: Math.max(0, Math.min(100, Math.round(progress))),
          stage,
        });
      };

      updateFallbackHud('FREEING FAULTED WEBGPU PIPELINE', 6);
      await yieldToMain();
      if (isCancelled) return;

      // 1. Dispose WebGPU backend stack first so GPU memory/swapchains release cleanly before allocating WebGL 2.0
      disposeActiveRendererStack();

      // 2. Create fresh off-screen WebGL canvas (browsers permanently lock a canvas to its first context type)
      const nextCanvas = document.createElement('canvas');
      nextCanvas.className = activeCanvas.className;
      nextCanvas.style.cssText = activeCanvas.style.cssText;
      nextCanvas.style.position = 'absolute';
      nextCanvas.style.inset = '0';
      nextCanvas.style.opacity = '0';
      nextCanvas.style.pointerEvents = 'none';
      container.appendChild(nextCanvas);

      try {
        updateFallbackHud('INITIALIZING WEBGL 2.0 BACKEND', 10);
        await yieldToMain();
        if (isCancelled) {
          nextCanvas.remove();
          return;
        }

        const r = await createWebGPURenderer(nextCanvas, { forceWebGL: true });
        if (isCancelled) {
          try { r.dispose(); } catch (e) {}
          nextCanvas.remove();
          return;
        }

        await configureRendererAndCompileShaders(r, true, true, (stage, progress) => {
          updateFallbackHud(stage, progress);
        });
        if (isCancelled) {
          disposeActiveRendererStack();
          nextCanvas.remove();
          return;
        }

        // Swap compiled WebGL canvas seamlessly into active display slot
        nextCanvas.style.position = '';
        nextCanvas.style.inset = '';
        nextCanvas.style.opacity = '1';
        nextCanvas.style.pointerEvents = '';
        if (activeCanvas.parentNode === container) {
          activeCanvas.replaceWith(nextCanvas);
        }
        activeCanvas = nextCanvas;
        (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = nextCanvas;

        activeIsWebGLSession = true;
        isFallbackTransitioning = false;
        lastFrameTime = performance.now();
        lastRawFrameTime = performance.now();

        setFallbackOverlay({
          phase: 'complete',
          reason: report.reason,
          progress: 100,
          stage: 'WEBGL 2.0 ACTIVE',
        });
        if (fallbackOverlayTimeoutRef.current) clearTimeout(fallbackOverlayTimeoutRef.current);
        fallbackOverlayTimeoutRef.current = setTimeout(() => {
          setFallbackOverlay(null);
        }, 3800);
      } catch (fallbackErr: any) {
        if (isCancelled) return;
        nextCanvas.remove();
        isFallbackTransitioning = false;
        console.error('Emergency WebGL fallback initialization failed:', fallbackErr);
        const errMessage = fallbackErr?.message || 'Emergency WebGL 2.0 fallback failed to compile.';
        setFallbackOverlay(null);
        setWebGpuError(errMessage);
        webGpuErrorRef.current = errMessage;
        onCompileErrorRef.current?.(errMessage);
      }
    };

    const runInitAndCompileShaders = async () => {
      const startTime = performance.now();
      let backendLabel = 'WEBGPU · WGSL';

      const reportProgress = (stage: string, progress: number, compiled = 0, total = 0) => {
        if (isCancelled) return;
        onCompileProgressRef.current?.({
          backend: backendLabel,
          stage,
          progress: Math.max(0, Math.min(100, Math.round(progress))),
          compiled,
          total,
          elapsedMs: Math.round(performance.now() - startTime),
        });
      };

      setWebGpuError(null);
      webGpuErrorRef.current = null;
      reportProgress('INITIALIZING RENDER BACKEND', 4, 0, 0);
      await yieldToMain();
      if (isCancelled) return;

      try {
        const ctrlSettings = getControllerSettings();
        const check = await isWebGPUSupported();
        if (isCancelled) return;

        if (!check.supported) {
          console.warn(`WebGPU is unsupported (${check.reason || 'no compatible adapter'}). Forcing WebGL 2.0.`);
          backendLabel = 'WEBGL 2.0 · GLSL';
        } else {
          backendLabel = 'WEBGPU · WGSL';
        }

        const r = await createWebGPURenderer(activeCanvas);
        if (isCancelled) {
          try { r.dispose(); } catch (e) {}
          return;
        }

        const activeIsWebGL = (r as any).backend?.isWebGLBackend === true;
        activeIsWebGLSession = activeIsWebGL;
        backendLabel = activeIsWebGL ? 'WEBGL 2.0 · GLSL' : 'WEBGPU · WGSL';

        // Estimate rough hardware profile for real-time choke calibration (non-blocking)
        roughHardwareProfile = await estimateRoughHardwareProfile((r as any).backend?.adapter);
        if (isCancelled) {
          try { r.dispose(); } catch (e) {}
          return;
        }

        await configureRendererAndCompileShaders(r, activeIsWebGL, false, reportProgress);
        if (isCancelled) return;

        if (!activeIsWebGL && roughHardwareProfile) {
          watchdog.attach(r, roughHardwareProfile, ctrlSettings, (report) => {
            void triggerEmergencyWebGLFallback(report);
          });
        }

        reportProgress('PIPELINE READY', 100, 1, 1);
        onCompileCompleteRef.current?.();
        lastFrameTime = performance.now();
        lastRawFrameTime = performance.now();
        animate();
      } catch (err: any) {
        if (isCancelled) return;
        console.error('WebGPU Renderer initialization failed:', err);
        const errMessage = err?.message || 'Hardware renderer failed to start.';
        setWebGpuError(errMessage);
        webGpuErrorRef.current = errMessage;
        onCompileErrorRef.current?.(errMessage);
      }
    };

    runInitAndCompileShaders();
    return () => {
      isCancelled = true;
      watchdog.detach();
      if (fallbackOverlayTimeoutRef.current) clearTimeout(fallbackOverlayTimeoutRef.current);
      if (mouseInactivityTimerRef.current) clearTimeout(mouseInactivityTimerRef.current);
      cancelAnimationFrame(frameId);
      unsubscribeSettings();
      resizeObserver.disconnect();
      if (lastTouchTapConfirmTimer) clearTimeout(lastTouchTapConfirmTimer);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancel);
      document.body.style.cursor = '';
      clearBloodSplatters();
      if (animRef.current.activeZippoGroup) {
        if (animRef.current.activeZippoGroup.parent) animRef.current.activeZippoGroup.parent.remove(animRef.current.activeZippoGroup);
        disposeNode(animRef.current.activeZippoGroup);
        animRef.current.activeZippoGroup = null;
      }
      if (mirrorReflectorNode && typeof mirrorReflectorNode.dispose === 'function') {
        try { mirrorReflectorNode.dispose(); } catch (e) {}
      }
      if (mirrorReflectorMesh && mirrorReflectorMesh.parent) {
        mirrorReflectorMesh.parent.remove(mirrorReflectorMesh);
      }
      if (mirrorReflectorGeo) mirrorReflectorGeo.dispose();
      if (mirrorReflectorMat) mirrorReflectorMat.dispose();
      shopHitBoxGeo.dispose();
      shopHitBoxMat.dispose();
      proceduralTextures.dispose();
      disposeActiveRendererStack();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ touchAction: 'none' }}
      className="w-full h-full bg-black overflow-hidden relative flex justify-center items-center select-none"
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          imageRendering: 'auto',
          WebkitFontSmoothing: 'none',
          touchAction: 'none',
        }}
      />

      {/* DYNAMIC HIGH-PERFORMANCE SCREENSPACE FLOATING TOOLTIP ABOVE THREE.JS OBJECTS */}
      {/* PLAYER DEATH RED TINT VIGNETTE OVERLAY */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-[118] transition-opacity duration-300"
        style={{
          opacity: player.health <= 0 ? 1 : 0,
          background: 'radial-gradient(circle at center, rgba(160, 0, 0, 0.35) 0%, rgba(90, 0, 0, 0.78) 55%, rgba(10, 0, 0, 0.98) 100%)',
          mixBlendMode: 'hard-light'
        }}
      />

      {/* DYNAMIC SCREEN LOW-POLY JAGGED BLOOD SPLATTER OVERLAY WITH GRAVITY DRIPS */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[120]">
        {screenSplats.map(splat => {
          const corePolygons = [
            '50,8 68,26 96,18 82,48 112,62 84,82 94,108 62,92 46,118 28,90 8,74 28,50 18,22 42,30',
            '46,12 72,18 92,8 88,42 114,56 90,78 78,108 54,94 34,114 26,82 6,62 32,42 24,18',
            '54,6 76,28 106,32 88,58 104,84 74,92 58,116 38,94 12,92 22,60 6,36 36,28'
          ];
          const clotPolygons = [
            '48,28 66,38 78,56 66,76 48,80 34,64 36,42',
            '44,30 68,34 74,58 58,78 38,72 32,48',
            '52,26 70,44 68,68 48,78 34,58 40,36'
          ];
          const rimPolygons = [
            '54,18 64,34 86,28 74,50 96,60 74,74 52,102 36,78 18,68 34,48',
            '50,20 70,24 82,46 98,56 78,74 68,94 48,82 26,64 40,42',
            '54,16 70,34 92,38 78,58 88,76 62,84 44,98 28,64 42,34'
          ];
          const v = (splat.variant || 0) % 3;

          return (
            <motion.div
              key={splat.id}
              initial={{ opacity: 0, scale: 0.25 }}
              animate={{ opacity: [0, 0.96, 0.96, 0.65, 0], scale: splat.scale }}
              transition={{ duration: 3.8, ease: 'easeOut' }}
              className="absolute pointer-events-none"
              style={{
                left: `${splat.x}%`,
                top: `${splat.y}%`,
                width: '132px',
                height: '132px',
                transform: `rotate(${Math.round(splat.rotation)}deg)`,
              }}
            >
              <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible">
                {/* Outer Wet Crimson Rim */}
                <polygon points={rimPolygons[v]} fill="#7a0808" opacity="0.72" />
                {/* Main Deep Crimson Splat Body */}
                <polygon points={corePolygons[v]} fill="#4a0202" opacity="0.94" />
                {/* Dark Coagulated Clot Core */}
                <polygon points={clotPolygons[v]} fill="#1b0000" opacity="0.98" />
                {/* Angular Micro Shards */}
                <polygon points="8,14 20,10 14,24" fill="#4a0202" />
                <polygon points="102,16 116,22 106,32" fill="#2c0101" />
                <polygon points="92,106 106,112 96,120" fill="#4a0202" />
                <polygon points="10,96 22,102 12,114" fill="#1b0000" />
              </svg>

              {/* Tapered Low-Poly Gravity Drip Trails */}
              <motion.svg
                viewBox="0 0 20 180"
                preserveAspectRatio="none"
                animate={{ height: ['0px', '42px', '96px', '148px', '185px'], opacity: [0, 0.95, 0.95, 0.8, 0] }}
                transition={{ duration: 3.4, times: [0, 0.15, 0.4, 0.7, 1], ease: 'linear' }}
                className="absolute left-[42%] top-[78%] w-[16px]"
              >
                <polygon points="2,0 18,0 14,140 10,180 5,138" fill="#4a0202" />
                <polygon points="6,0 13,0 11,110 8,145" fill="#1b0000" />
              </motion.svg>

              <motion.svg
                viewBox="0 0 16 110"
                preserveAspectRatio="none"
                animate={{ height: ['0px', '28px', '64px', '104px'], opacity: [0, 0.9, 0.88, 0] }}
                transition={{ duration: 2.9, times: [0, 0.2, 0.6, 1], ease: 'linear' }}
                className="absolute left-[22%] top-[68%] w-[12px]"
              >
                <polygon points="1,0 14,0 11,80 7,110 3,76" fill="#3a0101" />
              </motion.svg>

              <motion.svg
                viewBox="0 0 14 90"
                preserveAspectRatio="none"
                animate={{ height: ['0px', '22px', '50px', '82px'], opacity: [0, 0.88, 0.85, 0] }}
                transition={{ duration: 2.6, times: [0, 0.2, 0.6, 1], ease: 'linear' }}
                className="absolute left-[68%] top-[74%] w-[10px]"
              >
                <polygon points="2,0 12,0 9,68 6,90 3,64" fill="#4a0202" />
              </motion.svg>

              {/* Falling Angular Blood Tear Shards */}
              <motion.div
                animate={{ y: [0, 32, 74, 126, 188], opacity: [0, 1, 1, 1, 0] }}
                transition={{ duration: 3.1, times: [0, 0.2, 0.45, 0.75, 1], ease: 'linear' }}
                className="absolute left-[44%] top-[98%] w-[10px] h-[14px] bg-[#2a0000]"
                style={{ clipPath: 'polygon(50% 0%, 100% 60%, 60% 100%, 15% 75%)' }}
              />
              <motion.div
                animate={{ y: [0, 24, 56, 94, 146], opacity: [0, 1, 1, 1, 0] }}
                transition={{ duration: 2.7, times: [0, 0.2, 0.45, 0.75, 1], ease: 'linear' }}
                className="absolute left-[23%] top-[84%] w-[8px] h-[11px] bg-[#4a0202]"
                style={{ clipPath: 'polygon(40% 0%, 95% 55%, 50% 100%, 5% 65%)' }}
              />
            </motion.div>
          );
        })}
      </div>

      {/* SHOP PROMPT */}
      {player.health > 0 && gameState === 'PLAYER_TURN' && (
        <motion.div 
          className="absolute left-3 sm:left-8 top-1/2 -translate-y-1/2 z-[120] flex flex-col items-start gap-2"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <button
             type="button"
             className="flex items-center gap-2 sm:gap-2.5 text-[11px] uppercase font-mono text-neutral-200 hover:text-neutral-100 frosted-glass-ui px-3 sm:px-3.5 py-2.5 sm:py-2 min-h-[42px] sm:min-h-0 cursor-pointer pointer-events-auto transition-colors active:bg-[#250909]"
             onClick={() => {
                if (player.health <= 0 || gameState !== 'PLAYER_TURN') return;
                isLookingAtShopRef.current = !isLookingAtShopRef.current;
                setHoveredInfo(null);
                setDebugToggle(p => p + 1);
             }}
          >
             {inputType === 'gamepad' ? (
               <>
                 <span className="flex items-center gap-1.5">
                   <ControllerGlyph role="north" layout={controllerLayout} size="sm" />
                   <span className="font-bold">{isLookingAtShopRef.current ? 'BACK' : 'MARKET'}</span>
                 </span>
                 <span className="text-neutral-700 hidden sm:inline">·</span>
                 <span className="hidden sm:flex items-center gap-1.5 text-neutral-400">
                   <ControllerGlyph role="select" layout={controllerLayout} size="xs" />
                   <span>CURSOR</span>
                 </span>
               </>
             ) : inputType === 'touch' ? (
               <span className="tracking-widest font-bold">
                 {isLookingAtShopRef.current ? 'BACK TO TABLE' : 'MARKET'}
               </span>
             ) : (
               <span className="tracking-widest font-bold">
                 {isLookingAtShopRef.current ? '[Q] BACK TO TABLE' : '[Q] MARKET'}
               </span>
             )}
          </button>
        </motion.div>
      )}

      {/* EDGE SHOOT DETECTION ZONES (Desktop Hover & Mobile Visible Thumb Triggers) */}
      {player.health > 0 && gameState === 'PLAYER_TURN' && showControls && !isLookingAtShopRef.current && (
        inputType === 'touch' ? (
          <>
            {branch !== 'CLASSIC' && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[125] pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    if (gameState === 'PLAYER_TURN' && showControls) {
                      fireGun('dealer', 'player');
                      setHoveredInfo(null);
                    }
                  }}
                  className="shoot-action-btn px-5 py-2.5 min-h-[44px] bg-[#2a0709]/90 active:bg-[#4a0b0e] border border-red-700/90 text-red-400 font-mono text-xs font-bold tracking-[0.22em] uppercase shadow-lg"
                >
                  SHOOT DEALER
                </button>
              </div>
            )}

            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[125] pointer-events-auto">
              <button
                type="button"
                onClick={() => {
                  if (gameState === 'PLAYER_TURN' && showControls) {
                    fireGun('player', 'player');
                    setHoveredInfo(null);
                  }
                }}
                className="shoot-action-btn px-5 py-2.5 min-h-[44px] bg-[#121216]/90 active:bg-[#282830] border border-[#3e3e48] text-neutral-100 font-mono text-xs font-bold tracking-[0.22em] uppercase shadow-lg"
              >
                SHOOT SELF
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Top Edge: Shoot Dealer (Revamped branch only) */}
            {branch !== 'CLASSIC' && (
              <div 
                className="absolute top-0 left-0 right-0 h-[25vh] md:h-[30vh] z-[115] flex justify-center items-start pt-10 opacity-0 hover:opacity-100 transition-opacity duration-300 cursor-pointer bg-gradient-to-b from-red-950/60 to-transparent"
                onClick={() => {
                   if (gameState === 'PLAYER_TURN' && showControls) {
                       fireGun('dealer', 'player');
                       (window as any).dealerDomHovered = false;
                   }
                }}
                onMouseEnter={() => { (window as any).dealerDomHovered = true; }}
                onMouseLeave={() => { (window as any).dealerDomHovered = false; }}
              >
                <div className="font-mono text-lg md:text-xl tracking-[0.35em] text-red-500 font-bold">SHOOT DEALER</div>
              </div>
            )}
            
            {/* Bottom Edge: Shoot Self */}
            <div 
              className="absolute bottom-0 left-0 right-0 h-[25vh] md:h-[30vh] z-[115] flex justify-center items-end pb-10 opacity-0 hover:opacity-100 transition-opacity duration-300 cursor-pointer bg-gradient-to-t from-black/70 to-transparent"
              onClick={() => {
                 if (gameState === 'PLAYER_TURN' && showControls) {
                     fireGun('player', 'player');
                 }
              }}
            >
              <div className="font-mono text-lg md:text-xl tracking-[0.35em] text-neutral-200 font-bold">SHOOT SELF</div>
            </div>
          </>
        )
      )}

      {/* KEYBOARD / TOUCH QUICK CONTROLS HUD */}
      {inputType === 'touch' && getControllerSettings().showKeyboardHud !== false && (showControls || isLookingAtShopRef.current) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[120] pointer-events-none hidden sm:flex items-center gap-2.5 frosted-glass-ui px-3.5 py-1.5 font-mono text-[10px]">
          <span className="text-neutral-300 font-bold">DRAG VIEW TO LOOK</span>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-300 font-bold">TAP ITEM TO INSPECT / TAP AGAIN TO USE</span>
        </div>
      )}

      {inputType === 'kbm' && getControllerSettings().showKeyboardHud !== false && (showControls || isLookingAtShopRef.current) && (
        <motion.div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[120] pointer-events-none hidden sm:flex items-center gap-2.5 frosted-glass-ui px-3.5 py-1.5 font-mono text-[10px]"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: showKeyboardHud ? 1 : 0, y: showKeyboardHud ? 0 : -10 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span className="bg-[#16161a] text-neutral-200 px-1.5 py-0.5 border border-[#2e2e34] font-bold">S / ←</span>
            <span>SELF</span>
          </div>
          {branch !== 'CLASSIC' && (
            <>
              <span className="text-neutral-700">·</span>
              <div className="flex items-center gap-1.5 text-neutral-400">
                <span className="bg-[#16161a] text-red-400 px-1.5 py-0.5 border border-[#2e2e34] font-bold">D / →</span>
                <span>DEALER</span>
              </div>
            </>
          )}
          <span className="text-neutral-700">·</span>
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span className="bg-[#16161a] text-neutral-200 px-1.5 py-0.5 border border-[#2e2e34] font-bold">1-8</span>
            <span>ITEM</span>
          </div>
          <span className="text-neutral-700">·</span>
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span className="bg-[#16161a] text-neutral-200 px-1.5 py-0.5 border border-[#2e2e34] font-bold">Q</span>
            <span>MARKET</span>
          </div>
          <span className="text-neutral-700">·</span>
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span className="bg-[#16161a] text-neutral-200 px-1.5 py-0.5 border border-[#2e2e34] font-bold">SPACE</span>
            <span>CONFIRM</span>
          </div>
        </motion.div>
      )}

      {/* BLOOD CURRENCY DISPLAY - ONLY SHOWS IN SHOP */}
      <motion.div
        className="absolute right-8 top-20 sm:top-24 z-[130] flex flex-col items-end pointer-events-none"
        initial={{ opacity: 0, y: -12 }}
        animate={{ 
          opacity: isLookingAtShopRef.current ? 1 : 0,
          y: isLookingAtShopRef.current ? 0 : -12
        }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="flex items-baseline gap-2 frosted-glass-ui px-4 py-2 font-mono tabular-nums">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest">BLOOD</span>
          <span className="text-xl sm:text-2xl text-red-500 font-bold">
            {bloodCurrency}
          </span>
        </div>
      </motion.div>

      <div
        ref={popupRef}
        className={`absolute z-[150] text-center transition-opacity duration-150 ease-out w-56 -ml-28 -mt-20 ${
          inputType === 'touch' && hoveredInfo ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{ opacity: 0, visibility: 'hidden', left: 0, top: 0, position: 'absolute' }}
      >
        <div className="frosted-glass-ui p-2.5 w-full flex flex-col gap-1.5 items-center">
          <div ref={popupNameRef} className="text-red-500 font-mono text-[11px] font-bold tracking-widest uppercase" />
          <div ref={popupDescRef} className="text-[10px] font-mono text-neutral-300 leading-relaxed" />
          {inputType === 'touch' && hoveredInfo && (
            <button
              type="button"
              onClick={() => {
                if (hoveredInfo.type === 'ITEM' && hoveredInfo.index !== undefined && showControls) {
                  useItem(hoveredInfo.index, 'player');
                  setHoveredInfo(null);
                } else if (
                  hoveredInfo.type === 'SHOP_ITEM' &&
                  hoveredInfo.shopType &&
                  hoveredInfo.cost !== undefined &&
                  bloodCurrency >= hoveredInfo.cost &&
                  player.items.length < 8
                ) {
                  buyItem(hoveredInfo.shopType, hoveredInfo.cost);
                  playPurchaseSound();
                  setHoveredInfo(null);
                }
              }}
              className="mt-1 w-full py-2 min-h-[38px] bg-[#2f0909] active:bg-[#4a0b0e] border border-red-700 text-neutral-100 font-mono text-[10px] font-bold tracking-widest uppercase"
            >
              {hoveredInfo.type === 'SHOP_ITEM' ? 'PURCHASE ITEM' : 'USE ITEM'}
            </button>
          )}
        </div>
      </div>

      <div 
        id="virtual-cursor" 
        className="absolute w-4 h-4 border border-red-500 rounded-full pointer-events-none z-[9999] hidden transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center" 
      >
         <div className="w-1 h-1 bg-white rounded-full" />
      </div>

      {fallbackOverlay && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none select-none w-[min(360px,90vw)] font-mono">
          <div className="frosted-glass-ui border border-amber-800/70 bg-[#0d0b08]/95 px-3.5 py-2.5 space-y-1.5 shadow-2xl">
            <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider">
              <span className="flex items-center gap-1.5 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                {fallbackOverlay.phase === 'switching'
                  ? 'EMERGENCY WEBGL 2.0 FALLBACK'
                  : 'WEBGL 2.0 FALLBACK ACTIVE'}
              </span>
              <span className="text-neutral-300 tabular-nums">{fallbackOverlay.progress}%</span>
            </div>
            <div className="text-[9px] text-neutral-400 uppercase tracking-wider truncate">
              {fallbackOverlay.phase === 'switching' ? fallbackOverlay.stage : fallbackOverlay.reason}
            </div>
            {fallbackOverlay.phase === 'switching' && (
              <div className="w-full h-1 bg-[#171410] border border-amber-900/50 overflow-hidden">
                <div
                  className="h-full bg-amber-600 transition-[width] duration-150 ease-out"
                  style={{ width: `${fallbackOverlay.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {webGpuError && (
        <div className="fixed inset-0 z-[999999] bg-[#08080a] text-neutral-100 flex items-center justify-center p-4 sm:p-6 font-mono select-none overflow-hidden">
          <div className="max-w-md w-full frosted-glass-ui p-6 flex flex-col gap-4 relative">
            <div className="flex items-center gap-3 border-b border-[#26262b] pb-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <h2 className="text-sm sm:text-base font-bold text-neutral-100 tracking-wider uppercase">
                RENDER ENGINE FAILURE
              </h2>
            </div>

            <div className="p-3 bg-[#101013] border border-[#26262b] space-y-1">
              <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3 h-3 text-red-500" /> DETAILS
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed font-mono">
                {webGpuError}
              </p>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Failed to initialize WebGPU and WebGL fallback. Ensure hardware acceleration is enabled in your browser settings.
            </p>

            <div className="flex justify-end pt-3 border-t border-[#26262b]">
              <button
                onClick={handleRetryWebGpu}
                disabled={isRecheckingWebGpu}
                className="flex items-center gap-2 px-5 py-2 bg-[#2f0909] hover:bg-[#3d0c0c] text-neutral-100 border border-red-800 font-bold text-xs uppercase tracking-widest transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRecheckingWebGpu ? 'animate-spin text-red-400' : ''}`} />
                {isRecheckingWebGpu ? 'RESTARTING...' : 'REBOOT RENDERER'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
