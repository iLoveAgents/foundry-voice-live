# Foundry Voice Live - Task Runner
# https://github.com/casey/just

# Default recipe - show available commands
default:
    @just --list

# ============================================
# Installation
# ============================================

# Install all dependencies
install:
    pnpm install

# Clean install (remove node_modules first)
clean-install:
    rm -rf node_modules packages/*/node_modules demos/*/node_modules
    pnpm install

# ============================================
# Build
# ============================================

# Build all packages
build:
    pnpm -r run build

# Build react package only
build-react:
    pnpm --filter @iloveagents/foundry-voice-live-react run build

# Build proxy-node package only
build-proxy:
    pnpm --filter @iloveagents/foundry-voice-live-proxy-node run build

# ============================================
# Development
# ============================================

# Run all dev servers in parallel
dev:
    pnpm -r --parallel run dev

# Run playground dev server
dev-playground:
    pnpm --filter playground run dev

# Run avatar demo dev server
dev-avatar:
    pnpm --filter avatar run dev

# Run proxy dev server
dev-proxy:
    pnpm --filter @iloveagents/foundry-voice-live-proxy-node run dev

# Watch mode for react package
watch-react:
    pnpm --filter @iloveagents/foundry-voice-live-react run dev

# ============================================
# Testing
# ============================================

# Run all tests
test:
    pnpm -r run test

# Run tests with coverage
test-coverage:
    pnpm -r run test -- --coverage

# Run react package tests
test-react:
    pnpm --filter @iloveagents/foundry-voice-live-react run test

# Run proxy tests
test-proxy:
    pnpm --filter @iloveagents/foundry-voice-live-proxy-node run test

# ============================================
# Linting & Formatting
# ============================================

# Lint all packages
lint:
    pnpm -r run lint

# Fix linting issues
lint-fix:
    pnpm -r run lint -- --fix

# Format all files with prettier
format:
    pnpm -r run format

# Type check all packages
typecheck:
    pnpm -r run typecheck

# ============================================
# Publishing
# ============================================

# Dry run publish (preview what would be published)
publish-dry:
    pnpm --filter @iloveagents/foundry-voice-live-react publish --dry-run
    pnpm --filter @iloveagents/foundry-voice-live-proxy-node publish --dry-run

# Publish all packages
publish-all:
    pnpm --filter @iloveagents/foundry-voice-live-react publish --access public
    pnpm --filter @iloveagents/foundry-voice-live-proxy-node publish --access public

# ============================================
# Utilities
# ============================================

# Show dependency graph
deps:
    pnpm list -r --depth 0

# Update all dependencies
update:
    pnpm -r update

# Clean all build artifacts
clean:
    rm -rf packages/*/dist demos/*/dist
    rm -rf packages/*/.turbo demos/*/.turbo

# ============================================
# Future: Python tasks (uncomment when needed)
# ============================================

# build-python:
#     cd packages/proxy-python && poetry build

# test-python:
#     cd packages/proxy-python && poetry run pytest

# publish-python:
#     cd packages/proxy-python && poetry publish
