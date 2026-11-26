import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import init, { api_version, create_round, decide_classic_dealer, resolve_item, resolve_shot } from '../dist/wasm/russian_roulette_wasm.js';

const bytes = await readFile(new URL('../dist/wasm/russian_roulette_wasm_bg.wasm', import.meta.url));
await init({ module_or_path: bytes });

const participant = (health = 100, maxHealth = 100, items = []) => ({ health, maxHealth, items });
const cylinder = (firstLive) => Array.from({ length: 6 }, (_, i) => ({ isLive: i === 0 && firstLive, isSpent: false }));

test('compiled module preserves both branches’ cylinder ranges and reproduces seeds', () => {
  assert.equal(api_version(), 1);
  const ranges = { CLASSIC: [[1, 2], [1, 3], [2, 4], [2, 5]], REVAMPED: [[1, 3], [1, 4], [2, 4], [2, 5]] };
  for (const [branch, bounds] of Object.entries(ranges)) {
    ['NORMAL', 'HARD', 'VERY_HARD', 'NIGHTMARE'].forEach((difficulty, i) => {
      for (let seed = 0; seed < 100; seed++) {
        const input = { branch, difficulty, seed };
        const round = create_round(input);
        assert.deepEqual(round, create_round(input));
        assert.equal(round.chambers.length, 6);
        assert.equal(round.chambers.filter(c => c.isLive).length, round.liveCount);
        assert.ok(round.liveCount >= bounds[i][0] && round.liveCount <= bounds[i][1]);
      }
    });
  }
});

// Reference formulas come from the pre-migration React hook at 8ad8622.
test('compiled shot outcomes match reference formulas for both participants and modes', () => {
  const classicDamage = { NORMAL: 25, HARD: 20, VERY_HARD: 15, NIGHTMARE: 12 };
  for (const [difficulty, selfDamage] of Object.entries(classicDamage))
    for (const branch of ['CLASSIC', 'REVAMPED'])
      for (const shooter of ['player', 'dealer'])
        for (const target of ['player', 'dealer'])
          for (const live of [false, true])
            for (const doubled of [null, 'player', 'dealer'])
              for (const shielded of [false, true]) {
                const classic = branch === 'CLASSIC';
                const effective = classic ? shooter : target;
                const retaliation = !classic && !live && shooter === 'player' && effective === 'dealer';
                const base = classic ? effective === 'player' ? selfDamage : 35 : effective === shooter ? 70 : 35;
                const damage = live ? Math.max(0, base * (doubled === shooter ? 2 : 1) - (shielded ? 30 : 0)) : 0;
                const playerHp = effective === 'player' ? Math.max(0, 50 - damage) : 50;
                const dealerHp = effective === 'dealer' ? Math.max(0, 90 - damage) : 90;
                const gain = live
                  ? effective === 'player' ? (classic && playerHp > 0 ? 10 : 0) : shooter === 'player' ? (doubled === shooter ? 40 : 25) : classic ? 25 : 0
                  : shooter === 'dealer' || retaliation ? 0 : classic ? 10 : 5;
                const result = resolve_shot({
                  branch, difficulty, chambers: cylinder(live), currentChamberIndex: 0,
                  player: participant(50), dealer: participant(90), shooter, target,
                  doubleDamageActive: doubled, playerDamageReductionActive: shielded,
                  dealerDamageReductionActive: shielded, bloodCurrency: 8,
                });
                assert.equal(result.player.health, playerHp);
                assert.equal(result.dealer.health, dealerHp);
                assert.equal(result.damage, damage);
                assert.equal(result.effectiveTarget, effective);
                assert.equal(result.bloodCurrency, 8 + gain);
                assert.equal(result.retaliationActive, retaliation);
                assert.equal(result.retainsTurn, !classic && !live && effective === shooter);
                assert.equal(result.doubleDamageActive, null);
                assert.deepEqual(result.chambers[0], { isLive: live, isSpent: true, isEjected: false });
              }
});

test('compiled item effects preserve inventory, timestamps, changes to health and cylinder flags', () => {
  const nowMs = 1_796_000_000_000;
  function use(item, overrides = {}) {
    return resolve_item({
      branch: 'REVAMPED', chambers: cylinder(false), currentChamberIndex: 0,
      player: participant(25, 100, [item]), dealer: participant(75), user: 'player', itemIndex: 0,
      nowMs, playerDamageReductionEnd: null, dealerDamageReductionEnd: null, doubleDamageActive: null,
      ...overrides,
    });
  }
  const cases = [
    ['WHISKEY', 45, 100], ['TOURNIQUET', 25, 101], ['PENTAGRAM', 75, 100],
    ['DEFIBRILLATOR', 65, 90], ['SYRINGE', 75, 100], ['MEDKIT', 100, 100],
    ['PLIERS', 20, 100], ['RAZORBLADE', 15, 100], ['MIRROR', 25, 100],
    ['SCALPEL', 25, 100], ['CIGARETTE', 25, 100],
  ];
  for (const [item, health, maxHealth] of cases) {
    const result = use(item);
    assert.deepEqual(result.player, participant(health, maxHealth));
    assert.equal(result.dealerKnownShell, null);
  }
  assert.equal(use('CIGARETTE').playerDamageReductionEnd, nowMs + 20_000);
  assert.equal(use('CIGARETTE').dealerDamageReductionEnd, null);
  assert.equal(use('SCALPEL').doubleDamageActive, 'player');
  assert.equal(use('PLIERS').currentChamberIndex, 1);
  assert.equal(use('PLIERS').chambers[0].isEjected, true);
  assert.equal(use('RAZORBLADE').chambers[0].isLive, true);
  assert.equal(use('RAZORBLADE', { chambers: cylinder(true) }).doubleDamageActive, 'player');
  assert.equal(use('MIRROR', { branch: 'CLASSIC' }).chambers[1].isLive, true);
  assert.equal(use('MIRROR', { user: 'dealer', dealer: participant(75, 100, ['MIRROR']) }).dealerKnownShell, false);
  assert.throws(() => use('SCALPEL', { branch: 'CLASSIC' }), /scalpel/);
});

test('Classic dealer policy preserves source item priorities, gates and caps', () => {
  const state = {
    difficulty: 'NORMAL', player: participant(30), dealer: participant(32, 100, ['MIRROR', 'MEDKIT']),
    liveCount: 2, blankCount: 2, knownCurrentShell: null, dealerDamageReductionActive: false,
    itemsUsedThisTurn: 0, itemRoll: .77, mirrorRoll: .44,
  };
  const choose = (input = {}) => decide_classic_dealer({ ...state, ...input });
  const use = (itemIndex) => ({ action: 'USE_ITEM', itemIndex });
  const shoot = { action: 'SHOOT', target: 'dealer' };
  assert.deepEqual(choose(), use(1));
  assert.deepEqual(choose({ itemsUsedThisTurn: 1 }), shoot);
  assert.deepEqual(choose({ itemRoll: .78 }), shoot);
  const dealer = participant(80, 100, ['MIRROR', 'PLIERS']);
  assert.deepEqual(choose({ dealer }), use(0));
  assert.deepEqual(choose({ dealer, mirrorRoll: .45 }), shoot);
  assert.deepEqual(choose({ dealer, knownCurrentShell: true }), use(1));
  assert.deepEqual(choose({ dealer, liveCount: 0, knownCurrentShell: true }), shoot);
  assert.deepEqual(choose({ dealer, difficulty: 'HARD', itemsUsedThisTurn: 1, itemRoll: .99, mirrorRoll: .99 }), use(0));
});
