use crate::{Difficulty, GameError, ItemType, Participant, PlayerState};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassicDealerInput {
    pub difficulty: Difficulty,
    pub dealer: PlayerState,
    pub player: PlayerState,
    pub live_count: u8,
    pub blank_count: u8,
    pub known_current_shell: Option<bool>,
    pub dealer_damage_reduction_active: bool,
    pub items_used_this_turn: u8,
    pub item_roll: f64,
    pub mirror_roll: f64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DealerDecision {
    UseItem {
        #[serde(rename = "itemIndex")]
        item_index: usize,
    },
    Shoot {
        target: Participant,
    },
}

pub fn decide_classic_dealer_move(input: ClassicDealerInput) -> Result<DealerDecision, GameError> {
    use ItemType::*;
    let normal = input.difficulty == Difficulty::Normal;
    let hard = input.difficulty == Difficulty::Hard;
    let item_cap = if normal {
        1
    } else if hard {
        2
    } else {
        3
    };
    let shoot = DealerDecision::Shoot {
        target: Participant::Dealer,
    };
    if input.items_used_this_turn >= item_cap || (normal && input.item_roll >= 0.78) {
        return Ok(shoot);
    }
    let health = input.dealer.health;
    let max_health = input.dealer.max_health;
    let missing = max_health - health;
    let items = input.dealer.items;
    let live = input.live_count;
    let blank = input.blank_count;
    let total = u16::from(live) + u16::from(blank);
    let known = match (live, blank) {
        (1.., 0) => Some(true),
        (0, 1..) => Some(false),
        _ => input.known_current_shell,
    };
    let chance_live = match known {
        Some(true) => 1.0,
        Some(false) => 0.0,
        None if total > 0 => f64::from(live) / f64::from(total),
        None => 0.5,
    };
    let pliers_threshold = if normal {
        0.62
    } else if hard {
        0.52
    } else {
        0.45
    };

    // Order matters when several items can help. The first eligible item wins,
    // and duplicate items use their first inventory slot.
    let priorities = [
        (Medkit, (health <= 35 && missing >= 25) || missing >= 50),
        (Syringe, missing >= 40 || (health <= 35 && missing >= 20)),
        (Defibrillator, health <= 35 && max_health >= 30),
        (
            Pentagram,
            input.player.health - health >= if normal { 35 } else { 22 },
        ),
        (Whiskey, missing >= 18),
        (
            Mirror,
            known.is_none() && live > 0 && blank > 0 && (!normal || input.mirror_roll < 0.45),
        ),
        (
            Pliers,
            total > 1
                && health > 10
                && known != Some(false)
                && (known == Some(true)
                    || chance_live >= pliers_threshold
                    || (health <= 35 && chance_live > 0.0)),
        ),
        (
            Cigarette,
            !input.dealer_damage_reduction_active
                && live > 0
                && known != Some(false)
                && (known == Some(true)
                    || health <= 45
                    || chance_live >= if normal { 0.55 } else { 0.42 }),
        ),
        (
            Tourniquet,
            items.len() >= 7 || (health == max_health && items.contains(&Medkit)),
        ),
    ];
    Ok(priorities
        .into_iter()
        .find_map(|(item, eligible)| {
            if !eligible {
                return None;
            }
            items
                .iter()
                .position(|candidate| *candidate == item)
                .map(|item_index| DealerDecision::UseItem { item_index })
        })
        .unwrap_or(shoot))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ClassicDealerInput {
        ClassicDealerInput {
            difficulty: Difficulty::Normal,
            dealer: PlayerState {
                health: 31,
                max_health: 100,
                items: vec![ItemType::Mirror, ItemType::Medkit, ItemType::Medkit],
            },
            player: PlayerState {
                health: 25,
                max_health: 100,
                items: vec![],
            },
            live_count: 2,
            blank_count: 2,
            known_current_shell: None,
            dealer_damage_reduction_active: false,
            items_used_this_turn: 0,
            item_roll: 0.77,
            mirror_roll: 0.44,
        }
    }

    #[test]
    fn emergency_recovery_precedes_information_and_uses_first_matching_slot() {
        assert_eq!(
            decide_classic_dealer_move(input()).unwrap(),
            DealerDecision::UseItem { item_index: 1 }
        );
    }

    #[test]
    fn normal_dealer_item_roll_and_per_turn_cap_pass_control_to_a_self_shot() {
        let mut scenario = input();
        scenario.item_roll = 0.78;
        let shot = DealerDecision::Shoot {
            target: Participant::Dealer,
        };
        assert_eq!(decide_classic_dealer_move(scenario).unwrap(), shot);
        scenario = input();
        scenario.items_used_this_turn = 1;
        assert_eq!(decide_classic_dealer_move(scenario).unwrap(), shot);
    }

    #[test]
    fn normal_mirror_requires_uncertainty_and_the_matching_random_gate() {
        let mut scenario = input();
        scenario.dealer.items = vec![ItemType::Mirror, ItemType::Pliers];
        scenario.dealer.health = 80;
        scenario.mirror_roll = 0.45;
        assert_eq!(
            decide_classic_dealer_move(scenario).unwrap(),
            DealerDecision::Shoot {
                target: Participant::Dealer
            }
        );
        scenario = input();
        scenario.dealer.items = vec![ItemType::Mirror, ItemType::Pliers];
        scenario.known_current_shell = Some(true);
        assert_eq!(
            decide_classic_dealer_move(scenario).unwrap(),
            DealerDecision::UseItem { item_index: 1 }
        );
    }
}
