#!/usr/bin/env nu

def eukhe-root [daemon: path]: nothing -> any {
    mut dir = ($daemon | path dirname)
    loop {
        if ($dir | path join "eukhe-runtime" "pyproject.toml" | path exists) {
            return $dir
        }
        let parent = ($dir | path dirname)
        if $parent == $dir {
            return null
        }
        $dir = $parent
    }
}

def find-daemon [repo: path]: nothing -> path {
    if ($env.EUKHE_DAEMON? | is-not-empty) {
        return ($env.EUKHE_DAEMON | path expand)
    }
    let eukhe = ($repo | path dirname | path join "eukhe" "target")
    let found = ([($eukhe | path join "release" "eukhe-daemon") ($eukhe | path join "debug" "eukhe-daemon")]
        | where { |candidate| $candidate | path exists }
        | get 0?)
    if $found == null {
        error make { msg: "no eukhe-daemon found: set EUKHE_DAEMON or build ../eukhe" }
    }
    $found
}

def main [--profile (-p): string = "debug"] {
    let linux = $env.FILE_PWD
    let repo = ($linux | path dirname)
    let target_root = if ($env.CARGO_TARGET_DIR? | is-not-empty) { $env.CARGO_TARGET_DIR | path expand } else { $linux | path join "target" }
    let app = ($target_root | path join $profile "local-studio")
    if not ($app | path exists) {
        error make { msg: $"($app) is missing: run `cargo build` first" }
    }
    let daemon = (find-daemon $repo)
    let cli = ($daemon | path dirname | path join "eukhe")
    if not ($cli | path exists) {
        error make { msg: $"no eukhe beside ($daemon): build it with `cargo build -p eukhe-cli`" }
    }
    let root = (eukhe-root $daemon)
    if $root == null {
        error make { msg: $"no eukhe-runtime found above ($daemon)" }
    }
    let bundle = ($target_root | path join $profile "bundle")
    rm -r -f $bundle
    mkdir $bundle
    for binary in [$app $daemon $cli] {
        cp $binary $bundle
    }
    let excluded = [test uv.lock .venv __pycache__ .pytest_cache .ruff_cache .mypy_cache .git .DS_Store node_modules "*.pyc" "*.egg-info"]
    let excludes = ($excluded | each { |name| $"--exclude=($name)" })
    for sidecar in ["eukhe-runtime" "skills"] {
        let source = ($root | path join $sidecar)
        if ($source | path exists) {
            ^rsync -a ...$excludes $"($source)/" $"($bundle | path join $sidecar)/"
        }
    }
    let controller = ($repo | path join "controller")
    if ($controller | path join "src" "main.ts" | path exists) {
        let target = ($bundle | path join "share" "local-studio" "controller")
        mkdir $target
        cp -r ($controller | path join "src") $target
        for file in ["package.json" "bun.lock" "tsconfig.json"] {
            let path = ($controller | path join $file)
            if ($path | path exists) { cp $path $target }
        }
    }
    print $bundle
}
