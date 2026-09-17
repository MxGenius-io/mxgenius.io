//! Tenant-owned customer accounts around the existing edge-device and
//! Equipment Drive control plane.
//!
//! This module deliberately stores no payment credentials and invents no new
//! telemetry stream. Payment history is an operator-entered ledger; health is
//! read from the existing device heartbeat and deployment records.

use mxgenius_shared::application::context::ExecutionContext;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CustomerOperationsError {
    #[error("the requested customer record was not found")]
    NotFound,
    #[error("the customer record conflicts with existing state")]
    Conflict,
    #[error("the request is invalid: {0}")]
    Invalid(&'static str),
    #[error("persistence failed: {0}")]
    Persistence(#[from] sqlx::Error),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerInput {
    pub name: String,
    pub status: Option<String>,
    pub primary_contact_name: Option<String>,
    pub primary_contact_email: Option<String>,
    pub billing_email: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCustomerInput {
    pub name: String,
    pub status: String,
    pub primary_contact_name: Option<String>,
    pub primary_contact_email: Option<String>,
    pub billing_email: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignCustomerDeviceInput {
    pub customer_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCustomerPaymentInput {
    pub amount_cents: i64,
    pub currency: String,
    pub status: String,
    pub occurred_at: OffsetDateTime,
    pub reference: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerAccountSummaryRow {
    pub id: Uuid,
    pub name: String,
    pub status: String,
    pub primary_contact_name: Option<String>,
    pub primary_contact_email: Option<String>,
    pub billing_email: Option<String>,
    pub notes: Option<String>,
    pub device_count: i64,
    pub active_device_count: i64,
    pub attention_device_count: i64,
    pub total_paid_cents: i64,
    pub last_seen_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDeviceRow {
    pub id: Uuid,
    pub customer_account_id: Option<Uuid>,
    pub display_name: String,
    pub hardware_id: Option<String>,
    pub status: String,
    pub last_seen_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub assigned_pack_name: Option<String>,
    pub assigned_version_number: Option<i64>,
    pub assignment_requested_at: Option<OffsetDateTime>,
    pub latest_deployment_state: Option<String>,
    pub latest_error_code: Option<String>,
    pub latest_detail: Option<String>,
    pub latest_reported_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerPaymentRow {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub amount_cents: i64,
    pub currency: String,
    pub status: String,
    pub occurred_at: OffsetDateTime,
    pub reference: Option<String>,
    pub note: Option<String>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerOverview {
    pub customer: CustomerAccountSummaryRow,
    pub devices: Vec<CustomerDeviceRow>,
    pub payments: Vec<CustomerPaymentRow>,
}

#[derive(Clone)]
pub struct CustomerOperationsRepository {
    pool: PgPool,
}

impl CustomerOperationsRepository {
    pub fn new(pool: &PgPool) -> Self {
        Self { pool: pool.clone() }
    }

    pub async fn list_customers(
        &self,
        context: &ExecutionContext,
    ) -> Result<Vec<CustomerAccountSummaryRow>, CustomerOperationsError> {
        Ok(sqlx::query_as(customer_summary_sql(false))
            .bind(context.organization_id.0)
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn get_customer(
        &self,
        context: &ExecutionContext,
        customer_id: Uuid,
    ) -> Result<CustomerOverview, CustomerOperationsError> {
        let customer = sqlx::query_as(customer_summary_sql(true))
            .bind(context.organization_id.0)
            .bind(customer_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(CustomerOperationsError::NotFound)?;
        let devices = self.customer_devices(context, customer_id).await?;
        let payments = sqlx::query_as(
            r#"SELECT id,customer_id,amount_cents,currency,status,occurred_at,
                      reference,note,created_at
               FROM customer_payments
               WHERE organization_id=$1 AND customer_id=$2
               ORDER BY occurred_at DESC,id
               LIMIT 100"#,
        )
        .bind(context.organization_id.0)
        .bind(customer_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(CustomerOverview {
            customer,
            devices,
            payments,
        })
    }

    pub async fn create_customer(
        &self,
        context: &ExecutionContext,
        input: &CreateCustomerInput,
    ) -> Result<CustomerOverview, CustomerOperationsError> {
        let values = validate_customer(
            &input.name,
            input.status.as_deref().unwrap_or("active"),
            input.primary_contact_name.as_deref(),
            input.primary_contact_email.as_deref(),
            input.billing_email.as_deref(),
            input.notes.as_deref(),
        )?;
        let customer_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO customer_accounts
               (id,organization_id,name,status,primary_contact_name,
                primary_contact_email,billing_email,notes,created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
        )
        .bind(customer_id)
        .bind(context.organization_id.0)
        .bind(values.name)
        .bind(values.status)
        .bind(values.primary_contact_name)
        .bind(values.primary_contact_email)
        .bind(values.billing_email)
        .bind(values.notes)
        .bind(context.user_id.0)
        .execute(&self.pool)
        .await
        .map_err(map_database_error)?;
        self.get_customer(context, customer_id).await
    }

    pub async fn update_customer(
        &self,
        context: &ExecutionContext,
        customer_id: Uuid,
        input: &UpdateCustomerInput,
    ) -> Result<CustomerOverview, CustomerOperationsError> {
        let values = validate_customer(
            &input.name,
            &input.status,
            input.primary_contact_name.as_deref(),
            input.primary_contact_email.as_deref(),
            input.billing_email.as_deref(),
            input.notes.as_deref(),
        )?;
        let result = sqlx::query(
            r#"UPDATE customer_accounts
               SET name=$1,status=$2,primary_contact_name=$3,
                   primary_contact_email=$4,billing_email=$5,notes=$6,updated_at=now()
               WHERE organization_id=$7 AND id=$8"#,
        )
        .bind(values.name)
        .bind(values.status)
        .bind(values.primary_contact_name)
        .bind(values.primary_contact_email)
        .bind(values.billing_email)
        .bind(values.notes)
        .bind(context.organization_id.0)
        .bind(customer_id)
        .execute(&self.pool)
        .await
        .map_err(map_database_error)?;
        if result.rows_affected() != 1 {
            return Err(CustomerOperationsError::NotFound);
        }
        self.get_customer(context, customer_id).await
    }

    pub async fn assign_device(
        &self,
        context: &ExecutionContext,
        device_id: Uuid,
        customer_id: Option<Uuid>,
    ) -> Result<CustomerDeviceRow, CustomerOperationsError> {
        if let Some(customer_id) = customer_id {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM customer_accounts WHERE organization_id=$1 AND id=$2)",
            )
            .bind(context.organization_id.0)
            .bind(customer_id)
            .fetch_one(&self.pool)
            .await?;
            if !exists {
                return Err(CustomerOperationsError::NotFound);
            }
        }
        let result = sqlx::query(
            r#"UPDATE edge_devices SET customer_account_id=$1,updated_at=now()
               WHERE organization_id=$2 AND id=$3"#,
        )
        .bind(customer_id)
        .bind(context.organization_id.0)
        .bind(device_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(CustomerOperationsError::NotFound);
        }
        self.device(context, device_id).await
    }

    pub async fn record_payment(
        &self,
        context: &ExecutionContext,
        customer_id: Uuid,
        input: &RecordCustomerPaymentInput,
    ) -> Result<CustomerPaymentRow, CustomerOperationsError> {
        if input.amount_cents <= 0 {
            return Err(CustomerOperationsError::Invalid(
                "payment amount must be greater than zero",
            ));
        }
        let currency = input.currency.trim().to_ascii_uppercase();
        if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
            return Err(CustomerOperationsError::Invalid(
                "payment currency must be a three-letter code",
            ));
        }
        let status = input.status.trim().to_ascii_lowercase();
        if !matches!(status.as_str(), "paid" | "pending" | "failed" | "refunded") {
            return Err(CustomerOperationsError::Invalid(
                "payment status is invalid",
            ));
        }
        if input.occurred_at > OffsetDateTime::now_utc() + time::Duration::days(1) {
            return Err(CustomerOperationsError::Invalid(
                "payment date cannot be in the future",
            ));
        }
        let reference = optional_text(
            input.reference.as_deref(),
            160,
            "payment reference is too long",
        )?;
        let note = optional_text(input.note.as_deref(), 1000, "payment note is too long")?;
        let row = sqlx::query_as(
            r#"INSERT INTO customer_payments
               (id,organization_id,customer_id,amount_cents,currency,status,
                occurred_at,reference,note,recorded_by)
               SELECT $1,$2,c.id,$3,$4,$5,$6,$7,$8,$9
               FROM customer_accounts c
               WHERE c.organization_id=$2 AND c.id=$10
               RETURNING id,customer_id,amount_cents,currency,status,occurred_at,
                         reference,note,created_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(context.organization_id.0)
        .bind(input.amount_cents)
        .bind(currency)
        .bind(status)
        .bind(input.occurred_at)
        .bind(reference)
        .bind(note)
        .bind(context.user_id.0)
        .bind(customer_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(CustomerOperationsError::NotFound)?;
        Ok(row)
    }

    async fn customer_devices(
        &self,
        context: &ExecutionContext,
        customer_id: Uuid,
    ) -> Result<Vec<CustomerDeviceRow>, CustomerOperationsError> {
        Ok(sqlx::query_as(&format!(
            "{} WHERE d.organization_id=$1 AND d.customer_account_id=$2 ORDER BY d.updated_at DESC,d.id",
            customer_device_select()
        ))
        .bind(context.organization_id.0)
        .bind(customer_id)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn device(
        &self,
        context: &ExecutionContext,
        device_id: Uuid,
    ) -> Result<CustomerDeviceRow, CustomerOperationsError> {
        sqlx::query_as(&format!(
            "{} WHERE d.organization_id=$1 AND d.id=$2",
            customer_device_select()
        ))
        .bind(context.organization_id.0)
        .bind(device_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(CustomerOperationsError::NotFound)
    }
}

struct ValidCustomer<'a> {
    name: &'a str,
    status: &'a str,
    primary_contact_name: Option<&'a str>,
    primary_contact_email: Option<&'a str>,
    billing_email: Option<&'a str>,
    notes: Option<&'a str>,
}

fn validate_customer<'a>(
    name: &'a str,
    status: &'a str,
    primary_contact_name: Option<&'a str>,
    primary_contact_email: Option<&'a str>,
    billing_email: Option<&'a str>,
    notes: Option<&'a str>,
) -> Result<ValidCustomer<'a>, CustomerOperationsError> {
    let name = required_text(name, 160, "customer name is required")?;
    let status = status.trim();
    if !matches!(
        status,
        "prospect" | "trial" | "active" | "past_due" | "suspended" | "closed"
    ) {
        return Err(CustomerOperationsError::Invalid(
            "customer status is invalid",
        ));
    }
    let primary_contact_name =
        optional_text(primary_contact_name, 160, "contact name is too long")?;
    let primary_contact_email = optional_email(primary_contact_email)?;
    let billing_email = optional_email(billing_email)?;
    let notes = optional_text(notes, 4000, "customer notes are too long")?;
    Ok(ValidCustomer {
        name,
        status,
        primary_contact_name,
        primary_contact_email,
        billing_email,
        notes,
    })
}

fn required_text<'a>(
    value: &'a str,
    maximum: usize,
    message: &'static str,
) -> Result<&'a str, CustomerOperationsError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        return Err(CustomerOperationsError::Invalid(message));
    }
    Ok(value)
}

fn optional_text<'a>(
    value: Option<&'a str>,
    maximum: usize,
    message: &'static str,
) -> Result<Option<&'a str>, CustomerOperationsError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.chars().count() > maximum {
                Err(CustomerOperationsError::Invalid(message))
            } else {
                Ok(value)
            }
        })
        .transpose()
}

fn optional_email(value: Option<&str>) -> Result<Option<&str>, CustomerOperationsError> {
    let value = optional_text(value, 254, "email address is too long")?;
    if value.is_some_and(|email| {
        let (local, domain) = email.rsplit_once('@').unwrap_or_default();
        local.is_empty() || domain.is_empty() || domain.starts_with('.') || !domain.contains('.')
    }) {
        return Err(CustomerOperationsError::Invalid("email address is invalid"));
    }
    Ok(value)
}

fn customer_summary_sql(by_id: bool) -> &'static str {
    if by_id {
        r#"SELECT c.id,c.name,c.status,c.primary_contact_name,c.primary_contact_email,
                  c.billing_email,c.notes,
                  (SELECT COUNT(*) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id) AS device_count,
                  (SELECT COUNT(*) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id
                     AND d.status='active') AS active_device_count,
                  (SELECT COUNT(*) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id
                     AND d.status IN ('pending','offline')) AS attention_device_count,
                  COALESCE((SELECT SUM(p.amount_cents) FROM customer_payments p
                   WHERE p.organization_id=c.organization_id AND p.customer_id=c.id
                     AND p.status='paid'),0)::bigint AS total_paid_cents,
                  (SELECT MAX(d.last_seen_at) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id) AS last_seen_at,
                  c.created_at,c.updated_at
           FROM customer_accounts c
           WHERE c.organization_id=$1 AND c.id=$2"#
    } else {
        r#"SELECT c.id,c.name,c.status,c.primary_contact_name,c.primary_contact_email,
                  c.billing_email,c.notes,
                  (SELECT COUNT(*) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id) AS device_count,
                  (SELECT COUNT(*) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id
                     AND d.status='active') AS active_device_count,
                  (SELECT COUNT(*) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id
                     AND d.status IN ('pending','offline')) AS attention_device_count,
                  COALESCE((SELECT SUM(p.amount_cents) FROM customer_payments p
                   WHERE p.organization_id=c.organization_id AND p.customer_id=c.id
                     AND p.status='paid'),0)::bigint AS total_paid_cents,
                  (SELECT MAX(d.last_seen_at) FROM edge_devices d
                   WHERE d.organization_id=c.organization_id AND d.customer_account_id=c.id) AS last_seen_at,
                  c.created_at,c.updated_at
           FROM customer_accounts c
           WHERE c.organization_id=$1
           ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'trial' THEN 1
                    WHEN 'past_due' THEN 2 WHEN 'prospect' THEN 3
                    WHEN 'suspended' THEN 4 ELSE 5 END,c.name,c.id"#
    }
}

fn customer_device_select() -> &'static str {
    r#"SELECT d.id,d.customer_account_id,d.display_name,d.hardware_id,d.status,
              d.last_seen_at,d.created_at,d.updated_at,p.name AS assigned_pack_name,
              v.version_number AS assigned_version_number,
              a.requested_at AS assignment_requested_at,
              latest.state AS latest_deployment_state,
              latest.error_code AS latest_error_code,
              latest.detail AS latest_detail,
              latest.reported_at AS latest_reported_at
       FROM edge_devices d
       LEFT JOIN edge_device_assignments a
         ON a.organization_id=d.organization_id AND a.device_id=d.id
       LEFT JOIN equipment_pack_versions v
         ON v.organization_id=a.organization_id AND v.id=a.version_id
       LEFT JOIN equipment_packs p
         ON p.organization_id=v.organization_id AND p.id=v.pack_id
       LEFT JOIN LATERAL (
         SELECT dep.state,dep.error_code,dep.detail,dep.reported_at
         FROM edge_device_deployments dep
         WHERE dep.organization_id=d.organization_id AND dep.device_id=d.id
         ORDER BY dep.generation DESC,dep.reported_at DESC,dep.id
         LIMIT 1
       ) latest ON true"#
}

fn map_database_error(error: sqlx::Error) -> CustomerOperationsError {
    match &error {
        sqlx::Error::Database(database)
            if database.is_unique_violation() || database.is_foreign_key_violation() =>
        {
            CustomerOperationsError::Conflict
        }
        _ => CustomerOperationsError::Persistence(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn customer_validation_is_bounded() {
        assert!(validate_customer("Meridian Aviation", "active", None, None, None, None).is_ok());
        assert!(validate_customer("", "active", None, None, None, None).is_err());
        assert!(validate_customer("Meridian", "unknown", None, None, None, None).is_err());
        assert!(
            validate_customer("Meridian", "active", None, Some("not-an-email"), None, None)
                .is_err()
        );
    }

    #[test]
    fn device_health_comes_from_existing_ledgers() {
        let query = customer_device_select();
        assert!(query.contains("edge_device_assignments"));
        assert!(query.contains("edge_device_deployments"));
        assert!(query.contains("latest.error_code"));
        assert!(!query.contains("customer_telemetry"));
    }
}
