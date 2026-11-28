# Relay submission experience — delivery notes

## Evidence API integration update (2026-11-28)

This update supersedes the earlier limit/removal/polling findings below. API runtime inspected read-only at `D:/workspaces/qabas1/qabas1-api`: `relay.service.ts`, `relay.routes.ts`, `relay.form.ts`, `evidence.service.ts`, `evidence.worker.ts`, and `core/api/error_codes.type.ts`.

- Preserve `field`, `messageKey`, and `params` through both JSON and XHR errors; translate stable `evidence.*` codes without exposing raw server text. Limit messages use `maxFiles`; size errors use `maxBytes`. The old English-message conflict match is removed.
- Verified defaults are 20 files and 50 MiB; schema `maxFiles` still takes precedence. The inspect response does not expose a configurable byte limit, so 50 MiB matches the current API constant.
- Retain evidence ID from initialization. Remove calls public `DELETE /api/v1/r/:token/evidence/:id`; card and submission gate remain pending until acknowledgement. Network failure preserves the card for retry. Submitted-evidence denial disables removal.
- Wait for active initialization/transfer before DELETE. For ambiguous completion, require status confirmation before abandoning. No automatic new upload and no staff-only retry call. If initialization succeeds remotely but its response is lost, the unknown evidence ID cannot be abandoned from this client; the incomplete session expires server-side.
- Map `failureCode`, `scanAttempts`, `retryable`, and `action`; temporary scan failures offer a status recheck. Public actions do not authorize staff scan retries.
- Poll every 30 seconds with bounded backoff and at most 90 automatic/manual status checks per 15-minute page lifetime window, shared across additional-response forms. This reserves capacity within the API's 180 request limit; other tabs/clients can still exhaust the server limit.
- Keep prior grid refinements and keep request `instructions` hidden.

Backend follow-up found during source review (no backend edits):

1. `abandonEvidence` skips mutation/audit whenever the existing status is `FAILED`, yet returns `USER_ABANDONED`. The worker only cleans stored objects marked `USER_ABANDONED`. A `SCAN_UNAVAILABLE` file may therefore remain stored or eligible for another scan after the endpoint reports removal. Fix the guard to recognize already-abandoned failure codes rather than every FAILED state. Test abandonment of a failed scan with fewer than three attempts, asserting audit, terminal marker and eventual cleanup. Severity: medium (retention and lifecycle correctness).
2. `completeUpload` writes PROCESSING without checking an abandoned state and does not share the evidence lock used by abandon. Completion from another tab/in-flight request can undo abandonment. The frontend serializes its own known operations but cannot enforce cross-client ordering. Add a shared lock/state guard and a race regression test. Severity: medium (slot recovery and stored-object lifecycle).

Verification for this integration: 18 Node tests; the existing 53 Playwright assertions rerun against updated fixtures; dedicated recovery browser checks cover acknowledged deletion, pending removal, transfer/initialization races, lost completion, deletion failure/retry, scan recheck without reupload, and submitted-evidence denial. API `npm run ai:check` passed. Browser fixtures run on `http://127.0.0.1:8001` with synthetic files; no production API calls or deployments.

## Original delivery record

## Scope and architecture

The existing static, Arabic RTL renderer is retained. No framework, package dependency, backend contract, accounting behavior, or deployment architecture was changed.

- `assets/relay.js`: request loading/unavailable states, dynamic fields, derived eligibility, submission state, receipt and additional-response flow. Instructions now render from the request. Every supported field type remains supported.
- `assets/relay-attachments.js`: native pickers and touch choice dialog, compact three-column gallery, local image/PDF preview, stable tile DOM, two concurrent transfers, cancellation, stale-response guards, bounded evidence polling, cleanup and focus restoration.
- `assets/relay-state.js`: file policy, duplicate checks, aggregate attachment eligibility and Arabic error mapping.
- `assets/relay-api.js`: abortable requests, 30-second JSON and 120-second upload timeouts, strict response envelopes, real XHR progress, typed network/ambiguous errors.
- `assets/relay.css`, `relay.html`, `__demo/index.html`: 576px content column, existing forest/paper palette and local Arabic font, single attachment entry point, minimal footer, blob image previews allowed by CSP. Removed the placeholder support telephone number only from Relay/demo.
- Tests: API/state unit tests plus three reusable Playwright browser-check functions. Existing share/download code and routing are untouched.

## Behavioral decisions

The existing public contract accepts processing evidence and may return `EVIDENCE_PENDING`; submission remains enabled after byte transfer if all other rules pass. Receipt language distinguishes receipt from completed processing. Failed/queued/uploading attachments block submission, and none are silently dropped.

`allowPartial` and `allowMultiple` retain their existing semantics, including `supersedesSubmissionId` for additional responses. On a network/5xx/malformed-envelope submission outcome, the form is frozen and the exact payload and idempotency key are reused. There is no public submission-status endpoint, so a separate status lookup was not invented.

Upload initialization/completion POST idempotency is not documented. These are never automatically retried. For an ambiguous upload failure, users explicitly remove and reselect the file; for evidence polling failures, retry reuses the existing evidence ID without reuploading. GET polling has bounded backoff (three consecutive transient failures) and a bounded slow-processing window (24 checks), followed by an explicit recheck action.

Removal cancels local requests, excludes the evidence from the response, and releases its local preview URL. No server-side deletion endpoint exists in the supplied client contract; already-created server evidence needs the backend's normal abandoned-upload cleanup. Original bytes are never compressed, converted, or persisted in browser storage. Duplicate prevention uses filename, size and last-modified fingerprint; it is not content-hash deduplication.

PDF previews open the original local file in the native browser viewer; other document formats use download. Images open in an accessible modal at full available width. There is no extra upload or storage URL exposure for previews.

## HTTP 413 investigation

Repository evidence: `createUpload` sends JSON metadata (`fieldKey`, `name`, `mimeType`, `sizeBytes`). `completeUpload` sends the original File/Blob as `application/octet-stream` to `/uploads/:sessionId/complete`. This matches the pre-existing README contract: completion itself is the binary transfer. There is no earlier binary transfer, JSON-wrapped binary, or base64 amplification. A regression test confirms body identity and content type.

The frontend previously imposed 20 MiB/file, a 200-character filename limit, and an unconditional five-file ceiling. The supported schema exposes `maxFiles` and `allowedMediaTypes`; the unconditional five-file ceiling was removed. The existing 20 MiB and filename limits are preserved because this repository contains no authoritative configurable byte-limit field. Do not infer a new backend field name.

**The production 413 cause is not established or fixed by this frontend change.** No customer request was replayed. Backend/infrastructure follow-up: inspect the rejecting hop and sanitized logs for this exact completion route; compare ingress/proxy/body-parser/application byte limits against the advertised upload policy; verify raw `application/octet-stream` handling and content-length limits. The static site's nginx does not proxy these API uploads. If actual per-request byte limits differ, document and expose one authoritative byte-limit property and consume it in `limits()`; no API/infrastructure changes were made here.

## Verification actually performed

- `node --check` on share.js and all changed/new Relay JavaScript modules.
- `node --test tests/*.test.mjs`: **13 passed**, including the existing public share route test, numeric validation, raw-byte completion, typed network failures, malformed envelopes, file policy and aggregate states.
- Playwright with local synthetic fixtures: **53 assertions passed** across `relay-browser-check.js` (33), `relay-lifecycle-browser-check.js` (9), and `relay-fields-browser-check.js` (11). These are function bodies accepted by the Playwright MCP `browser_run_code_unsafe` filename option; they are not Node test-runner files. Start `python -m http.server 8000` first. All API requests in these scripts are intercepted; never point them at a real submission link.
- Covered empty, balance-only, attachment-only and strict responses; all supported non-attachment field types; multiple files and limits; duplicate/type/size rejection; transfer cancellation and late completion; processing; mixed 413/success; submit rejection; ambiguous retry with identical payload/key; duplicate-submit guard; extra responses; closed/expired/prior-response states; HTTP 401/404/410/503; long Arabic text; bounded slow/network polling; URL cleanup; touch choice sheet; native camera capture attribute; Escape/focus restoration.
- Viewport overflow checks passed at **320, 360, 390, 430, 768, 1024 and 1440px**. Long Arabic layout checked at 320, 390 and 768px. Mobile/desktop screenshots captured and visually inspected; fixed tile dimensions refined after inspection.
- Screenshots are local artifacts under `output/playwright/`: `relay-before-mobile.png`, `relay-after-mobile.png`, `relay-gallery-mobile.png`, `relay-after-desktop.png`, `relay-success.png`. Before uses the existing demo; after uses explicitly mocked generic request data.
- No package manifest, build command, linter or type-checker is configured. The production artifact is the HTML plus assets; no production deployment or container build was run.

## Remaining validation and assumptions

Real Android Chrome, iOS Safari, WhatsApp in-app browsers, actual camera hardware, mobile keyboards and native PDF viewers have **not** been device-tested. Chromium touch emulation verifies picker wiring, not hardware or cross-browser compatibility. No real customer evidence, financial data or external credentials were used.

Business metadata remains limited to the fields actually exposed by the existing client contract (title, instructions, expiry, schema). No period, organization, currency, phone number or support contact was fabricated. The expiry date is secondary; authoritative 410 responses are handled at upload, poll and submission time. No sticky action bar was added, avoiding keyboard/safe-area overlap.

Review the local demo, then perform a staging/device acceptance pass and the backend 413 investigation before rollout. Nothing was pushed or deployed.
