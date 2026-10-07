---
status: resolved
trigger: "目前插件节点，点击后没有了属性配置，严重bug"
created: 2026-08-19T00:00:00+08:00
updated: 2026-08-19T08:31:30+08:00
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "The property inspector depends on a fragile indirect FlowGram selection bridge and is placed below the fixed-height canvas at Chrome side-panel widths, so node clicks either fail to publish selectedId or update an inspector outside the visible viewport."
  confirming_evidence:
    - "NodeInspector only renders configuration when App.selectedId resolves to an item in state.draft."
    - "CanvasBridge ignores the selection array emitted by onSelectionChanged and rereads the global selection service."
    - "Below 700px, canvas-layout is a single column and the 430px canvas precedes NodeInspector; no scrolling or overlay behavior reveals the inspector after selection."
  falsification_test: "Verify a node-card click invokes React onSelect directly, FlowGram selection filters non-node entities, and the selected inspector is fixed inside the viewport below 700px."
  fix_rationale: "Publish selection directly from node-card clicks, consume the emitted FlowGram selection array for secondary synchronization, and show the selected inspector as a closable bottom panel at side-panel widths."
  blind_spots: "Final manual verification still requires reloading dist in the user's Chrome extension."
next_action: reload the production dist extension and click DOM, AI, loop, and wait cards at normal side-panel width

## Symptoms

expected: clicking a workflow node displays that node's editable properties in NodeInspector
actual: clicking a workflow node leaves the property configuration absent
errors: no explicit error reported
reproduction: open compose mode with a workflow node and click the node card
started: reported after commit b381c0a; compare against f2656b0

## Eliminated

- The smart DOM event editor is not rendered until a DOM node has already been resolved, so it cannot explain failure to resolve every node kind.
- The b381c0a port click change only affects output ports and stops propagation there; it does not directly handle node-card clicks.

## Evidence

- timestamp: 2026-08-19T00:00:00+08:00
  checked: App selected node derivation and WorkflowCanvas selection bridge
  found: App passes state.draft.find(node.id === selectedId) to NodeInspector; CanvasBridge is the only normal node-click path that sets selectedId and currently ignores the selection event payload.
  implication: any missed, reordered, or non-node FlowGram selection immediately turns the inspector into its empty state.
- timestamp: 2026-08-19T08:25:00+08:00
  checked: FlowGram 1.0.13 WorkflowNodeRenderer and SelectionService implementation
  found: WorkflowNodeRenderer selects on its internal click and SelectionService synchronously emits the selected entity array; the app ignored that array and had no direct node-card-to-React selection callback.
  implication: the application unnecessarily depended on global selection rereads and could not independently guarantee that clicking a rendered card selects its matching draft node.
- timestamp: 2026-08-19T08:27:00+08:00
  checked: responsive canvas and inspector CSS at Chrome side-panel widths
  found: below 700px the property inspector follows a fixed 430px canvas in a single-column grid, remains outside the initial viewport, and selection performs no scroll or overlay transition.
  implication: even a successful selection looks like no response in the normal narrow extension side panel.
- timestamp: 2026-08-19T08:31:30+08:00
  checked: focused selection regression tests, full repository tests, production plugin build, MCP build, temporary harness cleanup, dev server shutdown, and whitespace validation
  found: 19/19 tests pass; plugin TypeScript/Vite production build passes; MCP TypeScript build passes; no dev mock remains; dist is production output; git diff --check passes.
  implication: selection extraction, packaging, and builds are regression-covered and clean for manual extension verification.

## Resolution

root_cause: Node property display relied solely on an indirect FlowGram selection-service bridge that ignored its event payload, while the normal narrow Chrome side-panel layout rendered NodeInspector below a 430px canvas with no reveal behavior; clicks could therefore miss React selection or update an off-screen panel.
fix: Node cards now publish their ID directly to React, the FlowGram bridge resolves only workflow node IDs from its emitted selection array, and selected properties open in a closable, scrollable bottom panel below 700px while retaining the desktop right inspector.
verification: 19/19 unit tests pass, including node/edge selection filtering; plugin production build passes; MCP build passes; git diff --check passes; temporary browser harness was removed and the dev server was stopped before the final production build.
files_changed: [src/sidepanel/App.tsx, src/sidepanel/NodeInspector.tsx, src/sidepanel/WorkflowCanvas.tsx, src/sidepanel/canvas-selection.ts, src/sidepanel/canvas-selection.test.ts, src/sidepanel/styles.css]
