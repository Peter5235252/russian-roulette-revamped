use russian_roulette_game_core::{
    create_round as core_create_round, decide_classic_dealer_move,
    resolve_item as core_resolve_item, resolve_shot as core_resolve_shot,
};
use wasm_bindgen::prelude::*;

/// Increment when a breaking change is made to the browser ↔ core contract.
pub const API_VERSION: u32 = 1;

#[wasm_bindgen]
pub fn api_version() -> u32 {
    API_VERSION
}

#[wasm_bindgen]
pub fn create_round(input: JsValue) -> Result<JsValue, JsValue> {
    transform(input, core_create_round)
}

#[wasm_bindgen]
pub fn resolve_shot(input: JsValue) -> Result<JsValue, JsValue> {
    transform(input, core_resolve_shot)
}

#[wasm_bindgen]
pub fn resolve_item(input: JsValue) -> Result<JsValue, JsValue> {
    transform(input, core_resolve_item)
}

#[wasm_bindgen]
pub fn decide_classic_dealer(input: JsValue) -> Result<JsValue, JsValue> {
    transform(input, decide_classic_dealer_move)
}

fn transform<Input, Output>(
    input: JsValue,
    operation: fn(Input) -> Result<Output, russian_roulette_game_core::GameError>,
) -> Result<JsValue, JsValue>
where
    Input: serde::de::DeserializeOwned,
    Output: serde::Serialize,
{
    let input = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&format!("invalid game-core request: {error}")))?;
    let output = operation(input).map_err(|error| JsValue::from_str(&error.to_string()))?;
    output
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
        .map_err(|error| {
            JsValue::from_str(&format!("could not serialize game-core response: {error}"))
        })
}
