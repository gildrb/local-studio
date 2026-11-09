#!/usr/bin/env nu

use zig.nu toolchain

def developer-dir []: nothing -> string {
    if ($env.DEVELOPER_DIR? | is-not-empty) {
        return $env.DEVELOPER_DIR
    }
    let xcode = "/Applications/Xcode.app/Contents/Developer"
    if ($xcode | path exists) {
        let license = (with-env { DEVELOPER_DIR: $xcode } { do { ^xcodebuild -license check } | complete })
        if $license.exit_code == 0 {
            return $xcode
        }
    }
    "/Library/Developer/CommandLineTools"
}

def compile-icon [package: path, resources: path] {
    let partial = (mktemp -t "local-studio-icon.XXXXXX")
    let result = (do { ^xcrun actool ($package | path join "AppIcon.icon") --compile $resources --platform macosx --minimum-deployment-target 26.0 --app-icon AppIcon --output-partial-info-plist $partial --output-format human-readable-text } | complete)
    rm -f $partial
    if $result.exit_code != 0 or not ($resources | path join "Assets.car" | path exists) {
        error make { msg: $"actool could not compile AppIcon.icon \(needs Xcode 26+; run `sudo xcodebuild -runFirstLaunch` once\):\n($result.stdout)($result.stderr)" }
    }
}

def build-kit [repo: path, package: path, profile: string] {
    let cargo_profile = if $profile == "release" { ["--release"] } else { [] }
    let target_root = if ($env.CARGO_TARGET_DIR? | is-not-empty) { $env.CARGO_TARGET_DIR | path expand } else { $repo | path join "target" }
    $env.PATH = ($env.PATH | prepend (toolchain $target_root))
    ^cargo build --manifest-path ($repo | path join "Cargo.toml") -p local-studio-kit ...$cargo_profile
    let target = ($target_root | path join $profile)
    let generated = ($package | path join "Generated")
    let bindings = (mktemp -d)
    ^cargo run --quiet --manifest-path ($repo | path join "Cargo.toml") -p local-studio-kit --bin uniffi-bindgen ...$cargo_profile -- generate --library ($target | path join "liblocal_studio_kit.dylib") --language swift --out-dir $bindings
    rm -r -f $generated
    mkdir ($generated | path join "lib") ($generated | path join "LocalStudioKit") ($generated | path join "local_studio_coreFFI")
    mv ($bindings | path join "local_studio_core.swift") ($generated | path join "LocalStudioKit")
    mv ($bindings | path join "local_studio_coreFFI.h") ($generated | path join "local_studio_coreFFI")
    mv ($bindings | path join "local_studio_coreFFI.modulemap") ($generated | path join "local_studio_coreFFI" "module.modulemap")
    cp ($target | path join "liblocal_studio_kit.a") ($generated | path join "lib")
    rm -r -f $bindings
}

def find-daemon [repo: path]: nothing -> any {
    if ($env.EUKHE_DAEMON? | is-not-empty) {
        return ($env.EUKHE_DAEMON | path expand)
    }
    let eukhe = ($repo | path dirname | path join "eukhe" "target")
    [($eukhe | path join "release" "eukhe-daemon") ($eukhe | path join "debug" "eukhe-daemon")]
    | where { |candidate| $candidate | path exists }
    | get 0?
}

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

def sign-helper [source: path, target: path] {
    cp $source $target
    ^/usr/bin/codesign --force --sign - --timestamp=none $target
}

def bundle-eukhe [daemon: path, contents: path] {
    let macos = ($contents | path join "MacOS")
    sign-helper $daemon ($macos | path join "eukhe-daemon")
    let cli = ($daemon | path dirname | path join "eukhe")
    if ($cli | path exists) {
        sign-helper $cli ($macos | path join "eukhe")
    } else {
        print -e $"warning: no eukhe beside ($daemon); the app cannot install the Python kernel"
    }
    let root = (eukhe-root $daemon)
    if $root == null {
        print -e $"warning: no eukhe-runtime found above ($daemon); the Python kernel cannot be installed"
        return
    }
    let payload = ($contents | path join "Resources" "eukhe")
    mkdir $payload
    let excluded = [test uv.lock .venv __pycache__ .pytest_cache .ruff_cache .mypy_cache .git .DS_Store node_modules "*.pyc" "*.egg-info"]
    let excludes = ($excluded | each { |name| $"--exclude=($name)" })
    for sidecar in ["eukhe-runtime" "skills"] {
        let source = ($root | path join $sidecar)
        if ($source | path exists) {
            ^rsync -a ...$excludes $"($source)/" $"($payload | path join $sidecar)/"
            ^ln -s $"../Resources/eukhe/($sidecar)" ($macos | path join $sidecar)
        }
    }
}

def bundle-controller [repo: path, target: path] {
    let source = ($repo | path join "controller")
    if not ($source | path join "src" "main.ts" | path exists) {
        print -e "warning: no controller sources found; the app will only use a running Local controller"
        return
    }
    mkdir $target
    cp -r ($source | path join "src") $target
    for file in ["package.json" "bun.lock" "tsconfig.json"] {
        let path = ($source | path join $file)
        if ($path | path exists) { cp $path $target }
    }
}

def main [
    --configuration (-c): string = "Debug"
    --action (-a): string = "build"
] {
    let package = $env.FILE_PWD
    let repo = ($package | path dirname)
    let profile = match $configuration {
        "Debug" => "debug"
        "Release" => "release"
        _ => { error make { msg: $"unknown configuration ($configuration); expected Debug or Release" } }
    }
    let developer = (developer-dir)
    let sdk = (with-env { DEVELOPER_DIR: $developer } { ^xcrun --sdk macosx --show-sdk-path | str trim })
    let sdk_version = (with-env { DEVELOPER_DIR: $developer } { ^xcrun --sdk macosx --show-sdk-version | str trim })
    let minimum = "26.0"
    let platform = [-Xlinker -platform_version -Xlinker macos -Xlinker $minimum -Xlinker $sdk_version]
    with-env { DEVELOPER_DIR: $developer, SDKROOT: $sdk, MACOSX_DEPLOYMENT_TARGET: $minimum } {
        build-kit $repo $package $profile
        ^swift build --package-path $package --configuration $profile ...$platform
        let products = (^swift build --package-path $package --configuration $profile ...$platform --show-bin-path | str trim)
        let app = ($package | path join "build" $configuration "LocalStudio.app")
        let contents = ($app | path join "Contents")
        let executable = ($contents | path join "MacOS" "LocalStudio")
        rm -r -f $app
        mkdir ($contents | path join "MacOS") ($contents | path join "Resources")
        cp ($products | path join "LocalStudio") $executable
        cp ($package | path join "LocalStudio-Info.plist") ($contents | path join "Info.plist")
        compile-icon $package ($contents | path join "Resources")
        bundle-controller $repo ($contents | path join "Resources" "controller")
        for resource in (glob ($package | path join "Resources" "*")) {
            cp $resource ($contents | path join "Resources")
        }
        let daemon = (find-daemon $repo)
        if $daemon == null {
            print -e "warning: no eukhe-daemon found (set EUKHE_DAEMON); the app will only attach to a running daemon"
        } else {
            bundle-eukhe $daemon $contents
        }
        ^/usr/bin/codesign --force --sign - --timestamp=none $app
        match $action {
            "build" => { print $app }
            "run" => { ^$executable }
            "smoke" => { ^$executable "+smoke" }
            "smoke-shell" => { ^$executable "+smoke-shell" }
            _ => { error make { msg: $"unknown action ($action); expected build, run, smoke, or smoke-shell" } }
        }
    }
}
