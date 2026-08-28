import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const NEOCITIES_KEY = process.env.NEOCITIES_API_KEY;
const NEOCITIES_UPLOAD = "https://neocities.org/api/upload";

if (!SUPABASE_URL || !SUPABASE_KEY || !NEOCITIES_KEY) {
  throw new Error("Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, or NEOCITIES_API_KEY");
}

const root = process.cwd();
const publicDir = path.join(root, "neocities");
const imageDir = path.join(root, ".sync-images");
await fs.rm(imageDir, { recursive: true, force: true });
await fs.mkdir(imageDir, { recursive: true });

async function supabaseGet(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${table}: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function downloadImage(sourceUrl, filename) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not download image ${sourceUrl}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140);
  const full = path.join(imageDir, safe);
  await fs.writeFile(full, buffer);
  return safe;
}

function extensionFrom(urlString, contentType = "") {
  const m = String(urlString).match(/\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/);
  if (m) return m[1].toLowerCase();
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

async function build() {
  const posts = await supabaseGet(
    "posts",
    "select=*&published=eq.true&order=created_at.desc"
  );

  const noticeRows = await supabaseGet(
    "site_notice",
    "select=*&id=eq.1&limit=1"
  );

  const cleanPosts = [];
  for (const post of posts) {
    const clean = {
      id: post.id,
      type: post.type,
      title: post.title,
      subtitle: post.subtitle || "",
      body: post.body || "",
      created_at: post.created_at || null,
      extra: post.extra || {},
      image_url: null
    };

    if (post.image_url) {
      const ext = extensionFrom(post.image_url);
      const safeId = String(post.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `post-${safeId}.${ext}`;
      const stored = await downloadImage(post.image_url, filename);
      clean.image_url = `images/${stored}`;
    }

    cleanPosts.push(clean);
  }

  let notice = {
    title: "probably romanticising everything.",
    body: "and honestly? let me.",
    image_url: null
  };

  if (noticeRows[0]) {
    notice.title = noticeRows[0].title || "";
    notice.body = noticeRows[0].body || noticeRows[0].text || "";

    if (noticeRows[0].image_url) {
      const ext = extensionFrom(noticeRows[0].image_url);
      const stored = await downloadImage(noticeRows[0].image_url, `notice.${ext}`);
      notice.image_url = `images/${stored}`;
    }
  }

  await fs.writeFile(
    path.join(publicDir, "content.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), notice, posts: cleanPosts }, null, 2),
    "utf8"
  );
}

async function uploadToNeocities(filename, buffer) {
  const form = new FormData();
  form.append(filename, new Blob([buffer]), filename.split("/").pop());
  const response = await fetch(NEOCITIES_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${NEOCITIES_KEY}` },
    body: form
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Neocities upload ${filename}: ${response.status} ${text}`);
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (json?.result && json.result !== "success") throw new Error(`Neocities upload ${filename}: ${text}`);
}

async function main() {
  await build();

  const files = [];
  files.push(["index.html", await fs.readFile(path.join(publicDir, "index.html"))]);
  files.push(["content.json", await fs.readFile(path.join(publicDir, "content.json"))]);

  const imageNames = await fs.readdir(imageDir);
  for (const name of imageNames) {
    files.push([`images/${name}`, await fs.readFile(path.join(imageDir, name))]);
  }

  for (const [name, buffer] of files) {
    await uploadToNeocities(name, buffer);
    console.log(`Uploaded ${name}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
