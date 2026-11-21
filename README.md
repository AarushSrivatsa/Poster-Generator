# Poster Generator

Car listing poster studio: vehicle records, photo uploads, drag-and-drop image assignment based on each selected HTML template, live preview, and print-to-PDF.

## Architecture

- **Supabase Postgres** stores vehicle records, photo metadata, and saved HTML/Tailwind templates.
- **Supabase Storage** stores original image files.
- **FastAPI + SQLAlchemy** serve the frontend and API.
- **HTML + Tailwind** templates use simple placeholders. The Studio detects editable text fields and image targets from the selected template. The workspace keeps the copy editor, live preview, photo library, and drag-and-drop targets together; there are no fixed front/rear/interior positions or fixed image count.
- No SQLite, local upload directory, or Render disk is used.

## Render environment variables

| Variable | Required | Value |
|---|---:|---|
| `DATABASE_URL` | Yes | Supabase **Session pooler** PostgreSQL URI, port `5432` |
| `SUPABASE_URL` | Yes | Project URL, e.g. `https://PROJECT_REF.supabase.co` |
| `SUPABASE_SECRET_KEY` | Yes | Supabase secret API key (`sb_secret_...`; server-side only) |
| `SUPABASE_STORAGE_BUCKET` | No | Bucket name; defaults to `vehicle-photos` |

## Supabase setup

1. Create a Supabase project.
2. In **Project Settings → API → Legacy API keys**, copy the Project URL and create/copy a **Secret key** (`sb_secret_...`) from Settings → API Keys. The legacy `service_role` key is also accepted under the old variable name. Never put this key in frontend code or Git.
3. In **Connect → Session pooler**, copy the PostgreSQL URI. Replace the password placeholder with your database password. Use port `5432`, not direct IPv6 or transaction-pooler port `6543`; Render's free service networking should use the IPv4-compatible session pooler.
4. In **Storage**, create a bucket named `vehicle-photos` and mark it **Public**. Listing images are intended to be visible through public asset URLs. Upload and delete calls are still made server-side with the service-role key.
5. Add the three required environment variables to Render: `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`. The bucket variable is optional unless you choose another bucket name.

The app creates its application tables on startup. It also adds the `vehicle_photos.slot` and `vehicles.poster_fields` columns idempotently for databases created by earlier versions.

## Render free deployment

1. Create a Web Service from this repository using Docker.
2. Select the Free instance.
3. Add `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` in Render's Environment page.
4. Deploy. `render.yaml` describes the free service and prompts for secret values.

Do not attach a disk. Render Free filesystems are ephemeral; vehicle records are in Supabase Postgres and image files are in Supabase Storage. Free Render web services can spin down after 15 minutes without inbound traffic; the first request after spin-down may take about a minute.

## Template placeholders

Use plain names in HTML + Tailwind templates:

- **Text:** `{{title1}}`, `{{title2}}`, `{{price}}`, `{{description}}`, or any other name. Each becomes a large editable field in the Studio.
- **Images:** `{{image1}}`, `{{image2}}`, `{{image3}}`, and so on. Each becomes a drag-and-drop target. There is no hardcoded image count.
- Existing templates using `{{car.make}}`, `{{slot.hero}}`, and `{{label.hero}}` remain supported for backwards compatibility.

Put an image token in an image source, for example `<img src="{{image1}}" alt="">`. Put text tokens wherever that text should appear. The app detects each unique token from the selected template automatically.

## Security

This is currently an internal single-operator tool. The API does not yet implement login or authorization. Add authentication before sharing the deployed URL publicly. Keep the Supabase service-role key only in Render's private environment variables.
