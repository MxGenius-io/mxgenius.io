//! Cannibalization policy tests. Only compiled in test mode.
//!
//! A rob is an airworthiness claim, so every gate below corresponds to a way
//! the record could otherwise assert something untrue about a part fitted to
//! a flying aircraft.

#[cfg(test)]
mod tests {
    use crate::domain::cannibalization::*;
    use uuid::Uuid;

    fn valid_facts<'a>(donor_ac: &'a str, receiver_ac: &'a str) -> CompletionFacts<'a> {
        CompletionFacts {
            donor_event_exists: true,
            receiver_event_exists: true,
            donor_kind: Some("removal"),
            receiver_kind: Some("install"),
            donor_removal_reason: Some("cannibalized"),
            donor_rotable: None,
            receiver_rotable: None,
            donor_event_aircraft: Some(donor_ac),
            receiver_event_aircraft: Some(receiver_ac),
            claimed_donor_aircraft: Some(donor_ac),
            claimed_receiver_aircraft: Some(receiver_ac),
            donor_event_already_completed: false,
            receiver_event_already_completed: false,
        }
    }

    #[test]
    fn the_chain_only_moves_forward() {
        use CannibalizationStatus::*;
        for (a, b) in [
            (Proposed, Approved),
            (Proposed, Rejected),
            (Proposed, Cancelled),
            (Approved, Completed),
            (Approved, Cancelled),
        ] {
            assert!(a.can_transition_to(b), "expected {a:?} -> {b:?} legal");
        }
        for (a, b) in [
            // Approval cannot be skipped: completing straight from proposed
            // would mean a rob nobody blessed.
            (Proposed, Completed),
            // Terminal states are terminal.
            (Completed, Cancelled),
            (Completed, Approved),
            (Rejected, Approved),
            (Rejected, Proposed),
            (Cancelled, Proposed),
            // A decision is not reversed by re-deciding.
            (Approved, Rejected),
            (Approved, Proposed),
            (Proposed, Proposed),
        ] {
            assert!(!a.can_transition_to(b), "expected {a:?} -> {b:?} illegal");
        }
    }

    #[test]
    fn only_an_undecided_or_blessed_rob_blocks_retiring_the_unit() {
        use CannibalizationStatus::*;
        assert!(Proposed.is_open());
        assert!(Approved.is_open());
        for status in [Completed, Rejected, Cancelled] {
            assert!(!status.is_open(), "{status:?} is finished");
            assert!(status.is_terminal());
        }
    }

    #[test]
    fn a_proposal_must_say_what_was_taken_and_where_from() {
        // No identity at all.
        assert_eq!(
            proposal_problem(false, None, Some("N441TT"), false, Some("N908BX")),
            Some(ProposalProblem::NoIdentity)
        );
        assert_eq!(
            proposal_problem(false, Some("   "), Some("N441TT"), false, None),
            Some(ProposalProblem::NoIdentity)
        );
        // Either a rotable link or a serial satisfies identity.
        assert!(proposal_problem(true, None, Some("N441TT"), false, None).is_none());
        assert!(proposal_problem(false, Some("SN-1"), Some("N441TT"), false, None).is_none());

        // No donor.
        assert_eq!(
            proposal_problem(true, None, None, false, Some("N908BX")),
            Some(ProposalProblem::NoDonor)
        );
        // A donor event alone is enough.
        assert!(proposal_problem(true, None, None, true, None).is_none());
    }

    #[test]
    fn an_aircraft_cannot_rob_itself() {
        assert_eq!(
            proposal_problem(true, None, Some("N441TT"), false, Some("N441TT")),
            Some(ProposalProblem::SelfRob)
        );
        // Tail numbers are compared case-insensitively; the same aircraft
        // typed two ways is still the same aircraft.
        assert_eq!(
            proposal_problem(true, None, Some("n441tt"), false, Some("N441TT")),
            Some(ProposalProblem::SelfRob)
        );
        assert!(proposal_problem(true, None, Some("N441TT"), false, Some("N908BX")).is_none());
    }

    #[test]
    fn the_proposer_cannot_approve_their_own_rob() {
        assert!(violates_separation_of_duties("a@x.io", "a@x.io"));
        assert!(!violates_separation_of_duties("a@x.io", "b@x.io"));
    }

    #[test]
    fn a_life_limited_rob_records_the_life_that_crossed_the_boundary() {
        // Hours or cycles; either satisfies it, because different part
        // families are limited on different clocks.
        assert!(life_transfer_missing(true, None, None));
        assert!(!life_transfer_missing(true, Some(1200.5), None));
        assert!(!life_transfer_missing(true, None, Some(830)));
        assert!(!life_transfer_missing(true, Some(1200.5), Some(830)));
        // A part with no life limit needs none of this.
        assert!(!life_transfer_missing(false, None, None));
    }

    #[test]
    fn a_completion_needs_both_real_events() {
        let mut facts = valid_facts("N441TT", "N908BX");
        assert!(completion_problem(&facts).is_none());

        facts.donor_event_exists = false;
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::DonorEventMissing)
        );

        let mut facts = valid_facts("N441TT", "N908BX");
        facts.receiver_event_exists = false;
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::ReceiverEventMissing)
        );
    }

    #[test]
    fn the_events_must_be_the_right_way_round() {
        let mut facts = valid_facts("N441TT", "N908BX");
        facts.donor_kind = Some("install");
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::DonorNotRemoval)
        );

        let mut facts = valid_facts("N441TT", "N908BX");
        facts.receiver_kind = Some("removal");
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::ReceiverNotInstall)
        );
    }

    #[test]
    fn an_ordinary_removal_is_not_a_rob() {
        // This is the gate that keeps the cannibalization register honest: a
        // scheduled removal reused as a donor would let any part swap be
        // relabelled a rob after the fact.
        for reason in ["scheduled", "unscheduled", "repair"] {
            let mut facts = valid_facts("N441TT", "N908BX");
            facts.donor_removal_reason = Some(reason);
            assert_eq!(
                completion_problem(&facts),
                Some(CompletionProblem::DonorReasonNotCannibalized),
                "a {reason} removal must not complete a rob"
            );
        }
    }

    #[test]
    fn the_two_events_must_describe_one_part() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let mut facts = valid_facts("N441TT", "N908BX");
        facts.donor_rotable = Some(a);
        facts.receiver_rotable = Some(b);
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::RotableMismatch)
        );

        // Same unit is fine.
        facts.receiver_rotable = Some(a);
        assert!(completion_problem(&facts).is_none());

        // A rob of an untracked part is still a rob, so a missing link on
        // either side is not a mismatch.
        let mut facts = valid_facts("N441TT", "N908BX");
        facts.donor_rotable = Some(a);
        facts.receiver_rotable = None;
        assert!(completion_problem(&facts).is_none());
    }

    #[test]
    fn the_events_must_have_happened_on_the_tails_the_rob_names() {
        let mut facts = valid_facts("N441TT", "N908BX");
        facts.donor_event_aircraft = Some("N999ZZ");
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::DonorAircraftMismatch)
        );

        let mut facts = valid_facts("N441TT", "N908BX");
        facts.receiver_event_aircraft = Some("N999ZZ");
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::ReceiverAircraftMismatch)
        );

        // Case differences in a tail number are not a mismatch.
        let mut facts = valid_facts("N441TT", "N908BX");
        facts.donor_event_aircraft = Some("n441tt");
        assert!(completion_problem(&facts).is_none());
    }

    #[test]
    fn one_event_cannot_complete_two_robs() {
        // Without this the same removal could be the donor side of two
        // completed cannibalizations and the lineage would fork.
        let mut facts = valid_facts("N441TT", "N908BX");
        facts.donor_event_already_completed = true;
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::DonorEventAlreadyUsed)
        );

        let mut facts = valid_facts("N441TT", "N908BX");
        facts.receiver_event_already_completed = true;
        assert_eq!(
            completion_problem(&facts),
            Some(CompletionProblem::ReceiverEventAlreadyUsed)
        );
    }

    #[test]
    fn every_problem_explains_itself_to_the_person_who_hit_it() {
        use CompletionProblem::*;
        for problem in [
            DonorEventMissing,
            ReceiverEventMissing,
            DonorNotRemoval,
            ReceiverNotInstall,
            DonorReasonNotCannibalized,
            RotableMismatch,
            DonorAircraftMismatch,
            ReceiverAircraftMismatch,
            DonorEventAlreadyUsed,
            ReceiverEventAlreadyUsed,
        ] {
            let message = problem.message();
            assert!(message.len() > 20, "{problem:?} needs a real explanation");
            assert!(
                !message.contains("invalid"),
                "{problem:?} should say what is wrong, not just that something is"
            );
        }
        for problem in [
            ProposalProblem::NoIdentity,
            ProposalProblem::NoDonor,
            ProposalProblem::SelfRob,
        ] {
            assert!(problem.message().len() > 15);
        }
    }

    #[test]
    fn statuses_round_trip_and_reject_unknown_values() {
        use CannibalizationStatus::*;
        for status in [Proposed, Approved, Rejected, Completed, Cancelled] {
            assert_eq!(CannibalizationStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(CannibalizationStatus::parse("PROPOSED"), None);
        assert_eq!(CannibalizationStatus::parse("robbed"), None);
    }
}
