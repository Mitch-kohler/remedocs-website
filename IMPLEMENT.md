# RemeDocs Pricing + Lead Capture — Implementation Guide

This document tells you exactly what to do to get the pricing page, lead capture, and Stripe
payment flow live on `remedocs.com`. Follow the steps in order.

---

## Prerequisites — Gather These Before You Start

You need four things from external services before touching any code:

**Stripe**
1. Log into Stripe Dashboard → Payment Links → Create two payment links
   - **Starter**: $29.99/month (or one-time) — after creating, copy the URL (looks like `https://buy.stripe.com/...`)
   - **Growth**: $99.99/month (or one-time) — copy the URL
2. On **each** Payment Link, go to Advanced → Metadata, add key `plan` with value `starter` or `growth`
3. On each Payment Link, set the **Success URL** to:
   - Starter: `https://app.remedocs.com/auth/register?plan=starter`
   - Growth: `https://app.remedocs.com/auth/register?plan=growth`
4. Go to Developers → Webhooks → Add endpoint
   - URL: `https://remedocs-worker.<your-cf-subdomain>.workers.dev/stripe-webhook`
     (You'll get the actual URL after deploying the worker in Step 2 — come back and add it then)
   - Event: `checkout.session.completed`
   - After saving, click the webhook and copy the **Signing secret** (starts with `whsec_`)

**Resend**
- Log into resend.com → API Keys → Create API Key → copy it

**SalesHandy**
- Log into SalesHandy → Settings → API Key → Create if needed → copy the key
- Settings → Prospect Fields → System Fields — note the IDs for: First Name, Last Name, Email
  (Likely: `GlPYv8WvaV`, `LVPXoNWdwl`, `Y7PWZEW7wo` — but verify in your account)

---

## Step 1 — Deploy the Cloudflare Worker

The worker is already written in `worker/index.js` with `worker/wrangler.toml`.

```bash
cd remedocs-website/worker

# Install wrangler if needed
npm install -g wrangler

# Log in to Cloudflare
npx wrangler login

# Deploy the worker
npx wrangler deploy
```

After deploying, Wrangler will print the worker URL, e.g.:
`https://remedocs-worker.<your-subdomain>.workers.dev`

**Copy that URL** — you need it in the next steps.

Now set all the required secrets (run each command, paste value when prompted):

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SALESHANDY_API_KEY
npx wrangler secret put SALESHANDY_FIELD_ID_FIRST_NAME
npx wrangler secret put SALESHANDY_FIELD_ID_LAST_NAME
npx wrangler secret put SALESHANDY_FIELD_ID_EMAIL
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Values to enter:
- `RESEND_API_KEY` → the Resend API key you copied
- `SALESHANDY_API_KEY` → your SalesHandy API key
- `SALESHANDY_FIELD_ID_FIRST_NAME` → e.g. `GlPYv8WvaV`
- `SALESHANDY_FIELD_ID_LAST_NAME` → e.g. `LVPXoNWdwl`
- `SALESHANDY_FIELD_ID_EMAIL` → e.g. `Y7PWZEW7wo`
- `STRIPE_WEBHOOK_SECRET` → the `whsec_...` signing secret from the Stripe webhook

Now go back to Stripe Webhooks and update the endpoint URL to your actual worker URL:
`https://remedocs-worker.<your-subdomain>.workers.dev/stripe-webhook`

---

## Step 2 — Fill in Placeholders in pricing.html

Open `pricing.html` and make three find-and-replace substitutions:

| Find | Replace with |
|------|-------------|
| `WORKER_URL_PLACEHOLDER` | Your CF Worker URL, e.g. `https://remedocs-worker.abc123.workers.dev` |
| `STRIPE_STARTER_LINK` | Your Stripe Payment Link URL for Starter, e.g. `https://buy.stripe.com/xxx` |
| `STRIPE_GROWTH_LINK` | Your Stripe Payment Link URL for Growth, e.g. `https://buy.stripe.com/yyy` |

There is one occurrence of each. The `WORKER_URL` is a JS constant near the top of the `<script>` block. The Stripe links are `href` attributes on the Starter and Growth CTA buttons.

---

## Step 3 — Commit and Push

```bash
cd remedocs-website

git add pricing.html worker/index.js worker/wrangler.toml index.html IMPLEMENT.md
git commit -m "Add pricing page, CF worker, and lead capture/contact form wiring"
git push origin main
```

GitHub Pages deploys automatically. Give it ~60 seconds then verify:
- `https://remedocs.com/pricing.html` loads the pricing page
- Nav on the main site has a "Pricing" link
- Free plan modal opens, submits to the worker, and redirects to `app.remedocs.com`
- Enterprise modal opens and submits successfully
- Starter/Growth CTAs link to Stripe checkout

---

## Step 4 — Smoke Test

**Free plan lead capture:**
1. Go to `https://remedocs.com/pricing.html`
2. Click "Get Started Free" → fill in name + email → submit
3. Verify: `sales@remedocs.com` receives notification email
4. Verify: lead appears in SalesHandy
5. Verify: browser redirects to `https://app.remedocs.com/auth/register?plan=free&email=...`

**Enterprise contact form:**
1. Click "Contact Sales" → fill in all fields → submit
2. Verify: `sales@remedocs.com` receives the inquiry
3. Verify: the prospect email receives an auto-reply from `noreply@remedocs.com`

**Stripe paid plan (use Stripe test mode first):**
1. Click "Get Started" on Starter → completes Stripe checkout (use test card `4242 4242 4242 4242`)
2. Verify: browser redirects to `https://app.remedocs.com/auth/register?plan=starter`
3. Verify: customer receives welcome email from `noreply@remedocs.com`
4. Verify: `sales@remedocs.com` receives paid signup notification
5. Check Stripe Dashboard → Webhooks to confirm the event was delivered successfully (200 response)

---

## Troubleshooting

**Worker returning 500:** Check Cloudflare Dashboard → Workers → remedocs-worker → Logs for the error.

**SalesHandy not receiving leads:** The worker treats SalesHandy as non-blocking — a SalesHandy failure won't break the user flow but will log an error. Check worker logs.

**Stripe webhook failing signature verification:** Make sure `STRIPE_WEBHOOK_SECRET` is the signing secret from the specific webhook endpoint, not the API key. They look different — the signing secret starts with `whsec_`.

**Emails not sending:** Verify the Resend `RESEND_API_KEY` secret is set correctly and that `noreply@remedocs.com` is a verified sending domain in Resend.

**CORS errors in browser console:** The worker only allows `https://remedocs.com` and `https://www.remedocs.com`. If testing locally you'll need to add your local origin or test via the live site.
