# Sync Strategy Approach Review

This document consolidates and refines the discussed approaches for sync reliability, dependency handling, content-type enabling, and profile editing.

## 1) Core Execution Strategies

### A. Two-Phase Sync (Recommended Default)

Run sync in two explicit phases:

1. **Entities phase**
   - Sync core entity payload first.
   - Materialize records on both sides before linking.
2. **Relations phase**
   - Sync/link relation fields after entities exist.

Why: reduces broken/partial links and ordering fragility in relation-heavy schemas.

### B. One-Pass Sync (Advanced / Less Reliable)

Keep as optional mode with strict constraints:

- `dependencyDepth` is always **1**.
- Include only direct dependency targets that are in sync scope.
- Never traverse owning-side metadata (`mappedBy` / `inversedBy`).

This is intentionally constrained to avoid unsafe deep traversal complexity.

---

## 2) Dependency Rules (Authoritative)

For dependency sync, one-pass mode must:

1. Use `dependencyDepth = 1` only.
2. Include only targets that are part of sync scope.
3. Never traverse owning-side metadata (`mappedBy` / `inversedBy`).

Applied interpretation:

- Use direct relation target only.
- Exclude self-links and out-of-scope content types.
- Do not expand traversal from inverse/owning metadata.

---

## 3) Execution Ordering

### Two-Phase

- Entities phase should run in stable dependency-aware order.
- Relations phase runs after entity pass completes for all selected types.

### One-Pass

- More relational content types should receive lower priority (higher order number).
- Ordering should consider only allowed direct relations (under the depth=1 + in-scope + no mappedBy/inversedBy rules).

---

## 4) Enabling Content Types

When enabling a content type, provide:

1. **Enable only selected type**
2. **Enable selected type + direct dependencies (depth=1)**

Behavior for “enable with dependencies”:

- Expand only direct in-scope relation targets.
- Do not recursively traverse.
- Ignore mappedBy/inversedBy traversal semantics.

Recommended UX:

- Show preview summary before apply:
  - to enable
  - already enabled
  - skipped/out-of-scope

---

## 5) Sync Profiles and Advanced Editing

Profiles should remain fully editable and not locked by auto-generation.

For newly enabled types, support:

1. **Quick defaults** (auto-create profiles)
2. **Create + edit now** (guided advanced configuration)

Editable advanced settings include:

- direction
- conflict strategy
- sync deletions
- execution mode
- dependency sync toggle
- dependency depth (constrained to 1 in one-pass)
- field-level policies

---

## 6) Suggested Implementation Sequence

1. Add strategy contract (`two_phase` default, `one_pass` advanced).
2. Enforce one-pass dependency constraints globally (depth=1, in-scope only, no mappedBy/inversedBy traversal).
3. Implement two-phase orchestration in sync-now, profile execution, and bulk transfer.
4. Add content-type enable flow with “enable dependencies too” option and preview.
5. Keep profile editing fully available, including advanced settings.
6. Update UI hints to explain constraints and reliability tradeoffs.

---

## 7) Final Position

- Default production-safe path: **Two-phase sync**.
- Keep one-pass only as constrained advanced mode.
- Add **dependency-aware enable-all-direct-dependencies** option.
- Preserve and improve advanced profile editing instead of restricting it.
