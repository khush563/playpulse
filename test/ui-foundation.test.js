const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fan = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'public', 'shared.css'), 'utf8');

test('fan and merchant screens share PlayPulse foundations and reciprocal local navigation', () => {
  for (const screen of [fan, admin]) {
    assert.match(screen, /<title>PlayPulse/);
    assert.match(screen, /href="\/shared\.css"/);
    assert.match(screen, />\s*playpulse\.<\/div>/);
    assert.doesNotMatch(screen, /href="#"/);
  }

  assert.match(fan, /class="pp-context-link" href="\/admin">MERCHANT<\/a>/);
  assert.match(admin, /class="pp-context-link" href="\/">FAN APP<\/a>/);
  assert.match(shared, /:where\(button, input, a\):focus-visible/);
  assert.match(shared, /button:disabled/);
  assert.match(shared, /\.pp-status-line\[data-kind="error"\]/);
});

test('fan onboarding exposes validated local preferences and an honest demo lobby', () => {
  assert.match(fan, /id="onboarding-view"/);
  assert.match(fan, /id="preference-form"/);
  assert.match(fan, /src="\/preferences\.js"/);
  assert.match(fan, /id="lobby-view"/);
  assert.match(fan, /id="join-match"[^>]*disabled/);
  assert.match(fan, /Kickoff time unavailable · local demo/);
  assert.match(fan, /data-edit-preferences/);
  assert.match(fan, /src="\/predictions\.js"/);
  assert.match(fan, /id="prediction-form"/);
  assert.match(fan, /SIMULATED · OPEN/);
  assert.match(fan, /not a real signup count/);
  assert.match(admin, /data-prediction-state="open"/);
  assert.match(admin, /data-prediction-state="locked"/);
  assert.match(fan, /id="timeline-list"/);
  assert.match(fan, /SEEDED SIMULATION/);
  assert.match(admin, /SEEDED SIMULATOR · NOT A LIVE FEED/);
  assert.match(admin, /data-sim-action="duplicate"/);
  assert.match(admin, /data-sim-action="overturn"/);
  assert.doesNotMatch(fan, /official partner|official affiliation/i);
});

test('fan claims and the admin lifecycle audit are exposed through working controls', () => {
  assert.match(fan, /api\/campaigns\/\$\{encodeURIComponent/);
  assert.match(fan, /id="campaign-notice"/);
  assert.match(fan, /socket\.on\('campaign:state'/);
  assert.match(admin, /id="audit-list"/);
  assert.match(admin, /data-lifecycle="pending_confirmation"/);
  assert.match(admin, /data-sim-action="confirm"/);
  assert.match(admin, /data-sim-action="ignore"/);
});

test('catalogue pricing, fulfilment, inventory, and alternatives have visible UI contracts', () => {
  assert.match(fan, /id="original-price"/);
  assert.match(fan, /id="final-price"/);
  assert.match(fan, /id="discount-calculation"/);
  assert.match(fan, /id="minimum-basket"/);
  assert.match(fan, /id="inventory-remaining" hidden/);
  assert.match(fan, /id="fulfilment-detail"/);
  assert.match(fan, /id="deal-alternative" hidden/);
  assert.match(admin, /id="catalogue-list"/);
  assert.match(admin, /Untracked offers never show a made-up remaining count/);
});

test('merchant campaign builder exposes the complete local workflow and honest metrics', () => {
  assert.match(admin, /Demo merchant account/);
  assert.match(admin, /LOCAL DEMO · NO ORDERS OR CHARGES/);
  assert.match(admin, /id="merchant-campaign-form"/);
  assert.match(admin, /id="merchant-campaign-list"/);
  assert.match(admin, /id="merchant-preview"/);
  assert.match(admin, /id="merchant-campaign-budget"/);
  assert.match(admin, /id="merchant-redemptions"/);
  assert.match(admin, /id="merchant-fulfilment"/);
  assert.match(admin, /api\/merchant\/campaigns\/preview/);
  assert.match(admin, /api\/merchant\/dashboard/);
  assert.match(admin, /PAUSE/);
  assert.match(admin, /RESUME/);
  assert.match(admin, /CANCEL/);
});

test('merchant analytics exposes derived metrics, explicit denominators, and no fabricated incrementality', () => {
  assert.match(admin, /id="analytics-grid"/);
  assert.match(admin, /id="analytics-campaign"/);
  assert.match(admin, /Claims ÷ recorded impressions/);
  assert.match(admin, /Redemptions ÷ all claims/);
  assert.match(admin, /id="analytics-transactions"/);
  assert.match(admin, /COMPLETE DEMO ORDER/);
  assert.match(admin, /REDEEM COUPON/);
  assert.match(admin, /id="contribution-form"/);
  assert.match(admin, /Incrementality needs an experiment/);
  assert.match(admin, /reports no revenue uplift or incremental sales result/);
  assert.match(fan, /\/impressions/);
});

test('fan offers expose transparent rule-based personalised recommendation reasons', () => {
  assert.match(fan, /src="\/offer-ranking\.js"/);
  assert.match(fan, /id="recommendation-label"/);
  assert.match(fan, /PERSONALISED RECOMMENDATIONS · RULE-BASED/);
  assert.match(fan, /Why this offer\?/);
  assert.match(fan, /ranking_reasons/);
  assert.doesNotMatch(fan, /trained AI|AI-powered/i);
});

test('merchant decision support labels fallback data, estimates, and deterministic guidance', () => {
  assert.match(admin, /DEMO ASSISTANT · DETERMINISTIC RULES/);
  assert.match(admin, /no live AI model/i);
  assert.match(admin, /no claim of predictive accuracy/i);
  assert.match(admin, /id="copilot-form"/);
  assert.match(admin, /id="copilot-reach"/);
  assert.match(admin, /id="copilot-override"/);
  assert.match(admin, /SIMULATED ESTIMATE/);
  assert.match(admin, /api\/merchant\/decision-support/);
  assert.match(admin, /USE CAP IN CAMPAIGN BUILDER/);
});

test('fan engagement exposes points, earned badges, real streak records, and opt-in local groups', () => {
  assert.match(fan, /src="\/engagement\.js"/);
  assert.match(fan, /id="profile-view"/);
  assert.match(fan, /id="profile-points"/);
  assert.match(fan, /PREDICTION STREAK/);
  assert.match(fan, /MATCH REGULAR/);
  assert.match(fan, /Duplicate actions never award points twice/);
  assert.match(fan, /No sample participants or leaderboard/);
  assert.match(fan, /id="group-opt-in"/);
  assert.match(fan, /never sends invitations or messages automatically/);
  assert.match(fan, /api\/watch-parties/);
  assert.match(fan, /No purchases, clicks, paid entry, wagering, or cash prizes/);
});

test('notification centre is in-app only, accessible, preference-aware, and motion-safe', () => {
  assert.match(fan, /src="\/notifications\.js"/);
  assert.match(fan, /id="notification-list"/);
  assert.match(fan, /id="notify-events"/);
  assert.match(fan, /id="notify-offers"/);
  assert.match(fan, /id="notify-quiet"/);
  assert.match(fan, /id="notification-announcer"[^>]*aria-live="polite"/);
  assert.match(fan, /Duplicate event delivery cannot create duplicate entries/);
  assert.match(fan, /No push, browser notification, SMS, email, or external message is sent/);
  assert.doesNotMatch(fan, /Notification\.requestPermission|new Notification\(/);
  assert.match(shared, /prefers-reduced-motion: reduce/);
});

test('demo claim handoff remains local and explains that no real order is created', () => {
  assert.match(fan, /new URL\('\/demo-checkout\.html', window\.location\.origin\)/);
  assert.doesNotMatch(fan, /window\.open\(deal\.checkout_url/);
  const checkout = fs.readFileSync(path.join(root, 'public', 'demo-checkout.html'), 'utf8');
  assert.match(checkout, /LOCAL DEMO CONFIRMATION/);
  assert.match(checkout, /No order, payment, delivery, or vendor request has been created/);
  assert.match(checkout, /href="\/"/);
});

test('persistent browser history distinguishes new events and campaigns after a demo reset', () => {
  assert.match(fan, /event:\$\{event\.id\}:\$\{event\.detected_at\}:confirmed/);
  assert.match(fan, /const campaignKey = campaign =>/);
  assert.match(fan, /claim:\$\{data\.claim\.claim_id\}:\$\{data\.claim\.claimed_at\}/);
});
