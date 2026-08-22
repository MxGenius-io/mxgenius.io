//! Part request policy tests. Only compiled in test mode.
//!
//! The overdue cases below are the shared case table. The in-memory surface is
//! asserted against it here; the SQL surface is asserted to be the single
//! published constant, so the two cannot drift the way they did in the system
//! this design came from.

#[cfg(test)]
mod tests {
    use crate::domain::part_request::*;
    use time::macros::datetime;
    use time::OffsetDateTime;

    /// `(need_by, status, as_of, expected_overdue, expected_days)`
    type OverdueCase = (
        Option<OffsetDateTime>,
        &'static str,
        OffsetDateTime,
        bool,
        Option<i64>,
    );

    fn overdue_cases() -> Vec<OverdueCase> {
        let now = datetime!(2026-08-20 14:30:00 UTC);
        vec![
            // No need-by cannot be evaluated.
            (None, "requested", now, false, None),
            // Future need-by is not overdue.
            (
                Some(datetime!(2026-08-25 00:00:00 UTC)),
                "requested",
                now,
                false,
                None,
            ),
            // Yesterday reads one whole day, never zero because of clock time.
            (
                Some(datetime!(2026-08-19 23:59:00 UTC)),
                "requested",
                now,
                true,
                Some(1),
            ),
            // Due today is NOT overdue until tomorrow, whatever the time of day.
            (
                Some(datetime!(2026-08-20 00:00:01 UTC)),
                "requested",
                now,
                false,
                None,
            ),
            (
                Some(datetime!(2026-08-20 23:59:59 UTC)),
                "requested",
                now,
                false,
                None,
            ),
            // Day arithmetic across a clock-time boundary.
            (
                Some(datetime!(2026-08-10 23:00:00 UTC)),
                "ordered",
                now,
                true,
                Some(10),
            ),
            (
                Some(datetime!(2026-08-10 01:00:00 UTC)),
                "sourced",
                now,
                true,
                Some(10),
            ),
            // Every settled status is never overdue, however far past its need-by.
            (
                Some(datetime!(2020-01-01 00:00:00 UTC)),
                "received",
                now,
                false,
                None,
            ),
            (
                Some(datetime!(2020-01-01 00:00:00 UTC)),
                "installed",
                now,
                false,
                None,
            ),
            (
                Some(datetime!(2020-01-01 00:00:00 UTC)),
                "cancelled",
                now,
                false,
                None,
            ),
            // Live statuses past their need-by are overdue.
            (
                Some(datetime!(2026-08-01 00:00:00 UTC)),
                "requested",
                now,
                true,
                Some(19),
            ),
            (
                Some(datetime!(2026-08-01 00:00:00 UTC)),
                "sourced",
                now,
                true,
                Some(19),
            ),
            (
                Some(datetime!(2026-08-01 00:00:00 UTC)),
                "ordered",
                now,
                true,
                Some(19),
            ),
        ]
    }

    #[test]
    fn in_memory_overdue_matches_the_case_table() {
        for (need_by, status, as_of, expected, expected_days) in overdue_cases() {
            assert_eq!(
                is_overdue(need_by, status, as_of),
                expected,
                "is_overdue({need_by:?}, {status}, {as_of})"
            );
            assert_eq!(
                days_overdue(need_by, status, as_of),
                expected_days,
                "days_overdue({need_by:?}, {status}, {as_of})"
            );
        }
    }

    #[test]
    fn the_sql_surface_agrees_with_the_in_memory_surface_by_construction() {
        // Both surfaces must exclude exactly the settled statuses, compare on
        // the date component, and treat a null need-by as not overdue. The SQL
        // text is asserted here so a hand-edited predicate in a query cannot
        // silently disagree with the function above.
        for status in SETTLED_STATUSES {
            assert!(
                OVERDUE_SQL_PREDICATE.contains(&format!("'{status}'")),
                "SQL predicate must exclude the settled status {status}"
            );
            assert!(
                !is_overdue(
                    Some(datetime!(2000-01-01 00:00:00 UTC)),
                    status,
                    datetime!(2026-08-20 00:00:00 UTC)
                ),
                "in-memory surface must exclude the settled status {status}"
            );
        }
        assert!(
            OVERDUE_SQL_PREDICATE.contains("::date <"),
            "SQL predicate must compare on the date component, not the instant"
        );
        assert!(
            OVERDUE_SQL_PREDICATE.contains("IS NOT NULL"),
            "SQL predicate must treat a null need-by as not overdue"
        );
        assert_eq!(SETTLED_STATUSES.len(), 3);
    }

    #[test]
    fn both_sides_of_the_sql_date_comparison_are_pinned_to_utc() {
        // A bare `required_by::date` casts in the session TimeZone. Against a
        // session west of UTC that lands on the previous calendar day while
        // `now()` is evaluated in UTC, so a request due today reads as one day
        // overdue. Both sides must name the zone explicitly.
        let utc_casts = OVERDUE_SQL_PREDICATE.matches("AT TIME ZONE 'utc'").count();
        assert_eq!(
            utc_casts, 2,
            "both the need-by and the as-of side must be pinned to UTC: {OVERDUE_SQL_PREDICATE}"
        );
        assert!(
            !OVERDUE_SQL_PREDICATE.contains("pr.required_by::date"),
            "an unqualified ::date cast uses the session timezone"
        );
    }

    #[test]
    fn a_live_request_without_a_need_by_is_surfaced_separately() {
        assert!(is_missing_need_by(None, "requested"));
        assert!(is_missing_need_by(None, "ordered"));
        // Settled work does not need a date, so it is not part of the backlog.
        for status in SETTLED_STATUSES {
            assert!(!is_missing_need_by(None, status));
        }
        // Having a date is the point; it is not "missing" whatever the date.
        assert!(!is_missing_need_by(
            Some(datetime!(2020-01-01 00:00:00 UTC)),
            "requested"
        ));
        for status in SETTLED_STATUSES {
            assert!(MISSING_NEED_BY_SQL_PREDICATE.contains(&format!("'{status}'")));
        }
    }

    #[test]
    fn request_statuses_round_trip_and_reject_unknown_values() {
        use PartRequestStatus::*;
        for status in [Requested, Sourced, Ordered, Received, Installed, Cancelled] {
            assert_eq!(PartRequestStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(PartRequestStatus::parse("REQUESTED"), None);
        assert_eq!(PartRequestStatus::parse("in_progress"), None);
    }

    #[test]
    fn only_an_unfulfilled_request_is_advanced_by_placing_an_order() {
        use PartRequestStatus::*;
        assert!(Requested.is_open_to_ordering());
        assert!(Sourced.is_open_to_ordering());
        for status in [Ordered, Received, Installed, Cancelled] {
            assert!(
                !status.is_open_to_ordering(),
                "{status:?} must not be fast-forwarded by a placed order"
            );
        }
    }

    #[test]
    fn order_transitions_match_the_locked_graph() {
        use PartOrderStatus::*;
        let legal = [
            (Draft, Placed),
            (Draft, Cancelled),
            (Placed, Confirmed),
            (Placed, Cancelled),
            (Confirmed, Cancelled),
        ];
        for (a, b) in legal {
            assert!(a.can_transition_to(b), "expected {a:?} -> {b:?} legal");
        }

        let illegal = [
            // Procurement is directional; a placed order never becomes a draft.
            (Placed, Draft),
            (Confirmed, Draft),
            (Confirmed, Placed),
            // Cancellation is terminal.
            (Cancelled, Draft),
            (Cancelled, Placed),
            (Cancelled, Confirmed),
            // Skipping placement loses the supplier commitment.
            (Draft, Confirmed),
            // Self-transitions are not changes.
            (Draft, Draft),
            (Placed, Placed),
        ];
        for (a, b) in illegal {
            assert!(!a.can_transition_to(b), "expected {a:?} -> {b:?} illegal");
        }
    }

    #[test]
    fn priority_orders_aog_first() {
        use PartRequestPriority::*;
        assert!(Aog.queue_rank() < ScheduledMx.queue_rank());
        assert!(ScheduledMx.queue_rank() < Stock.queue_rank());
        for priority in [Aog, ScheduledMx, Stock] {
            assert_eq!(
                PartRequestPriority::parse(priority.as_str()),
                Some(priority)
            );
        }
        assert_eq!(PartRequestPriority::parse("critical"), None);
        assert_eq!(PartRequestPriority::parse("normal"), None);
    }

    #[test]
    fn only_exchange_and_repair_can_leave_a_core_behind() {
        use TypeOfBuy::*;
        assert!(Exchange.owes_core());
        assert!(Repair.owes_core());
        assert!(!Outright.owes_core());
        assert!(!Loan.owes_core());
        for kind in [Outright, Exchange, Repair, Loan] {
            assert_eq!(TypeOfBuy::parse(kind.as_str()), Some(kind));
        }
    }
}
