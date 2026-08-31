//! Part interchangeability: how one part number relates to another.
//!
//! Interchangeability is an airworthiness claim. A row saying two part numbers
//! are alternates asserts that one may be fitted where the other is called
//! for, which an operator determines against an IPC, a service bulletin, or a
//! manufacturer notice. Nothing here infers a relation from similar-looking
//! part numbers, and every relation carries the authority it was asserted
//! against.

use serde::{Deserialize, Serialize};

/// How `part_id` relates to `alternate_part_id`.
///
/// Mirrors the `part_alternates.relation` check constraint in
/// `0025_part_alternates.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlternateRelation {
    /// Fit-for-fit interchangeable. Mutual unless the row is marked one-way.
    Alternate,
    /// `part_id` replaces `alternate_part_id`.
    Supersedes,
    /// `part_id` is replaced by `alternate_part_id`.
    SupersededBy,
}

impl AlternateRelation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Alternate => "alternate",
            Self::Supersedes => "supersedes",
            Self::SupersededBy => "superseded_by",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "alternate" => Some(Self::Alternate),
            "supersedes" => Some(Self::Supersedes),
            "superseded_by" => Some(Self::SupersededBy),
            _ => None,
        }
    }

    /// The same claim read from the other part's side.
    ///
    /// A supersession seen from the replaced part is a `superseded_by`, and
    /// the reverse. Without this a lookup would have to know which direction
    /// the row happened to be written in, and would miss half the catalog.
    pub fn inverted(self) -> Self {
        match self {
            Self::Alternate => Self::Alternate,
            Self::Supersedes => Self::SupersededBy,
            Self::SupersededBy => Self::Supersedes,
        }
    }

    /// Whether this relation is a supersession rather than a plain alternate.
    ///
    /// The two are reported separately: a supersession says the part has been
    /// replaced, which is a different operational fact from a substitute being
    /// available.
    pub fn is_supersession(self) -> bool {
        matches!(self, Self::Supersedes | Self::SupersededBy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_relation_round_trips_through_its_wire_value() {
        for relation in [
            AlternateRelation::Alternate,
            AlternateRelation::Supersedes,
            AlternateRelation::SupersededBy,
        ] {
            assert_eq!(AlternateRelation::parse(relation.as_str()), Some(relation));
        }
    }

    #[test]
    fn unknown_relations_are_rejected_rather_than_defaulted() {
        assert_eq!(AlternateRelation::parse("equivalent"), None);
        assert_eq!(AlternateRelation::parse("ALTERNATE"), None);
        assert_eq!(AlternateRelation::parse(""), None);
    }

    /// Reading a claim from the other part's side must not change what it says.
    #[test]
    fn inverting_twice_returns_the_original_relation() {
        for relation in [
            AlternateRelation::Alternate,
            AlternateRelation::Supersedes,
            AlternateRelation::SupersededBy,
        ] {
            assert_eq!(relation.inverted().inverted(), relation);
        }
    }

    #[test]
    fn supersession_direction_flips_but_alternate_does_not() {
        assert_eq!(
            AlternateRelation::Supersedes.inverted(),
            AlternateRelation::SupersededBy
        );
        assert_eq!(
            AlternateRelation::SupersededBy.inverted(),
            AlternateRelation::Supersedes
        );
        // A mutual alternate reads the same from either side.
        assert_eq!(
            AlternateRelation::Alternate.inverted(),
            AlternateRelation::Alternate
        );
    }

    #[test]
    fn supersessions_are_reported_apart_from_alternates() {
        assert!(AlternateRelation::Supersedes.is_supersession());
        assert!(AlternateRelation::SupersededBy.is_supersession());
        assert!(!AlternateRelation::Alternate.is_supersession());
    }
}
