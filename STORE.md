# Chrome Web Store Listing

Metadata for the Chrome Web Store submission.

## Basic Info

- **Extension name:** MapBridge — Migrate Map Favorites
- **Category:** Productivity
- **Language:** English

## Short Description (132 chars max)

Migrate your map favorites between Baidu Maps and Amap. Fully local — no server, no sign-in.

## Detailed Description

MapBridge lets you move your saved places between Chinese map services without copy-pasting coordinates or addresses.

**How it works:**

1. Open the map service where your favorites are saved (Baidu Maps or Amap).
2. Click the MapBridge icon and select Source → Target.
3. Preview the extracted favorites, edit or remove entries you don't want.
4. Click Import — MapBridge writes them directly into the target map's favorites.

Everything happens locally in your browser. No data is sent to any server.

**Features:**

- Extract favorites from Baidu Maps or Amap with one click.
- Preview and edit the list before importing.
- Automatic coordinate conversion (BD-09 ↔ GCJ-02 ↔ WGS-84).
- Deduplication — duplicate entries are detected and skipped.
- No account or sign-in required. No server involved.

**Supported platforms:**

- Baidu Maps (map.baidu.com)
- Amap (amap.com)

More platforms coming soon.

## Permissions Justification

| Permission | Reason |
|---|---|
| `tabs` | Query open tabs to detect which map service is active |
| `host_permissions: *://map.baidu.com/*` | Read favorites from Baidu Maps pages |
| `host_permissions: *://ditu.baidu.com/*` | Read favorites from Baidu Maps pages |
| `host_permissions: *://ditu.amap.com/*` | Read and write favorites on Amap pages |
| `host_permissions: *://www.amap.com/*` | Read and write favorites on Amap pages |
| `host_permissions: *://newclient.map.baidu.com/*` | Read favorites from Baidu Maps client pages |

## Privacy Policy URL

After enabling GitHub Pages on the repo:
`https://queenkunkun.github.io/mapbridge/PRIVACY`

## Screenshot

At least 1 required (1280×800, PNG or JPEG). Suggested approach:

- Center the popup on a dark branded background, add a one-line caption
- Or compose a before/after flow: source popup → target result

## Promotional Tile (required)

- Size: 440×280 px
- Show the MapBridge logo on a dark background with the tagline: "Move your favorites between maps."
