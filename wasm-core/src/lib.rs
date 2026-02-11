use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceShape {
    pub kind: String,
    pub status: String,
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn normalize_metric_series(values: JsValue) -> Result<JsValue, JsValue> {
    let input: Vec<f64> = serde_wasm_bindgen::from_value(values)
        .map_err(|e| JsValue::from_str(&format!("Invalid input: {e}")))?;

    if input.is_empty() {
        return serde_wasm_bindgen::to_value(&Vec::<f64>::new())
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")));
    }

    let min = input
        .iter()
        .fold(f64::INFINITY, |acc, value| acc.min(*value));
    let max = input
        .iter()
        .fold(f64::NEG_INFINITY, |acc, value| acc.max(*value));

    if (max - min).abs() < f64::EPSILON {
        return serde_wasm_bindgen::to_value(&vec![0.0; input.len()])
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")));
    }

    let normalized: Vec<f64> = input
        .iter()
        .map(|value| (value - min) / (max - min))
        .collect();

    serde_wasm_bindgen::to_value(&normalized)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
}

#[wasm_bindgen]
pub fn correlate_metric_series(left: JsValue, right: JsValue) -> Result<f64, JsValue> {
    let left_values: Vec<f64> = serde_wasm_bindgen::from_value(left)
        .map_err(|e| JsValue::from_str(&format!("Invalid left input: {e}")))?;
    let right_values: Vec<f64> = serde_wasm_bindgen::from_value(right)
        .map_err(|e| JsValue::from_str(&format!("Invalid right input: {e}")))?;

    if left_values.is_empty() || right_values.is_empty() || left_values.len() != right_values.len() {
        return Ok(0.0);
    }

    let n = left_values.len() as f64;
    let left_mean = left_values.iter().sum::<f64>() / n;
    let right_mean = right_values.iter().sum::<f64>() / n;

    let mut numerator = 0.0;
    let mut left_sq = 0.0;
    let mut right_sq = 0.0;

    for (l, r) in left_values.iter().zip(right_values.iter()) {
        let dl = l - left_mean;
        let dr = r - right_mean;
        numerator += dl * dr;
        left_sq += dl * dl;
        right_sq += dr * dr;
    }

    if left_sq <= f64::EPSILON || right_sq <= f64::EPSILON {
        return Ok(0.0);
    }

    Ok((numerator / (left_sq.sqrt() * right_sq.sqrt())).clamp(-1.0, 1.0))
}

#[wasm_bindgen]
pub fn shape_resource_status(kind: String, status: String) -> String {
    let normalized = status.to_lowercase();

    if kind.eq_ignore_ascii_case("pod") {
        if normalized.contains("running") {
            return "running".into();
        }
        if normalized.contains("pending") {
            return "pending".into();
        }
        if normalized.contains("failed") || normalized.contains("error") {
            return "error".into();
        }
        return "warning".into();
    }

    if normalized.contains("error") || normalized.contains("crash") {
        return "error".into();
    }
    if normalized.contains("pending") {
        return "pending".into();
    }
    if normalized.contains("running") || normalized.contains("ready") {
        return "running".into();
    }

    "warning".into()
}
