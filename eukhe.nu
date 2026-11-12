export def tag [repo: path]: nothing -> string {
    open ($repo | path join "Cargo.toml") | get workspace.dependencies.eukhe-client.tag
}

def platform []: nothing -> string {
    match [$nu.os-info.name $nu.os-info.arch] {
        ["macos" "aarch64"] => "darwin-arm64"
        ["linux" "x86_64"] => "linux-x64"
        ["linux" "aarch64"] => "linux-arm64"
        [$os $arch] => { error make { msg: $"Eukhe publishes no release for ($os) ($arch): set EUKHE_BIN to an eukhe built from the pinned tag" } }
    }
}

def fetch [tag: string, cache: path]: nothing -> path {
    let version = ($tag | str replace "eukhe-v" "")
    let dir = ($cache | path join $tag)
    let binary = ($dir | path join "eukhe")
    if ($binary | path exists) {
        return $binary
    }
    let name = $"eukhe-($version)-(platform).tar.gz"
    let base = $"https://github.com/gildrb/eukhe/releases/download/($tag)"
    let partial = $"($dir).partial"
    rm -r -f $partial
    mkdir $partial
    let archive = ($partial | path join $name)
    print -e $"fetching ($base)/($name)"
    http get --raw $"($base)/($name)" | save -f $archive
    let expected = (http get --raw $"($base)/SHA256SUMS" | decode utf-8 | lines | parse "{hash}  {file}" | where file == $name | get hash.0?)
    let actual = (open --raw $archive | hash sha256)
    if $expected == null or $expected != $actual {
        rm -r -f $partial
        error make { msg: $"($name): sha256 ($actual) does not match the release's SHA256SUMS \(($expected)\)" }
    }
    ^tar -xzf $archive -C $partial
    rm $archive
    mv $partial $dir
    $binary
}

export def binary [repo: path, cache: path]: nothing -> path {
    if ($env.EUKHE_BIN? | is-not-empty) {
        return ($env.EUKHE_BIN | path expand)
    }
    fetch (tag $repo) $cache
}

export def sidecars [eukhe: path]: nothing -> list<path> {
    mut dir = ($eukhe | path dirname)
    loop {
        if ($dir | path join "eukhe-runtime" "pyproject.toml" | path exists) {
            break
        }
        let parent = ($dir | path dirname)
        if $parent == $dir {
            return []
        }
        $dir = $parent
    }
    let root = $dir
    ["eukhe-runtime" "skills" "models.bundled.json" "mcp-services.bundled.json"]
    | each { |name| $root | path join $name }
    | where { |source| $source | path exists }
}

export def copy-sidecar [source: path, target: path] {
    if ($source | path type) == "dir" {
        let excluded = [test uv.lock .venv __pycache__ .pytest_cache .ruff_cache .mypy_cache .git .DS_Store node_modules "*.pyc" "*.egg-info"]
        let excludes = ($excluded | each { |name| $"--exclude=($name)" })
        ^rsync -a ...$excludes $"($source)/" $"($target | path join ($source | path basename))/"
    } else {
        cp $source $target
    }
}
