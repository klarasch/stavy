# Recipes

Short answers to the common tasks. Each one is complete: you shouldn't need
Stavy's scripts, schema or viewer bundle to do it. Field details are in
`fields.md`; open it only if a recipe points there.

## See what a screen has, without reading the whole manifest

```bash
npm run stavy:ls
```

lists every screen with its fidelity, number of states, group and URL.

```bash
npm run stavy:ls -- <screen>
```

shows one screen: each state's URL and scan key, its dimensions, and the
flows that use it. Add `--json` to either for JSON.

If `stavy:ls` isn't in `package.json` yet, run `npm run stavy:update`.

Change the manifest with small, targeted edits to one entry. Never rewrite
the whole file with a script.

## Add a state to a screen

1. In the app, make the state reachable by URL: usually a `scene` value the
   screen reads (next recipe).
2. Add one entry to that screen's `states` in `stavy.json`:
   `{ "id": "empty", "url": "/contacts?scene=contacts-empty", "note": "First run" }`
3. `npm run stavy:validate`, then `npm run stavy:scan -- --keys contacts/empty`.

## Add a scene

A scene is a named patch over the app's base fixture data, read from the URL.

1. Find where the app reads `scene` (search for `scene` in the fixtures or
   data layer) and add one named entry there. Don't add a second mechanism.
2. The entry changes data only: clear a list, set a status, open a panel.
3. Keep it deterministic: fixed clock, seeded ids (`STAVY.md` rule 6).

## Add a new screen

1. Add a route that renders real kit components from fixture data selected
   by `scene`. Keep it `static`: no handlers, stores or effects on other
   screens (`STAVY.md` rule 3).
2. Register it with its states and `"fidelity": "static"`:
   `{ "id": "keys", "label": "API keys", "group": "Settings", "url": "/settings/keys", "fidelity": "static", "states": [ … ] }`
3. Validate, then scan just that screen: `--keys keys`.

## Register a dialog, drawer or confirmation

Make it a state: a scene that renders the screen with the dialog already
open, such as `/settings/keys?scene=keys-revoke-confirm`. Initialise the
dialog's `open` from the scene. Its buttons do nothing until a flow needs
them. One state per dialog moment (empty form, filled, error, confirm) is
normal.

## Capture an open menu, hover or focus

Prefer a scene if the moment matters to the review. If it only exists after
a click and has no URL:

- On a board, use a `screen` item with `do`:
  `{ "type": "screen", "screen": "contacts", "state": "loaded", "do": [{ "click": "FilterButton" }] }`
- In a flow, give the step `"via": "click"` and the `target` that the
  previous step's click opens.

`do` targets are a target id, a CSS selector, or visible text. `do` only
opens and points: never use it to type into or submit anything.

## Add a dimension

Use a dimension only for a real axis a reviewer compares across (role,
locale, release phase). For "which moment of this screen", add a state
instead.

1. Declare the axis once, at the top of `stavy.json` under `dimensions`:
   `{ "id": "role", "label": "Role", "kind": "role", "values": [{ "id": "admin", "label": "Admin" }, { "id": "viewer", "label": "Viewer" }] }`
   Add `"scope": "workspace"` if one choice should hold across every screen.
   The first value is the default.
2. On each screen that varies by it, put `{role}` in the `url`, and list the
   values it supports and its default:
   `"url": "/members?role={role}", "dimensions": { "role": ["admin", "viewer"] }, "defaults": { "role": "admin" }`
3. In the app, read the URL param (`role`) where the screen gets its data.
   Stavy only writes it into the URL; it never sets it any other way.
4. Pin the combinations to show as cards:
   `"instances": [{ "dims": { "role": "viewer" }, "note": "Read-only" }]`
5. Validate, then scan the screen.

## Check your work

Run once, after your edits, not after each one:

```bash
npm run stavy:validate
```

```bash
npm run stavy:scan -- --keys <screen>,<screen>/<state>
```

Read the text output: `✗` means the state didn't load, `missing target`
names an id the page doesn't have, and `console:` shows errors. Fix those,
scan the same keys again, then stop. A person reviews the pictures on the
canvas. Don't open screenshots or write browser scripts.

`stavy:validate` also prints a `fidelity:` line, such as `11 static ·
3 navigable`. If a screen you touched moved above `static`, say which flow
or review needed it.

## Don't write these unless asked

Docs, boards, `decisions.md`, the changelog, handover notes and local rules.
They belong to a checkpoint or handover, not to iterating. When someone asks
for one of them, load the matching file from the skill's table first.
