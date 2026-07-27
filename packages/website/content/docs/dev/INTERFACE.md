# Interface

## Main interface

![](../assets/marktext-interface.png)

- Green: title bar
- Orange: sidebar
- Red: editor tabs, document surface, and per-tab notification area

### Title bar

The title bar shows the current file path and application menus. macOS uses its
native window presentation; Linux and Windows can use the custom or native
title bar according to preferences.

### Sidebar

The sidebar contains the file tree, opened files, search, table of contents,
and Review panels. It can be resized or hidden.

### Editor

The editor surface is mounted by `@marktext/document-view` from the active
document-core session. Tabs sit above it and per-tab status appears below it.
All rendered ranges come from the parser-owned document revision.

Source mode mounts an exact source projection and sends typed range gestures to
the same session. It has no separate parser, document buffer, or undo history.
The Review sidebar, command palette, menus, and pointer tool consume one typed
Review snapshot and dispatch typed commands back to that owner.
