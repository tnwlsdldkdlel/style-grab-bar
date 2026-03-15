# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StyleGrabber is a **Figma plugin** that extracts typography styles and color palettes from websites. It consists of two workspaces in an npm monorepo:

- **`plugin/`** — Figma plugin (React UI + Figma sandbox controller)
- **`server/`** — Express backend that uses Puppeteer to scrape computed styles from web pages

## Commands

```bash
# Install dependencies (from root)
npm install

# Development
npm run dev:server     # Build & run server with --watch (port 3001)
npm run dev:plugin     # Build plugin with --watch

# Production build
npm run build:server   # tsc compile server
npm run build:plugin   # esbuild bundle plugin
```

## Architecture

### Data Flow

1. User enters URLs in the Figma plugin UI (`plugin/src/ui/App.tsx`)
2. UI sends POST requests to `http://localhost:3001/api/extract` for each URL sequentially
3. Server launches Puppeteer, navigates to the URL, and runs `page.evaluate()` to extract computed styles from text elements (`server/src/services/parser.ts`)
4. Server tags each style with a semantic group (heading/body/interactive/navigation/table) and detects grid scale systems (4px/8px)
5. Results are sent back to the UI, then forwarded to the plugin controller via `parent.postMessage`
6. Controller (`plugin/src/plugin/controller.ts`) calls `renderTables()` to generate Figma frames with typography cards, color palettes, and a comparison dashboard

### Plugin Build System

`plugin/build.mjs` uses esbuild to:
- Bundle `controller.ts` as IIFE (runs in Figma's plugin sandbox, ES2017 target)
- Bundle `ui/index.tsx` as IIFE, then inlines the JS into `dist/ui.html` (Figma requires a single HTML file for plugin UI)

### Key Types

Shared types are defined separately in both `plugin/src/types/index.ts` and `server/src/types/index.ts`. Core types: `TypographyStyle`, `ExtractResult`, `SemanticGroup`, `PluginMessage`.

### Figma Rendering (`plugin/src/plugin/tableRenderer.ts`)

This is the largest file. It builds Auto Layout frames in Figma:
- Per-site sections with typography cards grouped by semantic category
- Color palette section with swatch cards
- Comparison dashboard (shown when 2+ sites) with common/unique fonts, colors, and sizes across sites
- All text nodes use the "Inter" font family (Regular and Bold)

### Server Notes

- `server/src/services/fetcher.ts` is a placeholder — Puppeteer handles page loading directly in `parser.ts`
- The parser extracts styles from a fixed set of HTML element selectors (h1-h6, p, span, a, li, etc.) and deduplicates by computed style signature
- 15-second timeout per page load
