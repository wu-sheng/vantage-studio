# Copyright 2026 The Vantage Studio Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

.PHONY: help install dev build test lint typecheck format check image compose-up compose-down

COMPOSE := docker compose -f deploy/docker/docker-compose.yml

help: ## show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## pnpm install
	pnpm install

dev-bff: ## run the BFF in watch mode (Node 24 --strip-types)
	pnpm -F @vantage-studio/bff dev

dev-ui: ## run the SPA dev server (Vite at :5173, proxies /api to :8080)
	pnpm -F @vantage-studio/ui dev

build: ## build SPA + bundle BFF for production
	pnpm -F @vantage-studio/ui build
	pnpm -F @vantage-studio/bff build

test: ## run all tests
	pnpm test

lint: ## run eslint
	pnpm lint

typecheck: ## run vue-tsc + tsc across the workspace
	pnpm typecheck

format: ## run prettier --write
	pnpm format

check: lint typecheck test ## what CI runs

image: ## build the production Docker image
	docker build -f deploy/docker/Dockerfile -t vantage-studio:dev .

compose-up: ## bring up studio + oap + banyandb
	$(COMPOSE) up --build

compose-down: ## tear it all down
	$(COMPOSE) down --volumes
