//! Frozen aircraft-family vocabulary shared by manual retrieval and drive export.

pub(crate) const AIRCRAFT_MODELS: &[&str] = &[
    "CL300",
    "CL350",
    "CL601",
    "CL604",
    "CL605",
    "CL650",
    "GL5000",
    "GL5000 GVFD",
    "GL5500",
    "GL6000",
    "GL6500",
    "GL7500",
    "Global Express",
    "Global Express XRS",
    "Falcon 2000",
    "Falcon 2000EX",
    "Falcon 2000EX EASY",
    "Falcon 2000S",
    "Falcon 50",
    "Falcon 7X",
    "Falcon 8X",
    "Falcon 900B and C",
    "Falcon 900DX",
    "Falcon 900EX",
    "Falcon 900EX EASy",
    "G150",
    "G200",
    "G280",
    "G400",
    "G450",
    "G500",
    "G550",
    "G600",
    "G650",
    "G II",
    "GIII",
    "GIV",
    "GIV MSG-3 (not windows 11 friendly)",
    "GV",
    "Baron Series",
    "BONANZA SERIES",
    "KING AIR 100 SERIES",
    "KING AIR 200 SERIES",
    "KING AIR 300 SERIES",
    "KING AIR 90 SERIES",
    "MODEL 1900-C AIRLINER",
    "MODEL 1900D AIRLINER",
    "MODEL 99 AIRLINER",
    "MU-300",
    "PREMIER MODEL 390",
    "Travel Air",
    "C100 Series 1950s",
    "C100 SERIES 1960s",
    "C100 Series 1970s",
    "C100 Series 1980s",
    "C162",
    "C200 Series 1960s",
    "C200 Series 1970s",
    "C200 Series 1980s",
    "C208",
    "C303 336 and 337",
    "C310 and 320",
    "C335 and 340",
    "C401-402",
    "C404-411-414",
    "C421",
    "C425 and C441",
    "CE500",
    "CE510",
    "CE525",
    "CE525 (M2)",
    "CE525A",
    "CE525C",
    "CE550",
    "CE550 Bravo",
    "CE650",
    "CE680",
    "CE680A",
    "CE700 Longitude",
    "CE750 SN 0001-0500",
    "CE750 SN 0501-On",
    "LC-550FG Series",
    "S550",
    "Single Engine 1996 and Beyond",
    "U206F",
    "125 Series 1A and 1B",
    "125 Series 3A and 3B",
    "125 Series 400A and 400B",
    "125 Series 600",
    "125 Series 700",
    "Hawker 1000",
];

pub(crate) fn compact_aircraft_model(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

fn catalog_alias_key(value: &str) -> String {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_uppercase)
        .filter(|word| {
            !matches!(
                word.as_str(),
                "BOMBARDIER"
                    | "DASSAULT"
                    | "GULFSTREAM"
                    | "TEXTRON"
                    | "AVIATION"
                    | "BEECH"
                    | "BEECHCRAFT"
                    | "CESSNA"
                    | "HAWKER"
                    | "MODEL"
                    | "AIRLINER"
                    | "SERIES"
            )
        })
        .collect()
}

pub(crate) fn canonical_aircraft_model(value: &str) -> String {
    let trimmed = value.trim();
    let words = trimmed
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    for window in words.windows(2) {
        let family = window[0].as_str();
        let variant = window[1].as_str();
        if variant.chars().all(|character| character.is_ascii_digit()) {
            match family {
                "challenger" | "cl" => return format!("CL{variant}"),
                "global" | "gl" => return format!("GL{variant}"),
                _ => {}
            }
        }
    }

    let compact = compact_aircraft_model(trimmed);
    for prefix in ["CL", "GL"] {
        if compact.strip_prefix(prefix).is_some_and(|variant| {
            !variant.is_empty() && variant.chars().all(|character| character.is_ascii_digit())
        }) {
            return compact;
        }
    }
    if let Some(model) = AIRCRAFT_MODELS
        .iter()
        .find(|model| compact_aircraft_model(model) == compact)
    {
        return (*model).to_owned();
    }

    let alias = catalog_alias_key(trimmed);
    let mut matches = AIRCRAFT_MODELS
        .iter()
        .filter(|model| catalog_alias_key(model) == alias);
    let Some(first) = matches.next() else {
        return trimmed.to_owned();
    };
    if matches.next().is_some() {
        return trimmed.to_owned();
    }
    (*first).to_owned()
}

pub(crate) fn aircraft_models_match(left: &str, right: &str) -> bool {
    let left = compact_aircraft_model(&canonical_aircraft_model(left));
    let right = compact_aircraft_model(&canonical_aircraft_model(right));
    !left.is_empty() && left == right
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BrowserCatalog {
        aircraft: Vec<BrowserAircraft>,
    }

    #[derive(Deserialize)]
    struct BrowserAircraft {
        aircraft: String,
    }

    #[test]
    fn server_vocabulary_matches_the_browser_catalog() {
        let browser: BrowserCatalog =
            serde_json::from_str(include_str!("../../../../manual-catalog.json"))
                .expect("valid browser manual catalog");
        assert_eq!(
            browser
                .aircraft
                .into_iter()
                .map(|entry| entry.aircraft)
                .collect::<Vec<_>>(),
            AIRCRAFT_MODELS
        );
    }

    #[test]
    fn natural_manufacturer_names_resolve_to_catalog_families() {
        assert_eq!(
            canonical_aircraft_model("Bombardier Challenger 350"),
            "CL350"
        );
        assert_eq!(canonical_aircraft_model("Gulfstream G650"), "G650");
        assert_eq!(canonical_aircraft_model("Dassault Falcon 8X"), "Falcon 8X");
        assert_eq!(
            canonical_aircraft_model("Beechcraft 1900C"),
            "MODEL 1900-C AIRLINER"
        );
        assert_eq!(canonical_aircraft_model("Hawker 125-700"), "125 Series 700");
        assert!(aircraft_models_match(
            "Textron Cessna CE750 SN 0501-On",
            "CE750 SN 0501-On"
        ));
    }
}
