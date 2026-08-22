//! Traceability policy tests. Only compiled in test mode.

#[cfg(test)]
mod tests {
    use crate::domain::part_trace::*;

    #[test]
    fn the_paperwork_vocabulary_covers_the_forms_a_shop_actually_receives() {
        use TraceType::*;
        // ATA 106 is the standard used-parts trace form and TSO is a real
        // authorization; both were missing before.
        assert_eq!(TraceType::parse("ata106"), Some(Ata106));
        assert_eq!(TraceType::parse("tso"), Some(Tso));
        // A conformance certificate from the manufacturer is worth more than
        // one from a vendor, so the two must be distinguishable.
        assert_eq!(TraceType::parse("coc_mfr"), Some(CocMfr));
        assert_eq!(TraceType::parse("coc_vendor"), Some(CocVendor));
        assert_ne!(CocMfr, CocVendor);

        for value in [
            Form8130,
            EasaForm1,
            Tso,
            DualRelease,
            Coc,
            CocMfr,
            CocVendor,
            Ata106,
            Teardown,
            None,
        ] {
            assert_eq!(TraceType::parse(value.as_str()), Some(value));
        }
        assert_eq!(TraceType::parse("napkin"), Option::None);
        assert_eq!(TraceType::parse("8130-3"), Option::None);
    }

    #[test]
    fn the_legacy_conformance_value_is_readable_but_never_offered() {
        // Rows captured before the split recorded a CoC without recording
        // whose it was. They stay valid, but nothing new should be created
        // that cannot say which kind it is.
        assert_eq!(TraceType::parse("coc"), Some(TraceType::Coc));
        assert!(
            !TraceType::assignable().contains(&TraceType::Coc),
            "the ambiguous legacy value must not be offered for new records"
        );
        assert_eq!(TraceType::assignable().len(), 9);
        for value in TraceType::assignable() {
            assert_eq!(TraceType::parse(value.as_str()), Some(value));
        }
    }

    #[test]
    fn only_a_release_document_is_marked_as_one() {
        use TraceType::*;
        for value in [Form8130, EasaForm1, DualRelease] {
            assert!(value.is_airworthiness_release(), "{value:?}");
        }
        // A trace form records custody, and a conformance certificate records
        // that a part matches a spec. Neither releases anything to service.
        for value in [Ata106, Teardown, Coc, CocMfr, CocVendor, Tso, None] {
            assert!(!value.is_airworthiness_release(), "{value:?}");
        }
    }

    #[test]
    fn a_confidently_read_field_is_taken_without_asking() {
        assert!(ocr_auto_acceptable(Some(0.99)));
        assert!(ocr_auto_acceptable(Some(OCR_AUTO_ACCEPT_CONFIDENCE)));
        assert!(!ocr_auto_acceptable(Some(
            OCR_AUTO_ACCEPT_CONFIDENCE - 0.01
        )));
        assert!(!ocr_auto_acceptable(Some(0.5)));
        // Absent evidence is not strong evidence.
        assert!(!ocr_auto_acceptable(Option::None));
    }

    #[test]
    fn identity_and_airworthiness_fields_always_get_a_human() {
        // Reading these wrong misidentifies the part or its provenance, which
        // is a different class of mistake from a mislabelled description.
        for field in OCR_ALWAYS_REVIEW_FIELDS {
            assert!(
                ocr_requires_review(field, Some(0.999)),
                "{field} must be reviewed however confident the read"
            );
        }
        // Everything else rides on confidence alone.
        assert!(!ocr_requires_review("partNumber", Some(0.95)));
        assert!(ocr_requires_review("partNumber", Some(0.60)));
        assert!(ocr_requires_review("description", Option::None));
    }

    #[test]
    fn the_auto_accept_bar_is_high_enough_to_trust_unattended() {
        // A mechanic in a headset cannot proofread comfortably, so this
        // threshold is the whole safety margin for a hands-free check-in.
        // A const block, so lowering the bar fails the build rather than a
        // test run: this threshold is the whole safety margin for a
        // hands-free check-in and should not be quietly relaxed.
        const {
            assert!(
                OCR_AUTO_ACCEPT_CONFIDENCE >= 0.85,
                "auto-accepting below 0.85 puts unreviewed data into inventory"
            )
        };
        const { assert!(OCR_AUTO_ACCEPT_CONFIDENCE <= 1.0) };
    }

    #[test]
    fn an_event_is_one_install_xor_one_removal() {
        assert_eq!(
            PartEventKind::parse("install"),
            Some(PartEventKind::Install)
        );
        assert_eq!(
            PartEventKind::parse("removal"),
            Some(PartEventKind::Removal)
        );
        // A swap is two rows. There is no combined kind, deliberately.
        assert_eq!(PartEventKind::parse("swap"), None);
        assert_eq!(PartEventKind::parse("exchange"), None);
    }

    #[test]
    fn only_a_removal_carries_a_reason() {
        assert!(PartEventKind::Removal.accepts_removal_reason());
        assert!(!PartEventKind::Install.accepts_removal_reason());
    }

    #[test]
    fn cannibalized_is_the_reason_a_rob_correlates_against() {
        use RemovalReason::*;
        assert_eq!(RemovalReason::parse("cannibalized"), Some(Cannibalized));
        for reason in [Scheduled, Unscheduled, Cannibalized, Repair] {
            assert_eq!(RemovalReason::parse(reason.as_str()), Some(reason));
        }
        assert_eq!(RemovalReason::parse("robbed"), None);
    }

    #[test]
    fn a_delivered_leg_must_record_when_it_landed() {
        use ShipmentStatus::*;
        assert!(Delivered.requires_received_at());
        for status in [Pending, InTransit, Exception] {
            assert!(!status.requires_received_at());
        }
    }

    #[test]
    fn shipment_transitions_allow_recovery_from_an_exception() {
        use ShipmentStatus::*;
        for (a, b) in [
            (Pending, InTransit),
            (Pending, Delivered),
            (Pending, Exception),
            (InTransit, Delivered),
            (InTransit, Exception),
            // An exception is a problem to resolve, not a dead end.
            (Exception, InTransit),
            (Exception, Delivered),
        ] {
            assert!(a.can_transition_to(b), "expected {a:?} -> {b:?} legal");
        }
        for (a, b) in [
            // Delivered is the fact; a leg does not un-arrive.
            (Delivered, InTransit),
            (Delivered, Pending),
            (Delivered, Exception),
            (InTransit, Pending),
            (Pending, Pending),
        ] {
            assert!(!a.can_transition_to(b), "expected {a:?} -> {b:?} illegal");
        }
    }

    #[test]
    fn shipment_purposes_separate_procurement_from_a_repair_round_trip() {
        use ShipmentPurpose::*;
        for purpose in [Procurement, RepairOut, RepairReturn, Transfer, Return] {
            assert_eq!(ShipmentPurpose::parse(purpose.as_str()), Some(purpose));
        }
        assert_ne!(RepairOut, RepairReturn);
        assert_eq!(ShipmentPurpose::parse("shipping"), None);
    }
}
