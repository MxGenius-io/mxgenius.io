//! One compiled product-environment manifest shared with browser guidance.

use std::sync::OnceLock;

use mxgenius_shared::contracts::{
    EnvironmentDescribeRequest, EnvironmentDescribeResponse, EnvironmentSurface, EnvironmentTarget,
    EnvironmentTerm,
};
use serde_json::{json, Value};

const MANIFEST_JSON: &str = include_str!("../../../config/environment-manifest.json");

fn document() -> &'static Value {
    static DOCUMENT: OnceLock<Value> = OnceLock::new();
    DOCUMENT.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the compiled MXGenius environment manifest must contain valid JSON")
    })
}

fn manifest_version(manifest: &Value) -> String {
    format!(
        "{}+{}",
        manifest
            .get("schema_version")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        manifest
            .get("version")
            .and_then(Value::as_u64)
            .unwrap_or_default()
    )
}

fn surfaces(manifest: &Value) -> Vec<EnvironmentSurface> {
    manifest
        .get("surfaces")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|surface| serde_json::from_value(surface.clone()).ok())
        .collect()
}

fn target(item: &Value) -> Option<EnvironmentTarget> {
    Some(EnvironmentTarget {
        id: item.get("id")?.as_str()?.to_owned(),
        title: item.get("title")?.as_str()?.to_owned(),
        surface_id: item.get("surface")?.as_str()?.to_owned(),
        guidance: item.get("script")?.as_str()?.to_owned(),
        status: item.get("status")?.as_str()?.to_owned(),
        touchpoints: item
            .get("touchpoints")?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    })
}

fn targets(manifest: &Value) -> Vec<EnvironmentTarget> {
    manifest
        .get("tooltips")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(target)
        .collect()
}

fn terminology(manifest: &Value) -> Vec<EnvironmentTerm> {
    manifest
        .get("terminology")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| serde_json::from_value(entry.clone()).ok())
        .collect()
}

pub fn compact_manifest() -> Value {
    let manifest = document();
    let compact_surfaces = surfaces(manifest)
        .into_iter()
        .map(|surface| {
            json!({
                "id": surface.id,
                "label": surface.label,
                "kind": surface.kind,
                "parent_id": surface.parent_id,
                "route": surface.route,
                "purpose": surface.purpose,
                "capability_ids": surface.capabilities
                    .into_iter()
                    .map(|capability| capability.id)
                    .collect::<Vec<_>>(),
                "target_ids": surface.target_ids
            })
        })
        .collect::<Vec<_>>();
    json!({
        "manifest_version": manifest_version(manifest),
        "product": manifest.pointer("/product/name").and_then(Value::as_str),
        "purpose": manifest.pointer("/product/purpose").and_then(Value::as_str),
        "navigation_order": manifest.get("navigation_order"),
        "surfaces": compact_surfaces,
        "terminology": manifest.get("terminology"),
        "state_boundary": manifest.get("state_boundary")
    })
}

pub fn describe(
    request: &EnvironmentDescribeRequest,
) -> Result<EnvironmentDescribeResponse, String> {
    request.validate()?;
    let manifest = document();
    let all_surfaces = surfaces(manifest);
    let all_targets = targets(manifest);
    let requested_surface = request
        .surface_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let requested_target = request
        .target_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let selected_target = requested_target
        .map(|target_id| {
            all_targets
                .iter()
                .find(|target| target.id == target_id)
                .cloned()
                .ok_or_else(|| format!("unknown environment target: {target_id}"))
        })
        .transpose()?;
    let effective_surface = requested_surface.or_else(|| {
        selected_target
            .as_ref()
            .map(|target| target.surface_id.as_str())
    });
    let selected_surfaces = if let Some(surface_id) = effective_surface {
        let surface = all_surfaces
            .iter()
            .find(|surface| surface.id == surface_id)
            .cloned()
            .ok_or_else(|| format!("unknown environment surface: {surface_id}"))?;
        if selected_target
            .as_ref()
            .is_some_and(|target| target.surface_id != surface.id)
        {
            return Err(format!(
                "environment target {} does not belong to surface {}",
                selected_target.as_ref().expect("selected target").id,
                surface.id
            ));
        }
        vec![surface]
    } else {
        all_surfaces
    };
    let selected_targets = if let Some(target) = selected_target {
        vec![target]
    } else if let Some(surface_id) = effective_surface {
        all_targets
            .into_iter()
            .filter(|target| target.surface_id == surface_id)
            .collect()
    } else {
        Vec::new()
    };

    Ok(EnvironmentDescribeResponse {
        manifest_version: manifest_version(manifest),
        product: manifest
            .pointer("/product/name")
            .and_then(Value::as_str)
            .unwrap_or("MXGenius")
            .to_owned(),
        surfaces: selected_surfaces,
        targets: selected_targets,
        terminology: terminology(manifest),
    })
}

pub fn validate_manifest() -> Result<(), String> {
    let manifest = document();
    if manifest.get("manifest_kind").and_then(Value::as_str) != Some("mxgenius_environment") {
        return Err("environment manifest kind is invalid".into());
    }
    let surfaces = surfaces(manifest);
    let targets = targets(manifest);
    if surfaces.is_empty() || targets.is_empty() {
        return Err("environment manifest must define surfaces and targets".into());
    }
    let surface_ids = surfaces
        .iter()
        .map(|surface| surface.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if surface_ids.len() != surfaces.len() {
        return Err("environment surface IDs must be unique".into());
    }
    let target_ids = targets
        .iter()
        .map(|target| target.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if target_ids.len() != targets.len() {
        return Err("environment target IDs must be unique".into());
    }
    for target in &targets {
        if !surface_ids.contains(target.surface_id.as_str()) {
            return Err(format!(
                "environment target {} has unknown surface {}",
                target.id, target.surface_id
            ));
        }
        let owners = surfaces
            .iter()
            .filter(|surface| surface.target_ids.contains(&target.id))
            .collect::<Vec<_>>();
        if owners.len() != 1 || owners[0].id != target.surface_id {
            return Err(format!(
                "environment target {} must have exactly one matching surface owner",
                target.id
            ));
        }
    }
    for surface in &surfaces {
        for target_id in &surface.target_ids {
            if !target_ids.contains(target_id.as_str()) {
                return Err(format!(
                    "environment surface {} references unknown target {}",
                    surface.id, target_id
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiled_manifest_has_one_owner_for_every_guidance_target() {
        validate_manifest().expect("shared environment manifest should be coherent");
    }

    #[test]
    fn detail_queries_keep_stable_structure_separate_from_live_state() {
        let result = describe(&EnvironmentDescribeRequest {
            surface_id: Some("settings".into()),
            target_id: None,
        })
        .expect("settings surface");
        assert_eq!(result.surfaces.len(), 1);
        assert_eq!(result.surfaces[0].label, "Settings");
        assert!(result.surfaces[0]
            .capabilities
            .iter()
            .any(|capability| capability.id == "equipment-drives"));
        let compact = compact_manifest();
        assert!(compact.get("active_tab").is_none());
        assert!(compact.get("selected_case").is_none());
    }
}
