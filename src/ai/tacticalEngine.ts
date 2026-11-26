import { Difficulty, GameBranch, ItemType, PlayerState } from '../types';

export interface TacticalInput {
  difficulty: Difficulty;
  branch?: GameBranch;
  dealer: PlayerState;
  player: PlayerState;
  liveCount: number;
  blankCount: number;
  knownCurrentShell: boolean | null;
  doubleDamageActive: 'player' | 'dealer' | null;
  retaliationActive: boolean;
  dealerDamageReductionActive: boolean;
  playerDamageReductionActive: boolean;
  itemsUsedThisTurn: number;
}

export type TacticalDecision =
  | { action: 'USE_ITEM'; itemIndex: number; reasoning: string }
  | { action: 'SHOOT'; target: 'player' | 'dealer'; reasoning: string };

const BASE_DAMAGE = 35;
const CIGARETTE_MITIGATION = 30;

function computeShotDamage(
  shooter: 'player' | 'dealer',
  target: 'player' | 'dealer',
  doubleDamageActive: boolean,
  targetCigActive: boolean
): number {
  let dmg = target === shooter ? BASE_DAMAGE * 2 : BASE_DAMAGE;
  if (doubleDamageActive) dmg *= 2;
  if (targetCigActive) dmg = Math.max(0, dmg - CIGARETTE_MITIGATION);
  return dmg;
}

function getEffectiveKnownShell(
  knownCurrentShell: boolean | null,
  liveCount: number,
  blankCount: number
): boolean | null {
  if (liveCount > 0 && blankCount === 0) return true;
  if (blankCount > 0 && liveCount === 0) return false;
  return knownCurrentShell;
}

function getPlayerThreatDamage(playerItems: ItemType[], dealerCigActive: boolean): number {
  const hasDouble =
    playerItems.includes('SCALPEL') || playerItems.includes('RAZORBLADE');
  return computeShotDamage('player', 'dealer', hasDouble, dealerCigActive);
}

// ============================================================================
// HIGH-INTELLIGENCE EXPECTIMINIMAX ENGINE (USED BY VERY_HARD & NIGHTMARE)
// ============================================================================

interface SimState {
  l: number;
  b: number;
  known: boolean | null;
  dHp: number;
  pHp: number;
  dMaxHp: number;
  d2x: boolean;
  dCig: boolean;
  pCig: boolean;
  turn: 'dealer' | 'player';
  items: ItemType[]; // Dealer remaining usable items (excluding already spent in branch)
  pItems: ItemType[]; // Player items snapshot (for terminal threat)
}

function removeOneItem(items: ItemType[], item: ItemType): ItemType[] {
  const idx = items.indexOf(item);
  if (idx === -1) return items;
  const copy = items.slice();
  copy.splice(idx, 1);
  return copy;
}

function scoreTerminal(s: SimState, ruthlessness: number): number {
  if (s.pHp <= 0) return 10000;
  if (s.dHp <= 0) return -10000;

  const hpDiff = (s.dHp - s.pHp) * 1.45;
  const maxHpFactor = s.dMaxHp * 0.15;

  // Penalize leaving dealer inside player's next-turn kill range
  const pThreat = getPlayerThreatDamage(s.pItems, s.dCig);
  const pGuaranteedLiveThreat =
    s.pItems.includes('MIRROR') || s.pItems.includes('RAZORBLADE') || s.b === 0;

  let dangerPenalty = 0;
  if (s.turn === 'player' && s.l > 0) {
    if (s.dHp <= pThreat) {
      dangerPenalty -= (pGuaranteedLiveThreat ? 190 : 120) * ruthlessness;
    } else if (s.dHp <= BASE_DAMAGE) {
      dangerPenalty -= 95 * ruthlessness;
    }
  }

  // Reward keeping player inside dealer's kill range
  const dKillRange = computeShotDamage('dealer', 'player', s.d2x, s.pCig);
  let finishBonus = 0;
  if (s.pHp <= dKillRange) {
    finishBonus += 45 * ruthlessness;
  }

  // Value remaining unspent utility items cleanly so we don't burn items needlessly
  let invScore = 0;
  for (const it of s.items) {
    switch (it) {
      case 'MEDKIT': invScore += 28; break;
      case 'SYRINGE': invScore += 22; break;
      case 'SCALPEL': invScore += 20; break;
      case 'MIRROR': invScore += 18; break;
      case 'RAZORBLADE': invScore += 16; break;
      case 'PENTAGRAM': invScore += 14; break;
      case 'CIGARETTE': invScore += 13; break;
      case 'DEFIBRILLATOR': invScore += 12; break;
      case 'WHISKEY': invScore += 10; break;
      case 'PLIERS': invScore += 8; break;
      case 'TOURNIQUET': invScore += 2; break;
    }
  }

  const cigBonus = s.dCig ? 18 : 0;
  const doubleBonus = s.d2x ? 24 : 0;
  const turnBonus = s.turn === 'dealer' ? 22 : -18;

  // If cylinder just emptied, round reloads +2 items each & player starts
  const reloadPenalty = s.l === 0 && s.b === 0 ? -15 : 0;

  return (
    hpDiff +
    maxHpFactor +
    dangerPenalty +
    finishBonus +
    invScore +
    cigBonus +
    doubleBonus +
    turnBonus +
    reloadPenalty
  );
}

function evaluateSim(
  s: SimState,
  depth: number,
  ruthlessness: number,
  memo: Map<string, number>
): number {
  if (s.pHp <= 0) return 10000 + depth * 50; // Faster lethal wins strictly score higher
  if (s.dHp <= 0) return -10000 - depth * 50;
  if (depth <= 0 || (s.l === 0 && s.b === 0)) {
    return scoreTerminal(s, ruthlessness);
  }

  if (s.turn === 'player') {
    // Approximate rational opponent response for expectiminimax horizon
    const total = s.l + s.b;
    const pLive = s.l / total;
    const dThreatBase = computeShotDamage('player', 'dealer', false, s.dCig);
    const dThreat2x = computeShotDamage('player', 'dealer', true, s.dCig);
    const pHasMirror = s.pItems.includes('MIRROR');
    const pHasDouble = s.pItems.includes('SCALPEL') || s.pItems.includes('RAZORBLADE');

    // Probability opponent knows/plays optimal shot against dealer
    let expectedDealerDmg = 0;
    if (s.known === true || s.b === 0) {
      expectedDealerDmg = pHasDouble ? dThreat2x : dThreatBase;
    } else if (s.known === false || s.l === 0) {
      // Player likely burns blank on self if smart, then threatens next round
      if (s.l > 0) {
        expectedDealerDmg = (pHasDouble ? dThreat2x : dThreatBase) * 0.72;
      }
    } else if (pHasMirror) {
      expectedDealerDmg = pLive * (pHasDouble ? dThreat2x : dThreatBase) + (1 - pLive) * (s.l > 0 ? dThreatBase * 0.45 : 0);
    } else {
      expectedDealerDmg = pLive * (pHasDouble && pLive >= 0.5 ? dThreat2x : dThreatBase);
    }

    const postPlayer: SimState = {
      ...s,
      dHp: Math.max(0, s.dHp - expectedDealerDmg * 0.85),
      turn: 'dealer',
    };
    return scoreTerminal(postPlayer, ruthlessness);
  }

  const key = `${s.l},${s.b},${s.known === null ? 'u' : s.known ? '1' : '0'},${s.dHp},${s.pHp},${s.dMaxHp},${s.d2x ? 1 : 0},${s.dCig ? 1 : 0},${s.pCig ? 1 : 0},${depth},${s.items.join('.')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const total = s.l + s.b;
  const effectiveKnown = getEffectiveKnownShell(s.known, s.l, s.b);
  const pLive = effectiveKnown === true ? 1 : effectiveKnown === false ? 0 : s.l / total;
  const pBlank = 1 - pLive;

  let bestScore = -Infinity;

  // Option 1: SHOOT('player')
  {
    let val = 0;
    if (pLive > 0) {
      const dmg = computeShotDamage('dealer', 'player', s.d2x, s.pCig);
      const nextLive: SimState = {
        ...s,
        l: s.l - 1,
        known: null,
        pHp: Math.max(0, s.pHp - dmg),
        d2x: false,
        turn: 'player',
      };
      val += pLive * evaluateSim(nextLive, depth - 1, ruthlessness, memo);
    }
    if (pBlank > 0) {
      const nextBlank: SimState = {
        ...s,
        b: s.b - 1,
        known: null,
        d2x: false,
        turn: 'player',
      };
      val += pBlank * evaluateSim(nextBlank, depth - 1, ruthlessness, memo);
    }
    if (val > bestScore) bestScore = val;
  }

  // Option 2: SHOOT('dealer') (self)
  {
    let val = 0;
    if (pLive > 0) {
      const dmg = computeShotDamage('dealer', 'dealer', s.d2x, s.dCig);
      const nextLive: SimState = {
        ...s,
        l: s.l - 1,
        known: null,
        dHp: Math.max(0, s.dHp - dmg),
        d2x: false,
        turn: 'player',
      };
      val += pLive * evaluateSim(nextLive, depth - 1, ruthlessness, memo);
    }
    if (pBlank > 0) {
      const nextBlank: SimState = {
        ...s,
        b: s.b - 1,
        known: null,
        d2x: false,
        turn: 'dealer', // FREE TURN RETENTION
      };
      val += pBlank * evaluateSim(nextBlank, depth - 1, ruthlessness, memo);
    }
    if (val > bestScore) bestScore = val;
  }

  // Option 3: Evaluate distinct usable items in inventory (deduplicated by type)
  if (depth >= 2) {
    const seen = new Set<ItemType>();
    for (const item of s.items) {
      if (seen.has(item)) continue;
      seen.add(item);

      const remItems = removeOneItem(s.items, item);

      switch (item) {
        case 'MIRROR': {
          if (effectiveKnown !== null || s.l === 0 || s.b === 0) break;
          const liveBranch: SimState = { ...s, known: true, items: remItems };
          const blankBranch: SimState = { ...s, known: false, items: remItems };
          const val =
            pLive * evaluateSim(liveBranch, depth - 1, ruthlessness, memo) +
            pBlank * evaluateSim(blankBranch, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'SCALPEL': {
          if (s.d2x || s.l === 0) break;
          const next: SimState = { ...s, d2x: true, items: remItems };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'RAZORBLADE': {
          if (s.dHp <= 1) break;
          if (effectiveKnown === true && s.d2x) break; // Already 2x on confirmed live
          const afterHp = Math.max(1, s.dHp - 10);
          if (effectiveKnown === true) {
            const next: SimState = { ...s, dHp: afterHp, d2x: true, items: remItems };
            const val = evaluateSim(next, depth - 1, ruthlessness, memo);
            if (val > bestScore) bestScore = val;
          } else if (effectiveKnown === false) {
            // Converts current blank into guaranteed live round!
            const next: SimState = {
              ...s,
              dHp: afterHp,
              l: s.l + 1,
              b: Math.max(0, s.b - 1),
              known: true,
              items: remItems,
            };
            const val = evaluateSim(next, depth - 1, ruthlessness, memo);
            if (val > bestScore) bestScore = val;
          } else {
            // Unknown shell: pLive gets 2x, pBlank flips to guaranteed live
            const valLive = evaluateSim(
              { ...s, dHp: afterHp, d2x: true, known: true, items: remItems },
              depth - 1,
              ruthlessness,
              memo
            );
            const valBlank = evaluateSim(
              {
                ...s,
                dHp: afterHp,
                l: s.l + 1,
                b: Math.max(0, s.b - 1),
                known: true,
                items: remItems,
              },
              depth - 1,
              ruthlessness,
              memo
            );
            const val = pLive * valLive + pBlank * valBlank;
            if (val > bestScore) bestScore = val;
          }
          break;
        }
        case 'PLIERS': {
          if (s.dHp <= 5 || total <= 1) break;
          const afterHp = Math.max(1, s.dHp - 5);
          let val = 0;
          if (pLive > 0) {
            val +=
              pLive *
              evaluateSim(
                { ...s, dHp: afterHp, l: s.l - 1, known: null, items: remItems },
                depth - 1,
                ruthlessness,
                memo
              );
          }
          if (pBlank > 0) {
            val +=
              pBlank *
              evaluateSim(
                { ...s, dHp: afterHp, b: s.b - 1, known: null, items: remItems },
                depth - 1,
                ruthlessness,
                memo
              );
          }
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'PENTAGRAM': {
          if (s.pHp <= s.dHp) break;
          const next: SimState = {
            ...s,
            dHp: s.pHp,
            pHp: s.dHp,
            items: remItems,
          };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'WHISKEY': {
          if (s.dHp >= s.dMaxHp) break;
          const next: SimState = {
            ...s,
            dHp: Math.min(s.dMaxHp, s.dHp + 20),
            items: remItems,
          };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'SYRINGE': {
          if (s.dHp > s.dMaxHp - 20) break;
          const next: SimState = {
            ...s,
            dHp: Math.min(s.dMaxHp, s.dHp + 50),
            items: remItems,
          };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'MEDKIT': {
          if (s.dHp > s.dMaxHp - 25) break;
          const next: SimState = {
            ...s,
            dHp: s.dMaxHp,
            items: remItems,
          };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'DEFIBRILLATOR': {
          if (s.dMaxHp < 30 || s.dHp > s.dMaxHp - 25) break;
          const nextMax = Math.max(10, s.dMaxHp - 10);
          const nextHp = Math.min(nextMax, s.dHp + 40);
          if (nextHp <= s.dHp + 10) break;
          const next: SimState = {
            ...s,
            dHp: nextHp,
            dMaxHp: nextMax,
            items: remItems,
          };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'CIGARETTE': {
          if (s.dCig) break;
          const next: SimState = { ...s, dCig: true, items: remItems };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
        case 'TOURNIQUET': {
          // Only spend if helpful near maxHP or clearing space for next round
          if (s.items.length < 7 && s.dHp < s.dMaxHp) break;
          const next: SimState = {
            ...s,
            dMaxHp: s.dMaxHp + 1,
            items: remItems,
          };
          const val = evaluateSim(next, depth - 1, ruthlessness, memo);
          if (val > bestScore) bestScore = val;
          break;
        }
      }
    }
  }

  memo.set(key, bestScore);
  return bestScore;
}

function decideHighTierDealerMove(input: TacticalInput): TacticalDecision {
  const isNightmare = input.difficulty === 'NIGHTMARE';
  const ruthlessness = isNightmare ? 1.35 : 1.05;
  const searchDepth = isNightmare ? 4 : 3;

  const {
    dealer,
    player,
    liveCount: l,
    blankCount: b,
    knownCurrentShell,
    doubleDamageActive,
    dealerDamageReductionActive,
    playerDamageReductionActive,
    itemsUsedThisTurn,
  } = input;

  const d2x = doubleDamageActive === 'dealer';
  const effectiveKnown = getEffectiveKnownShell(knownCurrentShell, l, b);
  const items = dealer.items;
  const total = l + b;
  const pLive = effectiveKnown === true ? 1 : effectiveKnown === false ? 0 : total > 0 ? l / total : 0.5;

  // --- STEP 1: INSTANT GUARANTEED LETHAL EXECUTION CHECKS ---
  const currentPlayerShotDmg = computeShotDamage('dealer', 'player', d2x, playerDamageReductionActive);
  const doubledPlayerShotDmg = computeShotDamage('dealer', 'player', true, playerDamageReductionActive);

  if (effectiveKnown === true) {
    if (player.health <= currentPlayerShotDmg) {
      return { action: 'SHOOT', target: 'player', reasoning: 'Guaranteed lethal round confirmed. Executing player.' };
    }
    if (!d2x && player.health <= doubledPlayerShotDmg) {
      const scalpelIdx = items.indexOf('SCALPEL');
      if (scalpelIdx !== -1) {
        return { action: 'USE_ITEM', itemIndex: scalpelIdx, reasoning: 'Confirmed live round within 2x lethal threshold. Deploying Scalpel.' };
      }
      const razorIdx = items.indexOf('RAZORBLADE');
      if (razorIdx !== -1 && (isNightmare ? dealer.health > 1 : dealer.health > 15)) {
        return { action: 'USE_ITEM', itemIndex: razorIdx, reasoning: 'Confirmed live round within 2x threshold. Slashing Razorblade for guaranteed kill.' };
      }
    }
  }

  // Confirmed BLANK -> can Razorblade create an instant guaranteed lethal kill?
  if (effectiveKnown === false && player.health <= currentPlayerShotDmg) {
    const razorIdx = items.indexOf('RAZORBLADE');
    if (razorIdx !== -1 && (isNightmare ? dealer.health > 1 : dealer.health > 15)) {
      return { action: 'USE_ITEM', itemIndex: razorIdx, reasoning: 'Confirmed blank converted to lethal live shell via Razorblade.' };
    }
  }

  // Pentagram lethal reversal check: if dealer HP <= lethal shot AND player HP is much higher
  if (player.health > dealer.health) {
    const pentaIdx = items.indexOf('PENTAGRAM');
    const canKillAfterSwap =
      effectiveKnown === true &&
      (dealer.health <= currentPlayerShotDmg ||
        (dealer.health <= doubledPlayerShotDmg && !d2x && items.includes('SCALPEL')));
    if (pentaIdx !== -1 && canKillAfterSwap) {
      return { action: 'USE_ITEM', itemIndex: pentaIdx, reasoning: 'Executing Pentagram swap into guaranteed same-turn kill.' };
    }
  }

  // --- STEP 2: FULL EXPECTIMINIMAX ACTION RANKING ---
  const rootSim: SimState = {
    l,
    b,
    known: effectiveKnown,
    dHp: dealer.health,
    pHp: player.health,
    dMaxHp: dealer.maxHealth,
    d2x,
    dCig: dealerDamageReductionActive,
    pCig: playerDamageReductionActive,
    turn: 'dealer',
    items: items.slice(),
    pItems: player.items.slice(),
  };

  const memo = new Map<string, number>();

  // Score SHOOT('player')
  let shootPlayerScore = 0;
  if (pLive > 0) {
    const dmg = computeShotDamage('dealer', 'player', d2x, playerDamageReductionActive);
    shootPlayerScore +=
      pLive *
      evaluateSim(
        {
          ...rootSim,
          l: l - 1,
          known: null,
          pHp: Math.max(0, player.health - dmg),
          d2x: false,
          turn: 'player',
        },
        searchDepth - 1,
        ruthlessness,
        memo
      );
  }
  if (1 - pLive > 0) {
    shootPlayerScore +=
      (1 - pLive) *
      evaluateSim(
        {
          ...rootSim,
          b: b - 1,
          known: null,
          d2x: false,
          turn: 'player',
        },
        searchDepth - 1,
        ruthlessness,
        memo
      );
  }

  // Score SHOOT('dealer')
  let shootSelfScore = 0;
  if (pLive > 0) {
    const dmg = computeShotDamage('dealer', 'dealer', d2x, dealerDamageReductionActive);
    shootSelfScore +=
      pLive *
      evaluateSim(
        {
          ...rootSim,
          l: l - 1,
          known: null,
          dHp: Math.max(0, dealer.health - dmg),
          d2x: false,
          turn: 'player',
        },
        searchDepth - 1,
        ruthlessness,
        memo
      );
  }
  if (1 - pLive > 0) {
    shootSelfScore +=
      (1 - pLive) *
      evaluateSim(
        {
          ...rootSim,
          b: b - 1,
          known: null,
          d2x: false,
          turn: 'dealer',
        },
        searchDepth - 1,
        ruthlessness,
        memo
      );
  }

  let bestAction: TacticalDecision =
    shootSelfScore > shootPlayerScore
      ? { action: 'SHOOT', target: 'dealer', reasoning: 'Self-shot maximizes expected turn-retention value.' }
      : { action: 'SHOOT', target: 'player', reasoning: 'Attacking player maximizes expected round equity.' };
  let bestScore = Math.max(shootPlayerScore, shootSelfScore);

  // Prevent infinite / tedious stalling in a single turn if score gain is negligible
  const itemHardCap = isNightmare ? 5 : 3;
  if (itemsUsedThisTurn < itemHardCap) {
    const tried = new Set<ItemType>();
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (tried.has(item)) continue;
      tried.add(item);

      const remItems = removeOneItem(items, item);
      let candidateScore = -Infinity;
      let reason = '';

      switch (item) {
        case 'MIRROR': {
          if (effectiveKnown !== null || l === 0 || b === 0) break;
          const vLive = evaluateSim(
            { ...rootSim, known: true, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          const vBlank = evaluateSim(
            { ...rootSim, known: false, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          candidateScore = pLive * vLive + (1 - pLive) * vBlank + 4;
          reason = 'Peeking chamber with Mirror eliminates uncertainty.';
          break;
        }
        case 'SCALPEL': {
          if (d2x || l === 0) break;
          // Do not waste Scalpel if current shell is known blank unless we also have Pliers or Razorblade
          if (effectiveKnown === false && !remItems.includes('PLIERS') && !remItems.includes('RAZORBLADE')) break;
          // On uncertain rounds without mirror, require >= 0.5 odds (or very high aggression if player low)
          if (effectiveKnown === null && pLive < (isNightmare ? 0.5 : 0.6)) break;
          candidateScore = evaluateSim(
            { ...rootSim, d2x: true, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Sawing barrel with Scalpel to double incoming lethal output.';
          break;
        }
        case 'RAZORBLADE': {
          if (dealer.health <= (isNightmare ? 1 : 18)) break;
          if (effectiveKnown === true && d2x) break;
          const afterHp = Math.max(1, dealer.health - 10);
          if (effectiveKnown === true) {
            candidateScore = evaluateSim(
              { ...rootSim, dHp: afterHp, d2x: true, items: remItems },
              searchDepth,
              ruthlessness,
              memo
            );
            reason = 'Applying Razorblade on live shell for 2x damage.';
          } else if (effectiveKnown === false) {
            candidateScore = evaluateSim(
              {
                ...rootSim,
                dHp: afterHp,
                l: l + 1,
                b: Math.max(0, b - 1),
                known: true,
                items: remItems,
              },
              searchDepth,
              ruthlessness,
              memo
            );
            reason = 'Slashing Razorblade to seal blank into a guaranteed live round.';
          } else if (dealer.health >= 45 && pLive >= 0.45) {
            const vLive = evaluateSim(
              { ...rootSim, dHp: afterHp, d2x: true, known: true, items: remItems },
              searchDepth - 1,
              ruthlessness,
              memo
            );
            const vBlank = evaluateSim(
              {
                ...rootSim,
                dHp: afterHp,
                l: l + 1,
                b: Math.max(0, b - 1),
                known: true,
                items: remItems,
              },
              searchDepth - 1,
              ruthlessness,
              memo
            );
            candidateScore = pLive * vLive + (1 - pLive) * vBlank;
            reason = 'Using Razorblade to force a guaranteed live shell.';
          }
          break;
        }
        case 'PLIERS': {
          if (dealer.health <= 10 || total <= 1) break;
          // Ejecting a known blank costs 5 HP vs shooting self for 0 HP — only do it if preserving 2x!
          if (effectiveKnown === false && !d2x) break;
          // Never eject a known live round unless somehow preserving survival
          if (effectiveKnown === true && l > 0) break;
          const afterHp = Math.max(1, dealer.health - 5);
          let v = 0;
          if (pLive > 0) {
            v +=
              pLive *
              evaluateSim(
                { ...rootSim, dHp: afterHp, l: l - 1, known: null, items: remItems },
                searchDepth,
                ruthlessness,
                memo
              );
          }
          if (1 - pLive > 0) {
            v +=
              (1 - pLive) *
              evaluateSim(
                { ...rootSim, dHp: afterHp, b: b - 1, known: null, items: remItems },
                searchDepth,
                ruthlessness,
                memo
              );
          }
          candidateScore = v;
          reason = 'Using Pliers to advance past an unfavorable chamber.';
          break;
        }
        case 'PENTAGRAM': {
          const minGain = isNightmare ? 15 : 25;
          if (player.health - dealer.health < minGain) break;
          candidateScore = evaluateSim(
            { ...rootSim, dHp: player.health, pHp: dealer.health, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Triggering Pentagram life swap to seize overwhelming HP advantage.';
          break;
        }
        case 'MEDKIT': {
          const missing = dealer.maxHealth - dealer.health;
          const threat = getPlayerThreatDamage(player.items, dealerDamageReductionActive);
          if (missing < 35 && dealer.health > threat) break;
          candidateScore = evaluateSim(
            { ...rootSim, dHp: dealer.maxHealth, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Using Medkit to restore full vitality above threat threshold.';
          break;
        }
        case 'SYRINGE': {
          const missing = dealer.maxHealth - dealer.health;
          const threat = getPlayerThreatDamage(player.items, dealerDamageReductionActive);
          if (missing < 30 && dealer.health > threat) break;
          candidateScore = evaluateSim(
            { ...rootSim, dHp: Math.min(dealer.maxHealth, dealer.health + 50), items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Injecting Syringe for +50 HP combat stabilization.';
          break;
        }
        case 'WHISKEY': {
          const missing = dealer.maxHealth - dealer.health;
          if (missing < 15) break;
          candidateScore = evaluateSim(
            { ...rootSim, dHp: Math.min(dealer.maxHealth, dealer.health + 20), items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Drinking Whiskey (+20 HP) to clear lethal breakpoint.';
          break;
        }
        case 'DEFIBRILLATOR': {
          if (dealer.maxHealth < 30) break;
          const nextMax = Math.max(10, dealer.maxHealth - 10);
          const nextHp = Math.min(nextMax, dealer.health + 40);
          const threat = getPlayerThreatDamage(player.items, dealerDamageReductionActive);
          if (nextHp - dealer.health < 20 && dealer.health > threat) break;
          candidateScore = evaluateSim(
            { ...rootSim, dHp: nextHp, dMaxHp: nextMax, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Shocking with Defibrillator to survive incoming lethal fire.';
          break;
        }
        case 'CIGARETTE': {
          if (dealerDamageReductionActive || l === 0) break;
          // Activate cigarette only right before likely handing turn to player or risking live shot
          if (effectiveKnown === false && total > 1) break;
          candidateScore = evaluateSim(
            { ...rootSim, dCig: true, items: remItems },
            searchDepth,
            ruthlessness,
            memo
          );
          reason = 'Lighting Cigarette (-30 incoming damage) before contested turn.';
          break;
        }
        case 'TOURNIQUET': {
          if (itemsUsedThisTurn > 0) break;
          if (dealer.health === dealer.maxHealth && items.includes('MEDKIT')) {
            candidateScore = evaluateSim(
              { ...rootSim, dMaxHp: dealer.maxHealth + 1, items: remItems },
              searchDepth,
              ruthlessness,
              memo
            );
            reason = 'Applying Tourniquet to expand max HP cap.';
          }
          break;
        }
      }

      // Require clear positive margin over shooting directly so we don't spin wheels on +0 ties
      if (candidateScore > bestScore + 1.5) {
        bestScore = candidateScore;
        bestAction = { action: 'USE_ITEM', itemIndex: idx, reasoning: reason };
      }
    }
  }

  return bestAction;
}

// ============================================================================
// HARD TIER: CARD-COUNTING + SMART 2-STEP COMBOS
// ============================================================================

function decideHardDealerMove(input: TacticalInput): TacticalDecision {
  const {
    dealer,
    player,
    liveCount: l,
    blankCount: b,
    knownCurrentShell,
    doubleDamageActive,
    retaliationActive,
    dealerDamageReductionActive,
    playerDamageReductionActive,
    itemsUsedThisTurn,
  } = input;

  const d2x = doubleDamageActive === 'dealer';
  const effectiveKnown = getEffectiveKnownShell(knownCurrentShell, l, b);
  const items = dealer.items;
  const total = l + b;
  const pLive = effectiveKnown === true ? 1 : effectiveKnown === false ? 0 : total > 0 ? l / total : 0.5;
  const dmgNormal = computeShotDamage('dealer', 'player', d2x, playerDamageReductionActive);
  const dmg2x = computeShotDamage('dealer', 'player', true, playerDamageReductionActive);

  // 1. Confirmed live finishes
  if (effectiveKnown === true) {
    if (player.health <= dmgNormal) {
      return { action: 'SHOOT', target: 'player', reasoning: 'Hard: Guaranteed hit lethal on player.' };
    }
    if (!d2x && player.health <= dmg2x) {
      const sIdx = items.indexOf('SCALPEL');
      if (sIdx !== -1) return { action: 'USE_ITEM', itemIndex: sIdx, reasoning: 'Hard: Scalpel for lethal hit.' };
      const rIdx = items.indexOf('RAZORBLADE');
      if (rIdx !== -1 && dealer.health > 20) {
        return { action: 'USE_ITEM', itemIndex: rIdx, reasoning: 'Hard: Razorblade for lethal double damage.' };
      }
    }
    // High-value sawed-off shot on confirmed live
    if (!d2x && items.includes('SCALPEL') && !playerDamageReductionActive && player.health > 40) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SCALPEL'), reasoning: 'Hard: Sawing barrel for confirmed 70 HP shot.' };
    }
    return { action: 'SHOOT', target: 'player', reasoning: 'Hard: Discharging confirmed live shell at player.' };
  }

  // 2. Confirmed blank
  if (effectiveKnown === false) {
    // Opportunistic Razorblade finish
    const rIdx = items.indexOf('RAZORBLADE');
    if (rIdx !== -1 && dealer.health > 25 && player.health <= dmgNormal) {
      return { action: 'USE_ITEM', itemIndex: rIdx, reasoning: 'Hard: Converting confirmed blank into lethal shot.' };
    }
    if (d2x && l > 0 && dealer.health > 15 && items.includes('PLIERS')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('PLIERS'), reasoning: 'Hard: Ejecting blank to preserve 2x barrel.' };
    }
    return { action: 'SHOOT', target: 'dealer', reasoning: 'Hard: Confirmed blank self-shot for free turn.' };
  }

  // 3. Unknown mixed chamber tactical item phase (up to 2 items/turn)
  if (itemsUsedThisTurn < 2) {
    // Mirror on mixed odds
    const mirrorIdx = items.indexOf('MIRROR');
    if (mirrorIdx !== -1 && l > 0 && b > 0) {
      return { action: 'USE_ITEM', itemIndex: mirrorIdx, reasoning: 'Hard: Inspecting mixed cylinder with Mirror.' };
    }

    // Pentagram when meaningfully behind
    const pentaIdx = items.indexOf('PENTAGRAM');
    if (pentaIdx !== -1 && dealer.health <= 55 && player.health - dealer.health >= 30) {
      return { action: 'USE_ITEM', itemIndex: pentaIdx, reasoning: 'Hard: Reversing health deficit with Pentagram.' };
    }

    // Smart healing hierarchy
    const missing = dealer.maxHealth - dealer.health;
    if (dealer.health <= 45 && items.includes('MEDKIT') && missing >= 45) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('MEDKIT'), reasoning: 'Hard: Medkit recovery at critical HP.' };
    }
    if (missing >= 40 && items.includes('SYRINGE')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SYRINGE'), reasoning: 'Hard: Syringe recovery.' };
    }
    if (dealer.health <= 38 && items.includes('DEFIBRILLATOR') && dealer.maxHealth >= 30) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('DEFIBRILLATOR'), reasoning: 'Hard: Emergency Defibrillator shock.' };
    }
    if (missing >= 20 && dealer.health <= 75 && items.includes('WHISKEY')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('WHISKEY'), reasoning: 'Hard: Whiskey heal.' };
    }

    // Cigarette defense when threatened
    if (!dealerDamageReductionActive && dealer.health <= 70 && l > 0 && items.includes('CIGARETTE')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('CIGARETTE'), reasoning: 'Hard: Cigarette damage reduction.' };
    }

    // Scalpel when odds strongly favor live
    if (!d2x && pLive >= 0.66 && items.includes('SCALPEL') && !playerDamageReductionActive) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SCALPEL'), reasoning: 'Hard: High-odds Scalpel.' };
    }
  }

  // 4. Target choice on unknown round
  let threshold = 0.48;
  if (retaliationActive) threshold -= 0.12;
  if (dealer.health <= 70 && !dealerDamageReductionActive) threshold -= 0.14;
  if (d2x) return { action: 'SHOOT', target: 'player', reasoning: 'Hard: Never waste active 2x buff on self.' };

  return pLive >= threshold
    ? { action: 'SHOOT', target: 'player', reasoning: 'Hard: Odds favor firing at player.' }
    : { action: 'SHOOT', target: 'dealer', reasoning: 'Hard: Low live odds favor self-shot turn retention.' };
}

// ============================================================================
// NORMAL TIER: PRAGMATIC STREET GAMBLER WITH HUMAN FALLIBILITY
// ============================================================================

function decideNormalDealerMove(input: TacticalInput): TacticalDecision {
  const {
    dealer,
    player,
    liveCount: l,
    blankCount: b,
    knownCurrentShell,
    doubleDamageActive,
    retaliationActive,
    dealerDamageReductionActive,
    playerDamageReductionActive,
    itemsUsedThisTurn,
  } = input;

  const d2x = doubleDamageActive === 'dealer';
  const items = dealer.items;
  const total = l + b;

  // On Normal, Dealer isn't a flawless card counter: ~15% chance to doubt himself on the final shell unless Mirror-checked
  const countedKnown = getEffectiveKnownShell(knownCurrentShell, l, b);
  const effectiveKnown =
    knownCurrentShell !== null
      ? knownCurrentShell
      : countedKnown !== null && total === 1 && Math.random() < 0.15
        ? null
        : countedKnown;

  const pLive = effectiveKnown === true ? 1 : effectiveKnown === false ? 0 : total > 0 ? l / total : 0.5;

  // Respect explicit knowledge cleanly, without 1-turn Mirror+Scalpel 70 HP burst combos
  if (effectiveKnown === true) {
    if (
      !d2x &&
      itemsUsedThisTurn === 0 &&
      items.includes('SCALPEL') &&
      player.health <= 70 &&
      !playerDamageReductionActive &&
      Math.random() < 0.65
    ) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SCALPEL'), reasoning: 'Normal: Sawing barrel for confirmed finisher.' };
    }
    return { action: 'SHOOT', target: 'player', reasoning: 'Normal: Shooting confirmed live round at player.' };
  }

  if (effectiveKnown === false) {
    // Occasional human hesitation or cocky bluff instead of robotic 100% turn-chaining
    if (knownCurrentShell === null && Math.random() < 0.15) {
      return { action: 'SHOOT', target: 'player', reasoning: 'Normal: Second-guessing blank and firing at player.' };
    }
    return { action: 'SHOOT', target: 'dealer', reasoning: 'Normal: Firing blank at self to retain turn.' };
  }

  // Pragmatic capped item use (strictly max 1 per turn on Normal, with ~22% chance to just gamble directly)
  if (itemsUsedThisTurn < 1 && Math.random() < 0.78) {
    if (dealer.health <= dealer.maxHealth - 55 && items.includes('MEDKIT') && Math.random() < 0.8) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('MEDKIT'), reasoning: 'Normal: Healing with Medkit.' };
    }
    if (dealer.health <= dealer.maxHealth - 55 && items.includes('SYRINGE') && Math.random() < 0.8) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SYRINGE'), reasoning: 'Normal: Healing with Syringe.' };
    }
    if (dealer.health <= dealer.maxHealth - 30 && items.includes('WHISKEY') && Math.random() < 0.75) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('WHISKEY'), reasoning: 'Normal: Taking Whiskey sip.' };
    }
    if (dealer.health <= 25 && player.health >= 80 && items.includes('PENTAGRAM') && Math.random() < 0.65) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('PENTAGRAM'), reasoning: 'Normal: Desperate Pentagram swap.' };
    }
    if (dealer.health <= 25 && dealer.maxHealth >= 30 && items.includes('DEFIBRILLATOR') && Math.random() < 0.7) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('DEFIBRILLATOR'), reasoning: 'Normal: Emergency Defibrillator.' };
    }
    if (!dealerDamageReductionActive && dealer.health < 45 && items.includes('CIGARETTE') && Math.random() < 0.7) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('CIGARETTE'), reasoning: 'Normal: Lighting Cigarette.' };
    }
    if (l > 0 && b > 0 && items.includes('MIRROR') && Math.random() < 0.55) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('MIRROR'), reasoning: 'Normal: Checking chamber with Mirror.' };
    }
    if (!d2x && pLive >= 0.75 && items.includes('SCALPEL') && Math.random() < 0.7) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SCALPEL'), reasoning: 'Normal: Confident Scalpel.' };
    }
    if (dealer.health >= 65 && pLive >= 0.6 && items.includes('RAZORBLADE') && Math.random() < 0.28) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('RAZORBLADE'), reasoning: 'Normal: Aggressive Razorblade.' };
    }
    if (pLive < 0.35 && b > 0 && dealer.health > 35 && items.includes('PLIERS') && Math.random() < 0.35) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('PLIERS'), reasoning: 'Normal: Ejecting blank with Pliers.' };
    }
  }

  // Human variance on mixed decisions
  if (d2x) {
    return { action: 'SHOOT', target: 'player', reasoning: 'Normal: Firing sawed-off barrel at player.' };
  }

  let shootPlayerBias = pLive;
  if (retaliationActive) shootPlayerBias += 0.10;
  if (dealer.health <= 50) shootPlayerBias += 0.14;
  shootPlayerBias += (Math.random() - 0.5) * 0.28;

  return Math.random() < Math.max(0.08, Math.min(0.92, shootPlayerBias))
    ? { action: 'SHOOT', target: 'player', reasoning: 'Normal: Pressing fire against player.' }
    : { action: 'SHOOT', target: 'dealer', reasoning: 'Normal: Risking self-shot.' };
}

// ============================================================================
// CLASSIC BRANCH: SELF-TARGETED ROULETTE WITH ITEMS (SUPERNATURAL MIRROR, NO SCALPEL/2X)
// ============================================================================

function decideClassicDealerMove(input: TacticalInput): TacticalDecision {
  const {
    difficulty,
    dealer,
    player,
    liveCount: l,
    blankCount: b,
    knownCurrentShell,
    dealerDamageReductionActive,
    itemsUsedThisTurn,
  } = input;

  const items = dealer.items;
  const total = l + b;
  const effectiveKnown = getEffectiveKnownShell(knownCurrentShell, l, b);
  const pLive = effectiveKnown === true ? 1 : effectiveKnown === false ? 0 : total > 0 ? l / total : 0.5;
  const isNormal = difficulty === 'NORMAL';
  const isHard = difficulty === 'HARD';
  const itemCap = isNormal ? 1 : isHard ? 2 : 3;

  // Classic self-shot damage against Dealer is 35 HP (or 5 HP with Cigarette mitigation).
  // Dealer NEVER uses SCALPEL (unavailable in Classic) or RAZORBLADE (harmful on self-shots).
  const canUseItem = itemsUsedThisTurn < itemCap && (!isNormal || Math.random() < 0.78);

  if (canUseItem) {
    const missing = dealer.maxHealth - dealer.health;

    // 1. Critical survival / healing
    if (dealer.health <= 35 && items.includes('MEDKIT') && missing >= 25) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('MEDKIT'), reasoning: 'Classic: Medkit recovery at critical HP.' };
    }
    if (missing >= 50 && items.includes('MEDKIT')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('MEDKIT'), reasoning: 'Classic: Medkit restoring heavy missing HP.' };
    }
    if ((missing >= 40 || (dealer.health <= 35 && missing >= 20)) && items.includes('SYRINGE')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('SYRINGE'), reasoning: 'Classic: Syringe healing.' };
    }
    if (dealer.health <= 35 && dealer.maxHealth >= 30 && items.includes('DEFIBRILLATOR')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('DEFIBRILLATOR'), reasoning: 'Classic: Emergency Defibrillator recovery.' };
    }
    if (player.health - dealer.health >= (isNormal ? 35 : 22) && items.includes('PENTAGRAM')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('PENTAGRAM'), reasoning: 'Classic: Pentagram swap to seize HP lead.' };
    }
    if (missing >= 18 && dealer.health <= dealer.maxHealth - 18 && items.includes('WHISKEY')) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('WHISKEY'), reasoning: 'Classic: Whiskey recovery.' };
    }

    // 2. Supernatural Mirror: reveals current chamber AND curses an upcoming blank into LIVE!
    if (
      items.includes('MIRROR') &&
      effectiveKnown === null &&
      l > 0 &&
      b > 0 &&
      (!isNormal || Math.random() < 0.45)
    ) {
      return {
        action: 'USE_ITEM',
        itemIndex: items.indexOf('MIRROR'),
        reasoning: 'Classic: Inspecting chamber and cursing an upcoming blank via supernatural Mirror.',
      };
    }

    // 3. Pliers to safely discharge confirmed or high-probability live shells before pulling the trigger
    const pliersThreshold = isNormal ? 0.62 : isHard ? 0.52 : 0.45;
    if (
      items.includes('PLIERS') &&
      total > 1 &&
      dealer.health > 10 &&
      effectiveKnown !== false &&
      (effectiveKnown === true || pLive >= pliersThreshold || (dealer.health <= 35 && pLive > 0))
    ) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('PLIERS'), reasoning: 'Classic: Ejecting dangerous round with Pliers.' };
    }

    // 4. Cigarette to cushion incoming live self-shot damage (-30 HP)
    if (
      !dealerDamageReductionActive &&
      l > 0 &&
      effectiveKnown !== false &&
      items.includes('CIGARETTE') &&
      (effectiveKnown === true || dealer.health <= 45 || pLive >= (isNormal ? 0.55 : 0.42))
    ) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('CIGARETTE'), reasoning: 'Classic: Lighting Cigarette to mitigate live pull.' };
    }

    // 5. Tourniquet buffer when inventory is full or before Medkit
    if (items.includes('TOURNIQUET') && (items.length >= 7 || (dealer.health === dealer.maxHealth && items.includes('MEDKIT')))) {
      return { action: 'USE_ITEM', itemIndex: items.indexOf('TOURNIQUET'), reasoning: 'Classic: Applying Tourniquet.' };
    }
  }

  return {
    action: 'SHOOT',
    target: 'dealer',
    reasoning: 'Classic Russian Roulette: Dealer pulls the trigger against himself.',
  };
}

// ============================================================================
// PUBLIC DISPATCHER
// ============================================================================

export function decideDealerMove(input: TacticalInput): TacticalDecision {
  if (input.branch === 'CLASSIC') {
    return decideClassicDealerMove(input);
  }

  switch (input.difficulty) {
    case 'NIGHTMARE':
    case 'VERY_HARD':
      return decideHighTierDealerMove(input);
    case 'HARD':
      return decideHardDealerMove(input);
    case 'NORMAL':
    default:
      return decideNormalDealerMove(input);
  }
}
