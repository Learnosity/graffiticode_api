default: build
	npm start

test:
	npm run test

build:
	npm run build-dev
	npm run build

dev:
	npm run dev

deploy: $(eval SHELL:=/bin/bash)
	gcloud builds submit \
		--config cloudbuild.deploy.json \
		--substitutions=COMMIT_SHA="$$(git rev-parse HEAD)"

.PHONY: build test
