# Needs Go 1.22+ and TypeScript (npm i -g typescript). No other dependencies.

.PHONY: all build web server run demo test watch pi clean

all: build

build: web server

web:
	cd web && tsc -p .

server:
	cd server && go build -o ../qthclock .

run: build
	./qthclock -config config.json

demo: build
	./qthclock -config config.json -demo

test:
	cd server && go test ./...

# Rebuild the front end on save (run `make run` in another terminal, then refresh).
watch:
	cd web && tsc -p . --watch

# Cross-compile for a Raspberry Pi (64-bit OS). Copy qthclock-pi, web/ and config.json across.
pi: web
	cd server && GOOS=linux GOARCH=arm64 go build -o ../qthclock-pi .

clean:
	rm -rf web/dist qthclock qthclock-pi
