# PlayPulse local QA and demo guide

QA date: 27 October 2026. This repository is a localhost prototype; do not deploy it or connect it to real sports, vendor, payment, messaging, or identity services.

## Install and run

Requires Node.js 18 or newer. Dependencies are already present in the current workspace. On a fresh checkout only:

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

Final result: 62 tests passed, 0 failed, 0 skipped. All repository JavaScript files also passed `node --check`, `git diff --check` passed, and both browser tabs reported no console errors. A literal `pnpm test` attempt initially failed because this workstation could not find `node` on `PATH`; the same package script passed after adding the bundled Node directory as shown above.

## Journey coverage

1. **Onboarding:** manually verified Arsenal, Premier League, food, merchandise, and celebration preferences save into the browser and reach the lobby. Preference validation and empty/corrupt storage have automated coverage.
2. **Prediction and join:** creation, editing, lock time, invalid scores, duplicate prediction, reward cap, and idempotent join points have automated coverage. The labelled simulated lobby and Join Match action were manually verified.
3. **Confirmed goal:** manually verified an Arsenal goal changes the score and opens the eligible Arsenal offer. Socket routing and penalty timing have integration coverage.
4. **Duplicate delivery:** integration coverage proves one event/campaign/claim. Browser verification confirmed replaying the stable sample event ID adds no notification. Generated IDs remain distinct after reset.
5. **Overturn:** integration coverage confirms score reversal, campaign cancellation, preserved claims, `review_required` fulfilment, and audit history.
6. **Claim before expiry:** manually verified Buy Now creates one local claim, notification, reservation, and localhost confirmation. No retailer or payment request is sent.
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
3. **25–38 seconds — Live trigger:** In the admin tab click **Goal · Arsenal — Bukayo Saka scores**. Return immediately to the fan tab. The score becomes 1–0 and the flash offer opens.
4. **38–52 seconds — Relevant offer:** Show the five-minute claim clock, £80 → £48 calculation, tracked demo inventory, fulfilment estimate, and the real-signal **Why this offer?** explanation. Click **Buy now**.
5. **52–62 seconds — Safe redemption:** Show the localhost **Your offer is claimed** page and say that no order, payment, delivery, or vendor request was created. Click **Return to PlayPulse**.
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
