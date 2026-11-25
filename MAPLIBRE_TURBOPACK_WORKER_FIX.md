# MapLibre GL Web Worker Error in Next.js Turbopack — Detailed Fix Report

---

## Problem Summary

When running a Next.js 16 (Turbopack) application with MapLibre GL JS using **raster tile sources** (e.g., CARTO Dark Matter), the map fails to render with the following error in the browser console:

```text
Map error: Error: Worker failed to load. Check that the worker URL is correct.
    at Worker.<anonymous> (http://localhost:3000/_next/static/chunks/node_modules_maplibre-gl_dist_maplibre-gl_mjs_...:11423:42)
```

**Symptoms:**
- Map canvas remains black/blank
- "Failed to load map tiles. Check your connection." error banner appears
- Hundreds of repeated console errors (spam)
- MapLibre attempts to spawn a Web Worker for tile decoding, but Turbopack's chunk bundler intercepts the worker script URL

---

## Root Cause Analysis

### 1. How MapLibre GL Uses Web Workers
MapLibre GL JS offloads vector tile decoding, style parsing, and rendering preparation to a **Web Worker** to keep the main thread responsive. It does this by:
- Creating a `Blob` from an inline worker script
- Generating a `blob:` URL via `URL.createObjectURL()`
- Instantiating `new Worker(blobUrl)`

### 2. Why Turbopack Breaks This
Next.js **Turbopack** (enabled by default in Next.js 16+) aggressively bundles and chunks all JavaScript, including code inside `node_modules`. When MapLibre's worker blob URL is created:
- Turbopack's chunk resolver tries to resolve the worker script as a module
- The `blob:` URL is not a valid module entry point
- The worker fails to load, throwing the error above
- This happens **even for pure raster tiles** that don't need vector decoding

### 3. Why `workerCount = 0` Fails
Attempting to disable workers at runtime:
```typescript
(maplibregl as any).workerCount = 0;
```
...throws:
```text
TypeError: Cannot add property workerCount, object is not extensible
```
Because MapLibre's exported module object is **frozen/sealed** by Turbopack's module wrapper (or ES module strict mode), preventing property addition.

---

## Solution: Pass `workerUrl: ""` in Map Options

### The Fix
In `src/components/WeatherMap.tsx`, when creating the `maplibregl.Map` instance, add:

```typescript
mapRef.current = new maplibregl.Map({
  container,
  style: { ... },
  center: [lng, lat],
  zoom: 9,
  // ...other options
  // Disable web worker to avoid Turbopack "Worker failed to load" error
  // Raster tiles don't require worker thread
  // @ts-expect-error workerUrl is valid but not in MapOptions type
  workerUrl: "",
});
```

### Why This Works
| Aspect | Explanation |
|--------|-------------|
| **Official API** | `workerUrl` is a documented (but not TypeScript-typed) MapLibre option |
| **Empty string** | `workerUrl: ""` tells MapLibre "don't create a worker, run everything on main thread" |
| **Raster-only** | Since we use **raster tiles** (CARTO/OSM PNG), no vector decoding is needed — main-thread rendering is fast enough |
| **TypeScript** | Requires `@ts-expect-error` because `@types/maplibre-gl` doesn't include `workerUrl` in `MapOptions` |

---

## Complete Code Change

### File: `src/components/WeatherMap.tsx`

```diff
--- a/src/components/WeatherMap.tsx
+++ b/src/components/WeatherMap.tsx
@@ -1,4 +1,4 @@
 "use client";
 
 import React, { useState, useEffect, useRef, useCallback } from "react";
 import { useLocation } from "@/lib/location-context";
 import * as maplibregl from "maplibre-gl";
 import "maplibre-gl/dist/maplibre-gl.css";
 
 const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
 
 // Basemap sources (no API key required for basic Carto/OSM)
 // ... BASEMAP_SOURCES definition unchanged ...
 
 export default function WeatherMap({ activePage }: WeatherMapProps) {
   // ... hooks and state unchanged ...
 
   // Initialize map
   useEffect(() => {
     if (mapInitialized || !mapContainerRef.current) return;
 
     const container = mapContainerRef.current;
     if (!container) return;
 
     try {
       const source = BASEMAP_SOURCES[basemap];
 
       mapRef.current = new maplibregl.Map({
         container,
         style: {
           version: 8,
           sources: {
             basemap: {
               type: "raster",
               tiles: source.tiles,
               tileSize: 256,
               attribution: source.attribution,
               maxzoom: source.maxZoom,
             },
           },
           layers: [
             {
               id: "basemap",
               type: "raster",
               source: "basemap",
               minzoom: 0,
               maxzoom: source.maxZoom,
             },
           ],
         },
         center: [
           locationState.longitude ?? 78.4867,
           locationState.latitude ?? 17.385,
         ],
         zoom: 9,
         pitch: 0,
         bearing: 0,
         attributionControl: { compact: true },
+        // Disable web worker to avoid Turbopack "Worker failed to load" error
+        // Raster tiles don't require worker thread
+        // @ts-expect-error workerUrl is valid but not in MapOptions type
+        workerUrl: "",
       });
 
       // ... rest of map initialization unchanged ...
     }
   }, [mapInitialized, basemap, locationState.latitude, locationState.longitude, fetchWeather]);
 
   // ...
 }
```

---

## Verification Checklist

After applying the fix:

| Test | Expected Result |
|------|-----------------|
| `npm run build` | ✅ Compiles with zero TypeScript errors |
| `npm run dev` → open `http://localhost:3000` | ✅ No "Worker failed to load" errors in console |
| Navigate to page 2 (Weather Map) | ✅ CARTO Dark Matter tiles load, map renders |
| Map interactions (pan, zoom, click) | ✅ Smooth, no console errors |
| `workerUrl: ""` in production build | ✅ Works identically (no worker spawned) |

---

## Alternative Approaches (and Why They Fail)

| Approach | Result | Reason |
|----------|--------|--------|
| `(maplibregl as any).workerCount = 0` | ❌ TypeError | Module object is non-extensible in Turbopack |
| `(maplibregl as any).config = { WORKER_URL: "" }` | ❌ No effect | Config is read once at module init, not per-map |
| `next.config.js: transpilePackages: ['maplibre-gl']` | ❌ Doesn't fix | Worker blob URL is created at runtime, not compile time |
| `webpack: { experiments: { asyncWebAssembly: true } }` | ❌ Irrelevant | Not a WASM issue |
| Dynamic import with `ssr: false` | ❌ Partial | Still creates worker in browser |
| Use MapTiler/Mapbox vector tiles with API key | ❌ Overkill | Requires paid key; raster tiles work free |

---

## Production Notes

- **`workerUrl: ""` is safe for production** — it simply disables the worker thread. For raster-only maps, performance impact is negligible.
- **If you later add vector layers** (e.g., GeoJSON, vector tiles), remove `workerUrl: ""` and ensure Turbopack is configured to serve the worker script correctly (see [MapLibre docs](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#workerurl)).
- **Next.js 15+ (Webpack)** does not have this issue — it's specific to **Turbopack's chunk resolver** in Next.js 16+.

---

## Related Files

| File | Purpose |
|------|---------|
| `src/components/WeatherMap.tsx` | Main fix location — `workerUrl: ""` in Map constructor |
| `next.config.ts` | Contains `turbopack.root` fix (unrelated but required for clean builds) |
| `package.json` | Dependency: `maplibre-gl@^5.x` |

---

## References

- [MapLibre GL JS `workerUrl` option](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#workerurl)
- [Next.js Turbopack Documentation](https://nextjs.org/docs/app/building-your-application/configuring/turbopack)
- [MapLibre Worker Source](https://github.com/maplibre/maplibre-gl-js/blob/main/src/ui/map/worker.ts)

---

**Fix applied:** ✅ Build passes, dev server runs, map renders correctly in Turbopack dev mode.