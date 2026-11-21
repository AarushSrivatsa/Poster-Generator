# Poster Generator

A vehicle marketing poster studio designed around a fast, visual workflow: choose a vehicle, add photos, pick a design, edit the wording, and print a share-ready poster.

## What is included

- **Fast start:** create a vehicle with make, model, year, and variant.
- **Visual design gallery:** built-in Studio Minimal, Electric Motion, Executive Black, and the original Midnight Gold layout. Existing Supabase projects receive newly added built-in designs automatically on restart.
- **One-click poster setup:** choose the recommended design, fill sensible text defaults from the vehicle record, and auto-place uploaded photos into the design's image placeholders.
- **Live preview:** text and image assignments update the poster preview as you work.
- **Drag, drop, or tap:** drag a photo onto any image placeholder, or tap a photo and then tap a placeholder (helpful on touch screens).
- **Template-driven image targets:** image spaces are discovered from the selected HTML. There are no hardcoded front/rear/side/interior positions.
- **Editable poster copy:** any text placeholder becomes an editable field. Names like \`title1\`, \`title2\`, \`price\`, \`tagline\`, \`caption2\` are displayed with friendlier labels.
- **Custom designs:** paste arbitrary HTML + Tailwind templates and save them for reuse.
- **Print / Save PDF:** print the current poster from the browser.
- **Persistent storage:** Supabase Postgres stores records and templates; Supabase Storage stores photos. No SQLite or Render disk is used.

## Architecture

- FastAPI + SQLAlchemy backend.
- Supabase Postgres for vehicle records, photo metadata, and saved templates.
- Supabase Storage for original image files.
- HTML + CSS + Tailwind-compatible custom poster templates.
- Render web service; no local upload directory or persistent local filesystem.

## Render environment variables

| Variable | Required | Value |
|---|---:|---|
| \`DATABASE_URL\` | Yes | Supabase Session pooler PostgreSQL URI, port \`5432\` |
| \`SUPABASE_URL\` | Yes | Project URL, e.g. \`https://PROJECT_REF.supabase.co\` |
| \`SUPABASE_SECRET_KEY\` | Yes | Supabase secret API key (\`sb_secret_...\`; server-side only) |
| \`SUPABASE_STORAGE_BUCKET\` | No | Bucket name; defaults to \`vehicle-photos\` |

## Supabase setup

1. Create a Supabase project.
2. In Project Settings → API Keys, copy the Project URL and create/copy a Secret key (\`sb_secret_...\`). The legacy \`service_role\` key is also accepted using the old variable name. Never put this key in frontend code or Git.
3. In Connect → Session pooler, copy the PostgreSQL URI. Replace the password placeholder with your database password. Use port \`5432\`.
4. In Storage, create a bucket named \`vehicle-photos\` and mark it Public. Poster images are served via public asset URLs; upload and delete operations are performed server-side.
5. Add \`DATABASE_URL\`, \`SUPABASE_URL\`, and \`SUPABASE_SECRET_KEY\` to Render.

The app creates its application tables on startup and applies idempotent migrations for the \`vehicle_photos.slot\` and \`vehicles.poster_fields\` columns.

## Render deployment

1. Create a Web Service from this repository using Docker.
2. Select the Free instance.
3. Add the three required environment variables in Render's Environment page.
4. Deploy the latest commit. \`render.yaml\` describes the service and prompts for secret values.

Do not attach a disk. Vehicle records live in Supabase Postgres and image files live in Supabase Storage. Render Free filesystems are ephemeral.

## Custom template placeholders

Use plain names in HTML + Tailwind templates:

- **Text:** \`{{title1}}\`, \`{{title2}}\`, \`{{price}}\`, \`{{tagline}}\`, \`{{description}}\`, \`{{caption1}}\`, or any other text name. Each becomes an editable field in the Studio.
- **Images:** \`{{image1}}\`, \`{{image2}}\`, \`{{image3}}\`, and any other unique \`image...\` name become photo targets. There is no fixed image count.
- Put image tokens in \`src\` attributes, e.g. \`<img src="{{image1}}" alt="">\`.
- Existing designs using \`{{car.make}}\`, \`{{slot.hero}}\`, and \`{{label.hero}}\` remain supported for backwards compatibility.

## Important before public use

The current app is an internal single-operator tool and does not yet include login or per-dealership permissions. Add authentication and access controls before sharing the deployed URL publicly. Keep the Supabase secret key only in Render's private environment variables.
