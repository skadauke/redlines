// The program embeds the bundled TypeScript (src/engine.rs), which is made from packages/cli and
// isn't in git. A build without it stops here and says what to run.

use std::path::Path;

const BUNDLE: &str = "bundle/redlines.js";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={BUNDLE}");
    if !Path::new(BUNDLE).exists() {
        println!(
            "cargo::error=apps/desktop/redlines/{BUNDLE} doesn't exist. Run scripts/build-redlines in apps/desktop, or pnpm --filter redlines bundle at the root of the repository."
        );
    }
}
