//! Stock unit transition policy tests. Only compiled in test mode.

#[cfg(test)]
mod tests {
    use crate::domain::part::StockUnitStatus;

    #[test]
    fn legal_transitions_match_the_locked_graph() {
        use StockUnitStatus::*;
        let legal: &[(StockUnitStatus, StockUnitStatus)] = &[
            (Quarantine, Available),
            (Quarantine, Rejected),
            (Available, Reserved),
            // Stock is commonly issued straight off the shelf without a
            // reservation step.
            (Available, Issued),
            (Available, InRepair),
            (Available, Shipped),
            (Available, Scrapped),
            (Reserved, Issued),
            (Reserved, Available),
            (Reserved, InRepair),
            (Issued, Available),
            (Rejected, InRepair),
            (Rejected, Scrapped),
            (Rejected, Shipped),
            (InRepair, Available),
            (InRepair, Scrapped),
        ];
        for (a, b) in legal {
            assert!(a.can_transition_to(*b), "expected {:?} -> {:?} legal", a, b);
        }
    }

    #[test]
    fn illegal_transitions_are_rejected() {
        use StockUnitStatus::*;
        let illegal: &[(StockUnitStatus, StockUnitStatus)] = &[
            // Receiving inspection cannot be skipped.
            (Quarantine, Issued),
            (Quarantine, Reserved),
            (Quarantine, Shipped),
            // Scrapped stock is destroyed; it never returns to inventory.
            (Scrapped, Available),
            (Scrapped, InRepair),
            // Shipped stock has left the building.
            (Shipped, Available),
            // Archival is one-way.
            (Archived, Available),
            (Archived, Quarantine),
            // A unit cannot transition to the state it already holds.
            (Available, Available),
            (Quarantine, Quarantine),
        ];
        for (a, b) in illegal {
            assert!(
                !a.can_transition_to(*b),
                "expected {:?} -> {:?} illegal",
                a,
                b
            );
        }
    }

    #[test]
    fn terminal_states_are_marked_terminal() {
        use StockUnitStatus::*;
        for state in [Issued, Shipped, Scrapped, Archived] {
            assert!(state.is_terminal(), "{:?} should be terminal", state);
        }
        for state in [Quarantine, Available, Reserved, Rejected, InRepair] {
            assert!(!state.is_terminal(), "{:?} should not be terminal", state);
        }
    }

    #[test]
    fn status_strings_round_trip_through_the_database_vocabulary() {
        use StockUnitStatus::*;
        for state in [
            Quarantine, Available, Reserved, Issued, Rejected, InRepair, Shipped, Scrapped,
            Archived,
        ] {
            assert_eq!(
                StockUnitStatus::parse(state.as_str()),
                Some(state),
                "{:?} did not round trip",
                state
            );
        }
        assert_eq!(StockUnitStatus::parse("pending"), None);
    }
}
