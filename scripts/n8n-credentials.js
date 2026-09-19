const fs = require("fs");
const path = require("path");

// n8n binds a node's credential on import by ID, not by name. Every build script used
// to emit invented ids ("supabase-account", "anthropic-account"), which match nothing
// in any real instance, so all 56 credentialed nodes in Workflow B alone arrived
// unmapped and had to be re-pointed by hand on every single import.
//
// Put the instance's real ids in n8n/credentials.json and the import binds itself.
// These are references, not secrets: the id identifies which stored credential to use,
// and the key material never leaves n8n.
//
// To find them: open any workflow in n8n that is already mapped, Download it, and read
// the `credentials` block on any HTTP Request node.
const CONFIG_PATH = path.join(__dirname, "..", "n8n", "credentials.json");

const FALLBACK = {
  supabaseApi: { id: "supabase-account", name: "Supabase account" },
  anthropicApi: { id: "anthropic-account", name: "Anthropic account" },
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const merged = {
      supabaseApi: { ...FALLBACK.supabaseApi, ...(raw.supabaseApi || {}) },
      anthropicApi: { ...FALLBACK.anthropicApi, ...(raw.anthropicApi || {}) },
    };
    // Said out loud at build time, because a build that silently emits placeholder ids
    // is indistinguishable from one that worked until you are twenty nodes into
    // remapping by hand.
    const stillPlaceholder = Object.keys(FALLBACK).filter(
      (key) => !merged[key].id || merged[key].id === FALLBACK[key].id || merged[key].id === "PASTE_ID_HERE"
    );
    if (stillPlaceholder.length) {
      console.warn(
        "  ! credentials still using placeholder ids for: " +
          stillPlaceholder.join(", ") +
          " - these nodes will need mapping by hand on import."
      );
    }
    return merged;
  } catch {
    console.warn(
      "  ! n8n/credentials.json not found - emitting placeholder credential ids, so every node will need mapping by hand on import."
    );
    return FALLBACK;
  }
}

module.exports = load();
