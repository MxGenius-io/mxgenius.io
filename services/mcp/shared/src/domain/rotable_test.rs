//! Rotable policy tests. Only compiled in test mode.

#[cfg(test)]
mod tests {
    use crate::domain::rotable::*;

    #[test]
    fn a_contradictory_pairing_names_the_field_to_fix() {
        use RotableStatus::*;
        // Each contradiction must say which of the two fields to change,
        // because the caller cannot tell which one the system objected to.
        let in_stock =
            status_aircraft_contradiction(InStock, Some("N441TT")).expect("contradiction");
        assert!(in_stock.contains("installed") && in_stock.contains("clear the aircraft"));

        let scrapped =
            status_aircraft_contradiction(Scrapped, Some("N441TT")).expect("contradiction");
        assert!(scrapped.contains("clear the aircraft"));

        let installed = status_aircraft_contradiction(Installed, None).expect("contradiction");
        assert!(installed.contains("set the aircraft"));
    }

    #[test]
    fn a_coherent_pairing_is_accepted() {
        use RotableStatus::*;
        assert!(status_aircraft_contradiction(InStock, None).is_none());
        assert!(status_aircraft_contradiction(Installed, Some("N441TT")).is_none());
        assert!(status_aircraft_contradiction(Scrapped, None).is_none());
        // Whitespace is not an aircraft.
        assert!(status_aircraft_contradiction(InStock, Some("   ")).is_none());
        assert!(status_aircraft_contradiction(Installed, Some("  ")).is_some());
    }

    #[test]
    fn a_unit_away_from_the_shop_may_still_name_the_tail_it_came_off() {
        use RotableStatus::*;
        // This is often the only way to find the unit again, so it is
        // deliberately not treated as a contradiction in either direction.
        for status in [InRepair, InTransit, OnLoan] {
            assert!(
                status_aircraft_contradiction(status, Some("N441TT")).is_none(),
                "{status:?}"
            );
            assert!(
                status_aircraft_contradiction(status, None).is_none(),
                "{status:?}"
            );
        }
    }

    #[test]
    fn coherence_is_only_judged_when_the_caller_touched_the_pairing() {
        // Legacy rows are already contradictory. Judging unconditionally
        // rejects a notes-only edit because of data the user never entered.
        assert!(!edit_touches_pairing(false, false));
        assert!(edit_touches_pairing(true, false));
        assert!(edit_touches_pairing(false, true));
        assert!(edit_touches_pairing(true, true));
    }

    #[test]
    fn every_retirement_blocker_explains_itself() {
        use RetirementBlocker::*;
        for blocker in [CoreDue, OpenCannibalization, OpenWarrantyClaim] {
            let message = blocker.message();
            assert!(!message.is_empty());
            assert!(
                message.contains("still"),
                "a blocker must say the obligation is outstanding: {message}"
            );
        }
    }

    #[test]
    fn only_unsettled_obligations_block_retirement() {
        // A denied, credited, or closed claim is settled; the rest are money
        // still in flight and must not be retired out from under.
        assert!(OPEN_WARRANTY_STATUSES.contains(&"open"));
        assert!(OPEN_WARRANTY_STATUSES.contains(&"submitted"));
        assert!(OPEN_WARRANTY_STATUSES.contains(&"approved"));
        for settled in ["denied", "credited", "closed"] {
            assert!(
                !OPEN_WARRANTY_STATUSES.contains(&settled),
                "{settled} is settled"
            );
        }
        // A returned, waived, or billed core is no longer owed.
        assert!(OPEN_CORE_STATUSES.contains(&"due"));
        for settled in ["returned", "waived", "billed"] {
            assert!(
                !OPEN_CORE_STATUSES.contains(&settled),
                "{settled} is settled"
            );
        }
        // A completed, rejected, or cancelled rob is finished.
        assert!(OPEN_CANNIBALIZATION_STATUSES.contains(&"proposed"));
        assert!(OPEN_CANNIBALIZATION_STATUSES.contains(&"approved"));
        for settled in ["completed", "rejected", "cancelled"] {
            assert!(
                !OPEN_CANNIBALIZATION_STATUSES.contains(&settled),
                "{settled} is finished"
            );
        }
    }

    #[test]
    fn the_retirement_stamp_reads_first_and_keeps_the_history() {
        let note = retirement_note(
            "Beyond economic repair after second shop visit",
            "quality@example.io",
            "2026-08-22 14:05",
            Some("Removed from N441TT at 4200 hours."),
        );
        assert!(note.starts_with("[RETIRED 2026-08-22 14:05 UTC by quality@example.io]"));
        assert!(note.contains("Beyond economic repair"));
        // Existing notes survive verbatim underneath rather than being replaced.
        assert!(note.contains("Removed from N441TT at 4200 hours."));
        assert!(note.find("[RETIRED").unwrap() < note.find("Removed from").unwrap());
    }

    #[test]
    fn a_unit_with_no_prior_notes_gets_only_the_stamp() {
        let note = retirement_note("Scrapped", "q@x.io", "2026-08-22 14:05", None);
        assert_eq!(note, "[RETIRED 2026-08-22 14:05 UTC by q@x.io] Scrapped");
        // Whitespace-only history is not worth a blank line either.
        let blank = retirement_note("Scrapped", "q@x.io", "2026-08-22 14:05", Some("   "));
        assert_eq!(blank, note);
    }

    #[test]
    fn statuses_round_trip_and_reject_unknown_values() {
        use RotableStatus::*;
        for status in [InStock, Installed, InRepair, InTransit, OnLoan, Scrapped] {
            assert_eq!(RotableStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(RotableStatus::parse("IN_STOCK"), None);
        assert_eq!(RotableStatus::parse("retired"), None);
    }

    #[test]
    fn the_reason_bound_leaves_room_for_the_history_beneath_it() {
        const { assert!(MAX_RETIREMENT_REASON >= 200) };
        const { assert!(MAX_RETIREMENT_REASON <= 1000) };
    }
}
