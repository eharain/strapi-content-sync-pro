# Sync Strategy Approach Review

This document consolidates and refines the agreed approach for sync reliability, dependency handling, content-type enabling, and profile editing.

## 1) Core Execution Strategy (Hybrid Two-Pass)

**Consolidated rule:** Use a hybrid two-pass sync approach: **pass 1 syncs core entities, pass 2 syncs one-direction dependencies from owner/declaring side only** (entities first, relations second).

Implementation shape:

1. **Pass 1: Entities First**
   - Sync core entity payload first (materialize records on both sides).
   - Avoid relation-linking behavior in this pass.
2. **Pass 2: Relations Second (One Direction)**
   - Sync dependencies/relations only after entities exist.
   - Apply relation sync in one direction from the **owner/declaring side only**.

### Media in the Same Two-Pass Model

Media follows the same strategy:

1. **Pass 1 (Core media):** sync media entities/files first.
2. **Pass 2 (Media links):** sync media relations from owner entities (content types that hold media fields).

Design decision:

- Treat media as a referenced target, not the relation-driving owner.
- Relation updates are written from owning entities only.
- Remove separate morph-side traversal/update strategy from the approach.

Why: this removes duplicate/bi-directional link work, reduces conflict risk, and keeps relation application deterministic.

---

## 2) Dependency Rules (Authoritative)

For dependency sync:

1. `dependencyDepth` is always **1**.
2. Include only dependency targets that are part of sync scope.
3. Never traverse owning-side metadata graph expansion via `mappedBy` / `inversedBy`.
4. In pass 2, apply relation updates from the **owner/declaring side only**.

Applied interpretation:

- Use direct relation target only.
- Exclude self-links and out-of-scope content types.
- No recursive traversal.
- No inverse-side fan-out traversal.
- Media links are applied only from owner entities; no separate morph-driven inverse traversal.

---

## 3) Execution Ordering

- Entities pass runs first for all selected content types and core media.
- Relations pass runs second for all selected content types, including media link fields from owner entities.
- Ordering remains dependency-aware and stable.
- For relation-heavy types, keep lower priority (higher order number) where ordering tie-break is needed.

---

## 4) Enabling Content Types

When enabling a content type, provide:

1. **Enable only selected type**
2. **Enable selected type + direct dependencies (depth=1)**

Behavior for “enable with dependencies”:

- Expand only direct in-scope relation targets.
- Do not recursively traverse.
- Do not traverse through `mappedBy` / `inversedBy`.

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
- dependency depth (fixed to 1 where dependency sync is used)
- field-level policies

---

## 6) Suggested Implementation Sequence

1. Add strategy contract as **hybrid two-pass default**.
2. Enforce dependency constraints globally (depth=1, in-scope only, no mappedBy/inversedBy traversal).
3. Implement orchestration in sync-now, profile execution, and bulk transfer:
   - pass 1 entities + core media
   - pass 2 owner-side relations (including media links from owner entities)
   - remove separate morph/inverse traversal flow
4. Add content-type enable flow with “enable dependencies too” option and preview.
5. Keep profile editing fully available, including advanced settings.
6. Update UI hints to explain constraints and reliability tradeoffs.

---

## 7) Final Position

- Use **hybrid two-pass** execution: entities/core media first, relations second.
- Relation sync in pass 2 is **one directional from owner/declaring side**.
- Media links are synced from owner entities only; no separate morph-side inverse traversal strategy.
- Keep dependency scope constrained (depth=1, in-scope targets only).
- Add dependency-aware enable-all-direct-dependencies option.
- Preserve and improve advanced profile editing.
