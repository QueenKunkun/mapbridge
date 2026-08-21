# MapBridge — Privacy Policy

**Effective date:** August 2026

## Overview

MapBridge is a browser extension that helps you migrate map favorites between Chinese map services (Baidu Maps and Amap). All operations happen **entirely locally** in your browser.

## Data Collection

MapBridge **does not collect, store, transmit, or share any personal data.**

- No analytics, telemetry, or tracking tools are used.
- No data is sent to any external server.
- No cookies are set or read.

## How It Works

When you use MapBridge:

1. The extension reads favorites data from the map service website **currently open in your browser tab** (e.g., Baidu Maps or Amap).
2. This data is processed entirely within your browser — it never leaves your device.
3. The extension writes the processed data back to the target map service **through the same browser tab**, using the map service's own session.

At no point does MapBridge transmit your favorites, coordinates, addresses, or any other data to a third party.

## Permissions

MapBridge requests the following browser permissions:

| Permission | Why it is needed |
|---|---|
| `tabs` | To detect which map service tab is open and send messages to content scripts |
| `host_permissions` (map.baidu.com, ditu.amap.com, etc.) | To read and write favorites on the specific map service pages you have open |

These permissions are used **only** for the core functionality described above. They are never used for data collection or tracking.

## Third-Party Services

MapBridge does **not** integrate with or send data to any third-party services, analytics providers, or advertising networks.

## Changes to This Policy

If this privacy policy is updated, the changes will be published on this page with a revised effective date.

## Contact

If you have questions about this privacy policy, please open an issue on the [MapBridge GitHub repository](https://github.com/QueenKunkun/mapbridge).
