#!/usr/bin/env node
/**
 * generate-blog-posts.js
 *
 * Reads index.html, extracts the blog posts array (including SVG thumbnails
 * and body HTML), and generates:
 *   - blog/index.html            (listing page)
 *   - blog/{slug}/index.html     (one per post)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const BLOG_DIR = path.join(ROOT, 'blog');

// ── Slugs in the same order as the posts array ─────────────
const SLUGS = [
  'ada-title-ii-deadlines-government-agencies',
  'html-overlays-vs-pdf-remediation',
  'ai-alt-text-pdf-images',
  'section-508-vs-wcag-vs-pdfua',
  'accessibility-lawsuit-triggers-2025',
  'accessible-document-pipeline-at-scale',
  'pdf-tag-trees-guide',
  'wcag-universities-higher-education-2027',
  'llms-document-accessibility',
  'doj-28-cfr-part-35-pdfs',
  'pdf-remediation-cms-developer-guide',
  'en-301-549-european-accessibility',
  'accessible-tables-pdfs-guide',
  'healthcare-pdf-accessibility-hipaa-ada',
  'benchmarking-pdf-accessibility-tools-2025',
  'batch-remediating-legacy-document-archive',
  'plaintiffs-firms-inaccessible-pdfs',
  'wcag-3-0-pdf-accessibility-changes',
];

// ── Parse the posts array from index.html ───────────────────
function extractPosts(html) {
  // Find the posts array in the JS
  const startMarker = 'const posts = [';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new Error('Could not find "const posts = [" in index.html');

  // We need to find the matching closing bracket.
  // Walk forward counting brackets.
  let depth = 0;
  let i = html.indexOf('[', startIdx);
  let endIdx = -1;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
    // skip template literals (backtick strings)
    if (ch === '`') {
      i++;
      while (i < html.length && html[i] !== '`') {
        if (html[i] === '\\') i++; // skip escaped chars
        i++;
      }
    }
    // skip regular strings
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < html.length && html[i] !== q) {
        if (html[i] === '\\') i++;
        i++;
      }
    }
  }
  if (endIdx === -1) throw new Error('Could not find end of posts array');

  const arrayStr = html.substring(html.indexOf('[', startIdx), endIdx + 1);

  // Evaluate the array. It uses backtick template literals and single-quote
  // strings, which are valid JS. We use Function() to safely evaluate.
  const posts = new Function('return ' + arrayStr)();
  return posts;
}

// ── Shared CSS (inline in every generated page) ─────────────
const SHARED_CSS = `
:root{
  --bg:#07090D;--bg-1:#0C0F15;--bg-2:#111520;--bg-3:#161B28;
  --line:rgba(255,255,255,0.07);--line-2:rgba(255,255,255,0.12);
  --text:#E8EAF0;--text-2:#8A8FA8;--text-3:#545870;
  --mint:#0CF2B4;--mint-dim:rgba(12,242,180,0.09);--mint-glow:rgba(12,242,180,0.22);
  --blue:#3B8EF8;--red:#F25C5C;--amber:#F2A93B;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Instrument Sans',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden;-webkit-font-smoothing:antialiased;}
body::after{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");pointer-events:none;z-index:9998;opacity:.5;}

/* NAV */
nav{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 3rem;height:60px;border-bottom:1px solid var(--line);background:rgba(7,9,13,0.82);backdrop-filter:blur(20px) saturate(1.4);}
.logo{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:1.15rem;letter-spacing:-.03em;color:var(--text);text-decoration:none;display:flex;align-items:center;gap:6px;}
.logo-dot{width:7px;height:7px;border-radius:50%;background:var(--mint);display:inline-block;}
nav ul{display:flex;gap:2rem;list-style:none;align-items:center;}
nav ul a{color:var(--text-2);text-decoration:none;font-size:.82rem;font-weight:500;letter-spacing:.01em;transition:color .15s;}
nav ul a:hover,nav ul a.active{color:var(--text);}
.nav-btn{background:var(--mint);color:#04120D;font-family:'Instrument Sans',sans-serif;font-weight:600;font-size:.8rem;letter-spacing:.02em;padding:.45rem 1.1rem;border-radius:6px;text-decoration:none;transition:opacity .15s,box-shadow .15s;}
.nav-btn:hover{opacity:.88;box-shadow:0 0 20px var(--mint-glow);}
.nav-btn-ghost{border:1px solid var(--line-2);color:var(--text-2);font-family:'Instrument Sans',sans-serif;font-weight:500;font-size:.8rem;letter-spacing:.01em;padding:.43rem 1.1rem;border-radius:6px;text-decoration:none;transition:border-color .15s,color .15s;}
.nav-btn-ghost:hover{border-color:var(--text-2);color:var(--text);}

/* FOOTER */
footer{padding:2.25rem 3rem;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;}
.ft-links{display:flex;gap:1.75rem;list-style:none;}
.ft-links a{font-size:.78rem;color:var(--text-3);text-decoration:none;transition:color .15s;}
.ft-links a:hover{color:var(--text-2);}
.ft-copy{font-size:.73rem;color:var(--text-3);}

/* BLOG LISTING STYLES */
.blog-hero{padding:8rem 3rem 3.5rem;border-bottom:1px solid var(--line);background:var(--bg-1);}
.blog-hero h1{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(2rem,4vw,3rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.6rem;}
.blog-hero p{color:var(--text-2);font-size:.95rem;max-width:480px;line-height:1.7;}
.blog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;max-width:1100px;margin:0 auto;padding:4rem 3rem;}
.blog-card{background:var(--bg-1);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:border-color .2s,transform .2s;text-decoration:none;color:inherit;}
.blog-card:hover{border-color:var(--line-2);transform:translateY(-2px);}
.blog-thumb{height:150px;display:block;overflow:hidden;border-bottom:1px solid var(--line);position:relative;}.blog-thumb svg{width:100%;height:100%;}
.blog-body{padding:1.4rem;flex:1;display:flex;flex-direction:column;}
.blog-tag{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mint);margin-bottom:.6rem;}
.blog-title{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:.95rem;line-height:1.35;margin-bottom:.6rem;}
.blog-excerpt{font-size:.8rem;color:var(--text-2);line-height:1.65;flex:1;}
.blog-meta{display:flex;align-items:center;justify-content:space-between;margin-top:1rem;padding-top:.85rem;border-top:1px solid var(--line);}
.blog-date{font-size:.7rem;color:var(--text-3);}
.blog-read{font-size:.7rem;color:var(--text-3);}

/* BLOG POST STYLES */
.blog-post-wrap{max-width:720px;margin:0 auto;padding:8rem 3rem 4rem;}
.blog-post-back{display:inline-flex;align-items:center;gap:.4rem;font-size:.82rem;color:var(--text-3);text-decoration:none;margin-bottom:2rem;transition:color .15s;}
.blog-post-back:hover{color:var(--text-2);}
.blog-post-tag{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mint);margin-bottom:.75rem;}
.blog-post-title{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:clamp(1.6rem,3vw,2.2rem);letter-spacing:-.03em;line-height:1.1;margin-bottom:1rem;}
.blog-post-meta{font-size:.75rem;color:var(--text-3);margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid var(--line);}
.blog-post-body{font-size:.9rem;color:var(--text-2);line-height:1.85;}
.blog-post-body h2{font-family:'Bricolage Grotesque',sans-serif;color:var(--text);font-size:1.15rem;font-weight:700;margin:2rem 0 .65rem;letter-spacing:-.02em;}
.blog-post-body p{margin-bottom:1.1rem;}
.blog-post-body ul{padding-left:1.25rem;margin-bottom:1.1rem;display:flex;flex-direction:column;gap:.4rem;}
.blog-post-body strong{color:var(--text);font-weight:600;}
.blog-post-body .callout{background:var(--mint-dim);border:1px solid rgba(12,242,180,.2);border-radius:9px;padding:1rem 1.25rem;margin:1.5rem 0;font-size:.85rem;color:var(--text);}

/* FILTER */
.filter-bar{display:flex;gap:.5rem;flex-wrap:wrap;max-width:1100px;margin:0 auto;padding:2rem 3rem 0;}
.filter-btn{font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .85rem;border-radius:100px;border:1px solid var(--line-2);background:transparent;color:var(--text-3);cursor:pointer;transition:all .15s;font-family:'Instrument Sans',sans-serif;}
.filter-btn:hover{color:var(--text-2);border-color:var(--text-3);}
.filter-btn.active{background:var(--mint-dim);border-color:rgba(12,242,180,.3);color:var(--mint);}

@media(max-width:900px){.blog-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:600px){
  .blog-grid{grid-template-columns:1fr;padding:2rem 1.5rem;}
  nav{padding:0 1.5rem;}
  nav ul{gap:1rem;}
  .blog-hero{padding:6rem 1.5rem 2.5rem;}
  .blog-post-wrap{padding:6rem 1.5rem 3rem;}
  footer{padding:1.5rem;}
}
`;

// ── Nav HTML ────────────────────────────────────────────────
function navHTML(activePage) {
  const blogActive = activePage === 'blog' ? ' class="active"' : '';
  return `<nav>
  <a href="/" class="logo"><span class="logo-dot"></span>RemeDocs</a>
  <ul>
    <li><a href="/">Home</a></li>
    <li><a href="/how-it-works">How it works</a></li>
    <li><a href="/blog"${blogActive}>Blog</a></li>
    <li><a href="/pricing">Pricing</a></li>
    <li><a href="/free-pdf-accessibility-checker" class="nav-btn-ghost">Free PDF audit</a></li>
  </ul>
</nav>`;
}

// ── Footer HTML ─────────────────────────────────────────────
const FOOTER_HTML = `<footer>
  <a href="/" class="logo"><span class="logo-dot"></span>RemeDocs</a>
  <ul class="ft-links">
    <li><a href="/">Home</a></li>
    <li><a href="/blog">Blog</a></li>
    <li><a href="/pricing">Pricing</a></li>
    <li><a href="/free-pdf-accessibility-checker">Free PDF audit</a></li>
  </ul>
  <div class="ft-copy">&copy; 2026 RemeDocs, Inc.</div>
</footer>`;

// ── Head boilerplate ────────────────────────────────────────
function headHTML({ title, description, canonical }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHTML(title)}</title>
<meta name="description" content="${escapeAttr(description)}"/>
<link rel="canonical" href="${canonical}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet"/>
<style>${SHARED_CSS}</style>
</head>`;
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Convert post date string to ISO date ────────────────────
function toISO(dateStr) {
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0];
}

// ── JSON-LD for a blog post ─────────────────────────────────
function articleJSONLD(post, slug) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "datePublished": toISO(post.date),
    "author": { "@type": "Organization", "name": "RemeDocs" },
    "publisher": {
      "@type": "Organization",
      "name": "RemeDocs",
      "url": "https://remedocs.com"
    },
    "url": `https://remedocs.com/blog/${slug}`,
    "description": post.excerpt
  });
}

// ── Generate individual blog post page ──────────────────────
function generatePostPage(post, slug) {
  const title = `${post.title} | RemeDocs Blog`;
  const canonical = `https://remedocs.com/blog/${slug}`;

  return `${headHTML({ title, description: post.excerpt, canonical })}
<body>
${navHTML('blog')}

<article class="blog-post-wrap">
  <a href="/blog" class="blog-post-back">&larr; Back to blog</a>
  <div class="blog-post-tag">${escapeHTML(post.tag)}</div>
  <h1 class="blog-post-title">${escapeHTML(post.title)}</h1>
  <div class="blog-post-meta">${escapeHTML(post.date)} &middot; ${escapeHTML(post.read)} read</div>
  <div class="blog-post-body">
    ${post.body}
  </div>
  <div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--line);">
    <a href="/blog" class="blog-post-back">&larr; Back to all posts</a>
  </div>
</article>

${FOOTER_HTML}

<script type="application/ld+json">
${articleJSONLD(post, slug)}
</script>
</body>
</html>`;
}

// ── Generate blog listing page ──────────────────────────────
function generateListingPage(posts) {
  const title = 'Blog | RemeDocs';
  const description = 'Articles on PDF accessibility, WCAG compliance, ADA requirements, and automated document remediation.';
  const canonical = 'https://remedocs.com/blog';

  const tags = ['All', ...Array.from(new Set(posts.map(p => p.tag)))];

  const filterBtns = tags.map(tag =>
    `<button class="filter-btn${tag === 'All' ? ' active' : ''}" data-filter="${escapeAttr(tag)}">${escapeHTML(tag)}</button>`
  ).join('\n        ');

  const cards = posts.map((p, i) => {
    const slug = SLUGS[i];
    return `      <a href="/blog/${slug}" class="blog-card" data-tag="${escapeAttr(p.tag)}">
        <div class="blog-thumb">${p.svg}</div>
        <div class="blog-body">
          <div class="blog-tag">${escapeHTML(p.tag)}</div>
          <div class="blog-title">${escapeHTML(p.title)}</div>
          <div class="blog-excerpt">${escapeHTML(p.excerpt)}</div>
          <div class="blog-meta"><span class="blog-date">${escapeHTML(p.date)}</span><span class="blog-read">${escapeHTML(p.read)} read</span></div>
        </div>
      </a>`;
  }).join('\n');

  return `${headHTML({ title, description, canonical })}
<body>
${navHTML('blog')}

<section class="blog-hero">
  <h1>Blog</h1>
  <p>Guides, analysis, and deep dives on PDF accessibility, WCAG compliance, and document remediation.</p>
</section>

<div class="filter-bar" id="filter-bar">
  ${filterBtns}
</div>

<div class="blog-grid" id="blog-grid">
${cards}
</div>

${FOOTER_HTML}

<script>
(function(){
  const btns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.blog-card');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.getAttribute('data-filter');
      cards.forEach(c => {
        if (f === 'All' || c.getAttribute('data-tag') === f) {
          c.style.display = '';
        } else {
          c.style.display = 'none';
        }
      });
    });
  });
})();
</script>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────
function main() {
  console.log('Reading index.html...');
  const html = fs.readFileSync(INDEX, 'utf-8');

  console.log('Extracting posts array...');
  const posts = extractPosts(html);
  console.log(`Found ${posts.length} posts.`);

  if (posts.length !== 18) {
    console.warn(`WARNING: Expected 18 posts but found ${posts.length}`);
  }

  // Generate blog listing page
  const listingDir = BLOG_DIR;
  fs.mkdirSync(listingDir, { recursive: true });
  const listingPath = path.join(listingDir, 'index.html');
  fs.writeFileSync(listingPath, generateListingPage(posts), 'utf-8');
  console.log(`  Created: blog/index.html`);

  // Generate individual post pages
  posts.forEach((post, i) => {
    const slug = SLUGS[i];
    if (!slug) {
      console.warn(`  No slug for post index ${i}, skipping.`);
      return;
    }
    const dir = path.join(BLOG_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, generatePostPage(post, slug), 'utf-8');
    console.log(`  Created: blog/${slug}/index.html`);
  });

  console.log(`\nDone! Generated ${posts.length + 1} files.`);
}

main();
