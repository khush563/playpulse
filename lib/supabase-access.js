'use strict';

const { createServerClient, parseCookieHeader } = require('@supabase/ssr');

function createAccess(options = {}) {
  const demo = options.demoMode === true;
  const url = options.url || process.env.SUPABASE_URL;
  const key = options.key || process.env.SUPABASE_PUBLISHABLE_KEY;
  const origin = new URL(options.origin || process.env.APP_ORIGIN || 'http://127.0.0.1:3000').origin;
  const configured = Boolean(url && key);
  const cookieOptions = { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/' };
  const clientFactory = options.clientFactory || ((req, res) => createServerClient(url, key, {
    cookieOptions,
    cookies: {
      getAll: () => parseCookieHeader(req.headers.cookie || ''),
      setAll: cookies => {
        if (!res) return;
        for (const { name, value, options: settings } of cookies) res.cookie(name, value, { ...settings, ...cookieOptions, ...(settings.maxAge === undefined ? {} : { maxAge: settings.maxAge * 1000 }) });
      }
    },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(12000) }) }
  }));
  const attempts = new Map();

  function client(req, res) {
    if (!configured && !options.clientFactory) throw Object.assign(new Error('Account services are not configured.'), { status: 503 });
    return clientFactory(req, res);
  }
  async function identify(req, res) {
    if (req.account !== undefined) return req.account;
    req.account = null;
    req.supabase = client(req, res);
    const { data, error } = await req.supabase.auth.getUser();
    if (error || !data?.user) {
      // An absent/expired login is an ordinary guest. Provider outages fail closed.
      if (error && !['AuthSessionMissingError', 'AuthApiError'].includes(error.name)) throw Object.assign(new Error('Account service unavailable. Please try again.'), { status: 503 });
      if (error?.status >= 500) throw Object.assign(new Error('Account service unavailable. Please try again.'), { status: 503 });
      return null;
    }
    const user = data.user;
    if (!user.email_confirmed_at) throw Object.assign(new Error('Verify your email before continuing.'), { status: 403 });
    req.account = { id: user.id, email: user.email, name: user.user_metadata?.display_name || '', verified: true };
    return req.account;
  }
  async function role(req) {
    const result = await req.supabase.rpc('playpulse_my_role');
    if (result.error) throw Object.assign(new Error('The account database needs its PlayPulse migration. Please contact the owner.'), { status: 503 });
    return result.data || 'fan';
  }
  function sameOrigin(req, res, next) {
    if (demo || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const supplied = req.get('origin');
    if ((supplied && supplied !== origin) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'This request must come from PlayPulse.' });
    next();
  }
  function limited(req, res, next) {
    const now = Date.now();
    // Avoid locking every fan behind a café Wi-Fi or hosting proxy after twelve logins.
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : 'session';
    const attemptKey = `${req.ip}:${email}`;
    const bucket = attempts.get(attemptKey);
    if (bucket && bucket.until > now && bucket.count >= 12) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    attempts.set(attemptKey, !bucket || bucket.until <= now ? { until: now + 600000, count: 1 } : { ...bucket, count: bucket.count + 1 });
    if (attempts.size > 1000) for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
    if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    next();
  }
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(error => res.status(error.status || 503).json({ error: error.status ? error.message : 'The account service is unavailable. Please try again.' }));
  const fail = (result, fallback) => {
    if (result.error) throw Object.assign(new Error(result.error.status === 429 ? 'Please wait before trying again.' : fallback), { status: result.error.status === 429 ? 429 : 400 });
    return result.data;
  };
  function routes(app) {
    app.use('/api', sameOrigin);
    app.get('/api/auth/config', (_req, res) => res.set('Cache-Control', 'no-store').json({ configured: configured || demo, demo, google: process.env.PLAYPULSE_GOOGLE_AUTH === 'true' }));
    app.get('/api/account', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (demo) return res.json({ user: null, demo: true });
      const user = await identify(req, res);
      let accountRole = 'fan'; let databaseReady = false;
      if (user) {
        try { accountRole = await role(req); databaseReady = true; } catch (_) { /* Auth remains usable while owner installs schema. */ }
      }
      res.json({ user, role: accountRole, database_ready: databaseReady });
    }));
    app.post('/api/auth/register', limited, wrap(async (req, res) => {
      const { email, password, name } = req.body || {};
      if (!validEmail(email) || typeof password !== 'string' || password.length < 12 || password.length > 128 || typeof name !== 'string' || !name.trim() || name.trim().length > 80) return res.status(400).json({ error: 'Enter your name, a valid email and a password of 12–128 characters.' });
      const result = await client(req, res).auth.signUp({ email: email.trim().toLowerCase(), password, options: { emailRedirectTo: `${origin}/auth/callback`, data: { display_name: name.trim() } } });
      fail(result, 'Sign-up could not be completed. Check your details or try again later.');
      res.status(202).json({ message: 'If this address can be registered, a confirmation email will arrive. Open the confirmation link in this same browser. After confirming, you can sign in on other devices.' });
    }));
    app.post('/api/auth/login', limited, wrap(async (req, res) => {
      const { email, password } = req.body || {};
      if (!validEmail(email) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Enter your email and password.' });
      const data = fail(await client(req, res).auth.signInWithPassword({ email: email.trim().toLowerCase(), password }), 'Unable to sign in. Check your email and password, and confirm your email first.');
      if (!data.user?.email_confirmed_at) return res.status(403).json({ error: 'Verify your email before continuing.' });
      res.json({ ok: true });
    }));
    app.post('/api/auth/recover', limited, wrap(async (req, res) => {
      if (!validEmail(req.body?.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      fail(await client(req, res).auth.resetPasswordForEmail(req.body.email.trim().toLowerCase(), { redirectTo: `${origin}/auth/callback?recovery=1` }), 'Password recovery is temporarily unavailable. Try again later.');
      res.json({ message: 'If an account exists for this address, a password reset email will arrive.' });
    }));
    app.post('/api/auth/password', limited, wrap(async (req, res) => {
      if (!await identify(req, res)) return res.status(401).json({ error: 'Open the password reset email before setting a new password.' });
      if (typeof req.body?.password !== 'string' || req.body.password.length < 12 || req.body.password.length > 128) return res.status(400).json({ error: 'Use a password of 12–128 characters.' });
      fail(await req.supabase.auth.updateUser({ password: req.body.password }), 'Your password could not be updated. Please try again.');
      res.json({ ok: true });
    }));
    app.post('/api/auth/logout', wrap(async (req, res) => {
      const account = await identify(req, res);
      fail(await client(req, res).auth.signOut({ scope: 'local' }), 'Sign-out failed. Please try again.');
      ioLogout?.(account);
      res.json({ ok: true });
    }));
    app.get('/api/auth/google', wrap(async (req, res) => {
      if (process.env.PLAYPULSE_GOOGLE_AUTH !== 'true') return res.redirect('/auth?error=provider');
      const data = fail(await client(req, res).auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${origin}/auth/callback` } }), 'Google sign-in is temporarily unavailable.');
      res.redirect(data.url);
    }));
    app.get('/auth/callback', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        if (typeof req.query.code !== 'string') return res.redirect('/auth?error=confirmation');
        const result = await client(req, res).auth.exchangeCodeForSession(req.query.code);
        if (result.error) return res.redirect('/auth?error=confirmation');
        res.redirect(req.query.recovery === '1' ? '/auth?mode=password&auth_changed=1' : '/?view=lobby&auth_changed=1');
      } catch (_) { res.redirect('/auth?error=confirmation'); }
    });
  }
  // The server can close account sockets when login state changes without exposing tokens.
  let ioLogout = null;
  return { demo, configured, origin, identify, role, routes, client, wrap, setLogoutHandler(handler) { ioLogout = handler; } };
}
function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
module.exports = { createAccess };
