//! Import policy tests. Only compiled in test mode.
//!
//! These are the rules that decide whether a file is allowed to touch
//! inventory at all, so each one corresponds to a way a bad upload could
//! otherwise land silently.

#[cfg(test)]
mod tests {
    use crate::domain::part_import::*;

    fn row(cells: &[&str]) -> RawRow {
        RawRow::from_cells(&cells.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    /// A minimal acceptable row: a bulk consumable with a lot.
    fn good() -> RawRow {
        row(&[
            "AN960-10",
            "Washer, flat",
            "Acme",
            "consumable",
            "no",
            "STOCK-A1",
            "40",
            "NE",
            "",
            "LOT-1",
            "coc_mfr",
            "",
            "owned",
        ])
    }

    #[test]
    fn the_column_contract_is_one_definition() {
        assert_eq!(IMPORT_COLUMNS.len(), 13);
        // The exporter and the parser must agree, or a round trip silently
        // shifts every value one column left.
        assert_eq!(csv_header(), IMPORT_COLUMNS.join(","));
        assert_eq!(IMPORT_COLUMNS[0], "part_number");
        assert_eq!(IMPORT_COLUMNS[12], "owner_type");
    }

    #[test]
    fn a_well_formed_row_is_accepted_and_interpreted() {
        let parsed = validate_row(&good()).expect("row should be valid");
        assert_eq!(parsed.part_number, "AN960-10");
        assert_eq!(parsed.quantity, Some(40.0));
        assert_eq!(parsed.is_serialized, Some(false));
        assert_eq!(parsed.lot_number.as_deref(), Some("LOT-1"));
        assert_eq!(parsed.serial_number, None);
        // Location codes are normalised, so 'stock-a1' and 'STOCK-A1' are the
        // same shelf rather than two.
        assert_eq!(parsed.location_code.as_deref(), Some("STOCK-A1"));
    }

    #[test]
    fn a_part_number_is_the_one_thing_a_row_cannot_omit() {
        let mut r = good();
        r.part_number = "   ".into();
        let problems = validate_row(&r).unwrap_err();
        assert!(problems.contains(&RowProblem::PartNumberMissing));
    }

    #[test]
    fn every_vocabulary_is_checked_against_the_real_one() {
        let mut r = good();
        r.classification = "widget".into();
        r.condition_code = "MINT".into();
        r.owner_type = "borrowed".into();
        let problems = validate_row(&r).unwrap_err();
        assert!(problems.contains(&RowProblem::UnknownClassification("widget".into())));
        assert!(problems.contains(&RowProblem::UnknownConditionCode("MINT".into())));
        assert!(problems.contains(&RowProblem::UnknownOwnerType("borrowed".into())));
        // All three reported together: an operator fixing a file should see
        // the whole picture in one pass.
        assert_eq!(problems.len(), 3);
    }

    #[test]
    fn the_ambiguous_legacy_conformance_value_is_preserved_but_never_blessed() {
        // Historical rows may carry a bare 'coc', and the export writes it
        // back out, so refusing it outright made the system's own template
        // fail its own validation. It is preserved with a note instead: the
        // file applies, and nobody is told the certificate has a source.
        let mut r = good();
        r.trace_type = "coc".into();
        let parsed = validate_row(&r).expect("an exported legacy row must re-import");
        assert_eq!(parsed.trace_type.as_deref(), Some("coc"));
        assert!(
            parsed
                .notes
                .contains(&RowNote::LegacyTraceType("coc".into())),
            "the operator has to be told what was preserved"
        );

        // Every other unknown value is still a hard error: only the value the
        // export can actually emit is tolerated.
        let mut invented = good();
        invented.trace_type = "invented_tag".into();
        let problems = validate_row(&invented).unwrap_err();
        assert!(problems.contains(&RowProblem::UnknownTraceType("invented_tag".into())));

        // The specific ones are importable and carry no note.
        for value in ["coc_mfr", "coc_vendor", "ata106", "tso", "form_8130"] {
            let mut ok = good();
            ok.trace_type = value.into();
            let parsed = validate_row(&ok).expect("{value} should be importable");
            assert!(parsed.notes.is_empty(), "{value} needs no note");
        }
    }

    #[test]
    fn a_quantity_the_column_cannot_hold_is_a_row_problem_not_a_batch_failure() {
        // One bad cell used to fail inside the batch transaction and roll the
        // whole import back as a 503, with no per-row diagnostic.
        let mut r = good();
        r.quantity = "1000000000".into();
        let problems = validate_row(&r).unwrap_err();
        assert!(problems
            .iter()
            .any(|p| matches!(p, RowProblem::QuantityOutOfRange(_))));

        // Zero still means "catalog row, no stock" and must keep parsing.
        let mut catalog = good();
        catalog.quantity = "0".into();
        assert!(
            validate_row(&catalog).is_ok(),
            "a catalog row carries no stock"
        );
    }

    #[test]
    fn spreadsheet_booleans_are_read_the_way_people_write_them() {
        for truthy in ["true", "TRUE", "yes", "Y", "1", "x", "X"] {
            assert_eq!(parse_bool(truthy), Ok(Some(true)), "{truthy}");
        }
        for falsy in ["false", "No", "n", "0"] {
            assert_eq!(parse_bool(falsy), Ok(Some(false)), "{falsy}");
        }
        // Empty is "not stated", which is not the same as false: in an update
        // it must leave the existing value alone.
        assert_eq!(parse_bool(""), Ok(None));
        assert_eq!(parse_bool("   "), Ok(None));
        assert_eq!(parse_bool("maybe"), Err(NotABoolean));
    }

    #[test]
    fn quantity_must_be_a_real_non_negative_number() {
        let mut r = good();
        r.quantity = "lots".into();
        assert!(validate_row(&r)
            .unwrap_err()
            .contains(&RowProblem::UnparsableQuantity("lots".into())));

        let mut r = good();
        r.quantity = "-5".into();
        assert!(validate_row(&r)
            .unwrap_err()
            .contains(&RowProblem::NegativeQuantity("-5".into())));

        // Zero is legitimate: a catalog row with no stock behind it yet.
        let mut r = good();
        r.quantity = "0".into();
        r.location_code = "".into();
        r.lot_number = "".into();
        assert!(validate_row(&r).is_ok());
    }

    #[test]
    fn stock_has_to_sit_somewhere() {
        let mut r = good();
        r.location_code = "".into();
        assert!(validate_row(&r)
            .unwrap_err()
            .contains(&RowProblem::LocationRequiredWithQuantity));
    }

    #[test]
    fn a_physical_item_is_a_serial_or_a_lot_but_never_both() {
        let mut r = good();
        r.serial_number = "SN-1".into();
        r.lot_number = "LOT-1".into();
        r.quantity = "1".into();
        assert!(validate_row(&r)
            .unwrap_err()
            .contains(&RowProblem::SerialAndLot));
    }

    #[test]
    fn a_serialized_part_is_exactly_one_item() {
        // Stated by the flag.
        let mut r = good();
        r.is_serialized = "yes".into();
        r.lot_number = "".into();
        r.quantity = "6".into();
        assert!(validate_row(&r)
            .unwrap_err()
            .contains(&RowProblem::SerializedQuantityNotOne("6".into())));

        // Or implied by carrying a serial number, even when the flag is blank.
        let mut r = good();
        r.is_serialized = "".into();
        r.serial_number = "SN-1".into();
        r.lot_number = "".into();
        r.quantity = "3".into();
        assert!(validate_row(&r)
            .unwrap_err()
            .contains(&RowProblem::SerializedQuantityNotOne("3".into())));

        // One is fine.
        let mut r = good();
        r.is_serialized = "yes".into();
        r.serial_number = "SN-1".into();
        r.lot_number = "".into();
        r.quantity = "1".into();
        assert!(validate_row(&r).is_ok());
    }

    #[test]
    fn short_rows_are_padded_rather_than_shifted() {
        // A spreadsheet frequently omits trailing empty cells entirely. Padding
        // is what stops every value after a gap sliding one column left.
        let sparse = row(&["AN960-10", "Washer"]);
        assert_eq!(sparse.part_number, "AN960-10");
        assert_eq!(sparse.description, "Washer");
        assert_eq!(sparse.owner_type, "");
        assert_eq!(sparse.quantity, "");
        let parsed = validate_row(&sparse).expect("a catalog-only row is valid");
        assert_eq!(parsed.quantity, None);
    }

    #[test]
    fn a_blank_row_is_recognisable_so_it_can_be_ignored() {
        assert!(row(&["", "", ""]).is_blank());
        assert!(!good().is_blank());
    }

    #[test]
    fn add_only_is_the_default_mode() {
        // The common accident is a stock load quietly rewriting the catalog,
        // so the safe mode is the one you get without asking.
        assert_eq!(ImportMode::default(), ImportMode::AddOnly);
        assert_eq!(ImportMode::parse("add_only"), Some(ImportMode::AddOnly));
        assert_eq!(
            ImportMode::parse("add_and_update"),
            Some(ImportMode::AddAndUpdate)
        );
        assert_eq!(ImportMode::parse("overwrite"), None);
        assert_eq!(ImportMode::parse("ADD_ONLY"), None);
    }

    #[test]
    fn the_format_is_taken_from_the_content_type_then_the_filename() {
        assert_eq!(
            ImportFormat::detect(Some("text/csv"), None),
            Some(ImportFormat::Csv)
        );
        assert_eq!(
            ImportFormat::detect(Some("text/csv; charset=utf-8"), None),
            Some(ImportFormat::Csv)
        );
        assert_eq!(
            ImportFormat::detect(
                Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                None
            ),
            Some(ImportFormat::Xlsx)
        );
        // Browsers routinely send octet-stream; the filename decides then.
        assert_eq!(
            ImportFormat::detect(Some("application/octet-stream"), Some("stock.XLSX")),
            Some(ImportFormat::Xlsx)
        );
        assert_eq!(
            ImportFormat::detect(None, Some("stock.csv")),
            Some(ImportFormat::Csv)
        );
        assert_eq!(ImportFormat::detect(None, Some("stock.pdf")), None);
        assert_eq!(ImportFormat::detect(None, None), None);
    }

    #[test]
    fn only_a_conflict_stops_the_file() {
        assert!(RowPlan::Conflict {
            reason: "exists".into()
        }
        .is_blocking());
        assert!(!RowPlan::Create {
            creates_part: true,
            creates_unit: true
        }
        .is_blocking());
        assert!(!RowPlan::Update {
            changed_fields: vec!["description".into()]
        }
        .is_blocking());
        assert!(!RowPlan::Skip {
            reason: "identical".into()
        }
        .is_blocking());
    }

    #[test]
    fn csv_fields_survive_commas_quotes_and_newlines() {
        assert_eq!(csv_escape("plain"), "plain");
        assert_eq!(csv_escape("NUT, SELF-LOCKING"), "\"NUT, SELF-LOCKING\"");
        assert_eq!(csv_escape("6\" hose"), "\"6\"\" hose\"");
        assert_eq!(csv_escape("line\nbreak"), "\"line\nbreak\"");
    }

    #[test]
    fn every_problem_names_the_column_at_fault() {
        // A row number alone sends the operator hunting across 13 columns.
        let cases = vec![
            (RowProblem::PartNumberMissing, "part_number"),
            (
                RowProblem::UnknownClassification("x".into()),
                "classification",
            ),
            (
                RowProblem::UnknownConditionCode("x".into()),
                "condition_code",
            ),
            (RowProblem::UnknownTraceType("x".into()), "trace_type"),
            (RowProblem::UnknownOwnerType("x".into()), "owner_type"),
            (RowProblem::UnparsableBoolean("x".into()), "is_serialized"),
            (RowProblem::UnparsableQuantity("x".into()), "quantity"),
            (RowProblem::NegativeQuantity("x".into()), "quantity"),
            (RowProblem::LocationRequiredWithQuantity, "location_code"),
            (RowProblem::SerializedQuantityNotOne("2".into()), "quantity"),
        ];
        for (problem, column) in cases {
            assert!(
                problem.message().contains(column),
                "{problem:?} should name {column}: {}",
                problem.message()
            );
        }
        // The serial/lot rule names both columns it is about.
        let both = RowProblem::SerialAndLot.message();
        assert!(both.contains("serial") && both.contains("lot"));
    }
}
