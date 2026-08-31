//! Server-side paging for list endpoints.
//!
//! Published here once, as a single clamped request type and a single
//! response envelope, because the alternative is what this module replaces: a
//! bare `LIMIT 250` repeated across seven queries. A hard cap with no cursor,
//! no total, and no signal reads to the caller as "there are 250 of these"
//! rather than "there are more than we will tell you about", and the parts
//! request population is expected to run well past that.
//!
//! Two rules the callers depend on:
//!
//! - The total is counted over the same filtered set as the page, before the
//!   window is applied, so a pager can size itself honestly.
//! - Out-of-range and unparseable input clamps rather than errors. A stale
//!   bookmark on page 900 of a list that has shrunk should land on a valid
//!   page, not a 400.

use serde::{Deserialize, Deserializer, Serialize};

/// Deserialize an optional paging number leniently.
///
/// A page number reaches the server inside a URL, where it is as likely to be
/// a stale bookmark or a hand-edited string as a valid integer. Rejecting the
/// whole list request with a 400 because `?page=abc` will not parse serves
/// nobody: the caller wanted a list. Anything unparseable becomes `None` and
/// falls through to [`PageRequest::clamped`], which supplies the default.
///
/// Apply with `#[serde(default, deserialize_with = "lenient_page_number")]`.
pub fn lenient_page_number<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Number(i64),
        Text(String),
        Missing,
    }

    Ok(match Raw::deserialize(deserializer).unwrap_or(Raw::Missing) {
        Raw::Number(value) => Some(value),
        Raw::Text(value) => value.trim().parse::<i64>().ok(),
        Raw::Missing => None,
    })
}

/// A validated, clamped window over a list.
///
/// Construct with [`PageRequest::clamped`]; the fields are private so a
/// caller cannot hand SQL an unbounded or negative window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageRequest {
    page: i64,
    page_size: i64,
}

impl PageRequest {
    /// Rows per page when the caller does not ask for a size.
    pub const DEFAULT_PAGE_SIZE: i64 = 50;
    /// Ceiling on rows per page. A caller asking for more gets this.
    pub const MAX_PAGE_SIZE: i64 = 200;

    /// Clamp caller-supplied paging into a window that is always valid.
    ///
    /// `page` is one-based and floors at 1. `page_size` floors at 1 and caps
    /// at [`MAX_PAGE_SIZE`](Self::MAX_PAGE_SIZE). `None` on either side takes
    /// the default rather than removing the bound.
    pub fn clamped(page: Option<i64>, page_size: Option<i64>) -> Self {
        Self {
            page: page.unwrap_or(1).max(1),
            page_size: page_size
                .unwrap_or(Self::DEFAULT_PAGE_SIZE)
                .clamp(1, Self::MAX_PAGE_SIZE),
        }
    }

    /// The one-based page number.
    pub fn page(self) -> i64 {
        self.page
    }

    /// Rows per page.
    pub fn page_size(self) -> i64 {
        self.page_size
    }

    /// SQL `LIMIT`.
    pub fn limit(self) -> i64 {
        self.page_size
    }

    /// SQL `OFFSET`. Saturates rather than overflowing on an absurd page
    /// number, which a URL can always carry.
    pub fn offset(self) -> i64 {
        self.page.saturating_sub(1).saturating_mul(self.page_size)
    }
}

impl Default for PageRequest {
    fn default() -> Self {
        Self::clamped(None, None)
    }
}

/// One page of results plus what a pager needs to render itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub page: i64,
    pub page_size: i64,
    /// Rows matching the filter across every page, counted before the window.
    pub total_count: i64,
    /// Whether another page exists after this one.
    pub has_more: bool,
}

impl<T> Page<T> {
    /// Build a page from the rows of one window and the total over all of them.
    pub fn new(items: Vec<T>, request: PageRequest, total_count: i64) -> Self {
        let total_count = total_count.max(0);
        // `has_more` is derived from the window rather than from the row count,
        // so a final page that happens to be exactly full is not reported as
        // having a further, empty page after it.
        let consumed = request.offset().saturating_add(items.len() as i64);
        Self {
            items,
            page: request.page(),
            page_size: request.page_size(),
            total_count,
            has_more: consumed < total_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_apply_when_the_caller_asks_for_nothing() {
        let request = PageRequest::clamped(None, None);
        assert_eq!(request.page(), 1);
        assert_eq!(request.page_size(), PageRequest::DEFAULT_PAGE_SIZE);
        assert_eq!(request.offset(), 0);
        assert_eq!(request.limit(), PageRequest::DEFAULT_PAGE_SIZE);
    }

    /// A URL can carry anything. Zero, negative, and absurd values clamp into
    /// a valid window instead of rejecting the request.
    #[test]
    fn out_of_range_input_clamps_rather_than_errors() {
        assert_eq!(PageRequest::clamped(Some(0), None).page(), 1);
        assert_eq!(PageRequest::clamped(Some(-7), None).page(), 1);
        assert_eq!(PageRequest::clamped(None, Some(0)).page_size(), 1);
        assert_eq!(PageRequest::clamped(None, Some(-1)).page_size(), 1);
        assert_eq!(
            PageRequest::clamped(None, Some(10_000)).page_size(),
            PageRequest::MAX_PAGE_SIZE
        );
    }

    #[test]
    fn offsets_follow_the_page_number() {
        let request = PageRequest::clamped(Some(3), Some(25));
        assert_eq!(request.offset(), 50);
        assert_eq!(request.limit(), 25);
    }

    /// A page number far past the end is a stale bookmark, not an attack, and
    /// must not overflow the offset arithmetic.
    #[test]
    fn an_absurd_page_number_saturates_instead_of_overflowing() {
        let request = PageRequest::clamped(Some(i64::MAX), Some(200));
        assert!(request.offset() >= 0);
    }

    #[test]
    fn has_more_is_false_on_an_exactly_full_final_page() {
        // 100 rows, 50 per page, page 2: the window is full and there is
        // nothing after it.
        let page = Page::new(vec![0u8; 50], PageRequest::clamped(Some(2), Some(50)), 100);
        assert_eq!(page.total_count, 100);
        assert!(!page.has_more, "a full final page has nothing after it");
    }

    #[test]
    fn has_more_is_true_while_rows_remain() {
        let page = Page::new(vec![0u8; 50], PageRequest::clamped(Some(1), Some(50)), 100);
        assert!(page.has_more);
    }

    #[test]
    fn a_page_past_the_end_is_empty_and_reports_no_more() {
        let page = Page::new(Vec::<u8>::new(), PageRequest::clamped(Some(99), Some(50)), 10);
        assert!(page.items.is_empty());
        assert_eq!(page.total_count, 10);
        assert!(!page.has_more);
    }

    #[derive(Debug, Deserialize)]
    struct PagedQuery {
        #[serde(default, deserialize_with = "lenient_page_number")]
        page: Option<i64>,
    }

    /// A garbled or stale URL should still return a list.
    #[test]
    fn unparseable_page_numbers_fall_back_to_the_default() {
        for raw in ["\"abc\"", "\"\"", "\"12abc\"", "null"] {
            let query: PagedQuery =
                serde_json::from_str(&format!("{{\"page\":{raw}}}")).expect("lenient: {raw}");
            assert_eq!(query.page, None, "input {raw} should fall back");
            assert_eq!(PageRequest::clamped(query.page, None).page(), 1);
        }
    }

    #[test]
    fn parseable_page_numbers_still_arrive() {
        let numeric: PagedQuery = serde_json::from_str(r#"{"page":4}"#).expect("numeric");
        assert_eq!(numeric.page, Some(4));
        // A query string delivers everything as text.
        let text: PagedQuery = serde_json::from_str(r#"{"page":"4"}"#).expect("text");
        assert_eq!(text.page, Some(4));
    }

    /// The envelope is what the frontend reads; its field names are contract.
    #[test]
    fn the_wire_shape_is_camel_case() {
        let page = Page::new(vec![1u8], PageRequest::clamped(Some(1), Some(1)), 3);
        let json = serde_json::to_value(&page).expect("page serializes");
        assert!(json.get("pageSize").is_some(), "{json}");
        assert!(json.get("totalCount").is_some(), "{json}");
        assert!(json.get("hasMore").is_some(), "{json}");
        assert!(json.get("items").is_some(), "{json}");
    }
}
