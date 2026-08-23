.PHONY: setup dev demo test check build wear wear-release clean verify verify-quick verify-node

setup:
	pnpm install
	pnpm --filter @aibou/protocol build

dev:
	pnpm --filter @aibou/bridge dev

demo:
	pnpm --filter @aibou/bridge demo

test:
	pnpm -r test

check:
	pnpm -r typecheck
	pnpm -r test

# Full verification. Needs a running Bridge in live mode and a Wear emulator.
verify:
	node scripts/verify-all.mjs

# Same, minus the 95s backgrounded-approval wait.
verify-quick:
	node scripts/verify-all.mjs --quick

# Types, lint and unit tests only — no emulator required.
verify-node:
	node scripts/verify-all.mjs --skip-device

build:
	pnpm -r build

# Signed, installable Wear OS APK. Needs wear/keystore.properties.
wear-release:
	scripts/wear-release.sh

clean:
	pnpm -r exec -- rm -rf dist
	rm -rf node_modules
