/**
 * RemeDocs Cloudflare Worker
 *
 * Handles three endpoints for the remedocs.com marketing site:
 *   POST /capture-lead    → Free plan signup → SalesHandy CRM
 *   POST /contact         → Enterprise/general contact → Resend emails
 *   POST /stripe-webhook  → Stripe checkout.session.completed → welcome email
 *
 * Required environment secrets (set via `wrangler secret put`):
 *   RESEND_API_KEY
 *   SALESHANDY_API_KEY
 *   SALESHANDY_FIELD_ID_FIRST_NAME
 *   SALESHANDY_FIELD_ID_LAST_NAME
 *   SALESHANDY_FIELD_ID_EMAIL
 *   STRIPE_WEBHOOK_SECRET
 */

const ALLOWED_ORIGINS = [
  'https://remedocs.com',
  'https://www.remedocs.com',
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FETCH HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let response;
    try {
      switch (url.pathname) {
        case '/capture-lead':
          response = await handleLeadCapture(request, env);
          break;
        case '/contact':
          response = await handleContact(request, env);
          break;
        case '/stripe-webhook':
          // Stripe calls this server-to-server — skip CORS headers
          return await handleStripeWebhook(request, env);
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error('Worker error:', err);
      response = jsonResponse({ error: 'Internal server error' }, 500);
    }

    // Attach CORS headers
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT: /capture-lead
// Free plan signup → SalesHandy + internal notification
// ─────────────────────────────────────────────────────────────────────────────

async function handleLeadCapture(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400);

  const { full_name, work_email, plan = 'free' } = body;

  if (!full_name || !work_email) {
    return jsonResponse({ error: 'full_name and work_email are required' }, 400);
  }
  if (!isValidEmail(work_email)) {
    return jsonResponse({ error: 'Invalid email address' }, 400);
  }

  const nameParts = full_name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  // Push lead to SalesHandy (non-blocking — don't fail if SalesHandy is down)
  try {
    const shRes = await fetch('https://open-api.saleshandy.com/v1/prospects/import', {
      method: 'POST',
      headers: {
        'x-api-key': env.SALESHANDY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prospectList: [{
          fields: [
            { id: env.SALESHANDY_FIELD_ID_FIRST_NAME, value: firstName },
            { id: env.SALESHANDY_FIELD_ID_LAST_NAME,  value: lastName  },
            { id: env.SALESHANDY_FIELD_ID_EMAIL,      value: work_email },
          ],
        }],
        verifyProspects: false,
        conflictAction:  'addMissingFields',
      }),
    });
    if (!shRes.ok) {
      console.error('SalesHandy error:', await shRes.text());
    }
  } catch (err) {
    console.error('SalesHandy fetch failed:', err);
  }

  // Notify sales team
  await sendEmail(env, {
    to:      'sales@remedocs.com',
    subject: `New free plan signup: ${full_name}`,
    html: `
      <p><strong>New Free Plan Signup</strong></p>
      <p><strong>Name:</strong>  ${esc(full_name)}</p>
      <p><strong>Email:</strong> ${esc(work_email)}</p>
      <p><strong>Plan:</strong>  Free</p>
      <p style="color:#888;font-size:0.85em">Lead has been pushed to SalesHandy.</p>
    `,
  });

  return jsonResponse({ status: 'ok', message: 'Lead captured successfully.' });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT: /contact
// Enterprise / general contact form → sales notification + auto-reply
// ─────────────────────────────────────────────────────────────────────────────

async function handleContact(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400);

  const { name, email, company, message, type = 'general' } = body;

  if (!name || !email || !message) {
    return jsonResponse({ error: 'name, email, and message are required' }, 400);
  }
  if (!isValidEmail(email)) {
    return jsonResponse({ error: 'Invalid email address' }, 400);
  }

  const label     = type === 'enterprise' ? 'Enterprise Inquiry' : 'Contact Request';
  const firstName = name.split(' ')[0];

  // Notify sales
  await sendEmail(env, {
    to:      'sales@remedocs.com',
    subject: `New ${label} from ${name}${company ? ' — ' + company : ''}`,
    html: `
      <p><strong>New ${label}</strong></p>
      <p><strong>Name:</strong>  ${esc(name)}</p>
      <p><strong>Email:</strong> ${esc(email)}</p>
      ${company ? `<p><strong>Organization:</strong> ${esc(company)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <blockquote style="border-left:3px solid #0CF2B4;padding-left:1rem;color:#444;margin:0.5rem 0">
        ${esc(message).replace(/\n/g, '<br>')}
      </blockquote>
    `,
  });

  // Auto-reply to prospect
  await sendEmail(env, {
    to:      email,
    subject: 'We received your message — RemeDocs',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
        <p>Hi ${esc(firstName)},</p>
        <p>Thanks for reaching out to RemeDocs. We've received your message and someone
           from our team will be in touch within <strong>one business day</strong>.</p>
        <p>In the meantime, feel free to explore:</p>
        <ul style="padding-left:1.2rem;line-height:2">
          <li><a href="https://remedocs.com/?page=blog" style="color:#0CF2B4">Accessibility Insights Blog</a></li>
          <li><a href="https://remedocs.com/?page=audit" style="color:#0CF2B4">Try our free PDF audit</a></li>
        </ul>
        <p style="margin-top:1.5rem">— The RemeDocs Team</p>
        <hr style="border:none;border-top:1px solid #eee;margin:2rem 0"/>
        <p style="font-size:0.72rem;color:#999">
          RemeDocs · Automated PDF Accessibility ·
          <a href="https://remedocs.com" style="color:#999">remedocs.com</a>
        </p>
      </div>
    `,
  });

  return jsonResponse({ status: 'ok', message: "Your message has been sent. We'll be in touch shortly." });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT: /stripe-webhook
// checkout.session.completed → welcome email + account setup link
//
// Stripe Payment Link setup required:
//   1. In Stripe Dashboard → Payment Links, add metadata key "plan" = "starter" or "growth"
//   2. Set Success URL to: https://app.remedocs.com/auth/register?plan=starter
//      (Stripe will also redirect the browser; this webhook sends the email independently)
//   3. Add webhook endpoint pointing to: https://your-worker.workers.dev/stripe-webhook
//   4. Subscribe to event: checkout.session.completed
//   5. Copy the signing secret → wrangler secret put STRIPE_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────────────────

async function handleStripeWebhook(request, env) {
  const sig     = request.headers.get('Stripe-Signature') || '';
  const rawBody = await request.text();

  const isValid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error('Stripe signature verification failed');
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session       = event.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email || '';
    const customerName  = session.customer_details?.name  || '';
    // "plan" must be set as metadata on the Stripe Payment Link
    const plan          = session.metadata?.plan || 'starter';

    if (customerEmail) {
      const planLabel    = capitalize(plan);
      const registerUrl  = `https://app.remedocs.com/auth/register?plan=${encodeURIComponent(plan)}&email=${encodeURIComponent(customerEmail)}`;
      const firstName    = customerName.split(' ')[0] || '';

      // Welcome email to customer
      await sendEmail(env, {
        to:      customerEmail,
        subject: `Welcome to RemeDocs ${planLabel} — set up your account`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
            ${firstName ? `<p>Hi ${esc(firstName)},</p>` : '<p>Hi there,</p>'}
            <p>Your payment was successful — welcome to <strong>RemeDocs ${esc(planLabel)}</strong>! 🎉</p>
            <p>Click the button below to create your account and get started:</p>
            <p style="text-align:center;margin:2rem 0">
              <a href="${registerUrl}"
                 style="background:#0CF2B4;color:#04120D;padding:.85rem 2.25rem;border-radius:8px;
                        text-decoration:none;font-weight:700;font-size:.95rem;display:inline-block">
                Set up your account →
              </a>
            </p>
            <p style="font-size:.85rem;color:#555">
              Your ${esc(planLabel)} plan is active. This link takes you directly to account
              creation with your plan pre-selected. If you have any questions, just reply to
              this email.
            </p>
            <p style="margin-top:1.5rem">— The RemeDocs Team</p>
            <hr style="border:none;border-top:1px solid #eee;margin:2rem 0"/>
            <p style="font-size:0.72rem;color:#999">
              RemeDocs · Automated PDF Accessibility ·
              <a href="https://remedocs.com" style="color:#999">remedocs.com</a>
            </p>
          </div>
        `,
      });

      // Internal notification to sales
      await sendEmail(env, {
        to:      'sales@remedocs.com',
        subject: `New paid signup — ${esc(planLabel)}: ${esc(customerEmail)}`,
        html: `
          <p><strong>New Paid Signup</strong></p>
          <p><strong>Plan:</strong>  ${esc(planLabel)}</p>
          <p><strong>Email:</strong> ${esc(customerEmail)}</p>
          <p><strong>Name:</strong>  ${esc(customerName) || '(not provided)'}</p>
          <p><strong>Stripe session:</strong> ${esc(session.id)}</p>
        `,
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function sendEmail(env, { to, subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'RemeDocs <noreply@remedocs.com>',
        to:      Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error('Resend error:', await res.text());
    }
  } catch (err) {
    console.error('sendEmail failed:', err);
  }
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  try {
    const parts = {};
    sigHeader.split(',').forEach(part => {
      const idx = part.indexOf('=');
      parts[part.slice(0, idx)] = part.slice(idx + 1);
    });
    const { t, v1 } = parts;
    if (!t || !v1) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
    const computed = Array.from(new Uint8Array(mac))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    // Constant-time comparison
    if (computed.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function capitalize(str) {
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}
