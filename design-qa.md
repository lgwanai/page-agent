# Workflow library redesign QA

final result: passed

## Evidence and scope

- Source visual truth: `/Users/wuliang/.codex/generated_images/01a0017a-1dd5-7ce0-80e1-f5f50e0c855a/exec-41bae8eb-9f6e-44e2-90c1-093192b77a71.png` (selected option 1).
- User override: add an independent button that copies the complete workflow ID.
- Implementation screenshot: `design-qa-list.png`.
- Implementation: `http://127.0.0.1:5173/dev/workflow-list.html`, production WorkflowList/WorkflowRow components, sanitized development fixtures only. This page is not included in the extension build.
- State: first workflow overflow menu open, eight workflows, light theme.
- Source: 1089 × 1445 pixels, compared at approximately 2× density to 544 × 723 CSS pixels. Implementation: 544 × 742 full-page pixels, viewport 544 × 723, device density 1×. The small extra height is intentional for full UUID copy affordances rather than mock shorthand IDs.
- Source and final browser capture opened together in the same comparison input. Full-view text and icons were legible; no additional focused crop needed.

## Findings and comparison history

1. Initial capture: rows were too tall (88px minimum plus metadata), and the overflow menu was unnecessarily wide (190px). P2: reduced row minimum to 72px, vertical padding to 10px, and menu width to 168px. Recaptured and compared against source.
2. Final comparison: grouped white list, horizontal dividers, purple primary Run, trailing overflow, and inline metadata match the selected hierarchy. No actionable P0/P1/P2 findings remain.

## Required fidelity surfaces

- Typography: existing system Chinese font fallback retained; 14px semibold workflow titles and smaller muted metadata preserve hierarchy. Full names wrap instead of being lost. Existing extension heading size retained intentionally.
- Spacing/layout: compact shared list surface; rows reserve width only for Run and More. Copy-ID is inline with ID. Responsive 320px viewport has clientWidth = scrollWidth = 320; no horizontal overflow.
- Tokens: existing purple, off-white, muted gray, light borders and rounded surfaces reused. Solid primary fill retained from extension rather than introducing new gradient tokens.
- Assets: locally bundled Font Awesome vector icons, no new raster assets or custom drawn icons. Solid icons are an intentional user-approved library choice versus mock outline icons.
- Content: actual workflow data retained. Development screenshot uses sanitized sample IDs and metadata; no real keys, Chrome storage, or business actions are accessed.

## Interactions verified

- Browser: first menu opens; four secondary actions visible; Escape closes it; ID-copy click displays success; console error log empty.
- Unit tests: full UUID is passed to clipboard without invoking MCP or reading workflow keys; Escape restores trigger focus; existing edit/save/reopen and copy-Prompt cases pass.
- Overflow menu supports arrow keys, Home/End, outside pointer close, and placement above the trigger near the viewport bottom.

## Implementation checklist

- [x] Selected list hierarchy implemented.
- [x] Complete workflow ID copy separate from key/Prompt copy.
- [x] Existing callbacks retained.
- [x] Browser-rendered comparison and narrow viewport check.
- [x] Version synchronized to 0.10.33 before production build.

## Follow-up polish

No blocking findings. Real installed-extension smoke check after Chrome reload remains a user deployment step; browser QA reused the actual list component without production credentials.
