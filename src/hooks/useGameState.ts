import { useState, useRef, useEffect, useCallback } from 'react';
import { GameState, GameBranch, Chamber, PlayerState, ItemType, Difficulty } from '../types';
import { DEADLY_QUOTES, getRandomItemsByDifficulty } from '../gameData';
import { playStartAudio, startAmbientDrone, playGunshot, playEmptyClick, playItemSound, playBloodSplatter } from '../audio';
import { vibrateGamepad } from '../controller';
import { decideDealerMove } from '../ai/tacticalEngine';

const INITIAL_HEALTH = 100;
const DAMAGE_PER_SHOT = 35;
const CYLINDER_SIZE = 6;

const generateChambers = (numLive: number): Chamber[] => {
  const chambers = Array(CYLINDER_SIZE).fill({ isLive: false, isSpent: false });
  let placed = 0;
  while (placed < numLive) {
    const idx = Math.floor(Math.random() * CYLINDER_SIZE);
    if (!chambers[idx].isLive) {
      chambers[idx] = { isLive: true, isSpent: false };
      placed++;
    }
  }
  return chambers;
};


const getClassicSelfDamage = (difficulty: Difficulty): number => {
  switch (difficulty) {
    case 'NORMAL': return 25;
    case 'HARD': return 20;
    case 'VERY_HARD': return 15;
    case 'NIGHTMARE': return 12;
  }
};

const getClassicLiveCount = (difficulty: Difficulty): number => {
  switch (difficulty) {
    case 'NORMAL': return Math.floor(Math.random() * 2) + 1; // 1-2 live rounds
    case 'HARD': return Math.floor(Math.random() * 3) + 1; // 1-3 live rounds
    case 'VERY_HARD': return Math.floor(Math.random() * 3) + 2; // 2-4 live rounds
    case 'NIGHTMARE': return Math.floor(Math.random() * 4) + 2; // 2-5 live rounds
  }
};

const getRevampedLiveCount = (difficulty: Difficulty): number => {
  switch (difficulty) {
    case 'NORMAL': return Math.floor(Math.random() * 3) + 1; // 1-3 live rounds
    case 'HARD': return Math.floor(Math.random() * 4) + 1; // 1-4 live rounds
    case 'VERY_HARD': return Math.floor(Math.random() * 3) + 2; // 2-4 live rounds
    case 'NIGHTMARE': return Math.floor(Math.random() * 4) + 2; // 2-5 live rounds
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
  stateRef.current = state;
  const dealerItemsUsedThisTurnRef = useRef(0);
  const dealerKnownShellRef = useRef<boolean | null>(null);
  
  const updateState = useCallback((patch: Partial<CoreState>) => {
    stateRef.current = { ...stateRef.current, ...patch, turnSequence: stateRef.current.turnSequence + 1 };
    setState(stateRef.current);
  }, []);

  const liveCount = state.chambers.filter(c => c.isLive && !c.isSpent).length;
  const blankCount = state.chambers.filter(c => !c.isLive && !c.isSpent).length;

  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

  const startRound = async (initialLoading = false) => {
    dealerItemsUsedThisTurnRef.current = 0;
    dealerKnownShellRef.current = null;
    updateState({ gameState: 'LOADING' });
    const isClassic = stateRef.current.branch === 'CLASSIC';
    const live = isClassic
      ? getClassicLiveCount(stateRef.current.difficulty)
      : getRevampedLiveCount(stateRef.current.difficulty);
    const newChambers = generateChambers(live);
    
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
    const isClassic = sInit.branch === 'CLASSIC';
    const effectiveTarget = isClassic ? shooter : target;

    updateState({ 
      gameState: 'SHOOTING',
      shooter,
      target: effectiveTarget
    });
    const s = stateRef.current;
    const chamber = s.chambers[s.currentChamberIndex];

    if (shooter === 'dealer') {
      updateState({ retaliationActive: false });
    }

    updateState({
      message: "",
      subMessage: ""
    });
    
    await wait(1500);

    // Mark spent after the trigger pull delay when the round is actually fired
    const updatedState = stateRef.current;
    const newChambers = [...updatedState.chambers];
    newChambers[updatedState.currentChamberIndex] = { ...chamber, isSpent: true, isEjected: false };
    updateState({ chambers: newChambers });

    if (chamber.isLive) {
      playGunshot();
      vibrateGamepad(effectiveTarget === 'player' ? 'strong' : 'burst');
      setTimeout(playBloodSplatter, 150);
      updateState({ message: "", bloodLevel: 100 });
      
      let damage = isClassic
        ? (effectiveTarget === 'player' ? getClassicSelfDamage(updatedState.difficulty) : DAMAGE_PER_SHOT)
        : (effectiveTarget === shooter ? (DAMAGE_PER_SHOT * 2) : DAMAGE_PER_SHOT);
      
      const wasDouble = updatedState.doubleDamageActive === shooter;
      if (updatedState.doubleDamageActive) {
          if (wasDouble) {
            damage *= 2;
          }
          updateState({ doubleDamageActive: null }); // clear buff
      }
      
      let damageReduction = 0;
      if (effectiveTarget === 'player' && updatedState.playerDamageReductionEnd && Date.now() < updatedState.playerDamageReductionEnd) {
          damageReduction = 30;
      } else if (effectiveTarget === 'dealer' && updatedState.dealerDamageReductionEnd && Date.now() < updatedState.dealerDamageReductionEnd) {
          damageReduction = 30;
      }
      
      damage = Math.max(0, damage - damageReduction);

      if (effectiveTarget === 'player') {
        const p = updatedState.player;
        const remainingHp = Math.max(0, p.health - damage);
        updateState({
          player: { ...p, health: remainingHp },
          bloodCurrency: (isClassic && remainingHp > 0) ? updatedState.bloodCurrency + 10 : updatedState.bloodCurrency
        });
      } else {
        const d = updatedState.dealer;
        const bloodGain = shooter === 'player' ? (wasDouble ? 40 : 25) : (isClassic ? 25 : 0);
        updateState({ 
            dealer: { ...d, health: Math.max(0, d.health - damage) },
            bloodCurrency: updatedState.bloodCurrency + bloodGain 
        });
      }
      
      setTimeout(() => updateState({ bloodLevel: 0 }), 500);
      
      const isDeadlyToPlayer = effectiveTarget === 'player' && updatedState.player.health <= 0;
      await wait(isDeadlyToPlayer ? 300 : 1200);

      advanceChamber();
      if (await checkRoundOver()) return;
      
      passTurn(shooter);
    } else {
      playEmptyClick();
      vibrateGamepad('weak');

      if (updatedState.doubleDamageActive) {
        updateState({ doubleDamageActive: null });
      }

      if (!isClassic && shooter === 'player' && effectiveTarget === 'dealer') {
        updateState({
          retaliationActive: true,
          message: "",
          subMessage: ""
        });
      } else if (isClassic) {
        updateState({
          bloodCurrency: shooter === 'player' ? updatedState.bloodCurrency + 10 : updatedState.bloodCurrency,
          message: "*CLICK*",
          subMessage: shooter === 'player' ? "Blank — you survived the pull." : "Blank — the Dealer survived."
        });
      } else {
        updateState({
          bloodCurrency: shooter === 'player' ? updatedState.bloodCurrency + 5 : updatedState.bloodCurrency,
          message: "",
          subMessage: ""
        });
      }

      await wait(1000);
      
      advanceChamber();
      if (await checkRoundOver()) return;
      
      if (!isClassic && effectiveTarget === shooter) {
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
    const targetPlayer = user === 'player' ? sInit.player : sInit.dealer;
    const requestedItem = targetPlayer.items[itemIndex];
    if (!requestedItem) return;
    if (sInit.branch === 'CLASSIC' && requestedItem === 'SCALPEL') return;

    updateState({ gameState: 'ITEM_USE' });
    playItemSound();
    
    const s = stateRef.current;
    const currentState = user === 'player' ? s.player : s.dealer;
    const item = currentState.items[itemIndex];
    if (!item) return;
    
    // remove item
    const newItems = [...currentState.items];
    newItems.splice(itemIndex, 1);
    
    if (user === 'player') {
      updateState({ player: { ...s.player, items: newItems } });
    } else {
       dealerItemsUsedThisTurnRef.current += 1;
       updateState({ dealer: { ...s.dealer, items: newItems } });
    }

    updateState({
        message: `${user === 'player' ? 'You' : 'The Dealer'} used ${item}.`,
        subMessage: ""
    });
    
    await wait(1000);
    
    const s2 = stateRef.current;
    const chamber = s2.chambers[s2.currentChamberIndex];
    
    let waitTime = 2200;
    
    switch (item) {
      case 'MIRROR':
        if (s2.branch === 'CLASSIC') {
          let upcomingBlankIdx = -1;
          for (let off = 1; off < CYLINDER_SIZE; off++) {
            const idx = (s2.currentChamberIndex + off) % CYLINDER_SIZE;
            if (!s2.chambers[idx].isSpent && !s2.chambers[idx].isLive) {
              upcomingBlankIdx = idx;
              break;
            }
          }

          if (upcomingBlankIdx !== -1) {
            const mirroredChambers = [...s2.chambers];
            mirroredChambers[upcomingBlankIdx] = { ...mirroredChambers[upcomingBlankIdx], isLive: true };
            if (user === 'dealer') dealerKnownShellRef.current = chamber.isLive;
            updateState({
              chambers: mirroredChambers,
              subMessage:
                user === 'player'
                  ? chamber.isLive
                    ? "You see a LIVE round ahead — the mirror curses an upcoming blank into LIVE."
                    : "Current chamber is blank — the mirror curses an upcoming blank into LIVE."
                  : "The Dealer peers into the supernatural mirror. An upcoming blank turns LIVE."
            });
          } else if (!chamber.isSpent && !chamber.isLive) {
            const mirroredChambers = [...s2.chambers];
            mirroredChambers[s2.currentChamberIndex] = { ...chamber, isLive: true };
            if (user === 'dealer') dealerKnownShellRef.current = true;
            updateState({
              chambers: mirroredChambers,
              subMessage:
                user === 'player'
                  ? "The mirror's curse warps this final blank into a LIVE round!"
                  : "The Dealer gazes into the mirror — the final blank turns LIVE."
            });
          } else {
            if (user === 'dealer') dealerKnownShellRef.current = chamber.isLive;
            updateState({
              subMessage:
                user === 'player'
                  ? "The mirror glints crimson — every remaining chamber is already live."
                  : "The Dealer inspects the chamber through crimson glass."
            });
          }
        } else if (user === 'player') {
            updateState({ subMessage: chamber.isLive ? "You see a live round inside." : "You see an empty chamber." });
        } else {
            dealerKnownShellRef.current = chamber.isLive;
            updateState({ subMessage: "The Dealer inspects the chamber." });
        }
        break;
      case 'PLIERS':
        const newChambers = [...s2.chambers];
        newChambers[s2.currentChamberIndex] = { ...chamber, isSpent: true, isEjected: true };
        updateState({ chambers: newChambers });
        advanceChamber();
        updateState({ subMessage: `Shell ejected. It was a ${chamber.isLive ? 'live round' : 'blank'}.` });
        
        // Bleed a bit
        if (user === 'player') {
             updateState({ player: { ...s2.player, health: Math.max(1, s2.player.health - 5) } });
        } else {
             updateState({ dealer: { ...s2.dealer, health: Math.max(1, s2.dealer.health - 5) } });
        }
        break;
      case 'WHISKEY':
        if (user === 'player') {
             updateState({ player: { ...s2.player, health: Math.min(s2.player.maxHealth, s2.player.health + 20) } });
        } else {
             updateState({ dealer: { ...s2.dealer, health: Math.min(s2.dealer.maxHealth, s2.dealer.health + 20) } });
        }
        updateState({ subMessage: "Pain numbed. Vitality restored." });
        break;
      case 'TOURNIQUET':
         if (user === 'player') {
             updateState({ player: { ...s2.player, maxHealth: s2.player.maxHealth + 1 } });
         } else {
             updateState({ dealer: { ...s2.dealer, maxHealth: s2.dealer.maxHealth + 1 } });
         }
         updateState({ subMessage: "Braced for impact. Adrenaline surges." });
         break;
      case 'PENTAGRAM':
         updateState({ 
             player: { ...s2.player, health: s2.dealer.health },
             dealer: { ...s2.dealer, health: s2.player.health },
             subMessage: "Dark bargain struck. Life essence swapped."
         });
         break;
      case 'CIGARETTE':
         const reductionEnd = Date.now() + 20000;
         if (user === 'player') {
             updateState({ playerDamageReductionEnd: reductionEnd, subMessage: "You light a cigarette. Nerves steady as smoke fills your lungs." });
         } else {
             updateState({ dealerDamageReductionEnd: reductionEnd, subMessage: "The Dealer lights a cigarette and inhales a deep drag." });
         }
         waitTime = 3600;
         break;
      case 'SCALPEL':
         updateState({ doubleDamageActive: user, subMessage: "The barrel is sawn off. Double damage next shot." });
         waitTime = 3800;
         break;
      case 'DEFIBRILLATOR':
         if (user === 'player') {
             updateState({ player: { ...s2.player, health: Math.min(s2.player.maxHealth - 10, s2.player.health + 40), maxHealth: Math.max(10, s2.player.maxHealth - 10) } });
         } else {
             updateState({ dealer: { ...s2.dealer, health: Math.min(s2.dealer.maxHealth - 10, s2.dealer.health + 40), maxHealth: Math.max(10, s2.dealer.maxHealth - 10) } });
         }
         updateState({ subMessage: "A violent jolt. Vitality restored, but max health is permanently reduced." });
         break;
      case 'MEDKIT':
         if (user === 'player') {
             updateState({ player: { ...s2.player, health: s2.player.maxHealth } });
         } else {
             updateState({ dealer: { ...s2.dealer, health: s2.dealer.maxHealth } });
         }
         updateState({ subMessage: "Critical wounds patched. Fully restored." });
         waitTime = 5650;
         break;
      case 'SYRINGE':
         if (user === 'player') {
             updateState({ player: { ...s2.player, health: Math.min(s2.player.maxHealth, s2.player.health + 50) } });
         } else {
             updateState({ dealer: { ...s2.dealer, health: Math.min(s2.dealer.maxHealth, s2.dealer.health + 50) } });
         }
         updateState({ subMessage: "Instant surge. 50 HP restored." });
         break;
      case 'RAZORBLADE':
         let newHealth = user === 'player' ? s2.player.health - 10 : s2.dealer.health - 10;
         newHealth = Math.max(1, newHealth); // Prevent absolute death strictly during item use
         
         if (user === 'player') {
             // 180 bloodLevel to trigger both max opacity flash and the shake.
             updateState({ player: { ...s2.player, health: newHealth }, bloodLevel: 180, subMessage: "Slashing flesh with the razorblade..." });
             vibrateGamepad('jolt', { duration: 400 });
         } else {
             updateState({ dealer: { ...s2.dealer, health: newHealth }, subMessage: "Slashing flesh with the razorblade..." });
         }
         
         const bladeChambers = [...s2.chambers];
         const rChamber = bladeChambers[s2.currentChamberIndex];
         
         // Triple visceral sound playback for maximum effect
         setTimeout(() => { playBloodSplatter(); if (user === 'player') vibrateGamepad('burst'); }, 50);
         setTimeout(() => { playEmptyClick(); if (user === 'player') vibrateGamepad('click'); }, 150);
         setTimeout(() => { playBloodSplatter(); if (user === 'player') vibrateGamepad('strong'); }, 250);
         
         await wait(1000);
         
         if (rChamber.isLive) {
             if (user === 'dealer') dealerKnownShellRef.current = true;
             updateState({ doubleDamageActive: user, subMessage: "The chamber was already live. Double damage active." });
         } else {
             bladeChambers[s2.currentChamberIndex] = { ...rChamber, isLive: true };
             if (user === 'dealer') dealerKnownShellRef.current = true;
             updateState({ chambers: bladeChambers, subMessage: "Blood seals the blank. It's now a live round." });
         }
         setTimeout(() => updateState({ bloodLevel: 0 }), 1500);
         break;
    }
    
    await wait(waitTime);

    updateState({ 
        gameState: user === 'player' ? 'PLAYER_TURN' : 'DEALER_TURN',
        message: `${user === 'player' ? 'Your' : "The Dealer's"} turn continues.`,
        subMessage: ""
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
    liveCount,
    blankCount,
    startGame,
    fireGun,
    useItem,
    buyItem
  };
};
