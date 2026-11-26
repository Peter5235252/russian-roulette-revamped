import type { Chamber, Difficulty, GameBranch, ItemType, PlayerState } from '../types';
import type { TacticalInput, TacticalDecision } from '../ai/tacticalEngine';

/** Keep this in lockstep with `crates/game-wasm/src/lib.rs`. */
export const GAME_CORE_API_VERSION = 1;

export type Participant = 'player' | 'dealer';

export interface RoundResult {
  chambers: Chamber[];
  liveCount: number;
  nextSeed: number;
}

export interface ShotRequest {
  branch: GameBranch;
  difficulty: Difficulty;
  chambers: Chamber[];
  currentChamberIndex: number;
  player: PlayerState;
  dealer: PlayerState;
  shooter: Participant;
  target: Participant;
  doubleDamageActive: Participant | null;
  playerDamageReductionActive: boolean;
  dealerDamageReductionActive: boolean;
  bloodCurrency: number;
}

export interface ShotResult {
  chambers: Chamber[];
  player: PlayerState;
  dealer: PlayerState;
  chamberWasLive: boolean;
  effectiveTarget: Participant;
  damage: number;
  doubleDamageActive: Participant | null;
  bloodCurrency: number;
  retaliationActive: boolean;
  retainsTurn: boolean;
}

export interface ItemRequest {
  branch: GameBranch;
  chambers: Chamber[];
  currentChamberIndex: number;
  player: PlayerState;
  dealer: PlayerState;
  user: Participant;
  itemIndex: number;
  doubleDamageActive: Participant | null;
  playerDamageReductionEnd: number | null;
  dealerDamageReductionEnd: number | null;
  nowMs: number;
}

export interface ItemResult {
  chambers: Chamber[];
  currentChamberIndex: number;
  player: PlayerState;
  dealer: PlayerState;
  doubleDamageActive: Participant | null;
  playerDamageReductionEnd: number | null;
  dealerDamageReductionEnd: number | null;
  dealerKnownShell: boolean | null;
  item: ItemType;
}

interface WasmModule {
  default: () => Promise<void>;
  api_version: () => number;
  create_round: (input: unknown) => RoundResult;
  resolve_shot: (input: ShotRequest) => ShotResult;
  resolve_item: (input: ItemRequest) => ItemResult;
  decide_classic_dealer: (input: TacticalInput & { itemRoll: number; mirrorRoll: number }) => ClassicDealerDecision;
}

type ClassicDealerDecision =
  | Omit<Extract<TacticalDecision, { action: 'USE_ITEM' }>, 'reasoning'>
  | Omit<Extract<TacticalDecision, { action: 'SHOOT' }>, 'reasoning'>;

let gameCorePromise: Promise<WasmModule> | undefined;

function assetUrl(fileName: string): string {
  return new URL(`${import.meta.env.BASE_URL}wasm/${fileName}`, document.baseURI).href;
}

/**
 * Loads the Rust-generated module from Vite's public output. There is no
 * JavaScript rules fallback: a failed or mismatched game core leaves the game
 * unavailable instead of silently running divergent logic.
 */
export function loadGameCore(): Promise<WasmModule> {
  if (!gameCorePromise) {
    gameCorePromise = import(/* @vite-ignore */ assetUrl('russian_roulette_wasm.js'))
      .then(async (module: WasmModule) => {
        await module.default();
        if (module.api_version() !== GAME_CORE_API_VERSION) {
          throw new Error(
            `Unsupported game-core API: expected ${GAME_CORE_API_VERSION}, received ${module.api_version()}.`,
          );
        }
        return module;
      });
  }
  return gameCorePromise;
}

export async function createCoreRound(
  difficulty: Difficulty,
  branch: GameBranch,
  seed: number,
): Promise<RoundResult> {
  return (await loadGameCore()).create_round({ difficulty, branch, seed: seed >>> 0 });
}

export async function resolveCoreShot(request: ShotRequest): Promise<ShotResult> {
  return (await loadGameCore()).resolve_shot(request);
}

export async function resolveCoreItem(request: ItemRequest): Promise<ItemResult> {
  return (await loadGameCore()).resolve_item(request);
}

export async function decideCoreClassicDealer(input: TacticalInput): Promise<ClassicDealerDecision> {
  return (await loadGameCore()).decide_classic_dealer({
    ...input,
    itemRoll: Math.random(),
    mirrorRoll: Math.random(),
  });
}
