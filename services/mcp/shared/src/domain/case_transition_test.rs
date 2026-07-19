//! Case transition policy tests. Only compiled in test mode.

#[cfg(test)]
mod tests {
    use crate::domain::case::CaseStatus;

    #[test]
    fn legal_transitions_match_the_locked_graph() {
        use CaseStatus::*;
        let legal: &[(CaseStatus, CaseStatus)] = &[
            (Draft, Open),
            (Draft, Cancelled),
            (Open, Triage),
            (Open, Cancelled),
            (Triage, Diagnosing),
            (Triage, Cancelled),
            (Diagnosing, Planning),
            (Diagnosing, Cancelled),
            (Planning, AwaitingParts),
            (Planning, Scheduled),
            (Planning, Cancelled),
            (AwaitingParts, Scheduled),
            (AwaitingParts, Cancelled),
            (Scheduled, InWork),
            (Scheduled, Cancelled),
            (InWork, AwaitingInspection),
            (InWork, Cancelled),
            (AwaitingInspection, AwaitingApproval),
            (AwaitingInspection, InWork),
            (AwaitingApproval, Closed),
            (AwaitingApproval, InWork),
        ];
        for (a, b) in legal {
            assert!(a.can_transition_to(*b), "expected {:?} -> {:?} legal", a, b);
        }
    }

    #[test]
    fn illegal_transitions_are_rejected() {
        use CaseStatus::*;
        let illegal: &[(CaseStatus, CaseStatus)] = &[
            (Draft, Closed),
            (Open, Closed),
            (Triage, InWork),
            (Closed, Open),
            (Cancelled, Open),
            (AwaitingApproval, Draft),
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
}
