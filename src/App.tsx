import React, { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Cylinder } from "./components/Cylinder";
import { ItemRack } from "./components/ItemRack";
import { SettingsPanel } from "./components/SettingsPanel";
import { Arena3D, ShaderCompileProgress } from "./components/Arena3D";
import { CustomCursor } from "./components/CustomCursor";
import { useGameState } from "./hooks/useGameState";
import { playHeartbeat, setHeartbeatStatus, playTapSound, playUIHover, playUISliderTick, playUIClick } from "./audio";
import { CustomSelect, SelectOption } from "./components/CustomSelect";
import { ControllerGlyph } from "./components/ControllerGlyph";
import { Difficulty, GameBranch } from "./types";
import {
  ControllerLayout,
  InputType,
  getControllerSettings,
  subscribeControllerSettings,
  pollGamepadAutoSwitch,
  readSemanticGamepad,
  vibrateGamepad,
} from "./controller";
import {
  isWebGPUSupported,
  getWebGpuEmergencyFallbackState,
  subscribeWebGpuFallbackState,
} from "./renderers/RendererManager";

export const getDifficultyConfig = (diff: Difficulty, branch: GameBranch = 'REVAMPED') => {
  const isClassic = branch === 'CLASSIC';
  switch (diff) {
    case 'NORMAL':
      return {
        label: 'NORMAL',
        textColor: 'text-neutral-200 font-bold',
        borderColor: 'border-[#323238] focus:border-neutral-500',
        bgColor: 'bg-[#121215] hover:bg-[#18181c]',
        glowShadow: '',
        badgeBg: 'bg-[#16161a] text-neutral-200 border-[#2e2e34]',
        desc: isClassic
          ? '100 HP · 3 Items · No Scalpel · 25 Self-Live DMG · Dealer 100 HP'
          : '100 HP · 3 Items · 70 Self-Live DMG · Full Chamber HUD · Dealer 100 HP',
        intensity: 'NORMAL',
      };
    case 'HARD':
      return {
        label: 'HARD',
        textColor: 'text-amber-500 font-bold',
        borderColor: 'border-amber-900/70 focus:border-amber-700',
        bgColor: 'bg-[#15120e] hover:bg-[#1c1711]',
        glowShadow: '',
        badgeBg: 'bg-[#1a140e] text-amber-500 border-amber-900/70',
        desc: isClassic
          ? '75 HP · 2 Items · No Scalpel · 20 Self-Live DMG · Dealer 125 HP'
          : '75 HP · 2 Items · 70 Self-Live DMG · Shot Count Only · Dealer 125 HP',
        intensity: 'HARD',
      };
    case 'VERY_HARD':
      return {
        label: 'VERY HARD',
        textColor: 'text-red-500 font-bold',
        borderColor: 'border-red-900/80 focus:border-red-700',
        bgColor: 'bg-[#160d0d] hover:bg-[#1f1010]',
        glowShadow: '',
        badgeBg: 'bg-[#1a0d0d] text-red-500 border-red-900/80',
        desc: isClassic
          ? '50 HP · 1 Item · No Scalpel · 15 Self-Live DMG · Dealer 140 HP'
          : '50 HP · 1 Item · 70 Self-Live DMG · No HUD · Dealer 150 HP',
        intensity: 'VERY HARD',
      };
    case 'NIGHTMARE':
      return {
        label: 'NIGHTMARE',
        textColor: 'text-red-400 font-bold',
        borderColor: 'border-red-800 focus:border-red-600',
        bgColor: 'bg-[#1d0a0c] hover:bg-[#280c0f]',
        glowShadow: '',
        badgeBg: 'bg-[#22090b] text-red-400 border-red-800',
        desc: isClassic
          ? '30 HP · 0 Items · No Scalpel · 12 Self-Live DMG · Dealer 160 HP'
          : '30 HP · 0 Items · 70 Self-Live DMG · Deceptive HUD · Dealer 200 HP',
        intensity: 'NIGHTMARE',
      };
  }
};

export const getLowHealthThreshold = (diff: Difficulty, branch: GameBranch = 'REVAMPED'): number => {
  if (branch === 'CLASSIC') {
    switch (diff) {
      case 'NORMAL': return 25;
      case 'HARD': return 20;
      case 'VERY_HARD': return 15;
      case 'NIGHTMARE': return 12;
      default: return 25;
    }
  }
  switch (diff) {
    case 'NORMAL':
      return 35; // 35 or less is critical (under one standard shot of 35 damage)
    case 'HARD':
      return 25; // 25 or less is critical
    case 'VERY_HARD':
      return 20; // 20 or less is critical
    case 'NIGHTMARE':
      return 10; // 10 or less is critical (when starting with 30 max health)
    default:
      return 30;
  }
};

export default function App() {
  const {
    gameState,
    difficulty: gameDifficulty,
    branch: gameBranch,
    chambers,
    currentChamberIndex,
    player,
    dealer,
    message,
    subMessage,
    bloodLevel,
    retaliationActive,
    playerDamageReductionEnd,
    dealerDamageReductionEnd,
    bloodCurrency,
    doubleDamageActive,
    roundsSurvived,
    shooter,
    target,
    buyItem,
    startGame,
    fireGun,
    useItem,
  } = useGameState();

  const [showDeathScreen, setShowDeathScreen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [isHigh, setIsHigh] = useState(false);
  const [branch, setBranch] = useState<GameBranch>(() => {
    try {
      const saved = localStorage.getItem("russian_roulette_branch");
      if (saved === "CLASSIC" || saved === "REVAMPED") {
        return saved;
      }
      return "REVAMPED";
    } catch {
      return "REVAMPED";
    }
  });
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    try {
      const saved = localStorage.getItem("russian_roulette_diff");
      if (saved && ["NORMAL", "HARD", "VERY_HARD", "NIGHTMARE"].includes(saved)) {
        return saved as Difficulty;
      }
      return "NORMAL";
    } catch {
      return "NORMAL";
    }
  });
  const [inputType, setInputType] = useState<InputType>(() => getControllerSettings().inputType || "kbm");
  const [controllerLayout, setControllerLayout] = useState<ControllerLayout>(() => getControllerSettings().controllerLayout || "xbox");
  const [bloodEffectsEnabled, setBloodEffectsEnabled] = useState(() => getControllerSettings().bloodEffectsEnabled !== false);
  const [webGpuSupported, setWebGpuSupported] = useState<boolean>(true);
  const [shaderCompileState, setShaderCompileState] = useState<(ShaderCompileProgress & { active: boolean }) | null>(null);
  const pendingStartRef = useRef<{ difficulty: Difficulty; branch: GameBranch } | null>(null);
  const showShaderScreen = Boolean(shaderCompileState?.active);
  const shaderCompileActiveRef = useRef(false);
  shaderCompileActiveRef.current = showShaderScreen;

  const handleBranchChange = (val: GameBranch) => {
    setBranch(val);
    try {
      localStorage.setItem("russian_roulette_branch", val);
    } catch {}
  };

  const handleDifficultyChange = (val: Difficulty) => {
    setDifficulty(val);
    try {
      localStorage.setItem("russian_roulette_diff", val);
    } catch {}
  };

  const diffConfig = getDifficultyConfig(difficulty, branch);

  const activeDifficulty = gameDifficulty || difficulty;
  const activeBranch = gameBranch || branch;
  const unspentChambers = chambers ? chambers.filter((c) => !c.isSpent) : [];
  const unspentTotal = unspentChambers.length;
  const activeLiveCount = unspentChambers.filter((c) => c.isLive).length;
  const activeBlankCount = unspentChambers.filter((c) => !c.isLive).length;

  // Liar's Chamber deceptive calculations for NIGHTMARE difficulty
  let nightmareLiveCount = 0;
  let nightmareBlankCount = 0;
  if (activeDifficulty === "NIGHTMARE" && unspentTotal > 0) {
    if (activeLiveCount === activeBlankCount) {
      nightmareLiveCount = Math.min(unspentTotal, activeLiveCount + 1);
    } else {
      nightmareLiveCount = activeBlankCount;
    }
    nightmareBlankCount = Math.max(0, unspentTotal - nightmareLiveCount);
  }

  // Detect whether the browser supports WebGPU or if session emergency fallback is active
  useEffect(() => {
    const updateSupport = () => {
      const fb = getWebGpuEmergencyFallbackState();
      if (fb.active) {
        setWebGpuSupported(false);
        return;
      }
      isWebGPUSupported().then((res) => {
        setWebGpuSupported(res.supported && !getWebGpuEmergencyFallbackState().active);
      });
    };
    updateSupport();
    return subscribeWebGpuFallbackState(updateSupport);
  }, []);

  useEffect(() => {
    const s = getControllerSettings();
    setInputType(s.inputType || "kbm");
    setControllerLayout(s.controllerLayout || "xbox");
    setBloodEffectsEnabled(s.bloodEffectsEnabled !== false);
    return subscribeControllerSettings((updated) => {
      setInputType(updated.inputType);
      setControllerLayout(updated.controllerLayout || "xbox");
      setBloodEffectsEnabled(updated.bloodEffectsEnabled !== false);
    });
  }, []);

  const isPlayerTurn = gameState === "PLAYER_TURN";
  const showControls = isPlayerTurn;
  const isActionInProgress = gameState === "SHOOTING" || gameState === "ITEM_USE" || gameState === "LOADING" || gameState === "DEALER_TURN";

  useEffect(() => {
    if (selectedItemIndex >= player.items.length) {
      setSelectedItemIndex(Math.max(0, player.items.length - 1));
    }
  }, [player.items.length, selectedItemIndex]);

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      // Suppress UI click and tap sounds during revolver shooting sequences
      if (gameStateRef.current === "SHOOTING") {
        return;
      }
      const target = e.target as HTMLElement;
      const btn = target.closest("button") || target.closest("a") || target.closest(".clickable");
      if (btn) {
        if (btn.classList.contains('shoot-btn') || btn.classList.contains('shoot-action-btn')) {
          return;
        }
        if (btn.classList.contains('back-btn') || btn.closest('.back-btn')) {
          playUIClick('back');
        } else if (btn.getAttribute('role') === 'switch' || btn.getAttribute('role') === 'tab' || btn.getAttribute('role') === 'option' || btn.getAttribute('role') === 'combobox' || btn.getAttribute('aria-checked') != null) {
          playUIClick('toggle');
        } else {
          playTapSound();
        }
      }
    };
    
    const handleGlobalMouseOver = (e: MouseEvent) => {
      if (gameStateRef.current === "SHOOTING") {
        return;
      }
      const target = e.target as HTMLElement;
      const related = e.relatedTarget as HTMLElement;
      
      const targetBtn = target.closest("button") || target.closest("a") || target.closest('input[type="range"]') || target.closest(".clickable");
      const relatedBtn = related ? (related.closest("button") || related.closest("a") || related.closest('input[type="range"]') || related.closest(".clickable")) : null;
      
      if (targetBtn && targetBtn !== relatedBtn) {
        playUIHover(0.4);
      }
    };

    let lastSliderPlayTime = 0;
    const handleGlobalInput = (e: Event) => {
      if (gameStateRef.current === "SHOOTING") {
        return;
      }
      const target = e.target as HTMLInputElement;
      if (target.tagName.toLowerCase() === "input" && target.type === "range") {
        const now = performance.now();
        if (now - lastSliderPlayTime > 30) { // Rate limit slider tick sounds
          lastSliderPlayTime = now;
          const min = parseFloat(target.min) || 0;
          const max = parseFloat(target.max) || 100;
          const val = parseFloat(target.value) || 0;
          const normalized = (val - min) / (max - min);
          playUISliderTick(normalized);
        }
      }
    };

    window.addEventListener("click", handleGlobalClick, true);
    window.addEventListener("mouseover", handleGlobalMouseOver, true);
    window.addEventListener("input", handleGlobalInput, true);
    
    return () => {
      window.removeEventListener("click", handleGlobalClick, true);
      window.removeEventListener("mouseover", handleGlobalMouseOver, true);
      window.removeEventListener("input", handleGlobalInput, true);
    };
  }, []);

  useEffect(() => {
    const isCritical =
      player.health > 0 &&
      player.health <= getLowHealthThreshold(activeDifficulty, activeBranch) &&
      gameState !== "GAME_OVER";
    setHeartbeatStatus(isCritical);
  }, [player.health, gameState, activeDifficulty, activeBranch]);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsHigh(
        !!playerDamageReductionEnd && Date.now() < playerDamageReductionEnd,
      );
    }, 200);
    return () => clearInterval(interval);
  }, [playerDamageReductionEnd]);

  useEffect(() => {
    if (gameState === "GAME_OVER" && player.health <= 0) {
      const timer = setTimeout(() => {
        setShowDeathScreen(true);
      }, 2800);
      return () => clearTimeout(timer);
    } else {
      setShowDeathScreen(false);
    }
  }, [gameState, player.health]);

  useEffect(() => {
    if (isSettingsOpen) {
      if ((player.health <= 0 && gameState !== "MENU") || isActionInProgress) {
        setIsSettingsOpen(false);
      }
    }
  }, [player.health, gameState, isSettingsOpen, isActionInProgress]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shaderCompileActiveRef.current) {
        return;
      }
      if (
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          document.activeElement.tagName === "SELECT")
      ) {
        return;
      }

      if (e.key === "Tab" || e.key === "Escape") {
        e.preventDefault();
        if (player.health <= 0 && gameState !== "MENU") return;
        if (isActionInProgress) return;
        setIsSettingsOpen((p) => !p);
        return;
      }

      if (isSettingsOpen) {
        if (e.key === "Escape") {
          setIsSettingsOpen(false);
        }
        return;
      }

      if (
        gameState === "MENU" ||
        gameState === "ROUND_OVER" ||
        gameState === "GAME_OVER" ||
        gameState === "VICTORY"
      ) {
        if (e.key === " " || e.code === "Space" || e.key === "Enter") {
          e.preventDefault();
          const buttons = Array.from(
            document.querySelectorAll(".btn-rusty"),
          ) as HTMLButtonElement[];
          const actionBtn = buttons.find((b) => !b.disabled);
          if (actionBtn) actionBtn.click();
          return;
        }

        if (gameState === "MENU") {
          if (e.key === "ArrowUp" || e.code === "KeyW" || e.key === "ArrowDown" || e.code === "KeyS") {
            e.preventDefault();
            handleBranchChange(branch === "CLASSIC" ? "REVAMPED" : "CLASSIC");
          } else if (e.key === "ArrowLeft" || e.code === "KeyA") {
            e.preventDefault();
            const diffs: Difficulty[] = ["NORMAL", "HARD", "VERY_HARD", "NIGHTMARE"];
            const idx = diffs.indexOf(difficulty);
            handleDifficultyChange(diffs[(idx - 1 + diffs.length) % diffs.length]);
          } else if (e.key === "ArrowRight" || e.code === "KeyD") {
            e.preventDefault();
            const diffs: Difficulty[] = ["NORMAL", "HARD", "VERY_HARD", "NIGHTMARE"];
            const idx = diffs.indexOf(difficulty);
            handleDifficultyChange(diffs[(idx + 1) % diffs.length]);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, isSettingsOpen, branch, difficulty, isActionInProgress, player.health]);

  useEffect(() => {
    let frameId = 0;
    let wasConfirmPressed = false;
    let wasStartPressed = false;
    let wasSelectPressed = false;
    let wasLeftPressed = false;
    let wasRightPressed = false;
    let wasUpPressed = false;
    let wasDownPressed = false;

    const uiGamepadLoop = () => {
      frameId = requestAnimationFrame(uiGamepadLoop);
      if (shaderCompileActiveRef.current) return;

      const gp = pollGamepadAutoSwitch();
      if (!gp) {
        wasConfirmPressed = false;
        wasStartPressed = false;
        wasSelectPressed = false;
        wasLeftPressed = false;
        wasRightPressed = false;
        wasUpPressed = false;
        wasDownPressed = false;
        return;
      }

      const s = getControllerSettings();
      const sem = readSemanticGamepad(gp, s.controllerLayout);

      if (sem.start && !wasStartPressed) {
        if ((player.health > 0 || gameState === "MENU") && !isActionInProgress) {
          setIsSettingsOpen((p) => !p);
          vibrateGamepad("click");
        }
      }

      if (!isSettingsOpen) {
        if (sem.confirm && !wasConfirmPressed) {
          if (
            gameState === "MENU" ||
            gameState === "ROUND_OVER" ||
            gameState === "GAME_OVER" ||
            gameState === "VICTORY"
          ) {
            const buttons = Array.from(
              document.querySelectorAll(".btn-rusty"),
            ) as HTMLButtonElement[];
            const actionBtn = buttons.find((b) => !b.disabled);
            if (actionBtn) {
              actionBtn.click();
              vibrateGamepad("click");
            }
          }
        }

        if (gameState === "MENU") {
          if (sem.select && !wasSelectPressed) {
            setIsSettingsOpen(true);
            vibrateGamepad("click");
          }
          if ((sem.anyUp && !wasUpPressed) || (sem.anyDown && !wasDownPressed)) {
            setBranch((prev) => {
              const next: GameBranch = prev === "CLASSIC" ? "REVAMPED" : "CLASSIC";
              try {
                localStorage.setItem("russian_roulette_branch", next);
              } catch {}
              return next;
            });
            playUIHover(0.4);
            vibrateGamepad("click");
          }
          if (sem.anyLeft && !wasLeftPressed) {
            setDifficulty((prev) => {
              const diffs: Difficulty[] = ["NORMAL", "HARD", "VERY_HARD", "NIGHTMARE"];
              const idx = diffs.indexOf(prev);
              const next = diffs[(idx - 1 + diffs.length) % diffs.length];
              try {
                localStorage.setItem("russian_roulette_diff", next);
              } catch {}
              return next;
            });
            playUIHover(0.4);
            vibrateGamepad("click");
          }
          if (sem.anyRight && !wasRightPressed) {
            setDifficulty((prev) => {
              const diffs: Difficulty[] = ["NORMAL", "HARD", "VERY_HARD", "NIGHTMARE"];
              const idx = diffs.indexOf(prev);
              const next = diffs[(idx + 1) % diffs.length];
              try {
                localStorage.setItem("russian_roulette_diff", next);
              } catch {}
              return next;
            });
            playUIHover(0.4);
            vibrateGamepad("click");
          }
        }
      }

      wasConfirmPressed = sem.confirm;
      wasStartPressed = sem.start;
      wasSelectPressed = sem.select;
      wasLeftPressed = sem.anyLeft;
      wasRightPressed = sem.anyRight;
      wasUpPressed = sem.anyUp;
      wasDownPressed = sem.anyDown;
    };

    frameId = requestAnimationFrame(uiGamepadLoop);
    return () => cancelAnimationFrame(frameId);
  }, [gameState, isSettingsOpen, isActionInProgress, player.health]);

  return (
    <div className={`min-h-screen w-full relative flex flex-col crt ${bloodLevel > 150 ? 'shake-intense' : ''}`}>
      <CustomCursor />
      {/* Blood Overlay */}
      {bloodLevel > 0 && bloodEffectsEnabled && (
        <div
          className={`absolute inset-0 pointer-events-none z-50 ${bloodLevel > 150 ? 'duration-75 scale-105' : 'duration-300'} transition-all`}
          style={{
            backgroundColor: bloodLevel > 150 ? "rgba(42, 0, 0, 0.95)" : "var(--color-blood)",
            opacity: bloodLevel > 150 ? 0.9 : Math.min(0.8, bloodLevel / 200),
            mixBlendMode: "multiply"
          }}
        />
      )}
      {/* Cigarette Smoke Haze Overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-40 transition-opacity duration-[1500ms]"
        style={{
          backgroundColor: "#3a3632",
          opacity: isHigh ? 0.35 : 0,
          mixBlendMode: "screen",
          filter: "blur(24px)",
        }}
      />
      {player.health > 0 &&
        player.health <= getLowHealthThreshold(activeDifficulty, activeBranch) &&
        gameState !== "GAME_OVER" && (
          <div className="absolute inset-0 z-40 heartbeat-overlay mix-blend-multiply pointer-events-none" />
        )}
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsPanel difficulty={difficulty} onClose={() => setIsSettingsOpen(false)} />
        )}
      </AnimatePresence>

      {gameState === "MENU" && !showShaderScreen ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 z-10 text-center">
          <h1
            className="text-5xl sm:text-6xl font-sans font-bold text-red-700 tracking-tighter mb-3 uppercase"
          >
            RUSSIAN <br /> ROULETTE
          </h1>
          <p className="text-neutral-500 font-mono tracking-[0.25em] uppercase mb-10 text-xs">
            PULL THE TRIGGER. FACE THE DEALER.
          </p>

          <div className="flex flex-col items-center gap-4 mb-8 max-w-md w-full mx-auto px-2">
            {/* Minimalist Branch Selector: Classic vs Revamped */}
            <div className="flex items-center justify-center gap-2">
              {inputType === "gamepad" && (
                <ControllerGlyph role="dpad_ud" layout={controllerLayout} size="xs" />
              )}
              <div
                role="tablist"
                aria-label="Difficulty branch"
                className="inline-flex items-center border-b border-[#26262b]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={branch === "CLASSIC"}
                  onClick={() => handleBranchChange("CLASSIC")}
                  className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] font-bold whitespace-nowrap transition-colors cursor-pointer border-b-2 -mb-[1px] ${
                    branch === "CLASSIC"
                      ? "text-neutral-100 border-red-700"
                      : "text-neutral-500 border-transparent hover:text-neutral-300"
                  }`}
                >
                  CLASSIC
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={branch === "REVAMPED"}
                  onClick={() => handleBranchChange("REVAMPED")}
                  className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] font-bold whitespace-nowrap transition-colors cursor-pointer border-b-2 -mb-[1px] ${
                    branch === "REVAMPED"
                      ? "text-neutral-100 border-red-700"
                      : "text-neutral-500 border-transparent hover:text-neutral-300"
                  }`}
                >
                  REVAMPED
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3">
              {inputType === "gamepad" && (
                <ControllerGlyph role="dpad_lr" layout={controllerLayout} size="xs" />
              )}
              <div className="w-[220px]">
                <CustomSelect<Difficulty>
                  options={[
                    { value: "NORMAL", label: "Normal", colorClass: "text-neutral-200 font-bold" },
                    { value: "HARD", label: "Hard", colorClass: "text-amber-500 font-bold" },
                    { value: "VERY_HARD", label: "Very Hard", colorClass: "text-red-500 font-bold" },
                    { value: "NIGHTMARE", label: "Nightmare", colorClass: "text-red-400 font-bold" }
                  ]}
                  value={difficulty}
                  onChange={(val) => handleDifficultyChange(val)}
                  showIndustrialScrollbar={false}
                  buttonClassName={`min-w-[200px] uppercase font-mono tracking-widest ${diffConfig.borderColor} ${diffConfig.bgColor}`}
                />
              </div>
            </div>

            <div className="w-full max-w-sm px-3.5 py-2 border border-[#26262b] bg-[#0e0e11] font-mono text-[11px] text-neutral-400 text-center">
              {diffConfig.desc}
            </div>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="text-neutral-400 font-mono text-xs uppercase tracking-[0.2em] hover:text-neutral-200 transition-colors py-2 px-3 flex items-center gap-2 mx-auto justify-center cursor-pointer min-h-[40px]"
            >
              {inputType === "gamepad" && (
                <ControllerGlyph role="start" layout={controllerLayout} size="xs" />
              )}
              <span>SETTINGS</span>
            </button>
          </div>

          <button
            onClick={() => {
              const initialBackend = webGpuSupported ? "WEBGPU · WGSL" : "WEBGL 2.0 · GLSL";
              pendingStartRef.current = { difficulty, branch };
              setShaderCompileState({
                active: true,
                backend: initialBackend,
                stage: "INITIALIZING RENDER BACKEND",
                progress: 2,
                compiled: 0,
                total: 0,
                elapsedMs: 0,
              });
            }}
            className="btn-rusty px-10 py-3.5 min-h-[48px] text-base font-bold tracking-[0.25em] flex items-center justify-center gap-3 cursor-pointer"
          >
            {inputType === "gamepad" && (
              <ControllerGlyph role="confirm" layout={controllerLayout} size="lg" />
            )}
            ENTER CHAMBER
          </button>
        </div>
      ) : (
        // --- 3D MODE IMMERSIVE FULL-SCREEN VISUAL LAYOUT ---
        <>
          {/* Full Screen 3D Arena World background */}
          <div className="fixed inset-0 w-full h-full z-0 overflow-hidden pointer-events-auto">
            <Arena3D
              gameState={gameState}
              chambers={chambers}
              currentChamberIndex={currentChamberIndex}
              player={player}
              dealer={dealer}
              message={message}
              subMessage={subMessage}
              bloodLevel={bloodLevel}
              doubleDamageActive={doubleDamageActive}
              retaliationActive={retaliationActive}
              selectedItemIndex={selectedItemIndex}
              bloodCurrency={bloodCurrency}
              showControls={showControls}
              useItem={useItem}
              fireGun={fireGun}
              buyItem={buyItem}
              playerDamageReductionEnd={playerDamageReductionEnd}
              dealerDamageReductionEnd={dealerDamageReductionEnd}
              difficulty={activeDifficulty}
              branch={activeBranch}
              shooter={shooter}
              target={target}
              onShaderCompileProgress={(info) => {
                setShaderCompileState({ active: true, ...info });
              }}
              onShaderCompileComplete={() => {
                setShaderCompileState(null);
                const pending = pendingStartRef.current;
                pendingStartRef.current = null;
                if (pending) {
                  startGame(pending.difficulty, false, pending.branch);
                }
              }}
              onShaderCompileError={() => {
                setShaderCompileState(null);
                pendingStartRef.current = null;
              }}
            />
          </div>

          {/* Minimalist Gritty Shader Pre-Compilation Screen */}
          {showShaderScreen && shaderCompileState && (
            <div className="fixed inset-0 z-[300] bg-[#08080a] flex flex-col items-center justify-center p-6 select-none font-mono">
              <div className="w-full max-w-md border border-[#26262b] bg-[#0b0b0d] p-6 flex flex-col gap-5">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-3">
                  <span className="text-[11px] font-bold tracking-[0.22em] text-neutral-200 uppercase">
                    SHADER COMPILATION
                  </span>
                  <span className="text-[10px] tracking-[0.16em] text-red-500 font-bold uppercase tabular-nums">
                    {shaderCompileState.backend}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[10px] tracking-[0.15em] uppercase">
                    <span className="text-neutral-400 truncate pr-3">
                      {shaderCompileState.stage}
                    </span>
                    <span className="text-neutral-200 font-bold tabular-nums shrink-0">
                      {shaderCompileState.progress}%
                    </span>
                  </div>

                  <div className="w-full h-1.5 bg-[#141418] border border-[#26262b] overflow-hidden">
                    <div
                      className="h-full bg-[#7f1d1d] transition-[width] duration-150 ease-out"
                      style={{ width: `${shaderCompileState.progress}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-neutral-500 tracking-[0.14em] uppercase tabular-nums border-t border-[#1e1e23] pt-3">
                  <span>
                    {shaderCompileState.total > 0
                      ? `PIPELINES ${shaderCompileState.compiled}/${shaderCompileState.total}`
                      : "PREPARING PIPELINES"}
                  </span>
                  <span>
                    {(shaderCompileState.elapsedMs / 1000).toFixed(2)}S
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Immersive high-contrast floating overlay HUD */}
          {!showShaderScreen && (
            <div className="fixed inset-0 flex flex-col justify-between p-4 sm:p-8 z-10 pointer-events-none select-none">
                  {(player.health > 0 || gameState === "MENU") && !isActionInProgress && (
              <button
                 onClick={() => {
                   if ((player.health > 0 || gameState === "MENU") && !isActionInProgress) {
                     setIsSettingsOpen(true);
                   }
                 }}
                 className="pointer-events-auto absolute top-3 left-3 sm:top-4 sm:left-4 z-50 text-neutral-400 font-mono text-[11px] uppercase tracking-widest hover:text-neutral-100 transition-colors py-2 px-3 sm:py-1.5 frosted-glass-ui inline-flex items-center gap-2 w-auto cursor-pointer min-h-[40px] sm:min-h-0"
              >

                 {inputType === "gamepad" && (
                   <ControllerGlyph role="start" layout={controllerLayout} size="xs" />
                 )}
                 <span>SETTINGS</span>
              </button>
            )}

            {/* Difficulty-Scaled Cylinder Load Overlay HUD */}
            {gameState !== "MENU" && unspentTotal > 0 && (
              <>
                {/* 1. NORMAL MODE: Full Physical Shell Count */}
                {activeDifficulty === "NORMAL" && (
                  <div className="pointer-events-auto absolute bottom-20 left-3 sm:bottom-8 sm:left-8 z-40 flex flex-col gap-1 frosted-glass-ui px-2.5 py-1.5 sm:px-3 sm:py-2 select-none font-mono text-[10px] min-w-[130px] sm:min-w-[160px] tabular-nums">
                    <div className="flex items-center justify-between gap-3 text-neutral-500 uppercase tracking-widest text-[9px] border-b border-neutral-800 pb-1">
                      <span>CYLINDER</span>
                      <span>{unspentTotal}</span>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500 text-[9px]">LIVE</span>
                        <span className="text-red-500 font-bold text-xs">
                          {activeLiveCount}
                        </span>
                      </div>

                      <span className="text-neutral-800">·</span>

                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500 text-[9px]">BLANK</span>
                        <span className="text-neutral-200 font-bold text-xs">
                          {activeBlankCount}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. HARD MODE: "The Blind Chamber" (Remaining Shots Only) */}
                {activeDifficulty === "HARD" && (
                  <div className="pointer-events-auto absolute bottom-20 left-3 sm:bottom-8 sm:left-8 z-40 flex flex-col gap-1 frosted-glass-ui px-2.5 py-1.5 sm:px-3 sm:py-2 select-none font-mono text-[10px] min-w-[130px] sm:min-w-[150px] tabular-nums">
                    <div className="flex items-center justify-between gap-3 text-neutral-500 uppercase tracking-widest text-[9px] border-b border-neutral-800 pb-1">
                      <span>CYLINDER</span>
                      <span className="text-amber-500/80 text-[9px]">BLIND</span>
                    </div>

                    <div className="pt-0.5 text-neutral-200 font-bold text-xs tracking-wider uppercase">
                      {unspentTotal} REMAINING
                    </div>
                  </div>
                )}

                {/* 3. VERY_HARD MODE: "Total Blackout" -> No box rendered */}

                {/* 4. NIGHTMARE MODE: "Liar's Chamber" (Deceptive Lies in Normal GUI Design) */}
                {activeDifficulty === "NIGHTMARE" && (
                  <div className="pointer-events-auto absolute bottom-20 left-3 sm:bottom-8 sm:left-8 z-40 flex flex-col gap-1 frosted-glass-ui px-2.5 py-1.5 sm:px-3 sm:py-2 select-none font-mono text-[10px] min-w-[130px] sm:min-w-[160px] tabular-nums">
                    <div className="flex items-center justify-between gap-3 text-neutral-500 uppercase tracking-widest text-[9px] border-b border-neutral-800 pb-1">
                      <span>CYLINDER</span>
                      <span>{unspentTotal}</span>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500 text-[9px]">LIVE</span>
                        <span className="text-red-500 font-bold text-xs">
                          {nightmareLiveCount}
                        </span>
                      </div>

                      <span className="text-neutral-800">·</span>

                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500 text-[9px]">BLANK</span>
                        <span className="text-neutral-200 font-bold text-xs">
                          {nightmareBlankCount}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {isPlayerTurn && inputType === "gamepad" && (
              <div className="hidden sm:flex absolute top-4 left-1/2 -translate-x-1/2 items-center justify-center gap-2.5 text-[10px] uppercase font-mono text-neutral-300 frosted-glass-ui px-4 py-1.5 whitespace-nowrap">
                <span className="flex items-center gap-1.5">
                  <ControllerGlyph role="cancel" layout={controllerLayout} size="sm" />
                  <span>TOGGLE</span>
                </span>
                <span className="text-neutral-700">·</span>
                <span className="flex items-center gap-1.5">
                  <ControllerGlyph role="dpad" layout={controllerLayout} size="xs" />
                  <span>CYCLE</span>
                </span>
                <span className="text-neutral-700">·</span>
                <span className="flex items-center gap-1.5">
                  <ControllerGlyph role="confirm" layout={controllerLayout} size="sm" />
                  <span>USE/BUY</span>
                </span>
                <span className="text-neutral-700">·</span>
                <span className="flex items-center gap-1.5">
                  <ControllerGlyph role="lt" layout={controllerLayout} size="xs" />
                  <span className="text-neutral-200 font-bold">SELF</span>
                </span>
                {activeBranch !== "CLASSIC" && (
                  <>
                    <span className="text-neutral-700">·</span>
                    <span className="flex items-center gap-1.5">
                      <ControllerGlyph role="rt" layout={controllerLayout} size="xs" />
                      <span className="text-red-500 font-bold">DEALER</span>
                    </span>
                  </>
                )}
                <span className="text-neutral-700">·</span>
                <span className="flex items-center gap-1.5">
                  <ControllerGlyph role="rstick" layout={controllerLayout} size="xs" />
                  <span>LOOK</span>
                </span>
              </div>
            )}

            {/* Top Row: Dealer Hand info */}
            <div className="flex justify-between items-start w-full mt-1 sm:mt-0">
              <div className="flex items-center gap-3 pointer-events-auto">
              </div>
              <div className="text-[10px] font-mono text-neutral-400 frosted-glass-ui px-2.5 py-1 select-none tabular-nums">
                DEALER {dealer.items.length}/8
              </div>
            </div>

            {/* Bottom Section */}
            <div className="flex flex-col gap-3 w-full mt-auto">
              <div className="flex justify-between items-end w-full">
                <div className="pointer-events-auto">
                </div>

                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-mono text-neutral-400 uppercase frosted-glass-ui px-2.5 py-1 tracking-wider tabular-nums mb-14 sm:mb-0">
                    ITEMS {player.items.length}/8
                  </span>
                </div>
              </div>
            </div>

            {/* Dialogue Box: Centered cleanly above the bottom shoot self hitbox */}
            {gameState !== "SHOOTING" &&
              !(gameState === "GAME_OVER" && player.health <= 0) && (
              <div className="absolute bottom-[28vh] md:bottom-[30.5vh] left-1/2 -translate-x-1/2 text-center max-w-2xl w-full px-4 flex flex-col gap-1.5 items-center pointer-events-none select-text z-20 animate-fade-in">
                <h2 className="text-sm sm:text-lg md:text-xl font-mono text-white tracking-[0.18em] sm:tracking-[0.2em] font-bold uppercase drop-shadow-[0_2px_12px_rgba(0,0,0,1.0)]">
                  {message}
                </h2>
                {subMessage && (
                  <p className="text-red-500 font-serif italic text-xs sm:text-sm md:text-base drop-shadow-[0_1.5px_6px_rgba(0,0,0,1.0)]">
                    {subMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        </>
      )}

      {/* Cinematic overlay for 3D Mode during falling animation */}
      {gameState === "GAME_OVER" && player.health <= 0 && !showDeathScreen && (
        <motion.div
          className="fixed inset-0 bg-black pointer-events-none z-[150]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2.2, delay: 0.3, ease: "easeIn" }}
        />
      )}

      {/* GLOBAL GAME OVER OVERLAY */}
      {gameState === "GAME_OVER" && (showDeathScreen || dealer.health <= 0) && (
        <div className="fixed inset-0 bg-[#070709] flex flex-col items-center justify-center z-[200] p-6">
          {player.health <= 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex flex-col items-center gap-6 z-10 w-full max-w-sm"
            >
              <h2 className="text-7xl sm:text-8xl font-black text-red-700 font-serif tracking-[0.2em] uppercase select-none text-center">
                DEAD
              </h2>

              <div className="w-full font-mono text-xs text-neutral-300 tracking-wider uppercase flex flex-col gap-2 frosted-glass-ui px-5 py-4 tabular-nums">
                <div className="flex justify-between border-b border-neutral-800 pb-2">
                  <span className="text-neutral-500">Rounds Survived</span>
                  <span className="text-neutral-200 font-bold">{roundsSurvived}</span>
                </div>
                <div className="flex justify-between border-b border-neutral-800 pb-2">
                  <span className="text-neutral-500">Blood Splattered</span>
                  <span className="text-red-500 font-bold">{bloodLevel}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Lost Blood</span>
                  <span className="text-neutral-200 font-bold">{bloodCurrency}</span>
                </div>
              </div>

              <button
                onClick={() => startGame(activeDifficulty, false, activeBranch)}
                className="btn-rusty w-full py-3.5 min-h-[48px] text-sm font-bold tracking-[0.25em] uppercase cursor-pointer flex items-center justify-center gap-3"
              >
                {inputType === "gamepad" && (
                  <ControllerGlyph role="confirm" layout={controllerLayout} size="md" />
                )}
                TRY AGAIN
              </button>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex flex-col items-center gap-6 z-10 w-full max-w-sm"
            >
              <div className="text-center space-y-2">
                <h2 className="text-5xl sm:text-6xl font-black text-neutral-200 font-serif tracking-[0.2em] uppercase select-none">
                  SURVIVED
                </h2>
                <p className="text-neutral-500 font-mono text-[11px] uppercase tracking-widest">
                  The house is still waiting.
                </p>
              </div>

              <div className="w-full font-mono text-xs text-neutral-300 tracking-wider uppercase flex flex-col gap-2 frosted-glass-ui px-5 py-4 tabular-nums">
                <div className="flex justify-between border-b border-neutral-800 pb-2">
                  <span className="text-neutral-500">Rounds Survived</span>
                  <span className="text-neutral-200 font-bold">{roundsSurvived}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Retained Blood</span>
                  <span className="text-red-500 font-bold">{bloodCurrency}</span>
                </div>
              </div>

              <button
                onClick={() => startGame(activeDifficulty, true, activeBranch)}
                className="btn-rusty w-full py-3.5 min-h-[48px] text-sm font-bold tracking-[0.25em] uppercase cursor-pointer flex items-center justify-center gap-3"
              >
                {inputType === "gamepad" && (
                  <ControllerGlyph role="confirm" layout={controllerLayout} size="md" />
                )}
                NEXT ROUND
              </button>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
