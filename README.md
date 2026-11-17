# PlayPulse: personalized football flash commerce PoC

PlayPulse combines Supabase email/password accounts and persistent match-pool registration with the existing simulated Arsenal–Chelsea match, sentiment-based multi-merchant offers, and demo-coupon wallet. Guests must sign in. Verified accounts see invitations and merchant announcements; only fans who join the match pool before its deadline can enter its lobby, receive live updates, view offers and claim. Admins retain monitoring access. Match events, campaign activations, inventory and coupons remain process-local simulations. There is no real football feed, retailer integration, payment or production redemption.

## Run

Requires Node.js 22.12 or newer (the installed development runtime is Node.js 24).

```bash
# Only when dependencies are not already installed
pnpm install

node server.js
```

Open the [fan app](http://127.0.0.1:3000/) or [sign-up/sign-in page](http://127.0.0.1:3000/auth). The [admin workspace](http://127.0.0.1:3000/admin) requires an explicitly assigned admin account. Offer preferences, points and predictions remain browser-local and are partitioned by account; pool membership and the locked match team are recovered from Supabase across devices. There is no invented kickoff: an admin must schedule registration first.

See [QA.md](./QA.md) for the verified journey matrix, exact local commands, a 90-second YC demo script, and known limitations.

In admin, trigger a goal, award a penalty and then mark it scored or missed, spotlight a player, or end the match. Offers route only to fans following the affected team and are filtered by their saved offer and match-day preferences. Use **Reset match** to try another scenario and **Restart welcome screen** in Clubs to clear the saved fan setup. Run `node --test` for validation, UI contract, and routing integration tests.

The match screen includes an ordered timeline sourced entirely from the seeded local simulator. Each entry shows its minute, event type, team or match scope, confirmation status, and associated offer state. Supported demo events include goals, penalty awards and results, red cards, half-time, full-time, postponement, suspension, player spotlights, and overturns. Nothing in this prototype is connected to a real sports feed.

The admin-only simulator provides deterministic sample events, a five-minute clock advance, duplicate replay, overturn, and reset. Sample event IDs are stable. Replaying an ID returns the original event without changing the score, timeline, campaigns, claims, or coupons. Generated manual event, campaign, merchant campaign, and watch-party IDs remain monotonic for the running server so browser history cannot confuse a new post-reset item with an earlier one. The pending-goal sample demonstrates a two-step path: **detected → pending confirmation → confirmed**. It cannot change the score or activate a campaign until the explicit confirmation action. The admin audit lists the event, campaign, and claim transitions with their reasons.

## Deterministic event and campaign lifecycle

Events and campaigns are separate state machines in [lib/state-machine.js](./lib/state-machine.js):

- Event states: `detected`, `pending_confirmation`, `confirmed`, `overturned`, and `ignored`.
- Campaign states: `scheduled`, `active`, `paused`, `exhausted`, `expired`, and `cancelled`.
- Only a confirmed event applies its score or match-state effect and evaluates campaign rules.
- Stable event IDs make duplicate delivery idempotent. Each matching catalogue campaign receives its own activation for the event and target team, with an independent claim deadline and capacity.
- A claim is idempotent for its activation and local browser user ID. Across all activations, one local fan can claim once per merchant per match; separate merchants remain independently claimable. Released, expired, redeemed, and review-required coupons still count toward that merchant limit.
- Overturning a confirmed event reverses its score effect where applicable and cancels campaigns created by it. Existing claims remain in the audit as `review_required`; they are not silently deleted.
- The claim window defaults to five minutes. Merchandise coupons last 24 hours after claiming by default. Food and café coupons are valid during the match and expire at full time plus a merchant-selected grace of zero to two hours (two hours by default). Their exact timestamp is pending until full time is confirmed. The server rejects new order completion and redemption at the applicable cutoff. Retrying a claim never grants a fresh validity window.
- Suspension pauses active campaigns. Postponement and the final whistle close earlier in-play campaigns; any full-time result campaign is then evaluated from the final score. Events arriving after suspension, postponement, or full-time are recorded as ignored when sent through the simulator.
- An event with an earlier minute is retained in chronological timeline order and marked as delayed. Rules still run once at confirmation time.

The state machine is deterministic JavaScript. It does not use an LLM, VAR inference, a sports API, or an external campaign service.

## Local offer catalogue and inventory

[lib/offer-catalogue.js](./lib/offer-catalogue.js) seeds seven clearly labelled demo offers from three fictional demo vendors. Each offer has a stable ID, vendor, category, supported match/team/events, campaign dates, claim deadline, eligible product, price in integer minor units, discount rule, minimum basket, fulfilment mode and estimate, funding source, and optional tracked inventory.

- Percentage and fixed discounts are calculated in integer minor units. The API returns original price, discount amount, and final price.
- Event confirmation discovers offers by match, team, event, mood, active dates, claim deadline, and availability.
- The browser filters the collection by the fan's saved categories and celebration/comfort preference. Category chips refine that collection. Each card identifies its own merchant, offer, price, countdown, and claim state; Details opens that specific offer.
- Claiming revalidates the selected offer and minimum basket on the server before reserving inventory.
- Reservation uses a synchronous check-and-decrement in this single Node process. Duplicate claims return the original reservation and do not decrement stock twice.
- A reservation can be released once. Release never raises remaining stock above its seeded quantity cap.
- Remaining quantity appears only for offers whose inventory is explicitly tracked in the seeded data.
- The modal separates its claim countdown, coupon validity after claiming, and delivery or pickup estimate. The confirmation page loads the saved coupon from the server and shows its exact claimed-at and use-by timestamps. Claim and order notifications reopen that page in the same browser.
- Later goals and penalty attention do not supersede earlier active offers. Full time closes earlier in-play claim windows without invalidating saved coupons. An overturned source event still places unredeemed claims under review, including after their claim window has closed.
- Redeemed reservations cannot be released. A completed, unredeemed demo order must be cancelled through the merchant workspace to release its inventory. Coupon expiry prevents use but does not automatically release a reservation; the existing release/cancellation controls remain available.

All catalogue, reservation, and inventory state is in memory and resets with the local demo. There are no payments, live vendors, real discounts, or external inventory systems.

## Demo merchant workspace

The top of `/admin` is a local **Demo merchant account** workspace. It lists the seeded offers and products, reports active campaigns, active reservations, and budget committed from the in-memory reservation records, and provides a responsive campaign builder. A merchant can preview, create, edit, activate, pause, resume, or cancel a campaign.

The builder validates its title, description, vendor/product pairing, event and team targeting, discount, campaign dates, claim window, food/café post-match grace, minimum basket, tracked inventory, budget, maximum redemptions, fulfilment, and funding source on the server. Food/café settings offer match-only, 30 minutes, one hour, or two hours after full time; the API enforces a maximum of two hours. Maximum redemptions cannot exceed tracked inventory or the number that the campaign budget can fund. An edit cannot reduce inventory, redemption capacity, or budget below reservations already made. Campaigns are saved as `scheduled`; activation succeeds only during the configured campaign window and with available budget and capacity. Cancelled, expired, and exhausted campaigns are terminal in this demo.

Merchant-created campaigns join the same catalogue used by the event router, so an active campaign can become a fan offer when its match, team, event, mood, dates, inventory, and budget are eligible. The builder and dashboard are process-local: restart or **Reset match** restores the seed data. They do not authenticate a real vendor, place orders, or charge anyone.

## Local merchant analytics

The **Campaign economics** view on `/admin` calculates its figures from records created during the current local run. An impression is recorded once when one local user sees a selected offer in one triggered campaign. A claim comes from the fan's **Claim offer** action and is recorded against that specific activation and merchant. The merchant transaction controls can then explicitly mark that claim as a completed demo order, redeem its coupon, or cancel an unredeemed completed order. These actions are idempotent and do not send a real order or payment.

The view reports impressions, claims, completed demo orders, redemptions, order cancellations, campaign expiries, gross order value after discount, discount amount, funding split, average order value, claim rate, redemption rate, and campaign budget. Every rate labels its denominator, and averages or rates with a zero denominator show an em dash. Cancelled orders are excluded from gross order value and release their local inventory reservation.

Vendor-funded discounts use a 100% vendor share, sponsor-funded discounts use 0%, and co-funded campaigns store an explicit vendor percentage; the sponsor funds the remainder. Contribution is displayed only after a reviewer supplies unit product and fulfilment costs. Its labelled estimate is:

`gross order value after discount + sponsor-funded discount − (completed orders × (unit product cost + unit fulfilment cost))`

The demo does not report customer acquisition, repeat purchase, revenue lift, or incremental sales. The UI describes a future randomized holdout experiment because no control group exists in this prototype.

## Personalised offer ranking

[public/offer-ranking.js](./public/offer-ranking.js) provides a small AI-ready ranking interface. `recommendOffers` first applies deterministic hard eligibility for campaign status and dates, claim deadline, inventory, redemption capacity, budget, match, team, event, and campaign mood. Only that eligible set is passed to the ranker. A future ranker cannot return an offer outside that set without the interface rejecting its result.

The current `deterministic-weighted-v1` ranker uses the fan's explicitly saved category, selected team, chosen celebration or comfort setting, event relevance, and locally recorded offer-category views or claims. Location contributes only if a future caller supplies both explicit consent and actual distance data; this prototype asks for neither. Identical inputs produce the same order, with campaign date and stable offer ID as tie-breakers. Missing preference data uses deterministic relevance and chronological fallback sorting.

Each offer detail window is labelled **Personalised recommendations · rule-based** and displays a short **Why this offer?** explanation assembled only from signals that actually matched. PlayPulse does not infer a fan's emotional state, use sensitive personal data, or claim that this rules engine is a trained AI model. Eligibility, inventory, expiry, campaign budget, pricing, coupon, and reservation checks remain deterministic server rules and are repeated when the fan claims.

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

To emulate two fans, sign in to two different verified accounts in separate browser profiles or a private window. Signing in to the same account restores its existing pool membership and team.

## One concrete flow

1. A signed-in fan sees invitations at `/invitations` and joins the scheduled pool during its registration window, locking one side for that match in Supabase. Closing registration blocks new memberships, while existing memberships can be recovered. A member following Arsenal joins `fans:Arsenal`; Chelsea followers join `fans:Chelsea`. Only pool members can enter the fan lobby or claim; admins can monitor the simulated match.
2. Admin triggers **GOAL by Arsenal** at 14′. Everyone sees the score become 1–0.
3. Arsenal's collection receives four eligible celebration offers from three fictional merchants before preference filters; Chelsea's collection receives two comfort offers because Chelsea trails. There are no forced offer pop-ups. Non-members remain on invitations with registration times, participant counts and participating merchant names; they receive no score, timeline, live offers or wallet data.
4. Each activation has its own absolute claim deadline. A fan can claim the kit and a food offer from different merchants, then find both coupons in Wallet. The kit and scarf share one merchant, so claiming either uses that merchant's allowance for this match.
5. The wallet restores from the server after reload/reconnect and filters coupons by Ready, Used, Expired, and Other (review/cancelled). Each entry shows its merchant, originating moment, code, and exact use-by time. Its detail page returns directly to Wallet.

A **penalty awarded** names the club that won it and, if supplied, the player stepping up. It sends no new offers while the kick is pending, and existing activations retain their deadlines. The admin then records **scored** or **missed**. A score updates the match: a team that leads gets celebration offers; a team still trailing gets comfort food/café offers; an equalizer creates neither mood. A miss adds comfort offers for the penalty taker's fans. Each matching merchant campaign gets its own card in the collection; Details opens it on demand. A **player spotlight** adds themed offers only when the current team sentiment permits celebration. This fixture uses Bukayo Saka for Arsenal and Cole Palmer for Chelsea as mock player examples. **Full-time** evaluates winner/loser offers from the result; a draw adds no offers.

## Demo endpoints

Public GET examples work without signing in. Mutating and wallet requests now require the appropriate authenticated session cookie; examples below show payload shapes, not an authentication bypass. Use the app rather than copying session cookies into shell history.

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

`GET /api/match` returns the member/admin-only simulated match state, including `pending_penalty`, `timeline`, campaign configuration, and campaign audit snapshots. `GET /api/campaigns` exposes the same local campaign history plus the allowed states for debugging. Goal and penalty awards accept an optional `player`; spotlight requires one. The player must match the featured player for the selected club in this demo. A penalty result requires the awarded team's name and an `outcome` of `scored` or `missed`. Active deals are sent only over the selected team's Socket.io room. The mock clock advances one match minute per real minute while the internal status is `LIVE`.

### Intentionally simplified edge cases

- Accounts and pool memberships persist in Supabase. Restarting the server still clears simulated events, campaigns, inventory and claims.
- Runtime engine IDs are derived from verified account IDs on the server. Body/query user IDs cannot impersonate another fan. Multiple verified accounts per real person are still an abuse-prevention concern.
- Suspension is terminal in this simulator; reset starts a new run. There is no resume-feed reconciliation.
- Event correction reverses the simple score counter but does not recalculate every later campaign from the full historical match state.
- Existing claims from an overturned event are marked for review. The prototype does not decide retailer fulfilment or refunds.
- Campaign capacity and inventory are process-local. The synchronous reservation section is atomic for this single Node process, but no concurrent database transaction is simulated.

This PoC suggests a team from searches and club views inside this demo only. It does not read Google or browser search history. The fan's confirmed team and exploration counts are saved only in this browser; there is no verified user account. The **Inbox** is entirely in-app and asks for no device or browser notification permission. The five-minute clock is only a demo claim window. **Claim offer** saves a coupon to Wallet while the fan keeps exploring. **View coupon** opens its server-backed detail page; it does not contact a retailer, create an order, take payment, or reserve a real checkout price. A production handoff would need an actual claim token and retailer agreement. No app installation is needed on the development laptop.


## Check coupon validity locally

The default claim window is five minutes. Merchandise coupon validity is 24 hours from claiming; food/café validity runs until confirmed full time plus up to two hours. For a quicker **merchandise** expiry check, start with:

```bash
PLAYPULSE_CLAIM_WINDOW_SECONDS=30 PLAYPULSE_FULFILMENT_WINDOW_SECONDS=60 node server.js
```

1. Join Arsenal in the fan app, then trigger an Arsenal goal in `/admin`.
2. Claim a kit or scarf within 30 seconds. Open Wallet and then **View coupon** to see a merchandise use-by time 60 seconds after claiming. The override does not give food a claim-based window.
3. Return to Wallet or open the claim notification in Inbox to recover the same coupon and deadline. A later goal does not invalidate that coupon.
4. In `/admin`, complete the demo order and redeem it before its coupon deadline. Redemption is idempotent.
5. To check expiry, claim from another merchant (or reset the demo) and leave that coupon unredeemed. At the use-by time, its confirmation displays **Expired**, merchant use controls disappear, and direct API attempts to complete a new order or redeem return HTTP 409.

`GET /api/claims/:claimId` retrieves the signed-in account's current saved demo claim with caching disabled. A caller-supplied `user_id` cannot override the verified session identity. The confirmation handles missing claims, another account and a reset server without claiming success. No real merchant accepts these demo coupons through an integration.


## Independent merchant offers and wallet

- `server.js` expands each confirmed event into one activation per eligible catalogue offer. No new database, frontend framework, or external dependency is introduced. Different merchants may use different claim windows, stock, discounts, budgets, and capacity. A moment with no eligible offers still records the event and score successfully.
- `public/commerce.js` renders reusable offer and wallet cards. `public/commerce.css` supplies the responsive card/filter styles. Preferences are hard filters; the collection groups cards by source moment, newest first. No fair-rotation or paid-placement system is implemented.
- `GET /api/wallet?user_id=<local-user-id>` returns only that local identity's claims, including immutable merchant/product/trigger metadata and current coupon status. Member-visible match/campaign snapshots and the catalogue no longer include claim identities, coupon codes, or reservation records. The demo merchant workspace retains its transaction and audit views.
- `offers:activated` sends one collection announcement per team/moment. `offers:state` replays all active offers when a fan selects a team. `fan:identify` subscribes a local browser ID to its `wallet:changed` invalidations; the client reloads its wallet after changes and reconnects. The original primary `deal:flash` event remains for compatibility, but the fan app uses the collection.
- Merchant limits are enforced synchronously on the server before inventory reservation using the local user, match, and merchant tuple. Repeating the exact activation returns its original claim; another activation for the same merchant returns HTTP 409 with `existing_claim_id`. Changing team, choosing another product, or releasing a coupon does not reset the limit. A demo reset clears it along with the wallet.
- The default catalogue remains seven offers from three fictional merchants. An automated fixture tests twenty independent merchants, all claimable by the same fan without cross-merchant budget, inventory, deadline, or claim conflicts.

The authenticated wallet survives reload/reconnect and can be recovered by the same account in another browser while this server process is running. Its coupon and inventory records are not yet durable across restart/reset. Persistent commerce transactions, merchant ownership, real redemption, and automatic release of expired reservations remain separate work. The combined merchant workspace is admin-only until merchant-scoped accounts are implemented.


## Food and café coupon validity

`lib/claim-lifecycle.js` applies a match-end policy to food and the seeded café experience. Merchandise retains claim-based validity. The server records `match.ended_at` from the confirmed full-time event; the displayed minute reaching 90 does not itself declare full time. In this simulator, use the explicit Full time control in `/admin`.

A food/café claim stores its own policy and post-match grace. Before full time its `fulfilment_expires_at` is null, with explicit `awaiting_match_end` metadata; the UI shows the match-relative rule instead of inventing a timestamp. At full time all pending match-day coupons receive the exact `ended_at + redemption_grace_seconds` deadline and their wallets/coupon pages update through Socket.IO. Existing merchandise deadlines do not change.

The merchant builder offers match-only, +30 minutes, +1 hour, and +2 hours. Server validation accepts only non-negative whole seconds up to 7,200. A food campaign cannot bypass the rule by requesting a claim-based policy or using the merchandise validity override. New activations after full time are capped at the same match-end deadline; match-only food campaigns do not activate after the whistle. A late claim therefore cannot create another two hours or 24 hours. Suspended/postponed matches place unredeemed match-day coupons under review.

To test without waiting two hours: edit a food campaign in `/admin`, select **Match only**, save it, trigger a goal, and claim the food offer. Its wallet entry should say **Until full time**. Trigger Full time: the coupon immediately becomes expired and the merchant cannot complete a new order or redeem it. With the default +2 hours, the exact use-by time should instead be two hours after the confirmed final whistle.

## Match sentiment and locked sides

The current confirmed score determines each team's offer mood: leading means celebration, trailing means comfort, and level means neutral (no new celebration/comfort activation). A goal that reduces a deficit still opens comfort offers for that scoring team; jerseys unlock only when it leads. A missed penalty puts that team's offers in comfort mode until the next score change or final result. Comfort is restricted to food and match-day café experiences, even if a merchant configures merchandise for a comfort event. A spotlight cannot override this policy.

When a team's mood changes, incompatible active claim windows close immediately on the server and disappear from the fan collection. New claims recheck sentiment and the locked side before reserving inventory. Already claimed coupons retain their original use-by rules; an overturned source event can still place them under review. Closed offers do not reopen automatically after an overturn; a new confirmed trigger is needed.

`POST /api/pool/join` creates the authenticated account’s immutable team choice for the scheduled match. `POST /api/fan/team` requires pool membership and validates the persisted side; client-supplied user IDs are ignored. Wallet and socket identity responses restore the canonical choice. Browsing, editing preferences, clearing site data, restarting welcome, and resetting/restarting the demo cannot change a persisted membership’s side. Reset/restart still clears runtime coupons and inventory.

This is a per-account lock, not proof that each real person owns only one account. Public sign-up cannot assign staff roles. Administrative pages, event controls and merchant APIs require an explicit database staff assignment.


## Supabase setup and match pools

1. Copy `.env.example` to ignored `.env` and set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and the canonical `APP_ORIGIN`. The supplied development configuration is already saved locally with restrictive file permissions. No service-role key is required for this integration. Never commit `.env`, database passwords or secret keys.
2. Run [the migration](./supabase/migrations/202611170001_accounts_and_match_pools.sql) in the project's SQL editor. It creates pools, immutable memberships and an empty staff table, enables RLS and revokes direct client table access. Only constrained RPCs receive explicit execute grants. No real fan data or staff role is seeded.
3. Under **Authentication → URL Configuration**, set Site URL to `http://127.0.0.1:3000` and add both `http://127.0.0.1:3000/auth/callback` and `http://127.0.0.1:3000/auth/callback?recovery=1` to Redirect URLs. For deployment, use your HTTPS app domain instead, set `APP_ORIGIN` to that domain and remove development redirects from the production project.
4. Keep email confirmation enabled. Configure a production SMTP provider before accepting outside users: Supabase's default email sender is limited and only delivers to authorized team addresses. Configure signup/password-reset email templates and test delivery using the actual provider. Google remains hidden unless its provider is configured and `PLAYPULSE_GOOGLE_AUTH=true`.
5. Create your **PlayPulse** account at `/auth` and confirm its email. A Supabase dashboard account does not automatically create a PlayPulse account. To assign the owner admin access, run a separate SQL query after replacing the address:

```sql
insert into public.playpulse_staff(user_id, role)
select id, 'admin' from auth.users
where lower(email) = lower('YOUR_OWNER_EMAIL') and email_confirmed_at is not null
on conflict(user_id) do update set role = excluded.role;
```

Only an owner with database administration access should run that role assignment; there is no public promotion endpoint. Other signups remain fans. Merchant-specific accounts and ownership are not implemented in this increment; the combined merchant/event workspace is restricted to admins.

6. Open `/admin`, enter a genuine future kickoff and choose a 60- or 120-minute registration window. The database derives opening time as kickoff minus four hours. Once any member joins, the schedule cannot be edited to reopen registration. There is no arbitrary 5,000-member pool cap. Counts are actual unique accounts, with separate Arsenal/Chelsea totals.
7. A fan joins during `opens_at <= database time < closes_at`. The transaction takes a per-match advisory lock and a unique `(match_id, user_id)` constraint prevents duplicate membership. Retries return the original record even after closing; switching teams always fails. Guests are redirected to sign-in. Signed-in non-members use `/invitations` and can see registration and merchant announcements; lobby pages redirect them there and match/offer/wallet APIs return 403. Socket.IO rejects guests, gives signed-in non-members only pool invalidations, and scopes match updates to members/admins and analytics to admins. Each merchant's existing independent claim/stock/budget limits still apply.
8. In-app invitations appear while registration is open and link to the pool. Boundary timers, reconnect and returning to the app refresh registration state. Push notifications, email/SMS invitations, background scheduling and reminder preferences are not implemented; no external invitation is sent.

`lib/supabase-access.js` uses the official Supabase server-cookie SDK, verifies identities with Auth, keeps tokens in HTTP-only SameSite cookies, uses Secure cookies for HTTPS origins, restricts redirects, checks origins on writes and limits account attempts. Cookie-backed identities also protect wallet subscriptions. Browser preferences/notifications are scoped per account. `demoMode: true` exists solely as an explicit in-process test fixture; there is no environment switch or URL to enable a legacy identity bypass in the running app.

Run `node --test` for local regression tests. [Database checks](./supabase/tests/match-pools.sql) exercise RPC access control, immutable teams, duplicate and late joins, public projection and direct-write denial inside a transaction that rolls all test records back. Those checks require execution in the Supabase SQL editor; local tests use a provider/repository double plus a separate integration test of the real cookie SDK. A 5,000-member audience has not been load-tested. Pool-count socket invalidations are batched to avoid a full audience refresh on every individual join.


### Invitations and lobby access

`public/invitations.html`, `invitations.js` and `invitations.css` provide the signed-in page outside the match lobby. The existing pool card handles the registration window, immutable side selection, counts and merchant announcements. Successful joining enters the lobby; a returning member can use **Enter match lobby** even after registration closes. Missing registration never unlocks a score or offer preview. The sign-in screen has no Explore match link. Google sign-in remains disabled at the owner's request.

`server.js` enforces the policy for HTML pages, checkout, HTTP APIs and Socket.IO subscriptions/broadcasts. Admin accounts retain match monitoring and control. Invitations are in-app while the page is open; external delivery, out-of-window live match announcements and background push remain unimplemented. The pool RPC's existing anonymous database projection contains only schedule/count metadata, never the match feed or fan identities; application `/api/pool` now requires sign-in.


### One-off two-minute registration test

Migration `supabase/migrations/202611170002_two_minute_demo_window.sql` allows exactly two minutes only for the existing simulated fixture. Normal admin scheduling still enforces a 60–120 minute window opening four hours before kickoff. The one-off `supabase/dev/run-two-minute-test.sql` combines that migration with the specifically requested 17 November 2026, 23:48–23:50 IST slot. It refuses expired slots or pools with existing memberships. It never deletes or changes fan memberships. These fixed timestamps are not a recurring timer. For another test, edit both timestamps in the development script before execution.

The existing join RPC continues to enforce opening, closing and immutable teams against the database clock. Saving a normal admin schedule replaces the short test times if no fans have joined. Once fans join, preserve their pool and use a future fixture for the next real schedule; this prototype currently supports one fixture. Constraint checks in `supabase/tests/two-minute-demo-window.sql` use a temporary table and leave real pools untouched.
