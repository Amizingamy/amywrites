import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const NEOCITIES_KEY = process.env.NEOCITIES_API_KEY;

const NEOCITIES_UPLOAD = "https://neocities.org/api/upload";

if (!SUPABASE_URL || !SUPABASE_KEY || !NEOCITIES_KEY) {
  throw new Error(
    "Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, or NEOCITIES_API_KEY"
  );
}

const ROOT = process.cwd();

const PUBLIC_DIR = path.join(ROOT, "neocities");
const IMAGE_DIR = path.join(ROOT, ".sync-images");

await fs.rm(IMAGE_DIR, {
  recursive: true,
  force: true
});

await fs.mkdir(IMAGE_DIR, {
  recursive: true
});


async function supabaseGet(table, query) {

  const url =
    `${SUPABASE_URL}/rest/v1/${table}?${query}`;

  const response =
    await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json"
      }
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${table} failed: ${response.status} ${text}`
    );
  }

  return JSON.parse(text);
}


function safeFilename(value) {

  return String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 140);

}


function extensionFromUrl(url) {

  try {

    const pathname =
      new URL(url).pathname;

    const match =
      pathname.match(/\.([a-zA-Z0-9]{2,5})$/);

    if (match) {
      return match[1].toLowerCase();
    }

  } catch {
    // Use jpg below.
  }

  return "jpg";

}


async function downloadImage(sourceUrl, filename) {

  const response =
    await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(
      `Could not download image ${sourceUrl}: ${response.status}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  const safe =
    safeFilename(filename);

  const destination =
    path.join(IMAGE_DIR, safe);

  await fs.writeFile(
    destination,
    buffer
  );

  return safe;

}


async function buildContent() {

  console.log(
    "Fetching published posts from Supabase..."
  );

  const posts =
    await supabaseGet(
      "posts",
      "select=*&published=eq.true&order=created_at.desc"
    );

  console.log(
    `Found ${posts.length} published post(s).`
  );


  const noticeRows =
    await supabaseGet(
      "site_notice",
      "select=*&id=eq.1&limit=1"
    );


  const cleanPosts = [];


  for (const post of posts) {

    const clean = {

      id: post.id,

      type:
        post.type || "",

      title:
        post.title || "",

      subtitle:
        post.subtitle || "",

      body:
        post.body || "",

      created_at:
        post.created_at || null,

      extra:
        post.extra || {},

      image_url:
        null

    };


    if (post.image_url) {

      const extension =
        extensionFromUrl(
          post.image_url
        );

      const filename =
        `post-${safeFilename(post.id)}.${extension}`;


      const storedName =
        await downloadImage(
          post.image_url,
          filename
        );


      clean.image_url =
        `images/${storedName}`;

    }


    cleanPosts.push(clean);

  }


  const notice = {

    title:
      "probably romanticising everything.",

    body:
      "and honestly? let me.",

    image_url:
      null

  };


  if (noticeRows.length > 0) {

    const row =
      noticeRows[0];


    notice.title =
      row.title || "";


    notice.body =
      row.body ||
      row.text ||
      "";


    if (row.image_url) {

      const extension =
        extensionFromUrl(
          row.image_url
        );


      const storedName =
        await downloadImage(
          row.image_url,
          `notice.${extension}`
        );


      notice.image_url =
        `images/${storedName}`;

    }

  }


  await fs.mkdir(
    PUBLIC_DIR,
    {
      recursive: true
    }
  );


  const output = {

    generated_at:
      new Date().toISOString(),

    notice,

    posts:
      cleanPosts

  };


  await fs.writeFile(

    path.join(
      PUBLIC_DIR,
      "content.json"
    ),

    JSON.stringify(
      output,
      null,
      2
    ),

    "utf8"

  );


  console.log(
    "Built neocities/content.json"
  );

}


async function uploadToNeocities(
  filename,
  buffer
) {

  const form =
    new FormData();


  form.append(

    filename,

    new Blob([buffer]),

    filename.split("/").pop()

  );


  const response =
    await fetch(

      NEOCITIES_UPLOAD,

      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${NEOCITIES_KEY}`
        },

        body:
          form
      }

    );


  const text =
    await response.text();


  if (!response.ok) {

    throw new Error(

      `Neocities upload failed: ${response.status} ${text}`

    );

  }


  let result = null;


  try {

    result =
      JSON.parse(text);

  } catch {

    // Some responses may not be JSON.

  }


  if (
    result?.result &&
    result.result !== "success"
  ) {

    throw new Error(
      `Neocities rejected upload: ${text}`
    );

  }


  console.log(
    `Uploaded ${filename}`
  );

}


async function main() {

  console.log(
    "♡ AmyWrites sync starting..."
  );


  await buildContent();


  const files = [];


  files.push([

    "index.html",

    await fs.readFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    )

  ]);


  files.push([

    "content.json",

    await fs.readFile(
      path.join(
        PUBLIC_DIR,
        "content.json"
      )
    )

  ]);


  let imageNames = [];


  try {

    imageNames =
      await fs.readdir(
        IMAGE_DIR
      );

  } catch {

    imageNames = [];

  }


  for (
    const name
    of imageNames
  ) {

    files.push([

      `images/${name}`,

      await fs.readFile(
        path.join(
          IMAGE_DIR,
          name
        )
      )

    ]);

  }


  for (
    const [name, buffer]
    of files
  ) {

    await uploadToNeocities(
      name,
      buffer
    );

  }


  console.log(
    "♡ AmyWrites sync complete."
  );

}


main().catch(error => {

  console.error(
    "SYNC FAILED:"
  );

  console.error(error);

  process.exit(1);

});
