import { useState, useRef, useEffect, useCallback } from 'react';
import { GameState, GameBranch, Chamber, PlayerState, ItemType, Difficulty } from '../types';
import { DEADLY_QUOTES, getRandomItemsByDifficulty } from '../gameData';
import { playStartAudio, startAmbientDrone, playGunshot, playEmptyClick, playItemSound, playBloodSplatter } from '../audio';
import { vibrateGamepad } from '../controller';
import { decideDealerMove } from '../ai/tacticalEngine';
import { createCoreRound, loadGameCore, resolveCoreItem, resolveCoreShot, type ItemResult } from '../wasm/gameCore';

const INITIAL_HEALTH = 100;
const CYLINDER_SIZE = 6;

const itemMessage = (item: ItemType, user: 'player' | 'dealer', before: CoreState, result: ItemResult): string => {
  const index = before.currentChamberIndex;
  const live = before.chambers[index].isLive;
  switch (item) {
    case 'MIRROR': {
      if (before.branch === 'REVAMPED') {
        if (user === 'dealer') return 'The Dealer inspects the chamber.';
        return live ? 'You see a live round inside.' : 'You see an empty chamber.';
      }
      if (!live && result.chambers[index].isLive) {
        return user === 'player' ? "The mirror's curse warps this final blank into a LIVE round!"
          : 'The Dealer gazes into the mirror — the final blank turns LIVE.';
      }
      if (result.chambers.some((chamber, i) => chamber.isLive !== before.chambers[i].isLive)) {
        if (user === 'dealer') return 'The Dealer peers into the supernatural mirror. An upcoming blank turns LIVE.';
        return live ? 'You see a LIVE round ahead — the mirror curses an upcoming blank into LIVE.'
          : 'Current chamber is blank — the mirror curses an upcoming blank into LIVE.';
      }
      return user === 'player' ? 'The mirror glints crimson — every remaining chamber is already live.'
        : 'The Dealer inspects the chamber through crimson glass.';
    }
    case 'PLIERS': return `Shell ejected. It was a ${live ? 'live round' : 'blank'}.`;
    case 'WHISKEY': return 'Pain numbed. Vitality restored.';
    case 'TOURNIQUET': return 'Braced for impact. Adrenaline surges.';
    case 'PENTAGRAM': return 'Dark bargain struck. Life essence swapped.';
    case 'CIGARETTE': return user === 'player' ? 'You light a cigarette. Nerves steady as smoke fills your lungs.'
      : 'The Dealer lights a cigarette and inhales a deep drag.';
    case 'SCALPEL': return 'The barrel is sawn off. Double damage next shot.';
    case 'DEFIBRILLATOR': return 'A violent jolt. Vitality restored, but max health is permanently reduced.';
    case 'SYRINGE': return 'Instant surge. 50 HP restored.';
    case 'RAZORBLADE': return live ? 'The chamber was already live. Double damage active.' : "Blood seals the blank. It's now a live round.";
    case 'MEDKIT': return 'Critical wounds patched. Fully restored.';
  }
};

interface CoreState {
  gameState: GameState;
  difficulty: Difficulty;
  branch: GameBranch;
  chambers: Chamber[];
  currentChamberIndex: number;
  player: PlayerState;
  dealer: PlayerState;
  message: string;
  subMessage: string;
  bloodLevel: number;
  turnSequence: number;
  retaliationActive: boolean;
  playerDamageReductionEnd: number | null;
  dealerDamageReductionEnd: number | null;
  bloodCurrency: number;
  doubleDamageActive: 'player' | 'dealer' | null;
  roundsSurvived: number;
  shooter: 'player' | 'dealer' | null;
  target: 'player' | 'dealer' | null;
}

export const useGameState = () => {
  const [coreStatus, setCoreStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [coreError, setCoreError] = useState<string | null>(null);
  const [state, setState] = useState<CoreState>({
    gameState: 'MENU',
    difficulty: 'NORMAL',
    branch: 'REVAMPED',
    chambers: [],
    currentChamberIndex: 0,
    player: { health: INITIAL_HEALTH, maxHealth: INITIAL_HEALTH, items: [] },
    dealer: { health: INITIAL_HEALTH, maxHealth: INITIAL_HEALTH, items: [] },
    message: 'Load the cylinder.',
    subMessage: '',
    bloodLevel: 0,
    turnSequence: 0,
    retaliationActive: false,
    playerDamageReductionEnd: null,
    dealerDamageReductionEnd: null,
    bloodCurrency: 0,
    doubleDamageActive: null,
    roundsSurvived: 0,
    shooter: null,
    target: null
  });

  const stateRef = useRef<CoreState>(state);
  const dealerItemsUsedThisTurnRef = useRef(0);
  const dealerKnownShellRef = useRef<boolean | null>(null);
  
  const updateState = useCallback((patch: Partial<CoreState>) => {
    stateRef.current = { ...stateRef.current, ...patch, turnSequence: stateRef.current.turnSequence + 1 };
    setState(stateRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    loadGameCore()
      .then(() => {
        if (active) setCoreStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCoreStatus('failed');
        setCoreError(error instanceof Error ? error.message : 'The Rust game core could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  const liveCount = state.chambers.filter(c => c.isLive && !c.isSpent).length;
  const blankCount = state.chambers.filter(c => !c.isLive && !c.isSpent).length;

  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

  const startRound = async (initialLoading = false) => {
    dealerItemsUsedThisTurnRef.current = 0;
    dealerKnownShellRef.current = null;
    updateState({ gameState: 'LOADING' });
    const isClassic = stateRef.current.branch === 'CLASSIC';
    const round = await createCoreRound(
      stateRef.current.difficulty,
      stateRef.current.branch,
      crypto.getRandomValues(new Uint32Array(1))[0],
    );
    const { chambers: newChambers, liveCount: live } = round;
    
    updateState({
      chambers: newChambers,
      currentChamberIndex: 0,
      retaliationActive: false,
      doubleDamageActive: null,
      message: "Loading the cylinder...",
      subMessage: `${live} live ${live === 1 ? 'round' : 'rounds'}, ${CYLINDER_SIZE - live} ${CYLINDER_SIZE - live === 1 ? 'blank' : 'blanks'}.`,
      shooter: null,
      target: null
    });
    
    if (!initialLoading) {
       const diff = stateRef.current.difficulty;
       const branch = stateRef.current.branch;
       const p = stateRef.current.player;
       const d = stateRef.current.dealer;
       const dealerRefillCount = (diff === 'NORMAL' || (isClassic && diff === 'HARD')) ? 1 : 2;
       updateState({
         player: { ...p, items: [...p.items, ...getRandomItemsByDifficulty(2, diff, 'player', branch)].slice(0, 8) },
         dealer: { ...d, items: [...d.items, ...getRandomItemsByDifficulty(dealerRefillCount, diff, 'dealer', branch)].slice(0, 8) }
       });
    }

    await wait(2200);
    updateState({
      message: DEADLY_QUOTES[Math.floor(Math.random() * DEADLY_QUOTES.length)],
      subMessage: isClassic ? "Your turn. Pull the trigger on yourself — pray for a blank." : "Your turn.",
      gameState: 'PLAYER_TURN'
    });
  };

  const startGame = async (
    difficulty: Difficulty = 'NORMAL',
    nextRound = false,
    branch: GameBranch = stateRef.current.branch || 'REVAMPED'
  ) => {
    try {
      await loadGameCore();
      setCoreStatus('ready');
    } catch (error) {
      setCoreStatus('failed');
      setCoreError(error instanceof Error ? error.message : 'The Rust game core could not be loaded.');
      return;
    }
    playStartAudio();
    startAmbientDrone();

    const isClassic = branch === 'CLASSIC';
    let pHealth = 100, pItems = 3, dHealth = 100, dItems = 2;
    switch(difficulty) {
      case 'NORMAL':
        pHealth = 100; pItems = 3;
        dHealth = 100; dItems = 2;
        break;
      case 'HARD':
        pHealth = 75; pItems = 2;
        dHealth = 125; dItems = isClassic ? 3 : 4;
        break;
      case 'VERY_HARD':
        pHealth = 50; pItems = 1;
        dHealth = isClassic ? 140 : 150; dItems = isClassic ? 4 : 5;
        break;
      case 'NIGHTMARE':
        pHealth = 30; pItems = 0;
        dHealth = isClassic ? 160 : 200; dItems = isClassic ? 5 : 6;
        break;
    }

    const isNextRound = nextRound || (stateRef.current.gameState === 'GAME_OVER' && stateRef.current.player.health > 0);
    const currentItems = isNextRound
      ? stateRef.current.player.items
      : getRandomItemsByDifficulty(pItems, difficulty, 'player', branch);
    const dealerItems = getRandomItemsByDifficulty(dItems, difficulty, 'dealer', branch);

    updateState({
      difficulty,
      branch,
      player: { health: pHealth, maxHealth: pHealth, items: currentItems },
      dealer: { health: dHealth, maxHealth: dHealth, items: dealerItems },
      bloodLevel: 0,
      roundsSurvived: isNextRound ? stateRef.current.roundsSurvived : 0,
      bloodCurrency: isNextRound ? stateRef.current.bloodCurrency : 0,
      turnSequence: 0,
      doubleDamageActive: null,
      retaliationActive: false,
      playerDamageReductionEnd: null,
      dealerDamageReductionEnd: null,
      shooter: null,
      target: null
    });
    await startRound(true);
  };

  const checkRoundOver = async () => {
    const s = stateRef.current;
    if (s.player.health <= 0 || s.dealer.health <= 0) {
      const isPlayerWin = s.player.health > 0 && s.dealer.health <= 0;
      updateState({
        gameState: 'GAME_OVER',
        roundsSurvived: isPlayerWin ? s.roundsSurvived + 1 : s.roundsSurvived,
        message: s.player.health <= 0 ? "" : "The Dealer has been banished.",
        subMessage: ""
      });
      return true;
    }
    
    if (s.chambers.every(c => c.isSpent)) {
      updateState({
        gameState: 'ROUND_OVER',
        message: "Empty.",
        subMessage: "All chambers spent. Loading next round."
      });
      await wait(1200);
      await startRound();
      return true;
    }
    return false;
  };

  const advanceChamber = () => {
    dealerKnownShellRef.current = null;
    updateState({
      currentChamberIndex: (stateRef.current.currentChamberIndex + 1) % CYLINDER_SIZE
    });
  };

  const passTurn = (currentTurn: 'player' | 'dealer') => {
    dealerItemsUsedThisTurnRef.current = 0;
    if (currentTurn === 'player') {
      updateState({ gameState: 'DEALER_TURN', message: "The Dealer's turn." });
    } else {
      updateState({ gameState: 'PLAYER_TURN', message: "Your turn." });
    }
  };

  const fireGun = async (target: 'player' | 'dealer', shooter: 'player' | 'dealer') => {
    const sInit = stateRef.current;
    if (sInit.gameState !== (shooter === 'player' ? 'PLAYER_TURN' : 'DEALER_TURN')) return;
    const isClassic = sInit.branch === 'CLASSIC';

    updateState({ 
      gameState: 'SHOOTING',
      shooter,
      target: isClassic ? shooter : target
    });

    if (shooter === 'dealer') {
      updateState({ retaliationActive: false });
    }

    updateState({
      message: "",
      subMessage: ""
    });
    
    await wait(1500);

    const updatedState = stateRef.current;
    let shot;
    try {
      shot = await resolveCoreShot({
        branch: updatedState.branch,
        difficulty: updatedState.difficulty,
        chambers: updatedState.chambers,
        currentChamberIndex: updatedState.currentChamberIndex,
        player: updatedState.player,
        dealer: updatedState.dealer,
        shooter,
        target,
        doubleDamageActive: updatedState.doubleDamageActive,
        playerDamageReductionActive: Boolean(
          updatedState.playerDamageReductionEnd && Date.now() < updatedState.playerDamageReductionEnd,
        ),
        dealerDamageReductionActive: Boolean(
          updatedState.dealerDamageReductionEnd && Date.now() < updatedState.dealerDamageReductionEnd,
        ),
        bloodCurrency: updatedState.bloodCurrency,
      });
    } catch (error) {
      setCoreStatus('failed');
      setCoreError(error instanceof Error ? error.message : 'The Rust game core stopped responding.');
      updateState({ gameState: 'MENU', message: 'Game core failure.', subMessage: '' });
      return;
    }

    updateState({
      chambers: shot.chambers,
      player: shot.player,
      dealer: shot.dealer,
      doubleDamageActive: shot.doubleDamageActive,
      retaliationActive: shot.retaliationActive,
      bloodCurrency: shot.bloodCurrency,
      target: shot.effectiveTarget,
    });

    if (shot.chamberWasLive) {
      playGunshot();
      vibrateGamepad(shot.effectiveTarget === 'player' ? 'strong' : 'burst');
      setTimeout(playBloodSplatter, 150);
      updateState({ message: "", bloodLevel: 100 });
      
      setTimeout(() => updateState({ bloodLevel: 0 }), 500);
      
      await wait(1200);

      advanceChamber();
      if (await checkRoundOver()) return;
      
      passTurn(shooter);
    } else {
      playEmptyClick();
      vibrateGamepad('weak');

      if (isClassic) {
        updateState({
          message: "*CLICK*",
          subMessage: shooter === 'player' ? "Blank — you survived the pull." : "Blank — the Dealer survived."
        });
      } else {
        updateState({
          message: "",
          subMessage: ""
        });
      }

      await wait(1000);
      
      advanceChamber();
      if (await checkRoundOver()) return;
      
      if (shot.retainsTurn) {
        updateState({
          gameState: shooter === 'player' ? 'PLAYER_TURN' : 'DEALER_TURN',
          message: `${shooter === 'player' ? 'You' : 'The Dealer'} go again.`,
          subMessage: "Shoot."
        });
      } else {
        passTurn(shooter);
      }
    }
  };

  const useItem = async (itemIndex: number, user: 'player' | 'dealer') => {
    const sInit = stateRef.current;
    if (sInit.gameState !== (user === 'player' ? 'PLAYER_TURN' : 'DEALER_TURN')) return;
    const targetPlayer = user === 'player' ? sInit.player : sInit.dealer;
    const item = targetPlayer.items[itemIndex];
    if (!item || (sInit.branch === 'CLASSIC' && item === 'SCALPEL')) return;

    updateState({ gameState: 'ITEM_USE' });
    playItemSound();
    updateState({
      message: `${user === 'player' ? 'You' : 'The Dealer'} used ${item}.`,
      subMessage: '',
    });

    const beforeResolution = stateRef.current;
    const itemTimestamp = Date.now();
    let result;
    try {
      result = await resolveCoreItem({
        branch: beforeResolution.branch,
        chambers: beforeResolution.chambers,
        currentChamberIndex: beforeResolution.currentChamberIndex,
        player: beforeResolution.player,
        dealer: beforeResolution.dealer,
        user,
        itemIndex,
        doubleDamageActive: beforeResolution.doubleDamageActive,
        playerDamageReductionEnd: beforeResolution.playerDamageReductionEnd,
        dealerDamageReductionEnd: beforeResolution.dealerDamageReductionEnd,
        nowMs: itemTimestamp,
      });
    } catch (error) {
      setCoreStatus('failed');
      setCoreError(error instanceof Error ? error.message : 'The Rust game core stopped responding.');
      updateState({ gameState: 'MENU', message: 'Game core failure.', subMessage: '' });
      return;
    }

    if (user === 'dealer') dealerItemsUsedThisTurnRef.current += 1;
    updateState({
      player: { ...beforeResolution.player, items: result.player.items },
      dealer: { ...beforeResolution.dealer, items: result.dealer.items },
    });
    await wait(1000);
    const subMessage = itemMessage(item, user, beforeResolution, result);
    const effectDelay = Date.now() - itemTimestamp;

    if (item === 'RAZORBLADE') {
      updateState({
        player: result.player,
        dealer: result.dealer,
        bloodLevel: user === 'player' ? 180 : stateRef.current.bloodLevel,
        subMessage: 'Slashing flesh with the razorblade...',
      });
      if (user === 'player') vibrateGamepad('jolt', { duration: 400 });
      setTimeout(() => { playBloodSplatter(); if (user === 'player') vibrateGamepad('burst'); }, 50);
      setTimeout(() => { playEmptyClick(); if (user === 'player') vibrateGamepad('click'); }, 150);
      setTimeout(() => { playBloodSplatter(); if (user === 'player') vibrateGamepad('strong'); }, 250);
      await wait(1000);
      setTimeout(() => updateState({ bloodLevel: 0 }), 1500);
    }

    if (item === 'PLIERS') dealerKnownShellRef.current = null;
    if (result.dealerKnownShell !== null) dealerKnownShellRef.current = result.dealerKnownShell;
    updateState({
      chambers: result.chambers,
      currentChamberIndex: result.currentChamberIndex,
      player: result.player,
      dealer: result.dealer,
      doubleDamageActive: result.doubleDamageActive,
      playerDamageReductionEnd: item === 'CIGARETTE' && user === 'player' && result.playerDamageReductionEnd !== null
        ? result.playerDamageReductionEnd + effectDelay : result.playerDamageReductionEnd,
      dealerDamageReductionEnd: item === 'CIGARETTE' && user === 'dealer' && result.dealerDamageReductionEnd !== null
        ? result.dealerDamageReductionEnd + effectDelay : result.dealerDamageReductionEnd,
      subMessage,
    });
    const waitTime = item === 'CIGARETTE' ? 3600 : item === 'SCALPEL' ? 3800 : item === 'MEDKIT' ? 5650 : 2200;
    await wait(waitTime);
    if (await checkRoundOver()) return;

    updateState({ 
      gameState: user === 'player' ? 'PLAYER_TURN' : 'DEALER_TURN',
      message: `${user === 'player' ? 'Your' : "The Dealer's"} turn continues.`,
      subMessage: '',
    });
  };

  // Dealer AI effect trigger
  const aiRef = useRef(false);
  
  useEffect(() => {
    if (state.gameState === 'DEALER_TURN' && !aiRef.current) {
      aiRef.current = true;
      const playDealerTurn = async () => {
        const s = stateRef.current;
        if (s.gameState !== 'DEALER_TURN') {
           aiRef.current = false;
           return;
        }

        await wait(850);

        const currentRef = stateRef.current;
        if (currentRef.gameState !== 'DEALER_TURN') {
           aiRef.current = false;
           return;
        }

        const myItems = currentRef.dealer.items;
        const lCount = currentRef.chambers.filter(c => c.isLive && !c.isSpent).length;
        const bCount = currentRef.chambers.filter(c => !c.isLive && !c.isSpent).length;

        updateState({ message: "The Dealer is calculating..." });
        await wait(320);

        const latestRef = stateRef.current;
        if (latestRef.gameState !== 'DEALER_TURN') {
           aiRef.current = false;
           return;
        }

        const now = Date.now();
        const decision = decideDealerMove({
          difficulty: latestRef.difficulty || 'NORMAL',
          branch: latestRef.branch || 'REVAMPED',
          dealer: latestRef.dealer,
          player: latestRef.player,
          liveCount: lCount,
          blankCount: bCount,
          knownCurrentShell: dealerKnownShellRef.current,
          doubleDamageActive: latestRef.doubleDamageActive,
          retaliationActive: latestRef.retaliationActive,
          dealerDamageReductionActive: Boolean(
            latestRef.dealerDamageReductionEnd && now < latestRef.dealerDamageReductionEnd
          ),
          playerDamageReductionActive: Boolean(
            latestRef.playerDamageReductionEnd && now < latestRef.playerDamageReductionEnd
          ),
          itemsUsedThisTurn: dealerItemsUsedThisTurnRef.current,
        });

        aiRef.current = false;
        if (
          decision.action === 'USE_ITEM' &&
          decision.itemIndex >= 0 &&
          decision.itemIndex < myItems.length
        ) {
          useItem(decision.itemIndex, 'dealer');
          return;
        }

        const target =
          decision.action === 'SHOOT' ? decision.target : 'player';
        fireGun(target, 'dealer');
      };

      playDealerTurn();
    }
  }, [state.gameState, state.turnSequence]); // Trigger on every state update while dealer turn matches

  const buyItem = (itemType: ItemType, cost: number) => {
      if (stateRef.current.branch === 'CLASSIC' && itemType === 'SCALPEL') return;
      if (stateRef.current.bloodCurrency >= cost && stateRef.current.player.items.length < 8) {
          const p = stateRef.current.player;
          updateState({
              bloodCurrency: stateRef.current.bloodCurrency - cost,
              player: { ...p, items: [...p.items, itemType] }
          });
      }
  };

  return {
    ...state,
    coreStatus,
    coreError,
    liveCount,
    blankCount,
    startGame,
    fireGun,
    useItem,
    buyItem
  };
};
