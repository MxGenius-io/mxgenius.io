//! What a quantity column can hold.
//!
//! Published here once because the alternative is what this replaces: four
//! call sites each checking some of `is_finite`, `> 0`, and nothing else, so a
//! quantity outside the column's range reached Postgres, failed a typmod or a
//! `CHECK`, and surfaced as `503 server-side persistence is temporarily
//! unavailable` — a validation error dressed as an outage, which asks the
//! operator to retry something that can never succeed.
//!
//! Both ends matter. Above the ceiling the value does not fit the column; below
//! the resolution it rounds to zero and fails `CHECK (quantity > 0)`. The two
//! produce an identical symptom and had an identical cause.

/// Precision and scale of every quantity column. `COLUMN_TYPE` is the spelling
/// the migrations must use, and a test in the server crate — which owns
/// `migrations/` — asserts they still say it.
pub const QUANTITY_PRECISION: u32 = 12;
pub const QUANTITY_SCALE: u32 = 3;
pub const QUANTITY_COLUMN_TYPE: &str = "numeric(12,3)";

/// Nine integer digits and three decimals: the largest `numeric(12,3)` holds.
pub const MAX_QUANTITY: f64 = 999_999_999.999;

/// One unit in the last place at scale 3. Below this a value rounds to `0.000`
/// and fails `CHECK (quantity > 0)`. It is not a small quantity, it is an
/// unrecordable one.
pub const MIN_QUANTITY: f64 = 0.001;

/// Why a quantity cannot be recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuantityProblem {
    /// Not a number, or infinite. Not reachable through a JSON body — serde
    /// rejects both at the parse layer — but these functions are public and a
    /// computed value (a split remainder, an import cell) has no such guard.
    NotANumber,
    NotPositive,
    BelowResolution,
    AboveMaximum,
}

impl QuantityProblem {
    /// Renders the limit from the constant, so the operator-facing text cannot
    /// drift from the rule it is explaining.
    pub fn message(self) -> String {
        match self {
            Self::NotANumber => "quantity must be a number".into(),
            Self::NotPositive => "quantity must be greater than zero".into(),
            Self::BelowResolution => {
                format!("quantity must be at least {MIN_QUANTITY}; anything smaller rounds to zero")
            }
            Self::AboveMaximum => format!("quantity cannot exceed {MAX_QUANTITY}"),
        }
    }
}

/// The single published check for any value bound for a quantity column.
pub fn quantity_problem(value: f64) -> Option<QuantityProblem> {
    if !value.is_finite() {
        return Some(QuantityProblem::NotANumber);
    }
    if value <= 0.0 {
        return Some(QuantityProblem::NotPositive);
    }
    if value < MIN_QUANTITY {
        return Some(QuantityProblem::BelowResolution);
    }
    if value > MAX_QUANTITY {
        return Some(QuantityProblem::AboveMaximum);
    }
    None
}

/// The same magnitude rule for a signed ledger delta: the sign is allowed, the
/// size is not. Zero is a legitimate delta — a transfer moves stock without
/// changing how much of it there is.
pub fn quantity_delta_problem(value: f64) -> Option<QuantityProblem> {
    if !value.is_finite() {
        return Some(QuantityProblem::NotANumber);
    }
    if value.abs() > MAX_QUANTITY {
        return Some(QuantityProblem::AboveMaximum);
    }
    None
}
