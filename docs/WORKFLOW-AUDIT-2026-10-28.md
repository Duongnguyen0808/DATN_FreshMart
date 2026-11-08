# Workflow audit — 2026-10-28

## Result

All existing automated suites passed after the fixes below. This is a development verification, not a claim that physical hardware, real payment settlement, or concurrent production load has been certified.

## Fixed

- Forecast middleware required `reports.read` for unrelated routes mounted later under `/api/v1`, including user administration and customers. Its permission gate now applies only to `/forecasts` and `/recommendations`. RBAC tests check that delegated user readers remain allowed while forecast access remains forbidden.
- A role-management error message contained invalid UTF-8; replaced it with valid Vietnamese.
- Updated old test inputs/expectations: uppercase role codes, strict rejection of unknown branch query parameters, and global administrators inspecting inactive branches.
- Removed the lot workflow test's dependency on seeded OWNER data. Added an isolated `smart_store_workflows_test` runner.
- Extended the RFID-to-transfer test through supplier debt payment and a credit sale/customer collection, including overpayment and repeated settlement rejection.

## Verification

| Area | Result | Boundary |
| --- | --- | --- |
| Backend unit tests | 41 passed | Payment provider mocked |
| PostgreSQL integration tests | 85 passed across 11 files | Dedicated test databases |
| AI service | 16 passed | Includes forecast/safety-stock validation; not a guarantee of forecast accuracy on store data |
| Web | 52 routes checked | Desktop/mobile, mocked API; form actions and overflow checks |
| TypeScript | Backend and web passed | Static compilation |
| Services | Web, backend readiness and AI health returned 200 | Local development services |
| Application migrations | All 45 applied | Read-only status check |
| Application data integrity | No violations in checked invariants | 129 inventory rows, 5 purchase-order lines, 4 payables, 1 receivable |

The PostgreSQL workflow scenarios cover pack conversion, receiving, FEFO sale, invoice cancellation, returned-goods quarantine, disposal, stocktake completion, RFID confirmation/replay/unregistered or invalid tags, transfer dispatch/receive, receipt visibility, supplier payments and customer collections. Workflow fixtures run in transactions that roll back; application inventory was not changed by these tests.

Read-only integrity checks: nonnegative inventory/lot quantities, reservations within on-hand stock, lot totals equal inventory where lots exist, receipts within ordered quantities, paid balances within debt totals, and payment sums equal recorded paid balances. These checks do not reconcile every historical ledger or certify all accounting reports.

## Remaining real-world checks

- Physically scan the ESP32/RC522 (or camera) and observe network transmission, realtime popup and saved receipt; test network loss/reconnect.
- Complete a real payOS payment and verify the public webhook reaches the backend. Automated tests mock the provider and do not transfer money.
- Test simultaneous users/requests under production-like load. Transaction-based workflow fixtures do not simulate independent concurrent database transactions.
- Mobile native application, if used, is outside the browser viewport checks.

Non-blocking warnings remain in Python testing dependencies and pg's concurrent-query deprecation. They did not fail the tests.

## Repeat

From `backend`: `npm run test`, `npm run test:workflows`, `npm run check:integrity`.

Other database groups: `node scripts/test-integration.mjs <selection>`, with selections `all`, `login`, `logout`, `refresh`, `rbac`, `create-user`, `users`, `organization`, `products`.

From `ai-service`: `.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider`.

From `web-admin`: `npm run typecheck`; with the web running, `node scripts/verify-retail-ui.cjs`.
