# SolPersona Gallery for Roku.
#
#   make            lint + tests + zip (what CI runs)
#   make sideload   install build/solpersona-gallery-roku.zip on ROKU_IP
#   make dev        zip + sideload
#   make test-device run the Rooibos suite on the Roku itself
#   make mock       a stand-in SolPersona on :8090 for development
#
# Device targets read ROKU_IP and ROKU_PASSWORD from the environment or a
# git-ignored .env file (see README).

NODE_BIN := node_modules/.bin
ZIP := build/solpersona-gallery-roku.zip

.PHONY: all install lint test test-device zip sideload dev package screenshot debug mock art clean

all: lint test zip

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

install: node_modules

lint: node_modules
	$(NODE_BIN)/bsc --project bsconfig.json --create-package false
	node tools/check-namespaces.mjs

test: node_modules
	node tools/run-headless-tests.mjs

zip: node_modules
	$(NODE_BIN)/bsc --project bsconfig.json
	@ls -l $(ZIP)

sideload: $(ZIP)
	node tools/roku.mjs sideload $(ZIP)

dev: zip sideload

test-device: node_modules
	$(NODE_BIN)/bsc --project bsconfig.test.json
	node tools/roku.mjs test

package: zip
	node tools/roku.mjs package

screenshot:
	node tools/roku.mjs screenshot

debug:
	node tools/roku.mjs debug

mock: node_modules
	node tools/mock-server.mjs

art: node_modules
	node tools/make-art.mjs

clean:
	rm -rf build
