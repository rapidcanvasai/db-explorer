.PHONY: help setup dev backend frontend db-up db-down clean install reset

SHELL := /bin/bash
VENV := .venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

help:
	@echo "DB Explorer — local dev commands"
	@echo ""
	@echo "  make setup      First-time setup: venv, pip install, npm install, .env"
	@echo "  make dev        Start backend (:8001) + frontend (:5174) together"
	@echo "  make backend    Run FastAPI backend only"
	@echo "  make frontend   Run Vite frontend only"
	@echo "  make db-up      Start local MySQL via docker compose (port 3307)"
	@echo "  make db-down    Stop local MySQL"
	@echo "  make reset      Remove venv + node_modules (nuclear option)"
	@echo ""

setup:
	@./scripts/bootstrap.sh

install: setup

dev:
	@./scripts/dev.sh

backend:
	@$(PY) run.py

frontend:
	@cd dashboard && npm run dev

db-up:
	@docker compose up -d mysql
	@echo "MySQL starting on localhost:3307 (db=app_db, user=connector, pw=localtest)"

db-down:
	@docker compose down

reset:
	@rm -rf $(VENV) dashboard/node_modules
	@echo "Removed venv and node_modules. Run 'make setup' to reinstall."
