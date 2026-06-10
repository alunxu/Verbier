#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$PROJECT_ROOT/verbier-curator"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
BASE_URL="http://${HOST}:${PORT}"

missing=0
warnings=0

ok() {
  printf 'OK   %s\n' "$1"
}

warn() {
  printf 'WARN %s\n' "$1"
  warnings=$((warnings + 1))
}

fail() {
  printf 'MISS %s\n' "$1"
  missing=$((missing + 1))
}

need_file() {
  if [ -f "$PROJECT_ROOT/$1" ]; then
    ok "$1"
  else
    fail "$1"
  fi
}

need_dir() {
  if [ -d "$PROJECT_ROOT/$1" ]; then
    ok "$1/"
  else
    fail "$1/"
  fi
}

optional_file() {
  if [ -f "$PROJECT_ROOT/$1" ]; then
    ok "$1"
  else
    warn "$1"
  fi
}

echo "Verbier Curator demo preflight"
echo "Project root: $PROJECT_ROOT"
echo

if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  fail "Node.js is not installed or not on PATH"
fi

echo
echo "App entry files"
need_file "demo/server.mjs"
need_file "verbier-curator/package.json"
need_file "verbier-curator/index.html"
need_file "verbier-curator/choose.html"
need_file "verbier-curator/become-conductor.html"
need_file "verbier-curator/follow.html"
need_file "verbier-curator/gesture-guide.html"

echo
echo "Local app dependencies"
if [ -d "$APP_DIR/node_modules" ]; then
  ok "verbier-curator/node_modules/ (available, but the demo server does not require it)"
else
  warn "verbier-curator/node_modules/ missing; static demo still runs, Vite development mode would need npm install"
fi

echo
echo "Required local media folders"
need_dir "media"
need_dir "reorchestrate-poc/lens-assets"
need_dir "verbier-curator/public/assets/audio"
need_dir "verbier-curator/public/assets/stems"

echo
echo "Current demo media"
need_file "media/Mozart/VIDEO_AUDIO/Mozart_Video.mp4"
need_file "media/Haydn/VIDEO_AUDIO/Haydn_video.mp4"
need_file "media/Beethoven/VIDEO_AUDIO/Beethoven_video.mp4"
optional_file "Prototype_.mp4"

echo
echo "Gesture-control lens assets"
for piece in Mozart Haydn Beethoven Mozart_40 Mozart_Haffner Schubert; do
  need_file "reorchestrate-poc/lens-assets/${piece}/manifest.json"
  need_file "reorchestrate-poc/lens-assets/${piece}/preview.mp3"
  need_file "reorchestrate-poc/lens-assets/${piece}/mix.wav"
done

echo
echo "Static app visuals"
need_file "verbier-curator/public/v_logo_transparent.png"
need_file "verbier-curator/public/v_splash_bg.png"
need_file "verbier-curator/public/choose-bg-follow.jpg"

PHOTO_ROOT="/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/verbier-1994-2022-photos/Photos"
if [ -d "$PHOTO_ROOT" ]; then
  ok "$PHOTO_ROOT"
else
  warn "$PHOTO_ROOT not mounted; the app still runs, but some archive photo backgrounds may be missing"
fi

echo
echo "Server check"
if command -v curl >/dev/null 2>&1 && curl -fsS "$BASE_URL/choose.html" >/dev/null 2>&1; then
  ok "$BASE_URL/choose.html is responding"
  for page in / /choose.html /become-conductor.html /follow.html /gesture-guide.html; do
    if curl -fsS "$BASE_URL$page" >/dev/null 2>&1; then
      ok "$BASE_URL$page"
    else
      warn "$BASE_URL$page did not respond"
    fi
  done
else
  warn "No demo server responding at $BASE_URL. Run ./demo/run-demo.sh to start it."
fi

echo
if [ "$missing" -eq 0 ]; then
  echo "Preflight complete: no required files are missing. Warnings: $warnings"
  exit 0
else
  echo "Preflight complete: $missing required item(s) missing. Warnings: $warnings"
  exit 1
fi
