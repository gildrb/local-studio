#!/usr/bin/env bash
set -euo pipefail
: "${REPO:?set REPO to owner/name}"
: "${GH_TOKEN:?set GH_TOKEN}"
semver=semver@7.6.3
tauri=@tauri-apps/cli@2.12.5
protocol=1

die() { echo "::error::$*" >&2; exit 1; }

feed_url() {
  case $1 in
    stable) echo "https://github.com/$REPO/releases/latest/download/latest.json" ;;
    nightly | dev) echo "https://github.com/$REPO/releases/download/$1/latest.json" ;;
    *) die "unknown channel $1" ;;
  esac
}

feed() { curl -fsSL "$(feed_url "$1")" 2>/dev/null || true; }

feed_field() { feed "$1" | jq -r --arg f "$2" '.[$f] // empty' 2>/dev/null || true; }

check_newer() {
  local current
  current=$(feed_field "$1" version)
  [ -n "$current" ] || return 0
  npx -y "$semver" -p -r ">${current%%+*}" "${2%%+*}" > /dev/null || die "the $1 feed already holds $current, which is not older than $2"
}

name_of() {
  case $1 in
    stable) echo "Local Studio" ;;
    nightly) echo "Local Studio Nightly" ;;
    dev) echo "Local Studio Dev" ;;
  esac
}

upload() {
  curl -fsS -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary @"$2" "https://uploads.github.com/repos/$REPO/releases/$1/assets?name=$(basename "$2")" > /dev/null
}

draft() {
  local channel=$1 version=$2 commit=$3 tag=$4 prerelease=true
  [ "$channel" = stable ] && prerelease=false
  gh api "repos/$REPO/releases" -f tag_name="$tag" -f target_commitish="$commit" \
    -f name="$(name_of "$channel") $version" -F draft=true -F prerelease="$prerelease" -q .id
}

discard() {
  local state
  state=$(gh api "repos/$REPO/releases/$1" -q .draft 2>/dev/null || true)
  if [ "$state" = true ]; then
    gh api -X DELETE "repos/$REPO/releases/$1"
  else
    echo "release $1 is not a draft (state: ${state:-gone}); left alone"
  fi
}

fetch_assets() {
  local id=$1 dir=$2
  mkdir -p "$dir"
  gh api "repos/$REPO/releases/$id/assets" --paginate -q '.[] | [.name, .url] | @tsv' |
    while IFS=$'\t' read -r name url; do
      [ "$name" = latest.json ] && continue
      curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/octet-stream" -o "$dir/$name" "$url"
    done
}

notes() {
  local channel=$1 version=$2 commit=$3 previous
  previous=$(feed_field "$channel" commit)
  echo "$(name_of "$channel") $version, built from ${commit:0:7}."
  if [ -n "$previous" ] && git merge-base --is-ancestor "$previous" "$commit" 2> /dev/null; then
    git log --no-merges --format='- %s' "$previous..$commit" | head -n 50
  fi
  [ "${MAC_SIGNED:-}" = true ] || echo "No macOS build: the Apple signing secrets are not set."
}

feed_json() {
  local channel=$1 version=$2 commit=$3 dir=$4 base=$5 notes=$6 platforms='{}' key file signature
  for file in "$dir"/*; do
    case $(basename "$file") in
      local-studio-darwin-aarch64.app.tar.gz) key=darwin-aarch64 ;;
      local-studio-linux-x86_64.tar.gz) key=linux-x86_64 ;;
      *) continue ;;
    esac
    signature=
    if [ -n "${UPDATER_SIGNING_KEY:-}" ]; then
      TAURI_SIGNING_PRIVATE_KEY=$UPDATER_SIGNING_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${UPDATER_SIGNING_KEY_PASSWORD:-} \
        npx -y "$tauri" signer sign "$file" > /dev/null
      signature=$(cat "$file.sig")
      rm "$file.sig"
    fi
    platforms=$(jq --arg k "$key" --arg u "$base/$(basename "$file")" --arg s "$signature" --arg h "$(sha256sum "$file" | cut -d' ' -f1)" \
      '. + {($k): ({url: $u, sha256: $h} + (if $s == "" then {} else {signature: $s} end))}' <<< "$platforms")
  done
  jq -e 'has("linux-x86_64")' <<< "$platforms" > /dev/null || die "no Linux build in the draft"
  if [ "${MAC_SIGNED:-}" = true ]; then
    jq -e 'has("darwin-aarch64")' <<< "$platforms" > /dev/null || die "no macOS build in the draft"
  else
    jq -e 'has("darwin-aarch64") | not' <<< "$platforms" > /dev/null || die "an unsigned macOS build reached the draft"
  fi
  jq -n --arg channel "$channel" --arg version "$version" --arg commit "$commit" --arg notes "$notes" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson protocol "$protocol" --argjson platforms "$platforms" \
    '{product: "local-studio", channel: $channel, version: $version, commit: $commit, pub_date: $date, notes: $notes, protocol: $protocol, platforms: $platforms}'
}

kept=
discard_kept() {
  local status=$?
  [ "$status" -eq 0 ] || discard "$kept"
  exit "$status"
}

keep_nightly() {
  local version=$1 commit=$2 dir=$3 notes=$4 tag
  tag="nightly-$(sed -E 's/^[^-]+-nightly\.([0-9]{14})\+.*/\1/' <<< "$version")"
  [[ $tag =~ ^nightly-[0-9]{14}$ ]] || die "cannot read the build time from $version"
  kept=$(draft nightly "$version" "$commit" "$tag")
  trap discard_kept EXIT
  for file in "$dir"/*; do upload "$kept" "$file"; done
  feed_json nightly "$version" "$commit" "$dir" "https://github.com/$REPO/releases/download/$tag" "$notes" > "$RUNNER_TEMP/latest.json"
  upload "$kept" "$RUNNER_TEMP/latest.json"
  gh api -X PATCH "repos/$REPO/releases/$kept" -F draft=false -F prerelease=true -f make_latest=false -f body="$notes" > /dev/null
}

prune_nightlies() {
  local cutoff
  cutoff=$(date -u -d '14 days ago' +%Y%m%d%H%M%S)
  gh api "repos/$REPO/releases" --paginate -q '.[] | select(.draft | not) | .tag_name' |
    { grep -E '^nightly-[0-9]{14}$' || true; } |
    while read -r tag; do
      if [[ ${tag#nightly-} < $cutoff ]]; then
        echo "pruning $tag"
        gh release delete "$tag" -R "$REPO" --cleanup-tag --yes
      fi
    done
}

lookup() {
  local out
  out=$(gh api "$1" -q "$2" 2> /dev/null) && echo "$out" || true
}

release_id() { lookup "repos/$REPO/releases/tags/$1" .id; }

tag_sha() { lookup "repos/$REPO/git/ref/tags/$1" .object.sha; }

drop_tag() { [ -z "$(tag_sha "$1")" ] || gh api -X DELETE "repos/$REPO/git/refs/tags/$1"; }

retag() { gh api -X PATCH "repos/$REPO/releases/$1" -f tag_name="$2" -f target_commitish="$3" "${@:4}" > /dev/null; }

swap_rolling() {
  local channel=$1 id=$2 commit=$3 text=$4 previous="$1-previous" old old_sha stale
  old=$(release_id "$channel")
  stale=$(release_id "$previous")
  if [ -z "$old" ] && [ -n "$stale" ]; then
    echo "the $channel release is missing; $previous is the last good one"
    old=$stale
  elif [ -n "$stale" ]; then
    gh api -X DELETE "repos/$REPO/releases/$stale"
    drop_tag "$previous"
  fi
  old_sha=
  [ -z "$old" ] || old_sha=$(tag_sha "$(lookup "repos/$REPO/releases/$old" .tag_name)")
  if [ -n "$old" ] && [ -z "$old_sha" ]; then
    echo "the $channel release has no tag left; removing it"
    gh api -X DELETE "repos/$REPO/releases/$old"
    old=
  fi
  if [ -n "$old" ] && [ "$old" != "$stale" ]; then
    drop_tag "$previous"
    retag "$old" "$previous" "$old_sha"
  fi
  drop_tag "$channel"
  if retag "$id" "$channel" "$commit" -F draft=false -F prerelease=true -f make_latest=false -f body="$text"; then
    if [ -n "$old" ]; then
      gh api -X DELETE "repos/$REPO/releases/$old"
      drop_tag "$previous"
    fi
    return 0
  fi
  echo "::error::could not publish $channel; restoring the previous release"
  drop_tag "$channel"
  if [ -n "$old" ]; then
    retag "$old" "$channel" "$old_sha"
    drop_tag "$previous"
  fi
  exit 1
}

publish() {
  local channel=$1 id=$2 version=$3 commit=$4 dir="$RUNNER_TEMP/assets" text base
  check_newer "$channel" "$version"
  fetch_assets "$id" "$dir"
  text=$(notes "$channel" "$version" "$commit")
  [ "$channel" = nightly ] && keep_nightly "$version" "$commit" "$dir" "$text"
  case $channel in
    stable) base="https://github.com/$REPO/releases/download/v$version" ;;
    *) base="https://github.com/$REPO/releases/download/$channel" ;;
  esac
  feed_json "$channel" "$version" "$commit" "$dir" "$base" "$text" > "$RUNNER_TEMP/latest.json"
  cat "$RUNNER_TEMP/latest.json"
  upload "$id" "$RUNNER_TEMP/latest.json"
  check_newer "$channel" "$version"
  if [ "$channel" = stable ]; then
    gh api -X PATCH "repos/$REPO/releases/$id" -F draft=false -F prerelease=false -f make_latest=true -f body="$text" > /dev/null
  else
    swap_rolling "$channel" "$id" "$commit" "$text"
  fi
  [ "$channel" = nightly ] && prune_nightlies
  return 0
}

command=${1:-}
shift || true
case $command in
  feed-field) feed_field "$@" ;;
  check-newer) check_newer "$@" ;;
  draft) draft "$@" ;;
  upload) upload "$@" ;;
  discard) discard "$@" ;;
  publish) publish "$@" ;;
  *) die "usage: release.sh feed-field|check-newer|draft|upload|discard|publish ..." ;;
esac
