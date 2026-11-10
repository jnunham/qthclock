#!/usr/bin/env bash
# Installs what QTHClock needs to build and run.
#
#   ./scripts/install-prereqs.sh          # Go (required)
#   ./scripts/install-prereqs.sh --dev    # also Node.js + TypeScript, only needed to edit web/src
#
# Works on Raspberry Pi OS / Debian / Ubuntu (64- and 32-bit) and other Linux with curl.
# Debian's own "golang" package is often too old, so Go comes from go.dev.
set -euo pipefail

MIN_GO="1.22"
DEV=0
[[ "${1:-}" == "--dev" ]] && DEV=1

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"

# Basic tools
missing=()
for t in curl tar make git; do have "$t" || missing+=("$t"); done
if ((${#missing[@]})); then
  say "Installing ${missing[*]}"
  if have apt-get; then $SUDO apt-get update -y && $SUDO apt-get install -y "${missing[@]}"
  else echo "Please install: ${missing[*]}"; exit 1; fi
fi

# Go
version_ok() { # $1 = "go1.24.7"
  local v="${1#go}"; local major="${v%%.*}"; local rest="${v#*.}"; local minor="${rest%%.*}"
  local need_minor="${MIN_GO#*.}"
  [[ "$major" -gt 1 || ( "$major" -eq 1 && "$minor" -ge "$need_minor" ) ]]
}
export PATH="/usr/local/go/bin:$PATH"
if have go && version_ok "$(go env GOVERSION)"; then
  say "Go $(go env GOVERSION) is already installed"
else
  case "$(uname -m)" in
    aarch64|arm64) arch=arm64 ;;
    armv7l|armv6l) arch=armv6l ;;
    x86_64|amd64)  arch=amd64 ;;
    *) echo "Unsupported CPU $(uname -m); install Go $MIN_GO+ from https://go.dev/dl/"; exit 1 ;;
  esac
  ver="$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)"
  say "Installing $ver for linux-$arch into /usr/local/go"
  curl -fL "https://go.dev/dl/${ver}.linux-${arch}.tar.gz" -o /tmp/go.tgz
  $SUDO rm -rf /usr/local/go
  $SUDO tar -C /usr/local -xzf /tmp/go.tgz
  rm -f /tmp/go.tgz
  if ! grep -qs '/usr/local/go/bin' "$HOME/.profile"; then
    echo 'export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"' >> "$HOME/.profile"
  fi
  go version
fi

# Node + TypeScript (only for front-end development)
if ((DEV)); then
  if ! have npm; then
    say "Installing Node.js and npm"
    $SUDO apt-get install -y nodejs npm
  fi
  if ! have tsc; then
    say "Installing TypeScript"
    $SUDO npm install -g typescript
  fi
  tsc --version
fi

say "Done."
cat <<MSG

Next:
  source ~/.profile      # (once, so this shell can find Go)
  make run

Then open http://localhost:8073 (or http://<this-pi's-ip>:8073 from another computer).
MSG
