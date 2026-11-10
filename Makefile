# Running QTHClock needs only Go 1.22+ (see scripts/install-prereqs.sh).
# The compiled web front end (web/dist) is committed, so TypeScript is only
# needed if you edit web/src.

export PATH := /usr/local/go/bin:$(PATH)

.PHONY: all build web server run demo test watch pi prereqs clean

all: build

build: web server

prereqs:
	./scripts/install-prereqs.sh

web:
	@if command -v tsc >/dev/null 2>&1; then \
		cd web && tsc -p .; \
	else \
		echo "tsc not found: using the prebuilt web/dist (TypeScript is only needed to change web/src)"; \
	fi

server:
	@command -v go >/dev/null 2>&1 || { echo; echo "Go is not installed. Run:  ./scripts/install-prereqs.sh"; echo; exit 1; }
	@go env GOVERSION | awk -F'[go.]+' '{ if ($$2 < 1 || ($$2 == 1 && $$3 < 22)) { print "\nGo " $$0 " is too old (need 1.22+). Run:  ./scripts/install-prereqs.sh\n"; exit 1 } }'
	cd server && go build -o ../qthclock .

run: build
	./qthclock -config config.json

demo: build
	./qthclock -config config.json -demo

test:
	cd server && go test ./...

# Rebuild the front end on save (needs TypeScript: ./scripts/install-prereqs.sh --dev).
watch:
	cd web && tsc -p . --watch

# Cross-compile for a 64-bit Raspberry Pi from another machine.
pi: web
	cd server && GOOS=linux GOARCH=arm64 go build -o ../qthclock-pi .

clean:
	rm -f qthclock qthclock-pi
