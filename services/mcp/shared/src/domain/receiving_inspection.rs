//! Receiving inspection: the evidence behind releasing a part from quarantine.
//!
//! The slice ships `quarantine_then_inspect`, so a received unit reaches
//! `available` only by passing inspection. This module carries the vocabulary
//! that decision is recorded in.
//!
//! The outcome is stored on the row rather than recomputed from the gates.
//! [`Outcome::proposed_from`] exists to *offer* an outcome at the moment of
//! inspection, not to re-derive one later: the gate set may be extended, and
//! replaying an old acceptance under today's rules would restate what an
//! inspector concluded rather than report it.

use serde::{Deserialize, Serialize};

/// One inspection gate's result.
///
/// `NotApplicable` is a deliberate third value. "No dangerous-goods paperwork"
/// is a pass for a part that is not dangerous goods and a fail for one that
/// is; collapsing the two would lose the distinction that matters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateResult {
    Pass,
    Fail,
    #[serde(rename = "na")]
    NotApplicable,
}

impl GateResult {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Fail => "fail",
            Self::NotApplicable => "na",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pass" => Some(Self::Pass),
            "fail" => Some(Self::Fail),
            "na" => Some(Self::NotApplicable),
            _ => None,
        }
    }

    pub fn is_fail(self) -> bool {
        matches!(self, Self::Fail)
    }
}

/// The five gates of a receiving inspection, in the order an inspector works
/// them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionGates {
    pub part_number_matches_order: GateResult,
    pub serial_matches_tag: GateResult,
    pub tag_present_and_legible: GateResult,
    pub shelf_life_acceptable: GateResult,
    pub dangerous_goods_paperwork: GateResult,
}

impl InspectionGates {
    /// Whether the inspector actually assessed anything.
    ///
    /// Every gate left at `na` means nothing was checked, which is not the
    /// same as everything passing -- and must not release a part into
    /// serviceable stock on its own.
    pub fn any_assessed(&self) -> bool {
        [
            self.part_number_matches_order,
            self.serial_matches_tag,
            self.tag_present_and_legible,
            self.shelf_life_acceptable,
            self.dangerous_goods_paperwork,
        ]
        .iter()
        .any(|gate| !matches!(gate, GateResult::NotApplicable))
    }

    /// Whether any gate failed.
    pub fn any_failed(&self) -> bool {
        self.part_number_matches_order.is_fail()
            || self.serial_matches_tag.is_fail()
            || self.tag_present_and_legible.is_fail()
            || self.shelf_life_acceptable.is_fail()
            || self.dangerous_goods_paperwork.is_fail()
    }

    /// The gates that failed, by name, for the discrepancy summary.
    pub fn failed_gate_names(&self) -> Vec<&'static str> {
        let mut names = Vec::new();
        if self.part_number_matches_order.is_fail() {
            names.push("part number does not match the order");
        }
        if self.serial_matches_tag.is_fail() {
            names.push("serial number does not match the tag");
        }
        if self.tag_present_and_legible.is_fail() {
            names.push("tag missing or illegible");
        }
        if self.shelf_life_acceptable.is_fail() {
            names.push("shelf life unacceptable");
        }
        if self.dangerous_goods_paperwork.is_fail() {
            names.push("dangerous goods paperwork missing");
        }
        names
    }
}

/// What the inspector concluded. Stored on the row; never re-derived at read
/// time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Accepted,
    Quarantined,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Quarantined => "quarantined",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "accepted" => Some(Self::Accepted),
            "quarantined" => Some(Self::Quarantined),
            _ => None,
        }
    }

    /// The outcome the gates point to, offered to the inspector at the time of
    /// inspection.
    ///
    /// Advisory in one direction only. A failed gate or shipping damage means
    /// the part cannot be accepted, and that is enforced in the schema. Every
    /// gate passing does not compel acceptance: an inspector may quarantine on
    /// judgment the gates do not capture, and that call stands.
    pub fn proposed_from(gates: &InspectionGates, shipping_damage: bool) -> Self {
        if gates.any_failed() || shipping_damage || !gates.any_assessed() {
            Self::Quarantined
        } else {
            Self::Accepted
        }
    }

    /// Whether this outcome may stand given what the inspector recorded.
    ///
    /// Mirrors `receiving_inspections_acceptance_has_no_failed_gate`, so the
    /// API rejects with a usable message before the database rejects with a
    /// constraint name.
    pub fn is_supported_by(self, gates: &InspectionGates, shipping_damage: bool) -> bool {
        match self {
            // An acceptance has to rest on something the inspector actually
            // checked. An inspection recording nothing is not evidence.
            Self::Accepted => gates.any_assessed() && !gates.any_failed() && !shipping_damage,
            Self::Quarantined => true,
        }
    }
}

/// What is wrong with the material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscrepancyType {
    WrongPart,
    WrongQuantity,
    ShippingDamage,
    MissingPaperwork,
    IllegibleTag,
    ExpiredShelfLife,
    SuspectedUnapproved,
    ConditionMismatch,
    Other,
}

impl DiscrepancyType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WrongPart => "wrong_part",
            Self::WrongQuantity => "wrong_quantity",
            Self::ShippingDamage => "shipping_damage",
            Self::MissingPaperwork => "missing_paperwork",
            Self::IllegibleTag => "illegible_tag",
            Self::ExpiredShelfLife => "expired_shelf_life",
            Self::SuspectedUnapproved => "suspected_unapproved",
            Self::ConditionMismatch => "condition_mismatch",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "wrong_part" => Some(Self::WrongPart),
            "wrong_quantity" => Some(Self::WrongQuantity),
            "shipping_damage" => Some(Self::ShippingDamage),
            "missing_paperwork" => Some(Self::MissingPaperwork),
            "illegible_tag" => Some(Self::IllegibleTag),
            "expired_shelf_life" => Some(Self::ExpiredShelfLife),
            "suspected_unapproved" => Some(Self::SuspectedUnapproved),
            "condition_mismatch" => Some(Self::ConditionMismatch),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    /// Whether raising this discrepancy also marks the unit a Suspected
    /// Unapproved Part.
    ///
    /// SUP is a regulatory status that travels with the part, so it is set on
    /// the unit rather than living only in the report.
    pub fn marks_suspected_unapproved(self) -> bool {
        matches!(self, Self::SuspectedUnapproved)
    }
}

/// What is to be done with discrepant material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Disposition {
    ReturnToVendor,
    Rework,
    AcceptAsIs,
    Scrap,
}

impl Disposition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReturnToVendor => "return_to_vendor",
            Self::Rework => "rework",
            Self::AcceptAsIs => "accept_as_is",
            Self::Scrap => "scrap",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "return_to_vendor" => Some(Self::ReturnToVendor),
            "rework" => Some(Self::Rework),
            "accept_as_is" => Some(Self::AcceptAsIs),
            "scrap" => Some(Self::Scrap),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_pass() -> InspectionGates {
        InspectionGates {
            part_number_matches_order: GateResult::Pass,
            serial_matches_tag: GateResult::Pass,
            tag_present_and_legible: GateResult::Pass,
            shelf_life_acceptable: GateResult::Pass,
            dangerous_goods_paperwork: GateResult::Pass,
        }
    }

    #[test]
    fn every_vocabulary_round_trips_and_rejects_the_unknown() {
        for gate in [
            GateResult::Pass,
            GateResult::Fail,
            GateResult::NotApplicable,
        ] {
            assert_eq!(GateResult::parse(gate.as_str()), Some(gate));
        }
        assert_eq!(GateResult::parse("maybe"), None);
        for outcome in [Outcome::Accepted, Outcome::Quarantined] {
            assert_eq!(Outcome::parse(outcome.as_str()), Some(outcome));
        }
        assert_eq!(Outcome::parse("rejected"), None);
        for disposition in [
            Disposition::ReturnToVendor,
            Disposition::Rework,
            Disposition::AcceptAsIs,
            Disposition::Scrap,
        ] {
            assert_eq!(Disposition::parse(disposition.as_str()), Some(disposition));
        }
        assert_eq!(Disposition::parse("bin_it"), None);
    }

    /// `na` must not read as a failure, or every non-dangerous-goods part
    /// would quarantine on its paperwork gate.
    #[test]
    fn not_applicable_is_not_a_failure() {
        let mut gates = all_pass();
        gates.dangerous_goods_paperwork = GateResult::NotApplicable;
        assert!(!gates.any_failed());
        assert_eq!(Outcome::proposed_from(&gates, false), Outcome::Accepted);
    }

    #[test]
    fn any_failed_gate_proposes_quarantine() {
        for i in 0..5 {
            let mut gates = all_pass();
            match i {
                0 => gates.part_number_matches_order = GateResult::Fail,
                1 => gates.serial_matches_tag = GateResult::Fail,
                2 => gates.tag_present_and_legible = GateResult::Fail,
                3 => gates.shelf_life_acceptable = GateResult::Fail,
                _ => gates.dangerous_goods_paperwork = GateResult::Fail,
            }
            assert!(gates.any_failed(), "gate {i} should register as failed");
            assert_eq!(Outcome::proposed_from(&gates, false), Outcome::Quarantined);
            assert!(!Outcome::Accepted.is_supported_by(&gates, false));
        }
    }

    /// Undamaged paperwork does not make damaged material acceptable.
    #[test]
    fn shipping_damage_alone_prevents_acceptance() {
        let gates = all_pass();
        assert!(!gates.any_failed());
        assert_eq!(Outcome::proposed_from(&gates, true), Outcome::Quarantined);
        assert!(!Outcome::Accepted.is_supported_by(&gates, true));
    }

    /// An inspection that checked nothing must not release a part. Posting an
    /// empty body used to accept the unit into serviceable stock.
    #[test]
    fn an_inspection_that_assessed_nothing_cannot_accept() {
        let none_checked = InspectionGates {
            part_number_matches_order: GateResult::NotApplicable,
            serial_matches_tag: GateResult::NotApplicable,
            tag_present_and_legible: GateResult::NotApplicable,
            shelf_life_acceptable: GateResult::NotApplicable,
            dangerous_goods_paperwork: GateResult::NotApplicable,
        };
        assert!(!none_checked.any_assessed());
        assert!(!none_checked.any_failed(), "n/a is still not a failure");
        assert_eq!(
            Outcome::proposed_from(&none_checked, false),
            Outcome::Quarantined
        );
        assert!(!Outcome::Accepted.is_supported_by(&none_checked, false));
    }

    /// One real check is enough; the rest may legitimately not apply.
    #[test]
    fn a_single_assessed_gate_is_enough_to_accept() {
        let mut gates = InspectionGates {
            part_number_matches_order: GateResult::NotApplicable,
            serial_matches_tag: GateResult::NotApplicable,
            tag_present_and_legible: GateResult::NotApplicable,
            shelf_life_acceptable: GateResult::NotApplicable,
            dangerous_goods_paperwork: GateResult::NotApplicable,
        };
        gates.part_number_matches_order = GateResult::Pass;
        assert!(gates.any_assessed());
        assert_eq!(Outcome::proposed_from(&gates, false), Outcome::Accepted);
        assert!(Outcome::Accepted.is_supported_by(&gates, false));
    }

    /// The proposal is advisory in one direction only: an inspector may
    /// quarantine a part whose gates all passed, on judgment the gates do not
    /// capture.
    #[test]
    fn an_inspector_may_quarantine_despite_passing_gates() {
        let gates = all_pass();
        assert_eq!(Outcome::proposed_from(&gates, false), Outcome::Accepted);
        assert!(
            Outcome::Quarantined.is_supported_by(&gates, false),
            "a quarantine call always stands"
        );
    }

    #[test]
    fn failed_gates_are_named_for_the_discrepancy_summary() {
        let mut gates = all_pass();
        gates.serial_matches_tag = GateResult::Fail;
        gates.shelf_life_acceptable = GateResult::Fail;
        let names = gates.failed_gate_names();
        assert_eq!(names.len(), 2);
        assert!(names.iter().any(|n| n.contains("serial")));
        assert!(names.iter().any(|n| n.contains("shelf life")));
        assert!(all_pass().failed_gate_names().is_empty());
    }

    #[test]
    fn only_the_sup_discrepancy_flags_the_unit() {
        assert!(DiscrepancyType::SuspectedUnapproved.marks_suspected_unapproved());
        for other in [
            DiscrepancyType::WrongPart,
            DiscrepancyType::ShippingDamage,
            DiscrepancyType::MissingPaperwork,
            DiscrepancyType::Other,
        ] {
            assert!(!other.marks_suspected_unapproved());
        }
    }
}
