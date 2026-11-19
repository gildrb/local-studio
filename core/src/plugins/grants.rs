use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Capability, Plugin};

pub const GRANTS: &str = "grants.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grants {
    #[serde(default)]
    plugins: BTreeMap<String, Grant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant {
    version: String,
    capabilities: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Consent {
    Ready,
    NeedsConsent { missing: Vec<Capability> },
}

impl Grants {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join(GRANTS);
        let object = crate::workspace::providers::read_object(&path)?;
        serde_json::from_value(Value::Object(object)).map_err(|error| format!("{}: {error}", path.display()))
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        let value = serde_json::to_value(self).map_err(|error| error.to_string())?;
        crate::workspace::providers::write_private(&root.join(GRANTS), &value)
    }

    #[must_use]
    pub fn consent(&self, plugin: &Plugin) -> Consent {
        let granted = self.plugins.get(&plugin.id).map(|grant| &grant.capabilities);
        let missing: Vec<Capability> = plugin
            .capabilities
            .iter()
            .copied()
            .filter(|capability| !granted.is_some_and(|granted| granted.contains(capability.name())))
            .collect();
        if missing.is_empty() {
            Consent::Ready
        } else {
            Consent::NeedsConsent { missing }
        }
    }

    #[must_use]
    pub fn granted(&self, id: &str) -> Option<(&str, Vec<&str>)> {
        self.plugins
            .get(id)
            .map(|grant| (grant.version.as_str(), grant.capabilities.iter().map(String::as_str).collect()))
    }

    pub fn grant(&mut self, plugin: &Plugin, capabilities: &[Capability]) -> Result<(), String> {
        if let Some(extra) = capabilities.iter().find(|capability| !plugin.asks(**capability)) {
            return Err(format!("{} {} does not ask for {}", plugin.id, plugin.version, extra.name()));
        }
        let kept: BTreeSet<String> = self
            .plugins
            .get(&plugin.id)
            .map(|grant| grant.capabilities.clone())
            .unwrap_or_default()
            .into_iter()
            .filter(|name| Capability::parse(name).is_some_and(|capability| plugin.asks(capability)))
            .chain(capabilities.iter().map(|capability| capability.name().to_string()))
            .collect();
        self.plugins.insert(plugin.id.clone(), Grant { version: plugin.version.clone(), capabilities: kept });
        Ok(())
    }

    pub fn revoke(&mut self, id: &str, capabilities: &[Capability]) -> bool {
        if capabilities.is_empty() {
            return self.plugins.remove(id).is_some();
        }
        let Some(grant) = self.plugins.get_mut(id) else { return false };
        let before = grant.capabilities.len();
        grant.capabilities.retain(|name| !capabilities.iter().any(|capability| capability.name() == name));
        let changed = grant.capabilities.len() != before;
        if grant.capabilities.is_empty() {
            self.plugins.remove(id);
        }
        changed
    }
}
