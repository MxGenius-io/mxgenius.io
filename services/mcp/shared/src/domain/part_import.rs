//! Bulk import of parts and stock: the column contract, row validation, and
//! what the preview reports.
//!
//! Everything here is pure, so the rules that decide whether a file is
//! acceptable can be tested without a database and cannot drift between the
//! preview and the apply — both call the same functions over the same rows.

use serde::{Deserialize, Serialize};

use crate::domain::part_trace::TraceType;

/// The column contract, in order. One definition drives the parser, the
/// validator, and the exporter, so an exported file is always a valid import
/// template rather than something that merely resembles one.
pub const IMPORT_COLUMNS: [&str; 13] = [
    "part_number",
    "description",
    "manufacturer",
    "classification",
    "is_serialized",
    "location_code",
    "quantity",
    "condition_code",
    "serial_number",
    "lot_number",
    "trace_type",
    "certificate_number",
    "owner_type",
];

pub const CLASSIFICATIONS: [&str; 4] = ["rotable", "repairable", "expendable", "consumable"];
pub const CONDITION_CODES: [&str; 8] = ["NE", "NS", "OH", "SV", "RP", "AR", "US", "SC"];
pub const OWNER_TYPES: [&str; 5] = [
    "owned",
    "customer",
    "consignment",
    "exchange_core",
    "loaner",
];

/// How an upload is allowed to touch parts that already exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Creates only. A row naming a part that already exists is a conflict and
    /// the file is refused. The default, because the common accident is a
    /// stock load quietly rewriting catalog data nobody meant to touch.
    #[default]
    AddOnly,
    /// Non-empty cells overwrite; empty cells leave the existing value alone.
    AddAndUpdate,
}

impl ImportMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ImportMode::AddOnly => "add_only",
            ImportMode::AddAndUpdate => "add_and_update",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "add_only" => Some(ImportMode::AddOnly),
            "add_and_update" => Some(ImportMode::AddAndUpdate),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportFormat {
    Csv,
    Xlsx,
}

impl ImportFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            ImportFormat::Csv => "csv",
            ImportFormat::Xlsx => "xlsx",
        }
    }

    /// Chooses a reader from the declared content type, falling back to the
    /// filename when a browser sends something unhelpfully generic.
    pub fn detect(content_type: Option<&str>, file_name: Option<&str>) -> Option<Self> {
        let media = content_type.map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or(value)
                .trim()
                .to_ascii_lowercase()
        });
        match media.as_deref() {
            Some("text/csv") | Some("application/csv") => return Some(ImportFormat::Csv),
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            | Some("application/vnd.ms-excel") => return Some(ImportFormat::Xlsx),
            _ => {}
        }
        let name = file_name?.to_ascii_lowercase();
        if name.ends_with(".csv") {
            Some(ImportFormat::Csv)
        } else if name.ends_with(".xlsx") {
            Some(ImportFormat::Xlsx)
        } else {
            None
        }
    }
}

/// The cell held something that is not a yes or a no.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotABoolean;

/// Parses the spreadsheet notion of a boolean. Empty means "not stated",
/// which is different from false: an empty cell in an update must leave the
/// existing value alone rather than setting it to false.
pub fn parse_bool(value: &str) -> Result<Option<bool>, NotABoolean> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" => Ok(None),
        "true" | "yes" | "y" | "1" | "x" => Ok(Some(true)),
        "false" | "no" | "n" | "0" => Ok(Some(false)),
        _ => Err(NotABoolean),
    }
}

/// One row as read off the sheet, before any interpretation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RawRow {
    pub part_number: String,
    pub description: String,
    pub manufacturer: String,
    pub classification: String,
    pub is_serialized: String,
    pub location_code: String,
    pub quantity: String,
    pub condition_code: String,
    pub serial_number: String,
    pub lot_number: String,
    pub trace_type: String,
    pub certificate_number: String,
    pub owner_type: String,
}

impl RawRow {
    /// Builds a row from cells in `IMPORT_COLUMNS` order. Short rows are
    /// padded, because a spreadsheet's trailing empty cells are frequently
    /// simply absent.
    pub fn from_cells(cells: &[String]) -> Self {
        let get = |index: usize| {
            cells
                .get(index)
                .map(|s| s.trim().to_owned())
                .unwrap_or_default()
        };
        Self {
            part_number: get(0),
            description: get(1),
            manufacturer: get(2),
            classification: get(3),
            is_serialized: get(4),
            location_code: get(5),
            quantity: get(6),
            condition_code: get(7),
            serial_number: get(8),
            lot_number: get(9),
            trace_type: get(10),
            certificate_number: get(11),
            owner_type: get(12),
        }
    }

    pub fn is_blank(&self) -> bool {
        self.part_number.is_empty()
            && self.description.is_empty()
            && self.manufacturer.is_empty()
            && self.location_code.is_empty()
            && self.quantity.is_empty()
            && self.serial_number.is_empty()
            && self.lot_number.is_empty()
    }
}

/// Why a row cannot be accepted. Each names the column at fault, because a
/// row number alone sends the operator hunting across thirteen columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "problem", content = "detail")]
pub enum RowProblem {
    PartNumberMissing,
    UnknownClassification(String),
    UnknownConditionCode(String),
    UnknownTraceType(String),
    UnknownOwnerType(String),
    UnparsableBoolean(String),
    UnparsableQuantity(String),
    NegativeQuantity(String),
    QuantityOutOfRange(String),
    LocationRequiredWithQuantity,
    SerialAndLot,
    SerializedQuantityNotOne(String),
}

/// Something worth telling the operator that does not stop the file applying.
///
/// The export doubles as the import template, so an exported file has to
/// re-import. It could not: a row carrying the ambiguous legacy `coc` trace
/// value was rejected outright, because a *new* record should say whose
/// certificate of conformance it is. Both rules were right and together they
/// broke the round trip. A note keeps them: the value survives, and it is
/// never silently blessed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RowNote {
    LegacyTraceType(String),
}

impl RowNote {
    pub fn message(&self) -> String {
        match self {
            Self::LegacyTraceType(v) => format!(
                "trace_type '{v}' is a legacy value with no recorded source; it is preserved as \
                 imported. Set a specific certificate source when you know it."
            ),
        }
    }
}

impl RowProblem {
    pub fn message(&self) -> String {
        use RowProblem::*;
        match self {
            PartNumberMissing => "part_number is required".into(),
            UnknownClassification(v) => format!(
                "classification '{v}' is not one of {}",
                CLASSIFICATIONS.join(", ")
            ),
            UnknownConditionCode(v) => format!(
                "condition_code '{v}' is not one of {}",
                CONDITION_CODES.join(", ")
            ),
            UnknownTraceType(v) => format!("trace_type '{v}' is not a document this system records"),
            QuantityOutOfRange(v) => format!(
                "quantity '{v}' does not fit a stock record: {}",
                crate::domain::quantity::quantity_problem(v.parse::<f64>().unwrap_or(f64::NAN))
                    .map(|problem| problem.message())
                    .unwrap_or_else(|| "out of range".into())
            ),
            UnknownOwnerType(v) => {
                format!("owner_type '{v}' is not one of {}", OWNER_TYPES.join(", "))
            }
            UnparsableBoolean(v) => {
                format!("is_serialized '{v}' is not a yes or no value")
            }
            UnparsableQuantity(v) => format!("quantity '{v}' is not a number"),
            NegativeQuantity(v) => format!("quantity '{v}' cannot be negative"),
            LocationRequiredWithQuantity => {
                "location_code is required when a quantity is given, because stock has to sit somewhere".into()
            }
            SerialAndLot => {
                "a physical item is identified by a serial number or a lot number, never both".into()
            }
            SerializedQuantityNotOne(v) => format!(
                "a serialized part is one physical item, so quantity must be 1, not {v}"
            ),
        }
    }
}

/// A validated row, with its cells interpreted.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRow {
    pub part_number: String,
    pub description: Option<String>,
    pub manufacturer: Option<String>,
    pub classification: Option<String>,
    pub is_serialized: Option<bool>,
    pub location_code: Option<String>,
    pub quantity: Option<f64>,
    pub condition_code: Option<String>,
    pub serial_number: Option<String>,
    pub lot_number: Option<String>,
    pub trace_type: Option<String>,
    pub certificate_number: Option<String>,
    pub owner_type: Option<String>,
    /// Non-blocking remarks about what was accepted, in the operator's terms.
    pub notes: Vec<RowNote>,
}

fn optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Checks one row and interprets it. Every problem found is returned, not just
/// the first, so an operator fixing a file sees the whole picture in one pass
/// instead of rediscovering it a row at a time.
pub fn validate_row(row: &RawRow) -> Result<ParsedRow, Vec<RowProblem>> {
    let mut problems = Vec::new();
    let mut notes: Vec<RowNote> = Vec::new();

    if row.part_number.trim().is_empty() {
        problems.push(RowProblem::PartNumberMissing);
    }

    let classification = optional(&row.classification);
    if let Some(value) = classification.as_deref() {
        if !CLASSIFICATIONS.contains(&value) {
            problems.push(RowProblem::UnknownClassification(value.to_owned()));
        }
    }

    let condition_code = optional(&row.condition_code);
    if let Some(value) = condition_code.as_deref() {
        if !CONDITION_CODES.contains(&value) {
            problems.push(RowProblem::UnknownConditionCode(value.to_owned()));
        }
    }

    // Reuses the assignable set, so a *new* record still cannot claim an
    // anonymous certificate of conformance. The one exception is the legacy
    // 'coc' an export may carry out of an existing row: refusing it made the
    // system's own template fail its own validation, so it is preserved and
    // noted rather than rejected or silently accepted.
    let trace_type = optional(&row.trace_type);
    if let Some(value) = trace_type.as_deref() {
        let assignable = TraceType::assignable()
            .iter()
            .any(|candidate| candidate.as_str() == value);
        if !assignable {
            if value == "coc" {
                notes.push(RowNote::LegacyTraceType(value.to_owned()));
            } else {
                problems.push(RowProblem::UnknownTraceType(value.to_owned()));
            }
        }
    }

    let owner_type = optional(&row.owner_type);
    if let Some(value) = owner_type.as_deref() {
        if !OWNER_TYPES.contains(&value) {
            problems.push(RowProblem::UnknownOwnerType(value.to_owned()));
        }
    }

    let is_serialized = match parse_bool(&row.is_serialized) {
        Ok(value) => value,
        Err(NotABoolean) => {
            problems.push(RowProblem::UnparsableBoolean(row.is_serialized.clone()));
            None
        }
    };

    let quantity = match optional(&row.quantity) {
        None => None,
        Some(raw) => match raw.parse::<f64>() {
            Err(_) => {
                problems.push(RowProblem::UnparsableQuantity(raw.clone()));
                None
            }
            Ok(value) if !value.is_finite() => {
                problems.push(RowProblem::UnparsableQuantity(raw.clone()));
                None
            }
            Ok(value) if value < 0.0 => {
                problems.push(RowProblem::NegativeQuantity(raw.clone()));
                None
            }
            // Zero means "catalog row, no stock" and is planned for
            // separately, so only a row that actually carries stock is
            // measured against the column's range. Without this a single
            // out-of-range cell failed inside the batch transaction and rolled
            // the whole import back as a 503, with no per-row diagnostic --
            // despite the preview existing to give exactly that.
            Ok(value)
                if value > 0.0 && crate::domain::quantity::quantity_problem(value).is_some() =>
            {
                problems.push(RowProblem::QuantityOutOfRange(raw.clone()));
                None
            }
            Ok(value) => Some(value),
        },
    };

    let location_code = optional(&row.location_code).map(|value| value.to_uppercase());
    let serial_number = optional(&row.serial_number);
    let lot_number = optional(&row.lot_number);

    if quantity.is_some_and(|value| value > 0.0) && location_code.is_none() {
        problems.push(RowProblem::LocationRequiredWithQuantity);
    }
    if serial_number.is_some() && lot_number.is_some() {
        problems.push(RowProblem::SerialAndLot);
    }
    // A serialized part is one physical item. Checked against whichever of the
    // two signals the row carries: the flag, or a serial number.
    let looks_serialized = is_serialized == Some(true) || serial_number.is_some();
    if looks_serialized {
        if let Some(value) = quantity {
            if (value - 1.0).abs() > f64::EPSILON {
                problems.push(RowProblem::SerializedQuantityNotOne(row.quantity.clone()));
            }
        }
    }

    if !problems.is_empty() {
        return Err(problems);
    }

    Ok(ParsedRow {
        part_number: row.part_number.trim().to_owned(),
        description: optional(&row.description),
        manufacturer: optional(&row.manufacturer),
        classification,
        is_serialized,
        location_code,
        quantity,
        condition_code,
        serial_number,
        lot_number,
        trace_type,
        certificate_number: optional(&row.certificate_number),
        owner_type,
        notes,
    })
}

/// What the preview says would happen to one row.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "outcome")]
pub enum RowPlan {
    /// A new catalog part, or new stock against an existing one.
    Create {
        creates_part: bool,
        creates_unit: bool,
    },
    /// An existing part whose fields this row would change.
    Update { changed_fields: Vec<String> },
    /// Nothing to do; typically an identical unit already on file.
    Skip { reason: String },
    /// The row is valid but not permitted in this mode.
    Conflict { reason: String },
}

impl RowPlan {
    pub fn is_blocking(&self) -> bool {
        matches!(self, RowPlan::Conflict { .. })
    }
}

/// Builds the CSV header line. Also the export header, so a round trip is
/// lossless by construction.
pub fn csv_header() -> String {
    IMPORT_COLUMNS.join(",")
}

/// Quotes one CSV field. Anything containing a comma, quote, or newline is
/// wrapped and its quotes doubled.
pub fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}
