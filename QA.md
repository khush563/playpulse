# PlayPulse local QA and demo guide

QA date: 17 November 2026. This repository is a localhost prototype; it now uses the configured Supabase development project for identity and match pools. Sports, vendors, payments and redemption remain simulations; this is not a completed public-launch audit.

## Install and run

Requires Node.js 22.12 or newer. Dependencies are already present in the current workspace. On a fresh checkout only:

```bash
pnpm install
```

Start the app:

```bash
node server.js
```

On this workstation, Node.js 24.22.1 is supplied by the Codex runtime but is not on the interactive shell `PATH`. These exact commands were verified here without installing anything:

```bash
PLAYPULSE_NODE_DIR="/Users/kkirar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
"$PLAYPULSE_NODE_DIR/node" server.js
PATH="$PLAYPULSE_NODE_DIR:$PATH" pnpm test
```

Confirmed local URLs from the server startup output:

- Fan app: <http://127.0.0.1:3000/>
- Demo merchant and event control: <http://127.0.0.1:3000/admin>

Run all unit, integration, and UI contract tests:

```bash
node --test
```

The project has no configured lint, TypeScript type-check, or production-build command. The browser files are served directly by Express.

Current automated result: 102 tests passed, 0 failed, 0 skipped. A literal `pnpm test` attempt initially failed because this workstation could not find `node` on `PATH`; the same package script passed after adding the bundled Node directory as shown above.

## Sentiment and team-lock checks

`test/team-sentiment.test.js` covers required selection, immutable/idempotent choices, concurrent choices, opposing-side claim rejection, socket reconnect/browsing/multiple tabs, goals while still trailing, equalizers, changes of lead, preserved earned coupons, missed penalties, and misconfigured comfort merchandise. Existing claim fixtures now select their side before claiming.

Manual browser flow: follow Chelsea with all offer preferences, trigger Arsenal 1–0, and verify only comfort food/café offers. Score twice for Chelsea: jerseys should appear at 1–2. Claim a jersey, then score twice for Arsenal: at 3–2 only comfort food/café should remain in the collection, while Wallet still shows the earned jersey coupon as ready with its original 24-hour deadline. Editing preferences must disable Arsenal; Clubs must disable following the opposing side. In the explicit legacy-engine fixture reset starts a new selection. In the authenticated application, pool membership and team choice persist through reset/restart and clearing browser data.

## Journey coverage

1. **Onboarding:** manually verified Arsenal, Premier League, food, merchandise, and celebration preferences save into the browser and reach the lobby. Preference validation and empty/corrupt storage have automated coverage.
2. **Prediction and join:** creation, editing, lock time, invalid scores, duplicate prediction, reward cap, and idempotent join points have automated coverage. The labelled simulated lobby and Join Match action were manually verified.
3. **Confirmed goal:** manually verified an Arsenal goal changes the score and populates the eligible multi-merchant collection without opening a modal. Socket routing and penalty timing have integration coverage.
4. **Duplicate delivery:** integration coverage proves one event and no repeated activations or claims. Browser verification confirmed replaying the stable sample event ID adds no notification. Generated IDs remain distinct after reset.
5. **Overturn:** integration coverage confirms score reversal, campaign cancellation, preserved claims, `review_required` fulfilment, and audit history.
6. **Claim before expiry:** verified Claim offer saves a local claim, notification, and reservation to Wallet, with server-backed coupon details. No retailer or payment request is sent.
7. **Expired/exhausted:** integration and state-machine tests reject claims after expiry or capacity exhaustion.
8. **Inventory and budget:** catalogue and merchant tests cover duplicate reservations, release boundaries, stock underflow, budget ceilings, and invalid campaign limits.
9. **Merchant campaign lifecycle:** manually verified preview, create, activate, pause, and cancel. Validation and invalid transitions have automated coverage.
10. **Analytics:** manually verified one real local impression and claim, then one completed and redeemed demo order. The resulting gross value, discounts, funding split, rates, and budget came from stored records. Formula and zero-denominator cases have automated coverage.
11. **Personalised ranking:** automated coverage proves hard eligibility runs before deterministic ranking and a replacement ranker cannot return an ineligible, expired, or out-of-stock offer.
12. **Notifications:** manually verified preferences, unread state, goal/offer/claim/order/redemption entries, mark-all-read, and duplicate suppression. Quiet mode and disabled alert categories have automated coverage.
13. **Points and badges:** automated coverage proves repeated prediction, join, settlement, and Early Bird actions do not duplicate points or badges.
14. **Empty/error/mobile:** empty inbox and analytics states, storage failures, invalid forms, and server validation have automated or manual coverage. Fan and merchant layouts were manually checked at a 390 × 844 viewport; the fan match timeline and fixed navigation remained usable.

## 90-second YC demo

Use two tabs and a fresh/private browser profile for the clean first-time flow. Keep `/` on the left and `/admin` on the right.

1. **0–15 seconds — Personal setup:** In the fan tab choose **Arsenal**, **Premier League**, **Food**, **Merchandise**, and **Celebration deals**. Click **Continue to match lobby**. Enter **2–1** and click **Save prediction**.
2. **15–25 seconds — Join:** Point out **Local demo** and **Simulated** labels, then click **Join match**. Say that PlayPulse uses an explicit club and offer preference rather than private browsing history.
3. **25–38 seconds — Live trigger:** In the admin tab click **Goal · Arsenal — Bukayo Saka scores**. Return immediately to the fan tab. The score becomes 1–0 and the Moment offers collection updates.
4. **38–52 seconds — Relevant offer:** Show merchant cards with independent countdowns, the £80 → £48 kit calculation, stock and fulfilment. Details shows the rule-based explanation. Claim the kit and a food offer from different merchants.
5. **52–62 seconds — Safe redemption:** Open Wallet to show both coupons, then View coupon to show its exact use-by time. Explain that no real order or payment was created, then Return to Wallet.
6. **62–78 seconds — Merchant proof:** Open `/admin` and scroll to **Campaign economics**. Show one recorded impression and claim. Click **Complete demo order**, then **Redeem coupon**. The completed order, redemption, £48 gross order value, £32 discount, funding split, and budget now derive from that local record.
7. **78–87 seconds — Reliability:** In **Deterministic demo events**, click **Sample Arsenal goal · 23′**, then **Replay last event ID**. Show that the duplicate creates no second event or offer. Click **Overturn last event** and show the audit trail instead of erased history.
8. **87–90 seconds — Close:** “PlayPulse turns verified match moments into relevant, measurable commerce while the fan emotion is still alive.”

## Known limitations and simulated integrations

- Arsenal–Chelsea, match time, events, players, scores, fixtures, and all vendors/products are labelled local demo data.
- Match and merchant state, catalogue reservations, analytics, campaigns, predictions reward capacity, and watch parties are in memory and reset with the Node process or demo reset as documented.
- Preferences, notification history, prediction identity, points, badges, and interactions use browser `localStorage`; clearing site data or changing browser profiles creates another local identity.
- There is no authentication, production database, multi-process inventory transaction, robust multi-account fraud protection, sports feed, retailer API, payment, delivery, push notification, SMS, email, location, social network, or trained AI model.
- The rule-based recommendation layer cannot bypass deterministic eligibility, inventory, expiry, price, campaign budget, or coupon checks.
- The forecasting assistant uses a labelled illustrative dataset until three valid local campaign samples exist. It does not claim predictive accuracy or uplift.
- The single fixture cannot naturally earn three-match streak badges. No fake matches or participants are added to reach those thresholds.


## Coupon validity regression coverage

`test/claim-lifecycle.test.js` and `test/coupon-flow.test.js` cover the exact coupon expiry boundary, late claims, independent claim and coupon windows, retry deadlines, duplicate redemption, new-match-moment preservation, overturn review after a window closes, authoritative confirmation data, local owner matching, reset handling, and completed/redeemed reservation release guards. Time-bound API tests use a mocked clock rather than waiting for real deadlines.

The confirmation loads saved claim data from the server. Coupon or expiry parameters added to its URL do not change the saved coupon or its validity. Order completion and redemption enforce the deadline on the server; merchant controls also stop offering those actions when the deadline passes. Coupons are local demo records and cannot be redeemed at real merchants.

Coupon validity browser checks verified server-backed details, the exact 24-hour deadline, URL-tampering resistance, merchant completion/redemption, redeemed and expired states, and missing-claim handling. No browser JavaScript errors were reported. Mobile offer and confirmation screenshots were visually inspected.

For quick manual expiry checks, use the 30-second claim and 60-second coupon configuration in README.md. Existing reservations are not automatically released on coupon expiry; unpurchased claims can be released through the existing local release endpoint, and completed unredeemed demo orders can be cancelled from the merchant workspace.


## Multi-merchant collection and wallet verification

`test/multi-merchant.test.js` adds coverage for twenty independent merchants from one moment, concurrent same-merchant claims, different-product/team/event duplicate prevention, independent deadlines and capacity, exhausted inventory and budgets, no-eligible-offer events, private wallet invalidations, public snapshot sanitization, reconnect replay, and wallet reset. The twenty-merchant fixture is test data; the default UI still uses three fictional merchants.

The current headless Chrome check exercised a 390 × 844 fan screen and 1366 × 900 merchant screen: empty Wallet, a four-card/three-merchant offer collection, category chips, on-demand offer details, claiming from two different merchants, disabling sibling offers from an already-claimed merchant, preserving earlier activations, wallet reload, offline error/retry, reconnect, live redemption updates, wallet filters, coupon details and return, overturn review, celebration-only preferences, expired coupons, and demo reset. There were no browser JavaScript errors. The offer collection and wallet screenshots were visually inspected.

Manual demo: join Arsenal with Food and Merchandise (or No preference), trigger an Arsenal goal, claim the kit and snack offers, then open Wallet. The scarf belongs to the same merchant as the kit and should offer the existing coupon instead of another claim. Trigger a second goal and confirm the earlier windows remain. Complete/redeem one coupon in `/admin` and verify its wallet status updates. Reload the fan page and open Wallet to recover both claims. Resetting the demo clears them.


## Match-relative food validity

`test/match-day-validity.test.js` and the added lifecycle cases cover food/café coupons without invented timestamps before full time, a long match, the exact full-time and two-hour expiry boundaries, shorter merchant grace, capped late post-match claims, duplicate full-time delivery, global merchandise override isolation, suspended-match review, and attempts to bypass the two-hour maximum. Merchandise remains valid for 24 hours from its own claim by default.

For manual testing, edit the seeded snack campaign before triggering a goal and choose **Match only**. Claim the snack, then trigger Full time to check immediate expiry. Default food/café campaigns instead receive a deadline two hours after that confirmed full-time event. The simulator clock reaching 90 minutes is not a full-time event.

A focused headless Chrome check at 390 × 844 (fan) and 1366 × 900 (merchant) verified the food-only builder setting, a café's 30-minute preview/save, distinct merchandise/food/café card wording, pending full-time wallet labels, food order completion during the match, live full-time timestamp updates on an already-open coupon page, two-hour food expiry, removal of expired merchant redemption controls, and the expired coupon page. No JavaScript errors were reported. Pending and post-full-time screenshots were visually inspected.


## Manual event trigger feedback

Verified Goal, Penalty awarded, and Penalty missed through the user's in-app browser. The simulator now shows a live score, latest event, and human-readable result directly beside the trigger buttons. Buttons explicitly say they trigger immediately. Awarding a penalty brings Scored/Missed controls into view, explains why other triggers are temporarily disabled, and resolving it re-enables them. Existing campaign form input values were preserved during the page reload used to verify this change.


## Account and match-pool increment

The running app uses `.env` and defaults to account enforcement. Original engine tests explicitly request `demoMode: true`, while `test/auth-pool.test.js` covers restricted discovery, login requirements, protected admin and case/encoded path variants, signup field whitelisting, verified email, server-derived identity, member-only claims, opposing-side rejection, retry/deadline behavior, durable-membership recovery after demo reset, CSRF and provider/database failure handling, socket identity spoofing, and clock boundaries. `test/auth-session.test.js` exercises the actual Supabase server-cookie SDK against a local provider, checking verified user lookup, token-free responses, HTTP-only/Secure/SameSite cookies, cookie lifetime conversion and logout. No automated local test sends a real email or creates a real cloud account.

The owner has saved the Site URL and both callback redirects. Cloud smoke checks verified the supplied publishable key, email confirmation requirement and disabled Google provider. The owner reported a successful migration; the local `/api/pool` endpoint then returned a real empty, unscheduled pool projection and the three seeded merchant names. No fabricated kickoff or membership was inserted. Live negative checks also confirmed that the publishable key cannot read staff records, join a pool or schedule a match (all returned HTTP 401 / SQL permission denied). The standalone SQL transaction checks still need a run in Supabase before claiming authenticated database-level test execution.

To complete the real-user journey, verify email delivery, then create and confirm a fan account using the saved redirect settings. Assign only the owner an admin row using the separate documented SQL. Schedule a kickoff so registration is currently open (for a quick simulation, a kickoff about three hours in the future with a two-hour window works), join from a fan account, and verify its team persists after sign-out/relogin in another browser. Close-time rejection must be tested with a separately scheduled empty test pool or the SQL transaction fixtures. Once actual memberships exist, the app intentionally rejects schedule edits.

Remaining: real email/Google-provider delivery checks, owner role setup, admin MFA, live signed-in browser claim verification, authenticated SQL execution checks, durable commerce records, merchant-specific accounts/ownership, background/external invitations, and concurrent-user load testing. Pool and account persistence do not make the simulated commerce engine production-ready.


## Members-only lobby access

The latest access policy replaces public discovery. Guests opening `/`, `/index.html`, checkout or invitations redirect to `/auth`. A signed-in non-member stays at `/invitations` with registration times, real pool counts and merchant names. Opening match/offer/campaign/wallet/claim APIs returns 403; opening the lobby or checkout redirects to invitations. Joining during registration unlocks the lobby and locks one side; a returning member retains access after registration closes. Admin monitoring remains available without fan membership. The Explore match link has been removed; Google sign-in remains disabled.

Local provider-double tests cover guest API and HTML denial (including case/encoded aliases), non-member API and page denial, successful join and access after close, cross-account wallet isolation, immutable sides, admin access and database failure. Socket tests cover anonymous rejection, non-member subscription denial, absence of live match/offer/analytics traffic for outsiders, pool notification delivery, joined-member reconnect and staff-only analytics. These tests do not substitute for a real signed-in Supabase fan joining a scheduled pool; that still needs owner-assisted verification. No production match feed, push/email invitation delivery or durable coupon engine was added.


Latest verification: all **104 local tests passed** after the access changes. Browser checks confirmed the running app redirects a guest to sign-in and has no Explore match or Google option. An isolated local provider fixture verified the outside invitations page, joining, the locked Arsenal side in preference setup, entry to the lobby and access to the simulated match. The fixture made no Supabase writes and was stopped afterward. Its screenshot uses test identity and schedule data.


## Two-minute registration test

The owner reported successful execution of the explicit demo migration and schedule script. The signed-in invitations page was refreshed and visibly showed registration open, closing at 23:50 IST on 17 November 2026, with the Join offer pool control. This verifies the applied test schedule, not an actual completed fan join. Normal scheduling limits and the join RPC are unchanged. A local test covers exact opening and exclusive closing at the requested two-minute boundaries. The new SQL temporary-table constraint checks are prepared but have not been run in Supabase.
