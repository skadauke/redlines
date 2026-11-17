// The program embeds the bundled TypeScript (src/engine.rs), which is made from packages/cli and
// isn't in git. A build without it stops here and says what to run.

use std::path::Path;

const BUNDLES: [&str; 2] = ["bundle/redlines.js", "bundle/word.js"];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    for bundle in BUNDLES {
        println!("cargo:rerun-if-changed={bundle}");
        if !Path::new(bundle).exists() {
            println!(
                "cargo::error=apps/desktop/redlines/{bundle} doesn't exist. Run scripts/build-redlines in apps/desktop, or pnpm --filter redlines bundle at the root of the repository."
            );
        }
    }
}
