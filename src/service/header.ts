/*---
compatibilityVersion: naiscript-1.0
id: 9a2772ae-1eac-4259-8d27-261687badc8c
name: "UCCDS: Universal Customizable Chapter Detection System"
version: 1.0.0
author: MidMeantime
description: "Dependency script. Finds the chapters in your story (headers, Prologue/Epilogue, Part/Book/Act, scene breaks) and shares them with other scripts that support UCCDS, so every script agrees on what a chapter is. Set your chapter rules once in this script's Config tab. Free to use and remix (MIT)."
memoryLimit: 8
config:
  # @uccds-config
  - name: uccds_watch_seconds
    prettyName: "[UCCDS] Change Check Interval (seconds)"
    type: number
    default: 10
    min: 3
    max: 120
    decimal: false
    description: "How often to check for chapter changes while a connected script is listening for them. Only runs when a script asked to be told about changes."
---*/
/**
 * UCCDS dependency script for NovelAI
 *
 * Other scripts ask this one for the story's chapters through api.v1.messaging (channel "uccds").
 * The user's chapter rules live in this script's config, so one setting applies to every script
 * that uses it. Protocol and client: see README.md / dist/uccds-client.ts.
 *
 * Built from: src/chapter-headers.ts + src/uccds-types.ts + src/uccds-core.ts + src/service/*.
 * Free to share, fork and change (MIT). Credit appreciated, never required.
 */
