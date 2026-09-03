//! The quantity bound, from both ends and at the boundary itself.

#[cfg(test)]
mod tests {
    use crate::domain::quantity::*;

    /// The constants must stay derivable from the column's precision and
    /// scale, so widening `numeric(12,3)` later forces both to move together
    /// rather than one silently outliving the other.
    #[test]
    fn the_limits_follow_from_the_column_type() {
        assert_eq!(MIN_QUANTITY, 10f64.powi(-(QUANTITY_SCALE as i32)));
        assert_eq!(
            MAX_QUANTITY,
            10f64.powi((QUANTITY_PRECISION - QUANTITY_SCALE) as i32) - MIN_QUANTITY
        );
        assert_eq!(
            QUANTITY_COLUMN_TYPE,
            format!("numeric({QUANTITY_PRECISION},{QUANTITY_SCALE})")
        );
    }

    #[test]
    fn the_boundary_values_themselves_are_accepted() {
        assert_eq!(quantity_problem(MAX_QUANTITY), None);
        assert_eq!(quantity_problem(MIN_QUANTITY), None);
        assert_eq!(quantity_problem(1.0), None);
    }

    /// The reported symptom: a count above the ceiling used to reach Postgres
    /// and come back as a 503.
    #[test]
    fn anything_past_the_ceiling_is_refused() {
        for value in [1e9, 1e10, 1e12, MAX_QUANTITY * 2.0] {
            assert_eq!(
                quantity_problem(value),
                Some(QuantityProblem::AboveMaximum),
                "{value} should not fit the column"
            );
        }
    }

    /// The same symptom from the other end, which the original finding missed:
    /// a value under the column's resolution rounds to zero and fails
    /// `CHECK (quantity > 0)`.
    #[test]
    fn anything_under_the_resolution_is_refused() {
        for value in [0.0009, 0.0004, 1e-9] {
            assert_eq!(
                quantity_problem(value),
                Some(QuantityProblem::BelowResolution),
                "{value} rounds to zero at scale {QUANTITY_SCALE}"
            );
        }
    }

    #[test]
    fn zero_and_negative_are_refused_as_such() {
        assert_eq!(quantity_problem(0.0), Some(QuantityProblem::NotPositive));
        assert_eq!(quantity_problem(-1.0), Some(QuantityProblem::NotPositive));
        assert_eq!(
            quantity_problem(-MAX_QUANTITY),
            Some(QuantityProblem::NotPositive)
        );
    }

    /// NaN must be classified as a non-number rather than slipping through a
    /// comparison. `NAN <= 0.0` is false, which is exactly how the receiving
    /// path's `quantity <= 0.0` check would have let it past.
    #[test]
    fn non_finite_values_are_refused_and_not_mistaken_for_negatives() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(
                quantity_problem(value),
                Some(QuantityProblem::NotANumber),
                "{value} must be caught before any comparison"
            );
        }
        assert_eq!(
            f64::NAN.partial_cmp(&0.0),
            None,
            "the comparison this guard replaces must remain unordered"
        );
    }

    /// A ledger delta may be negative and may be zero; only its magnitude is
    /// bounded.
    #[test]
    fn a_ledger_delta_keeps_its_sign_and_may_be_zero() {
        assert_eq!(quantity_delta_problem(0.0), None);
        assert_eq!(quantity_delta_problem(-5.0), None);
        assert_eq!(quantity_delta_problem(-MAX_QUANTITY), None);
        assert_eq!(
            quantity_delta_problem(-MAX_QUANTITY * 2.0),
            Some(QuantityProblem::AboveMaximum)
        );
        assert_eq!(
            quantity_delta_problem(f64::NAN),
            Some(QuantityProblem::NotANumber)
        );
    }

    /// The operator-facing text has to carry the number it is explaining, or
    /// the limit and the message drift apart.
    #[test]
    fn each_message_names_the_limit_it_enforces() {
        assert!(QuantityProblem::AboveMaximum
            .message()
            .contains("999999999.999"));
        assert!(QuantityProblem::BelowResolution.message().contains("0.001"));
        assert!(QuantityProblem::NotPositive
            .message()
            .contains("greater than zero"));
    }
}
