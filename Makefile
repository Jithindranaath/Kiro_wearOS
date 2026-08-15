.PHONY: setup dev demo test check build wear clean

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

build:
	pnpm -r build

clean:
	pnpm -r exec -- rm -rf dist
	rm -rf node_modules
