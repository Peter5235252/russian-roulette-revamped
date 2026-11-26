//! Deterministic, browser-independent game rules.
//!
//! Animation, rendering, audio, input and persistence stay in the browser layer.
//! This crate owns rule outcomes so the same requests can be tested natively and
//! evaluated by the WebAssembly build.

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod classic_dealer;
pub use classic_dealer::{decide_classic_dealer_move, ClassicDealerInput, DealerDecision};

pub const CYLINDER_SIZE: usize = 6;
pub const API_VERSION: u32 = 1;
const BASE_DAMAGE: i32 = 35;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GameError {
    #[error("the cylinder must contain exactly {CYLINDER_SIZE} chambers")]
    InvalidCylinderSize,
    #[error("the current chamber index is outside the cylinder")]
    InvalidChamberIndex,
    #[error("no shell is available in the current chamber")]
    CurrentChamberSpent,
    #[error("the requested inventory item does not exist")]
    MissingItem,
    #[error("the scalpel is not available in classic mode")]
    ClassicScalpel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Difficulty {
    Normal,
    Hard,
    VeryHard,
    Nightmare,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameBranch {
    Classic,
    Revamped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Participant {
    Player,
    Dealer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ItemType {
    Mirror,
    Pliers,
    Whiskey,
    Tourniquet,
    Pentagram,
    Cigarette,
    Scalpel,
    Defibrillator,
    Syringe,
    Razorblade,
    Medkit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chamber {
    pub is_live: bool,
    pub is_spent: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_ejected: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub health: i32,
    pub max_health: i32,
    pub items: Vec<ItemType>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundRequest {
    pub difficulty: Difficulty,
    pub branch: GameBranch,
    /// A caller-owned state for the deterministic PRNG. The response contains
    /// the next state so a scenario can be reproduced exactly.
    pub seed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundResult {
    pub chambers: Vec<Chamber>,
    pub live_count: usize,
    pub next_seed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotRequest {
    pub branch: GameBranch,
    pub difficulty: Difficulty,
    pub chambers: Vec<Chamber>,
    pub current_chamber_index: usize,
    pub player: PlayerState,
    pub dealer: PlayerState,
    pub shooter: Participant,
    pub target: Participant,
    pub double_damage_active: Option<Participant>,
    pub player_damage_reduction_active: bool,
    pub dealer_damage_reduction_active: bool,
    pub blood_currency: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotResult {
    pub chambers: Vec<Chamber>,
    pub player: PlayerState,
    pub dealer: PlayerState,
    pub chamber_was_live: bool,
    pub effective_target: Participant,
    pub damage: i32,
    pub double_damage_active: Option<Participant>,
    pub blood_currency: i32,
    pub retaliation_active: bool,
    pub retains_turn: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRequest {
    pub branch: GameBranch,
    pub chambers: Vec<Chamber>,
    pub current_chamber_index: usize,
    pub player: PlayerState,
    pub dealer: PlayerState,
    pub user: Participant,
    pub item_index: usize,
    pub double_damage_active: Option<Participant>,
    pub player_damage_reduction_end: Option<u64>,
    pub dealer_damage_reduction_end: Option<u64>,
    /// Browser time is intentionally injected rather than read from a global,
    /// making timing rules reproducible in native tests.
    pub now_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemResult {
    pub chambers: Vec<Chamber>,
    pub current_chamber_index: usize,
    pub player: PlayerState,
    pub dealer: PlayerState,
    pub double_damage_active: Option<Participant>,
    pub player_damage_reduction_end: Option<u64>,
    pub dealer_damage_reduction_end: Option<u64>,
    /// `None` means the item did not disclose a shell to the dealer.
    pub dealer_known_shell: Option<bool>,
    pub item: ItemType,
}

/// Creates a six-round cylinder using the same difficulty ranges as the
/// browser game, but with explicit deterministic randomness.
pub fn create_round(request: RoundRequest) -> Result<RoundResult, GameError> {
    let mut rng = XorShift32::new(request.seed);
    let live_count = match (request.branch, request.difficulty) {
        (GameBranch::Classic, Difficulty::Normal) => rng.range_inclusive(1, 2),
        (GameBranch::Classic, Difficulty::Hard) => rng.range_inclusive(1, 3),
        (GameBranch::Classic, Difficulty::VeryHard) => rng.range_inclusive(2, 4),
        (GameBranch::Classic, Difficulty::Nightmare) => rng.range_inclusive(2, 5),
        (GameBranch::Revamped, Difficulty::Normal) => rng.range_inclusive(1, 3),
        (GameBranch::Revamped, Difficulty::Hard) => rng.range_inclusive(1, 4),
        (GameBranch::Revamped, Difficulty::VeryHard) => rng.range_inclusive(2, 4),
        (GameBranch::Revamped, Difficulty::Nightmare) => rng.range_inclusive(2, 5),
    };

    let mut chambers = vec![blank_chamber(); CYLINDER_SIZE];
    let mut placed = 0;
    while placed < live_count {
        let index = rng.range(0, CYLINDER_SIZE);
        if !chambers[index].is_live {
            chambers[index].is_live = true;
            placed += 1;
        }
    }

    Ok(RoundResult {
        chambers,
        live_count,
        next_seed: rng.state,
    })
}

/// Resolves the game-rule outcome of pulling the trigger. It does not advance
/// the cylinder; the presentation layer owns animation timing and advances only
/// after the trigger sequence has completed.
pub fn resolve_shot(mut request: ShotRequest) -> Result<ShotResult, GameError> {
    validate_cylinder(&request.chambers, request.current_chamber_index)?;
    let chamber = request.chambers[request.current_chamber_index].clone();
    if chamber.is_spent {
        return Err(GameError::CurrentChamberSpent);
    }

    request.chambers[request.current_chamber_index].is_spent = true;
    request.chambers[request.current_chamber_index].is_ejected = Some(false);

    let effective_target = match request.branch {
        GameBranch::Classic => request.shooter,
        GameBranch::Revamped => request.target,
    };
    let mut currency = request.blood_currency;
    let was_double = request.double_damage_active == Some(request.shooter);
    // Every trigger pull consumes a pending double-damage effect, including a blank.
    let next_double_damage = None;

    if !chamber.is_live {
        if request.branch == GameBranch::Classic {
            if request.shooter == Participant::Player {
                currency += 10;
            }
        } else if request.shooter == Participant::Player && effective_target == Participant::Player
        {
            currency += 5;
        }

        return Ok(ShotResult {
            chambers: request.chambers,
            player: request.player,
            dealer: request.dealer,
            chamber_was_live: false,
            effective_target,
            damage: 0,
            double_damage_active: next_double_damage,
            blood_currency: currency,
            retaliation_active: request.branch == GameBranch::Revamped
                && request.shooter == Participant::Player
                && effective_target == Participant::Dealer,
            retains_turn: request.branch == GameBranch::Revamped
                && effective_target == request.shooter,
        });
    }

    let mut damage = base_shot_damage(
        request.branch,
        request.difficulty,
        request.shooter,
        effective_target,
    );
    if was_double {
        damage *= 2;
    }
    let protected = match effective_target {
        Participant::Player => request.player_damage_reduction_active,
        Participant::Dealer => request.dealer_damage_reduction_active,
    };
    if protected {
        damage = (damage - 30).max(0);
    }

    match effective_target {
        Participant::Player => {
            request.player.health = (request.player.health - damage).max(0);
            if request.branch == GameBranch::Classic && request.player.health > 0 {
                currency += 10;
            }
        }
        Participant::Dealer => {
            request.dealer.health = (request.dealer.health - damage).max(0);
            currency += if request.shooter == Participant::Player {
                if was_double {
                    40
                } else {
                    25
                }
            } else if request.branch == GameBranch::Classic {
                25
            } else {
                0
            };
        }
    }

    Ok(ShotResult {
        chambers: request.chambers,
        player: request.player,
        dealer: request.dealer,
        chamber_was_live: true,
        effective_target,
        damage,
        double_damage_active: next_double_damage,
        blood_currency: currency,
        retaliation_active: false,
        retains_turn: false,
    })
}

/// Applies an inventory item and removes it from the user's inventory. Timing,
/// sounds, haptics and message copy are intentionally kept in TypeScript.
pub fn resolve_item(mut request: ItemRequest) -> Result<ItemResult, GameError> {
    validate_cylinder(&request.chambers, request.current_chamber_index)?;
    let inventory = match request.user {
        Participant::Player => &mut request.player.items,
        Participant::Dealer => &mut request.dealer.items,
    };
    if request.item_index >= inventory.len() {
        return Err(GameError::MissingItem);
    }
    let item = inventory.remove(request.item_index);
    if request.branch == GameBranch::Classic && item == ItemType::Scalpel {
        return Err(GameError::ClassicScalpel);
    }

    let mut known_shell = None;
    match item {
        ItemType::Mirror => {
            let current = request.chambers[request.current_chamber_index].clone();
            if request.branch == GameBranch::Classic {
                let upcoming_blank = (1..CYLINDER_SIZE)
                    .map(|offset| (request.current_chamber_index + offset) % CYLINDER_SIZE)
                    .find(|&index| {
                        let chamber = &request.chambers[index];
                        !chamber.is_spent && !chamber.is_live
                    });
                if let Some(index) = upcoming_blank {
                    request.chambers[index].is_live = true;
                } else if !current.is_spent && !current.is_live {
                    request.chambers[request.current_chamber_index].is_live = true;
                    if request.user == Participant::Dealer {
                        known_shell = Some(true);
                    }
                }
            }
            if request.user == Participant::Dealer && known_shell.is_none() {
                known_shell = Some(current.is_live);
            }
        }
        ItemType::Pliers => {
            let chamber = &mut request.chambers[request.current_chamber_index];
            chamber.is_spent = true;
            chamber.is_ejected = Some(true);
            request.current_chamber_index = (request.current_chamber_index + 1) % CYLINDER_SIZE;
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.health = (player.health - 5).max(1);
        }
        ItemType::Whiskey => {
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.health = (player.health + 20).min(player.max_health);
        }
        ItemType::Tourniquet => {
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.max_health += 1;
        }
        ItemType::Pentagram => {
            std::mem::swap(&mut request.player.health, &mut request.dealer.health);
        }
        ItemType::Cigarette => match request.user {
            Participant::Player => {
                request.player_damage_reduction_end = Some(request.now_ms + 20_000)
            }
            Participant::Dealer => {
                request.dealer_damage_reduction_end = Some(request.now_ms + 20_000)
            }
        },
        ItemType::Scalpel => request.double_damage_active = Some(request.user),
        ItemType::Defibrillator => {
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.max_health = (player.max_health - 10).max(10);
            player.health = (player.health + 40).min(player.max_health);
        }
        ItemType::Syringe => {
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.health = (player.health + 50).min(player.max_health);
        }
        ItemType::Razorblade => {
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.health = (player.health - 10).max(1);
            let chamber = &mut request.chambers[request.current_chamber_index];
            if chamber.is_live {
                request.double_damage_active = Some(request.user);
            } else {
                chamber.is_live = true;
            }
            if request.user == Participant::Dealer {
                known_shell = Some(true);
            }
        }
        ItemType::Medkit => {
            let player = player_mut(request.user, &mut request.player, &mut request.dealer);
            player.health = player.max_health;
        }
    }

    Ok(ItemResult {
        chambers: request.chambers,
        current_chamber_index: request.current_chamber_index,
        player: request.player,
        dealer: request.dealer,
        double_damage_active: request.double_damage_active,
        player_damage_reduction_end: request.player_damage_reduction_end,
        dealer_damage_reduction_end: request.dealer_damage_reduction_end,
        dealer_known_shell: known_shell,
        item,
    })
}

fn validate_cylinder(chambers: &[Chamber], current_chamber_index: usize) -> Result<(), GameError> {
    if chambers.len() != CYLINDER_SIZE {
        return Err(GameError::InvalidCylinderSize);
    }
    if current_chamber_index >= chambers.len() {
        return Err(GameError::InvalidChamberIndex);
    }
    Ok(())
}

fn player_mut<'a>(
    participant: Participant,
    player: &'a mut PlayerState,
    dealer: &'a mut PlayerState,
) -> &'a mut PlayerState {
    match participant {
        Participant::Player => player,
        Participant::Dealer => dealer,
    }
}

fn blank_chamber() -> Chamber {
    Chamber {
        is_live: false,
        is_spent: false,
        is_ejected: None,
    }
}

fn base_shot_damage(
    branch: GameBranch,
    difficulty: Difficulty,
    shooter: Participant,
    target: Participant,
) -> i32 {
    match branch {
        GameBranch::Classic if target == Participant::Player => match difficulty {
            Difficulty::Normal => 25,
            Difficulty::Hard => 20,
            Difficulty::VeryHard => 15,
            Difficulty::Nightmare => 12,
        },
        GameBranch::Classic => BASE_DAMAGE,
        GameBranch::Revamped if shooter == target => BASE_DAMAGE * 2,
        GameBranch::Revamped => BASE_DAMAGE,
    }
}

#[derive(Debug, Clone, Copy)]
struct XorShift32 {
    state: u32,
}

impl XorShift32 {
    fn new(seed: u32) -> Self {
        // Xorshift32 has an all-zero absorbing state.
        Self {
            state: if seed == 0 { 0x6d2b_79f5 } else { seed },
        }
    }

    fn next(&mut self) -> u32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        self.state
    }

    fn range(&mut self, start: usize, end_exclusive: usize) -> usize {
        debug_assert!(start < end_exclusive);
        start + (self.next() as usize % (end_exclusive - start))
    }

    fn range_inclusive(&mut self, start: usize, end_inclusive: usize) -> usize {
        self.range(start, end_inclusive + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(health: i32) -> PlayerState {
        PlayerState {
            health,
            max_health: health,
            items: vec![],
        }
    }

    fn cylinder(current_live: bool) -> Vec<Chamber> {
        let mut chambers = vec![blank_chamber(); CYLINDER_SIZE];
        chambers[0].is_live = current_live;
        chambers
    }

    #[test]
    fn seeded_rounds_are_reproducible_and_valid() {
        let request = RoundRequest {
            difficulty: Difficulty::Hard,
            branch: GameBranch::Revamped,
            seed: 123_456,
        };
        let first = create_round(request.clone()).unwrap();
        let second = create_round(request).unwrap();
        assert_eq!(first, second);
        assert!((1..=4).contains(&first.live_count));
        assert_eq!(
            first.chambers.iter().filter(|shell| shell.is_live).count(),
            first.live_count
        );
    }

    #[test]
    fn live_player_shot_is_resolved_by_core_and_awards_currency() {
        let result = resolve_shot(ShotRequest {
            branch: GameBranch::Revamped,
            difficulty: Difficulty::Normal,
            chambers: cylinder(true),
            current_chamber_index: 0,
            player: player(100),
            dealer: player(100),
            shooter: Participant::Player,
            target: Participant::Dealer,
            double_damage_active: None,
            player_damage_reduction_active: false,
            dealer_damage_reduction_active: false,
            blood_currency: 0,
        })
        .unwrap();
        assert!(result.chambers[0].is_spent);
        assert_eq!(result.dealer.health, 65);
        assert_eq!(result.damage, 35);
        assert_eq!(result.blood_currency, 25);
    }

    #[test]
    fn blank_self_shot_keeps_the_turn_in_revamped_mode() {
        let result = resolve_shot(ShotRequest {
            branch: GameBranch::Revamped,
            difficulty: Difficulty::Normal,
            chambers: cylinder(false),
            current_chamber_index: 0,
            player: player(100),
            dealer: player(100),
            shooter: Participant::Player,
            target: Participant::Player,
            double_damage_active: Some(Participant::Player),
            player_damage_reduction_active: false,
            dealer_damage_reduction_active: false,
            blood_currency: 0,
        })
        .unwrap();
        assert!(!result.chamber_was_live);
        assert!(result.retains_turn);
        assert_eq!(result.double_damage_active, None);
        assert_eq!(result.blood_currency, 5);
    }

    #[test]
    fn pliers_ejects_shell_advances_cylinder_and_cannot_kill_user() {
        let mut user = player(5);
        user.items.push(ItemType::Pliers);
        let result = resolve_item(ItemRequest {
            branch: GameBranch::Revamped,
            chambers: cylinder(true),
            current_chamber_index: 0,
            player: user,
            dealer: player(100),
            user: Participant::Player,
            item_index: 0,
            double_damage_active: None,
            player_damage_reduction_end: None,
            dealer_damage_reduction_end: None,
            now_ms: 0,
        })
        .unwrap();
        assert!(result.chambers[0].is_spent);
        assert_eq!(result.chambers[0].is_ejected, Some(true));
        assert_eq!(result.current_chamber_index, 1);
        assert_eq!(result.player.health, 1);
    }

    #[test]
    fn razorblade_turns_a_blank_live_without_killing_the_user() {
        let mut user = player(10);
        user.items.push(ItemType::Razorblade);
        let result = resolve_item(ItemRequest {
            branch: GameBranch::Revamped,
            chambers: cylinder(false),
            current_chamber_index: 0,
            player: user,
            dealer: player(100),
            user: Participant::Player,
            item_index: 0,
            double_damage_active: None,
            player_damage_reduction_end: None,
            dealer_damage_reduction_end: None,
            now_ms: 0,
        })
        .unwrap();
        assert_eq!(result.player.health, 1);
        assert!(result.chambers[0].is_live);
        assert_eq!(result.double_damage_active, None);
    }

    #[test]
    fn classic_mirror_curses_the_next_available_blank() {
        let mut user = player(100);
        user.items.push(ItemType::Mirror);
        let mut chambers = cylinder(true);
        chambers[1].is_live = false;
        let result = resolve_item(ItemRequest {
            branch: GameBranch::Classic,
            chambers,
            current_chamber_index: 0,
            player: user,
            dealer: player(100),
            user: Participant::Player,
            item_index: 0,
            double_damage_active: None,
            player_damage_reduction_end: None,
            dealer_damage_reduction_end: None,
            now_ms: 0,
        })
        .unwrap();
        assert!(result.chambers[1].is_live);
    }
}
