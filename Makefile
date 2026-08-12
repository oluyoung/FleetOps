.PHONY: dev up down stop logs migrate migrate-down install build lint check-types test clean

# Run the full stack: infra containers + all apps via turbo dev.
# Ctrl-C stops turbo dev; infra containers keep running (use `make down` to stop them).
dev: up migrate
	npm run dev

# Start Postgres + Mosquitto + Prometheus + Grafana in the background.
up:
	docker compose up -d

# Stop and remove the infra containers (data volumes persist).
down:
	docker compose down

# Stop the infra containers without removing them.
stop:
	docker compose stop

logs:
	docker compose logs -f

install:
	npm install

# Apply Postgres migrations. Depends on `up` so Postgres is reachable.
migrate: up
	npm run migrate --workspace=api -- up

migrate-down:
	npm run migrate --workspace=api -- down

build:
	npm run build

lint:
	npm run lint

check-types:
	npm run check-types

# Requires infra up + migrated, same as `dev`.
test: up migrate
	npm run test

# Remove infra containers and their volumes (destructive: drops Postgres/Grafana data).
clean:
	docker compose down -v
