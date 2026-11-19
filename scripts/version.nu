#!/usr/bin/env nu

const identities = {
    stable: { name: "Local Studio", bundle_id: "org.local.studio.macos", app_id: "dev.localstudio.LocalStudio", scheme: "localstudio" }
    nightly: { name: "Local Studio Nightly", bundle_id: "org.local.studio.macos.nightly", app_id: "dev.localstudio.LocalStudio.Nightly", scheme: "localstudio-nightly" }
    dev: { name: "Local Studio Dev", bundle_id: "org.local.studio.macos.dev", app_id: "dev.localstudio.LocalStudio.Dev", scheme: "localstudio-dev" }
}

def replace-once [text: string, pattern: string, replacement: string, what: string]: nothing -> string {
    let found = ($text | parse -r $pattern | length)
    if $found != 1 {
        error make { msg: $"expected one ($what), found ($found)" }
    }
    $text | str replace -r $pattern $replacement
}

def plist-string [text: string, key: string, value: string]: nothing -> string {
    replace-once $text ('(<key>' + $key + '</key>\s*<string>)[^<]*(</string>)') ('${1}' + $value + '${2}') $"($key) in the Info.plist"
}

def stamp [root: path, identity: record, short: string, bundle: string] {
    let plist_path = ($root | path join "macos" "LocalStudio-Info.plist")
    mut plist = (open --raw $plist_path)
    for entry in [
        [CFBundleName $identity.name]
        [CFBundleDisplayName $identity.name]
        [CFBundleIdentifier $identity.bundle_id]
        [CFBundleURLName $identity.bundle_id]
        [CFBundleShortVersionString $short]
        [CFBundleVersion $bundle]
    ] {
        $plist = (plist-string $plist $entry.0 $entry.1)
    }
    $plist = (replace-once $plist '(<key>CFBundleURLSchemes</key>\s*<array>\s*<string>)[^<]*(</string>)' ('${1}' + $identity.scheme + '${2}') "CFBundleURLSchemes in the Info.plist")
    $plist | save -f $plist_path

    let main_path = ($root | path join "linux" "src" "main.rs")
    let main = (replace-once (open --raw $main_path) 'application_id\("[^"]*"\)' $"application_id\(\"($identity.app_id)\"\)" "application_id in linux/src/main.rs")
    $main | save -f $main_path
}

def main [
    channel: string
    --stamp
    --json
    --at: string
    --commit: string
    --root: path
] {
    if $channel not-in [stable nightly dev local] {
        error make { msg: $"unknown channel ($channel); expected stable, nightly, dev or local" }
    }
    let root = ($root | default ($env.FILE_PWD | path dirname))
    let base = (open ($root | path join "Cargo.toml") | get workspace.package.version)
    if ($base !~ '^\d+\.\d+\.\d+$') {
        error make { msg: $"workspace version ($base) is not X.Y.Z" }
    }
    let at = if $at == null { date now | date to-timezone UTC | format date "%Y%m%d%H%M%S" } else { $at }
    if ($at !~ '^\d{14}$') {
        error make { msg: $"--at ($at) is not YYYYMMDDHHMMSS" }
    }
    let commit = if $commit == null { ^git -C $root rev-parse HEAD | str trim } else { $commit }
    if ($commit !~ '^[0-9a-f]{7,40}$') {
        error make { msg: $"--commit ($commit) is not a hex commit id" }
    }
    let sha7 = ($commit | str substring 0..6)
    let version = match $channel {
        "stable" => $base
        "nightly" => $"($base)-nightly.($at)+($sha7)"
        "dev" => $"($base)-dev.($at)+($sha7)"
        "local" => $"($base)-dev.0+local.($sha7)"
    }
    let identity = ($identities | get (if $channel == "local" { "dev" } else { $channel }))
    let bundle = $"($at | str substring 0..7).($at | str substring 8..13)"
    if $stamp {
        stamp $root $identity $base $bundle
    }
    if $json {
        { channel: $channel, version: $version, base: $base, commit: $commit, bundle_version: $bundle } | merge $identity | to json
    } else {
        $version
    }
}
