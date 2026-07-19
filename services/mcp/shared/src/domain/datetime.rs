//! `UtcDateTime` — a wire-friendly newtype around `time::OffsetDateTime`.
//!
//! Why a newtype: `schemars` 0.8 does not ship a `time` feature, and the
//! orphan rule blocks us from implementing `JsonSchema` for the foreign
//! `OffsetDateTime` directly. Wrapping it in a local newtype lets us emit
//! the canonical RFC 3339 `date-time` JSON Schema and round-trip through
//! serde as a string when needed, while keeping the underlying type for
//! arithmetic and formatting inside the domain layer.

use std::fmt;
use std::ops::{Add, Sub};

use schemars::gen::SchemaGenerator;
use schemars::schema::{InstanceType, Schema, SchemaObject};
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// A canonical UTC datetime at the wire boundary. Inside the domain layer we
/// use the wrapped `OffsetDateTime` for arithmetic and conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UtcDateTime(pub OffsetDateTime);

impl Serialize for UtcDateTime {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_rfc3339())
    }
}

impl<'de> Deserialize<'de> for UtcDateTime {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::from_rfc3339(&value).map_err(serde::de::Error::custom)
    }
}

impl UtcDateTime {
    pub fn now() -> Self {
        Self(OffsetDateTime::now_utc())
    }
    pub fn from_unix(secs: i64) -> Result<Self, time::error::ComponentRange> {
        Ok(Self(OffsetDateTime::from_unix_timestamp(secs)?))
    }
    pub fn to_rfc3339(&self) -> String {
        self.0.format(&Rfc3339).unwrap_or_else(|_| String::new())
    }
    pub fn inner(&self) -> OffsetDateTime {
        self.0
    }
    pub fn into_inner(self) -> OffsetDateTime {
        self.0
    }
    pub fn from_rfc3339(s: &str) -> Result<Self, time::error::Parse> {
        Ok(Self(OffsetDateTime::parse(s, &Rfc3339)?))
    }
}

impl Default for UtcDateTime {
    fn default() -> Self {
        Self::now()
    }
}

impl fmt::Display for UtcDateTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_rfc3339())
    }
}

impl From<OffsetDateTime> for UtcDateTime {
    fn from(v: OffsetDateTime) -> Self {
        Self(v)
    }
}
impl From<UtcDateTime> for OffsetDateTime {
    fn from(v: UtcDateTime) -> Self {
        v.0
    }
}

impl Add<time::Duration> for UtcDateTime {
    type Output = Self;
    fn add(self, rhs: time::Duration) -> Self {
        Self(self.0 + rhs)
    }
}
impl Sub<time::Duration> for UtcDateTime {
    type Output = Self;
    fn sub(self, rhs: time::Duration) -> Self {
        Self(self.0 - rhs)
    }
}

impl JsonSchema for UtcDateTime {
    fn schema_name() -> String {
        "UtcDateTime".into()
    }
    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        SchemaObject {
            instance_type: Some(InstanceType::String.into()),
            format: Some("date-time".into()),
            ..Default::default()
        }
        .into()
    }
}

/// Same wrapper for the `time::Date` calendar date. Used by document
/// revision effective dates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct IsoDate(pub time::Date);

impl Serialize for IsoDate {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for IsoDate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let format = time::macros::format_description!("[year]-[month]-[day]");
        time::Date::parse(&value, format)
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}

impl IsoDate {
    pub fn inner(&self) -> time::Date {
        self.0
    }
    pub fn from_calendar(
        year: i32,
        month: u8,
        day: u8,
    ) -> Result<Self, time::error::ComponentRange> {
        let d = time::Date::from_calendar_date(year, time::Month::try_from(month)?, day)?;
        Ok(Self(d))
    }
}

impl JsonSchema for IsoDate {
    fn schema_name() -> String {
        "IsoDate".into()
    }
    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        SchemaObject {
            instance_type: Some(InstanceType::String.into()),
            format: Some("date".into()),
            ..Default::default()
        }
        .into()
    }
}

impl fmt::Display for IsoDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = self
            .0
            .format(&time::format_description::well_known::Iso8601::DATE)
            .map_err(|_| fmt::Error)?;
        f.write_str(&s)
    }
}

#[cfg(test)]
mod tests {
    use super::{IsoDate, UtcDateTime};

    #[test]
    fn datetime_wire_formats_match_the_published_json_schema() {
        let datetime: UtcDateTime =
            serde_json::from_str("\"2026-07-19T08:00:00Z\"").expect("RFC 3339 datetime");
        assert_eq!(
            serde_json::to_string(&datetime).unwrap(),
            "\"2026-07-19T08:00:00Z\""
        );

        let date: IsoDate = serde_json::from_str("\"2026-07-19\"").expect("ISO date");
        assert_eq!(serde_json::to_string(&date).unwrap(), "\"2026-07-19\"");
    }
}
