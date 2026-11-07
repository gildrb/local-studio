#!/usr/bin/env nu

def real-zig [shim: path]: nothing -> string {
    let found = (which -a zig | where type == external | get path | where { |candidate| not ($candidate | str starts-with $shim) } | get 0?)
    if $found != null {
        let version = (do { ^$found version } | complete | get stdout | str trim)
        if ($version | str starts-with "0.15.") {
            return $found
        }
    }
    let store = (^nix build --no-link --print-out-paths nixpkgs#zig_0_15 | lines | last | str trim)
    $store | path join "bin" "zig"
}

def write-script [file: path, body: string] {
    $"#!/bin/sh\n($body)\n" | save -f $file
    ^chmod +x $file
}

export def toolchain [target_root: path]: nothing -> string {
    let root = ($target_root | path join "zig-0.15")
    let zig = (real-zig $root)
    let lib = (^$zig env | parse -r '\.lib_dir = "(?<dir>[^"]+)"' | get dir.0)
    let bin = ($root | path join "bin")
    let shim = ($root | path join "xcode")
    let sdk = ($root | path join "MacOSX.sdk")
    mkdir $bin $shim ($sdk | path join "usr" "lib") ($sdk | path join "System" "Library" "Frameworks")
    ^ln -sfn ($lib | path join "libc" "include" "any-macos-any") ($sdk | path join "usr" "include")
    ^ln -sfn ($lib | path join "libc" "darwin" "libSystem.tbd") ($sdk | path join "usr" "lib" "libSystem.tbd")
    ^ln -sfn ($lib | path join "libc" "darwin" "SDKSettings.json") ($sdk | path join "SDKSettings.json")
    write-script ($shim | path join "xcode-select") $"echo '($root)'"
    write-script ($shim | path join "xcrun") $"echo '($sdk)'"
    write-script ($bin | path join "zig") $"PATH='($shim):'\"$PATH\" exec '($zig)' \"$@\""
    $bin
}

def main [] {
    let repo = ($env.FILE_PWD | path dirname)
    let target = if ($env.CARGO_TARGET_DIR? | is-not-empty) { $env.CARGO_TARGET_DIR | path expand } else { $repo | path join "target" }
    print (toolchain $target)
}
