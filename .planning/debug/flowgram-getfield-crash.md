---
status: awaiting_human_verify
trigger: "点击编辑模式，一片空白，啥也没显示，插件报错提示：TypeError: o.getField is not a function"
created: 2026-08-16T01:27:56+08:00
updated: 2026-08-16T01:47:40+08:00
---

## Current Focus

reasoning_checkpoint:
  hypothesis: CanvasNode renders FlowGram Field directly instead of through useNodeRender().form.render(), so Field receives the default empty FormModelContext object and calls a nonexistent getField method.
  confirming_evidence:
    - Installed @flowgram.ai/free-layout-editor is exactly 1.0.13 and its Field implementation executes `const formModel = useFormModel(); formModel.getField(name)`.
    - FlowGram's useNodeRender exposes `form.render()`, and getNodeForm implements it by returning NodeRender, which wraps registry formMeta.render in a real Form provider.
    - Project CanvasNode renders `<Field name="config">` directly, while its registry formMeta currently renders an unrelated hidden title Field.
  falsification_test: If moving the config Field into registry formMeta.render and rendering it via form.render() still produces getField in a built runtime smoke test, this hypothesis is false.
  fix_rationale: It restores the Form provider boundary required by FlowGram rather than suppressing the exception or avoiding field access.
  blind_spots: The Chrome extension's real sidepanel cannot be fully clicked from this shell; verification can cover the exact provider behavior, TypeScript build, production bundle, and tests before user confirmation.
next_action: user reloads the unpacked dist extension and confirms compose mode renders without the getField exception

## Symptoms

expected: clicking compose/edit mode renders the workflow canvas and node property UI
actual: compose/edit mode renders a blank panel
errors: TypeError: o.getField is not a function
reproduction: open the Chrome extension side panel and click edit/compose mode
started: after integrating the FlowGram canvas in version 0.2.0

## Eliminated

- hypothesis: The plain-object formMeta itself must implement getField().
  evidence: FlowGram 1.0.13 declares V2 FormMeta as a plain object with render(), and FormModelV2 consumes it; getField belongs to the React FormModelContext value, not formMeta.
  timestamp: 2026-08-16T01:38:30+08:00

## Evidence

- timestamp: 2026-08-16T01:31:40+08:00
  checked: src/sidepanel/WorkflowCanvas.tsx and package.json
  found: CanvasNode imports FlowGram Field and reads name="config"; getNodeDefaultRegistry returns formMeta as the plain object `{ render: ... }`; dependency range resolves from `^1.0.13`.
  implication: the integration has two possible form-context mismatches, with the plain formMeta object the highest-probability source of a missing getField method.

- timestamp: 2026-08-16T01:38:30+08:00
  checked: installed @flowgram.ai/form Field runtime at dist/index.js and @flowgram.ai/free-layout-core useNodeRender runtime/types
  found: Field unconditionally calls `formModel.getField(name)` from FormModelContext; the context default is `{}`. useNodeRender supplies `form.render()`, which reaches NodeRender/FormRender and installs the actual Form provider around registry formMeta.render.
  implication: a Field rendered directly by CanvasNode exactly produces `TypeError: ...getField is not a function`; the supported boundary is form.render().

- timestamp: 2026-08-16T01:38:30+08:00
  checked: FlowGram 1.0.13 WorkflowNodeRegistry and FormMeta declarations
  found: registry formMeta is allowed to be the V2 plain object `{ render(...) }`; it does not itself need a getField method.
  implication: the earlier plain-formMeta hypothesis is eliminated; the missing React Form provider is the root cause.

- timestamp: 2026-08-16T01:41:50+08:00
  checked: minimal fix in src/sidepanel/WorkflowCanvas.tsx
  found: CanvasNodeForm now owns the config Field inside registry formMeta.render, and CanvasNode renders it through useNodeRender().form.render().
  implication: Field is now mounted beneath FlowGram's Form provider while preserving the same config serialization path.

- timestamp: 2026-08-16T01:45:20+08:00
  checked: npm run build, npm test, npm run lint
  found: production TypeScript/Vite build passes; all 5 existing tests pass. Lint cannot start because this repository has no ESLint configuration file.
  implication: the fix is type-correct and build-safe; lint is unavailable for the whole repository rather than failing on the changed file.

- timestamp: 2026-08-16T01:45:20+08:00
  checked: attempted Node SSR smoke test through the free-layout-editor package entry
  found: Node 26 cannot import a separate free-auto-layout dependency because @dagrejs/graphlib lacks a named ESM export expected by that package.
  implication: use the direct @flowgram.ai/form package for the provider-boundary experiment; this Node-only import issue does not occur in the successful Vite browser build.

- timestamp: 2026-08-16T01:47:40+08:00
  checked: direct React SSR experiment with @flowgram.ai/form
  found: rendering a bare Field reproduces the exact `TypeError: formModel.getField is not a function`; wrapping the same Field in FlowGram Form renders without that error after a minimal browser-global shim.
  implication: the provider-boundary hypothesis is experimentally confirmed and the applied form.render() fix targets the exact failure mechanism.

## Resolution

root_cause: CanvasNode mounts FlowGram Field outside the Form provider created by node.form.render(), so Field reads `{}` from FormModelContext and crashes on getField.
fix: Move the config Field into CanvasNodeForm registered as formMeta.render, and have CanvasNode render it exclusively through form.render().
verification: npm run build passes; npm test passes 5/5; direct runtime experiment reproduces exact exception for bare Field and removes it with a Form provider. Awaiting confirmation in the real Chrome extension sidepanel.
files_changed: [src/sidepanel/WorkflowCanvas.tsx]
