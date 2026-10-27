# PlayPulse: personalized football flash commerce PoC

This local demo provides onboarding, a simulated Arsenal–Chelsea Premier League match lobby, free match predictions, and event-triggered offers. A fan's selected club joins that club's Socket.io room for five-minute offers. No account, paid football feed, app installation, payment, or real affiliate integration is needed for the demo.

## Run

Requires Node.js 18 or newer.

```bash
# Only when dependencies are not already installed
pnpm install

node server.js
```

Open the [fan view](http://127.0.0.1:3000/) and [admin trigger](http://127.0.0.1:3000/admin) in separate tabs. First choose a club, optional league, offer categories, and match-day mode. The choices are validated and saved only in this browser using `localStorage`; clearing browser site data removes them, and they do not follow the user to another device. Returning users open in the local demo match lobby, where they can review or edit their choices before joining. The seeded Arsenal–Chelsea fixture has no kickoff timestamp, so the lobby honestly shows the live demo state without an invented pre-match countdown.

See [QA.md](./QA.md) for the verified journey matrix, exact local commands, a 90-second YC demo script, and known limitations.

In admin, trigger a goal, award a penalty and then mark it scored or missed, spotlight a player, or end the match. Offers route only to fans following the affected team and are filtered by their saved offer and match-day preferences. Use **Reset match** to try another scenario and **Restart welcome screen** in Clubs to clear the saved fan setup. Run `node --test` for validation, UI contract, and routing integration tests.

The match screen includes an ordered timeline sourced entirely from the seeded local simulator. Each entry shows its minute, event type, team or match scope, confirmation status, and associated offer state. Supported demo events include goals, penalty awards and results, red cards, half-time, full-time, postponement, suspension, player spotlights, and overturns. Nothing in this prototype is connected to a real sports feed.

The admin-only simulator provides deterministic sample events, a five-minute clock advance, duplicate replay, overturn, and reset. Sample event IDs are stable. Replaying an ID returns the original event without changing the score, timeline, campaigns, claims, or coupons. Generated manual event, campaign, merchant campaign, and watch-party IDs remain monotonic for the running server so browser history cannot confuse a new post-reset item with an earlier one. The pending-goal sample demonstrates a two-step path: **detected → pending confirmation → confirmed**. It cannot change the score or activate a campaign until the explicit confirmation action. The admin audit lists the event, campaign, and claim transitions with their reasons.

## Deterministic event and campaign lifecycle

Events and campaigns are separate state machines in [lib/state-machine.js](./lib/state-machine.js):

- Event states: `detected`, `pending_confirmation`, `confirmed`, `overturned`, and `ignored`.
- Campaign states: `scheduled`, `active`, `paused`, `exhausted`, `expired`, and `cancelled`.
- Only a confirmed event applies its score or match-state effect and evaluates campaign rules.
- Stable event IDs and one campaign per event/team rule make duplicate delivery idempotent.
- A claim is also idempotent for its campaign and local browser user ID.
- Overturning a confirmed event reverses its score effect where applicable and cancels campaigns created by it. Existing claims remain in the audit as `review_required`; they are not silently deleted.
- The claim window defaults to five minutes. A successful claim receives a separate fulfilment deadline, which defaults to 24 hours in the demo.
- Suspension pauses active campaigns. Postponement and the final whistle close earlier in-play campaigns; any full-time result campaign is then evaluated from the final score. Events arriving after suspension, postponement, or full-time are recorded as ignored when sent through the simulator.
- An event with an earlier minute is retained in chronological timeline order and marked as delayed. Rules still run once at confirmation time.

The state machine is deterministic JavaScript. It does not use an LLM, VAR inference, a sports API, or an external campaign service.

## Local offer catalogue and inventory

[lib/offer-catalogue.js](./lib/offer-catalogue.js) seeds seven clearly labelled demo offers from three fictional demo vendors. Each offer has a stable ID, vendor, category, supported match/team/events, campaign dates, claim deadline, eligible product, price in integer minor units, discount rule, minimum basket, fulfilment mode and estimate, funding source, and optional tracked inventory.

- Percentage and fixed discounts are calculated in integer minor units. The API returns original price, discount amount, and final price.
- Event confirmation discovers offers by match, team, event, mood, active dates, claim deadline, and availability.
- The browser applies the fan's saved categories locally and selects the best eligible catalogue choice. If that category is unavailable, the modal labels and shows an eligible alternative.
- Claiming revalidates the selected offer and minimum basket on the server before reserving inventory.
- Reservation uses a synchronous check-and-decrement in this single Node process. Duplicate claims return the original reservation and do not decrement stock twice.
- A reservation can be released once. Release never raises remaining stock above its seeded quantity cap.
- Remaining quantity appears only for offers whose inventory is explicitly tracked in the seeded data.
- The modal separates its campaign claim countdown from delivery or pickup fulfilment time.

All catalogue, reservation, and inventory state is in memory and resets with the local demo. There are no payments, live vendors, real discounts, or external inventory systems.

## Demo merchant workspace

The top of `/admin` is a local **Demo merchant account** workspace. It lists the seeded offers and products, reports active campaigns, active reservations, and budget committed from the in-memory reservation records, and provides a responsive campaign builder. A merchant can preview, create, edit, activate, pause, resume, or cancel a campaign.

The builder validates its title, description, vendor/product pairing, event and team targeting, discount, campaign dates, claim window, minimum basket, tracked inventory, budget, maximum redemptions, fulfilment, and funding source on the server. Maximum redemptions cannot exceed tracked inventory or the number that the campaign budget can fund. An edit cannot reduce inventory, redemption capacity, or budget below reservations already made. Campaigns are saved as `scheduled`; activation succeeds only during the configured campaign window and with available budget and capacity. Cancelled, expired, and exhausted campaigns are terminal in this demo.

Merchant-created campaigns join the same catalogue used by the event router, so an active campaign can become a fan offer when its match, team, event, mood, dates, inventory, and budget are eligible. The builder and dashboard are process-local: restart or **Reset match** restores the seed data. They do not authenticate a real vendor, place orders, or charge anyone.

## Local merchant analytics

The **Campaign economics** view on `/admin` calculates its figures from records created during the current local run. An impression is recorded once when one local user sees a selected offer in one triggered campaign. A claim comes from the fan's **Buy now** action. The merchant transaction controls can then explicitly mark that claim as a completed demo order, redeem its coupon, or cancel an unredeemed completed order. These actions are idempotent and do not send a real order or payment.

The view reports impressions, claims, completed demo orders, redemptions, order cancellations, campaign expiries, gross order value after discount, discount amount, funding split, average order value, claim rate, redemption rate, and campaign budget. Every rate labels its denominator, and averages or rates with a zero denominator show an em dash. Cancelled orders are excluded from gross order value and release their local inventory reservation.

Vendor-funded discounts use a 100% vendor share, sponsor-funded discounts use 0%, and co-funded campaigns store an explicit vendor percentage; the sponsor funds the remainder. Contribution is displayed only after a reviewer supplies unit product and fulfilment costs. Its labelled estimate is:

`gross order value after discount + sponsor-funded discount − (completed orders × (unit product cost + unit fulfilment cost))`

The demo does not report customer acquisition, repeat purchase, revenue lift, or incremental sales. The UI describes a future randomized holdout experiment because no control group exists in this prototype.

## Personalised offer ranking

[public/offer-ranking.js](./public/offer-ranking.js) provides a small AI-ready ranking interface. `recommendOffers` first applies deterministic hard eligibility for campaign status and dates, claim deadline, inventory, redemption capacity, budget, match, team, event, and campaign mood. Only that eligible set is passed to the ranker. A future ranker cannot return an offer outside that set without the interface rejecting its result.

The current `deterministic-weighted-v1` ranker uses the fan's explicitly saved category, selected team, chosen celebration or comfort setting, event relevance, and locally recorded offer-category views or claims. Location contributes only if a future caller supplies both explicit consent and actual distance data; this prototype asks for neither. Identical inputs produce the same order, with campaign date and stable offer ID as tie-breakers. Missing preference data uses deterministic relevance and chronological fallback sorting.

Each flash window is labelled **Personalised recommendations · rule-based** and displays a short **Why this offer?** explanation assembled only from signals that actually matched. PlayPulse does not infer a fan's emotional state, use sensitive personal data, or claim that this rules engine is a trained AI model. Eligibility, inventory, expiry, campaign budget, pricing, coupon, and reservation checks remain deterministic server rules and are repeated when the fan claims.

## Merchant decision support demo

The **Campaign planning copilot** on `/admin` is a deterministic template engine with no external model, API call, credential, or ML training pipeline. The merchant supplies expected eligible reach, available stock, available campaign budget, a campaign goal, and optional unit costs. The selected local campaign supplies its actual discount, remaining redemption ceiling, price, and funding split.

At least three valid runtime samples for the selected offer are required before the engine uses local observations. A sample is one triggered campaign with recorded impressions, claims, and completed demo orders. Until that threshold is met, the UI and response explicitly identify a fixed illustrative demo dataset. The displayed claim and completed-order ranges apply the lowest and highest sample rates to the merchant-entered reach; they are scenario ranges, not statistical confidence intervals or claims about real customer behaviour.

The conservative stock cap is:

`minimum(available stock, budget ÷ discount per claim, remaining maximum redemptions, upper claim scenario)`

The merchant can override that recommendation only within the stock, budget, and redemption boundary. If both unit product cost and fulfilment cost are supplied, the demo also calculates contribution per completed order as `final price + sponsor-funded discount − product cost − fulfilment cost`. Missing cost inputs remain missing; the assistant does not invent margin, stock, reach, conversion, or lift.

## Local engagement and watch parties

The fan **Profile** uses the same local browser identity as predictions. Points are deterministic and idempotent: a saved free prediction earns 10 once per match, joining the match experience earns 5 once per match, a correct final outcome earns 10, and an exact score earns 25 instead of the outcome award. Purchases, offer views, repeat clicks, group creation, and notification permission earn no points. There is no paid entry, betting, wagering, cash prize, or leaderboard.

Badges are based only on saved records. **Early Bird** mirrors a granted Early Bird reward, **Prediction Streak** requires predictions across three consecutive match sequence numbers, and **Match Regular** requires actual Join Match records across three consecutive match sequence numbers. This one-fixture prototype can show progress but cannot fabricate the later matches needed to earn the streak badges. Points, badges, and their history are stored in `localStorage` and can be cleared with the welcome-screen reset.

Watch-party features are off until the fan opts in. A fan can create a small process-local group, copy its local invite link or code manually, join an invitation, and leave. PlayPulse sends no external message and builds no chat, feed, public participant list, or multiplayer transport. Member counts come from unique local user IDs that actually joined the in-memory group. Group reward progress reaches its target at three actual members only while the current catalogue has an active campaign for the match/team with enough stock and remaining budget for a claim. It does not reserve inventory or issue a coupon automatically. Groups disappear when the server or demo match resets.

## In-app notification centre

The fan **Inbox** records confirmed simulated match events, eligible offer activation, claim success, offer expiry, and claim-related order or redemption changes. Every entry has a stable source-derived ID, so replaying a duplicate event or campaign update cannot create another entry. Links return to the match, current offer, profile, or claim status where that destination exists.

Event alerts and offer alerts can be disabled separately. A disabled category is remembered as suppressed, so a later duplicate delivery is still ignored. Quiet mode keeps new entries and unread counts in the inbox but suppresses the polite live-region announcement. Claim and order entries remain in history because they describe actions involving the local user. The app requests no browser notification permission and sends no push, SMS, email, or external message.

Important in-app updates use a polite ARIA live region, notification rows are keyboard-operable buttons, the offer dialog supports Escape, and the shared stylesheet disables meaningful motion when `prefers-reduced-motion: reduce` is set. Confetti remains decorative, pointer-transparent, and unnecessary for reading or claiming an offer.

The lobby also supports one free score or outcome prediction per local browser ID and match. The explicit **Edit prediction** action works only while the simulated window is open. With no trustworthy kickoff timestamp, the admin page controls the open/locked state and labels it as simulated. The first 5,000 eligible claims in the running local server receive an Early Bird badge by default; the in-memory capacity resets when the server restarts and is not a claim that real users joined. Reaching the cap does not block predictions or regular eligible offers. Predictions and the local identifier use `localStorage`, so clearing site data can bypass these lightweight prototype boundaries; this is not multi-account fraud prevention.

Optional local configuration is read when the server starts:

```bash
PLAYPULSE_PREDICTION_STATE=locked node server.js
PLAYPULSE_PREDICTION_LOCK_AT=2026-10-28T18:30:00Z node server.js
PLAYPULSE_EARLY_BIRD_CAP=5000 node server.js
PLAYPULSE_CLAIM_WINDOW_SECONDS=300 node server.js
PLAYPULSE_FULFILMENT_WINDOW_SECONDS=86400 node server.js
PLAYPULSE_CAMPAIGN_CAPACITY=1000 node server.js
```

To emulate two different fans simultaneously, use separate browser profiles or a normal and private window: a browser profile shares the chosen team between its tabs.

## One concrete flow

1. A guest can browse the match without offers. If they follow **Arsenal**, their browser joins the `fans:Arsenal` Socket.io room. A Chelsea follower joins `fans:Chelsea`.
2. Admin triggers **GOAL by Arsenal** at 14′. Everyone sees the score become 1–0.
3. Arsenal's room gets a celebration kit offer. Because Chelsea now trails, Chelsea's room gets a comfort meal offer. Browsing guests receive neither.
4. Each offer has its own absolute expiry timestamp. Its modal counts down from five minutes and disappears at zero, including after a reconnect or page reload.

A **penalty awarded** names the club that won it and, if supplied, the player stepping up. It sends no offer while the kick is pending and clears older offers so fans can watch. The admin then records **scored** or **missed**. A score updates the match and sends a celebration offer to that club's fans, plus a comfort offer to the opponent's fans if their club is behind. A miss sends a comfort offer to the penalty taker's fans. These penalty-result offers arrive as small cards; tapping **View deal** opens the full window. Each card lasts five minutes from the result. A **player spotlight** names a featured player and sends a themed offer without changing the score. This fixture uses Bukayo Saka for Arsenal and Cole Palmer for Chelsea as mock player examples. **Full-time** sends a celebration offer to the winner's fans and a comfort offer to the loser's fans; a draw sends no offer.

## Demo endpoints

```bash
curl -X POST http://127.0.0.1:3000/api/events/goal \
  -H 'Content-Type: application/json' -d '{"team":"Arsenal"}'

curl -X POST http://127.0.0.1:3000/api/events/penalty \
  -H 'Content-Type: application/json' -d '{"team":"Chelsea","player":"Cole Palmer"}'

curl -X POST http://127.0.0.1:3000/api/events/penalty-result \
  -H 'Content-Type: application/json' -d '{"team":"Chelsea","outcome":"scored"}'

curl -X POST http://127.0.0.1:3000/api/events/spotlight \
  -H 'Content-Type: application/json' -d '{"team":"Arsenal","player":"Bukayo Saka"}'

curl -X POST http://127.0.0.1:3000/api/events/full-time
curl -X POST http://127.0.0.1:3000/api/match/reset

curl -X POST http://127.0.0.1:3000/api/simulator/event \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"demo-goal-001","type":"goal","team":"Arsenal","player":"Bukayo Saka","minute":23}'

curl -X POST http://127.0.0.1:3000/api/simulator/event \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"demo-pending-goal-001","type":"goal","team":"Arsenal","player":"Bukayo Saka","minute":22,"lifecycle_state":"pending_confirmation"}'

curl -X POST http://127.0.0.1:3000/api/simulator/confirm \
  -H 'Content-Type: application/json' -d '{"event_id":"demo-pending-goal-001"}'

curl -X POST http://127.0.0.1:3000/api/simulator/ignore \
  -H 'Content-Type: application/json' -d '{"event_id":"demo-pending-goal-001"}'

curl -X POST http://127.0.0.1:3000/api/simulator/duplicate \
  -H 'Content-Type: application/json' -d '{"event_id":"demo-goal-001"}'

curl -X POST http://127.0.0.1:3000/api/simulator/overturn \
  -H 'Content-Type: application/json' -d '{"event_id":"demo-goal-001"}'

curl -X POST http://127.0.0.1:3000/api/simulator/advance \
  -H 'Content-Type: application/json' -d '{"minutes":5}'

curl http://127.0.0.1:3000/api/campaigns

curl http://127.0.0.1:3000/api/catalogue

curl 'http://127.0.0.1:3000/api/offers?team=Arsenal&event=goal&mood=celebrate&categories=food'

curl -X POST http://127.0.0.1:3000/api/campaigns/ars-celebrate-992/claim \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"local-demo-user","offer_id":"demo-ars-kit-40","basket_subtotal_minor":8000}'

curl -X POST http://127.0.0.1:3000/api/reservations/RESERVATION_ID/release \
  -H 'Content-Type: application/json' -d '{"user_id":"local-demo-user"}'
```

`GET /api/match` returns the public simulated match state, including `pending_penalty`, `timeline`, campaign configuration, and campaign audit snapshots. `GET /api/campaigns` exposes the same local campaign history plus the allowed states for debugging. Goal and penalty awards accept an optional `player`; spotlight requires one. The player must match the featured player for the selected club in this demo. A penalty result requires the awarded team's name and an `outcome` of `scored` or `missed`. Active deals are sent only over the selected team's Socket.io room. The mock clock advances one match minute per real minute while the internal status is `LIVE`.

### Intentionally simplified edge cases

- All state is in memory. Restarting the server clears events, campaigns, and claims.
- A local browser ID is enough for demo idempotency. Clearing site data or using another browser creates another identity.
- Suspension is terminal in this simulator; reset starts a new run. There is no resume-feed reconciliation.
- Event correction reverses the simple score counter but does not recalculate every later campaign from the full historical match state.
- Existing claims from an overturned event are marked for review. The prototype does not decide retailer fulfilment or refunds.
- Campaign capacity and inventory are process-local. The synchronous reservation section is atomic for this single Node process, but no concurrent database transaction is simulated.

This PoC suggests a team from searches and club views inside this demo only. It does not read Google or browser search history. The fan's confirmed team and exploration counts are saved only in this browser; there is no verified user account. The **Inbox** is entirely in-app and asks for no device or browser notification permission. The five-minute clock is only a demo claim window. **Buy now** opens a localhost confirmation page; it does not contact a retailer, create an order, take payment, or reserve a real checkout price. A production handoff would need an actual claim token and retailer agreement. No app installation is needed on the development laptop.
