# Content Sync Pro — Production Readiness Test Matrix

This guide converts the environment notes from `test-enviroments-setup.txt` into a structured, repeatable validation matrix for release readiness.

## 1) Test Environments

### Remote Server
- Start:
  - `D:\Rutba\ERP> npm run dev:strapi`
- URL: `http://localhost:4010`
- DB: MySQL (`pos_db`)
- Upload dir: `D:\Rutba\data\rutba-pos-files\uploads`

### Local Server
- Start:
  - `D:\Rutba\ERP\pos-strapi> npm run dev`
- URL: `http://localhost:40101`
- DB: MySQL (`rutba_pos`)
- Upload dir: `D:\Rutba\data\rutba-pos-files\tmp\uploads`

### Shared Notes
- Same Strapi codebase, different `.env` values.
- Admin credentials (both):
  - Email: `eharain@yahoo.com`
  - Password: `At56ZNTxXf6JSTq`
- Plugin deploy target to test runtime updates:
  - `D:\Rutba\ERP\pos-strapi\src\plugins\strapi-content-sync-pro`
- Restart may be required after plugin copy/update.

## 2) Scope of Validation

- Paired mode (plugin installed both sides)
- Single-side mode (plugin active on local only)
- Profiles (simple + advanced), dependency depth, execution modes
- Entity sync (CMS content, products, orders)
- Media sync + entity-linked media
- Stats tab snapshots and before/after reports
- Log/report retention and cleanup controls
- Failure/recovery behavior

## 3) Pass/Fail Exit Criteria

A build is **production-ready** only if all are true:
- Critical test cases pass (P0/P1 below)
- No data corruption in local/remote DBs
- No orphaned media references after sync runs
- Stats/report data is generated and retention controls work
- Plugin starts cleanly after restart in tested configurations

## 4) Test Matrix

| ID | Priority | Area | Scenario | Setup | Steps | Expected Result | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| P0-01 | P0 | Health | Plugin ping reachable both servers (paired) | Both running with plugin enabled | Call `/api/strapi-content-sync-pro/ping` on :40101 and :4010 | HTTP 200 + `{ "status": "ok" }` | TODO |  |
| P0-02 | P0 | Connection | Connection test in paired mode | Local configured to remote | Run **Test Connection** in Configuration tab | Success, plugin endpoint validated | TODO |  |
| P0-03 | P0 | Single-side | Connection test in single-side mode | Disable remote plugin load via env | Set local mode `single_side`, run Test Connection | Success without requiring remote plugin routes | TODO |  |
| P0-04 | P0 | Profiles | Pull-only enforcement in single-side | Local mode `single_side` | Try creating push/bidirectional profile | UI/API enforce pull-only | TODO |  |
| P0-05 | P0 | Execution | Live mode blocked in single-side | Local mode `single_side` | Try saving execution mode `live` | Rejected or normalized to non-live | TODO |  |
| P0-06 | P0 | Data | Orders remote → local sync | Create new orders on remote | Run local pull/sync | Orders and order details appear local | TODO |  |
| P0-07 | P0 | Data | CMS/offers local → remote sync (paired) | Create CMS/offers local | Run push/bidirectional | Entries appear remote correctly | TODO |  |
| P0-08 | P0 | Media | Entity-linked media sync | Attach media to products/CMS | Run sync profile + media sync | Files + DB refs consistent on target | TODO |  |
| P0-09 | P0 | Stats | Pre/post run report generation | Any enabled content types | Trigger sync run | Stats report contains before/after snapshots | TODO |  |
| P0-10 | P0 | Retention | Manual clear logs/reports | Existing logs/reports | Use clear actions in Stats tab | Data removed, UI refreshed | TODO |  |
| P1-01 | P1 | Dependencies | Min depth profile run | Profile depth=1 | Run profile | Only first-level dependencies handled | TODO |  |
| P1-02 | P1 | Dependencies | Max depth profile run | Profile depth=5 | Run profile | Deep dependencies handled; no crash | TODO |  |
| P1-03 | P1 | Media Recovery | Recreate deleted local media from remote | Delete selected local media rows/files | Run downward sync | Missing media restored | TODO |  |
| P1-04 | P1 | Conflict | Latest/local/remote strategy behavior | Divergent edits both sides | Run with each strategy | Winner follows selected policy | TODO |  |
| P1-05 | P1 | Restart | Restart resilience | Update plugin files + restart | Restart both servers | Plugin loads without route/service errors | TODO |  |
| P1-06 | P1 | Retention Auto | Pruning by max entries | Set low limits | Trigger retention run | Old logs/reports pruned to limit | TODO |  |
| P2-01 | P2 | Performance | Large dataset pagination behavior | Seed high row count | Run sync with page-size variations | Completes with bounded memory/errors | TODO |  |
| P2-02 | P2 | UX | Stats readability | Run several syncs | Review report history | Clear before/after trend visibility | TODO |  |

## 5) Detailed Execution Checklist

### A. Baseline + Connectivity
1. Confirm both servers are running.
2. Verify paired mode ping endpoints.
3. Configure local plugin connection settings.
4. Validate **Test Connection** in paired mode.

### B. Single-side Mode
1. Disable plugin loading on remote using env flag.
2. Keep local plugin enabled.
3. Set local `syncMode = single_side`.
4. Run connection test and verify success without remote plugin route dependency.
5. Verify profile direction and execution mode restrictions.

### C. Data Sync Scenarios
1. Create products with variations on source side; sync and verify target.
2. Create orders on remote; pull to local and verify details.
3. Create CMS content/offers local; push to remote and verify.
4. Run scenarios with different conflict strategies.

### D. Media Scenarios
1. Upload media and attach to products/CMS entities.
2. Sync and verify both file presence and DB links.
3. Delete a subset of local media rows/files.
4. Re-run downward sync; confirm restoration.

### E. Stats + Retention
1. Trigger sync; confirm report with before/after snapshots appears.
2. Verify columns: local/remote count, newest timestamps, newest side.
3. Use manual clear for logs and reports.
4. Configure low retention limits and run retention; verify pruning.

### F. Restart/Recovery
1. Copy plugin changes into Strapi plugin destination.
2. Restart both instances.
3. Re-check critical routes and one sync run.

## 6) Evidence Template

For each executed case, capture:
- Timestamp
- Server mode (paired/single-side)
- Profile ID/name and execution mode
- Request/response snippets (or screenshots)
- DB/file verification notes
- Result: Pass/Fail + defect link

Example note:
- `P0-09` | `2026-04-21 10:20` | `Pass`
- Report ID: `...`
- Before: products local=120 remote=115 newest=local
- After: products local=120 remote=120 newest=equal

## 7) Defect Severity Guidance

- **Critical**: Data loss/corruption, wrong direction writes, plugin cannot start
- **High**: Core sync path broken for common scenario
- **Medium**: Stats/reporting incorrect but sync still reliable
- **Low**: UI copy/formatting issues

## 8) Go/No-Go Summary

- Total cases executed:
- Passed:
- Failed:
- Blocked:
- Critical open defects:
- Decision: **GO / NO-GO**

---

## Current Session Smoke Result

- Ping local (`:40101`) = PASS
- Ping remote (`:4010`) = PASS
- Package test script (`npm run test`) = PASS (`No tests yet` placeholder)

A full production readiness sign-off requires completion of the matrix above.
