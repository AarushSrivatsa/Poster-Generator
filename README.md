# Poster Generator

Car listing poster studio: vehicle records, photo uploads, drag-and-drop image assignment based on each selected HTML template, live preview, and print-to-PDF.

## Architecture

- **Supabase Postgres** stores vehicle records, photo metadata, and saved HTML/Tailwind templates.
- **Supabase Storage** stores original image files.
- **FastAPI + SQLAlchemy** serve the frontend and API.
- **HTML + Tailwind** templates use data placeholders. The photo-placement UI discovers slot names from the selected template HTML; the app imposes no fixed front/rear/interior layout.
- No SQLite, local upload directory, or Render disk is used.

## Render environment variables

| Variable | Required | Value |
|---|---:|---|
| `DATABASE_URL` | Yes | Supabase **Session pooler** PostgreSQL URI, port `5432` |
| `SUPABASE_URL` | Yes | Project URL, e.g. `https://PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase legacy `service_role` key (server-side only) |
| `SUPABASE_STORAGE_BUCKET` | No | Bucket name; defaults to `vehicle-photos` |

## Supabase setup

1. Create a Supabase project.
2. In **Project Settings → API → Legacy API keys**, copy the Project URL and the `service_role` key. Never put this key in frontend code or Git.
3. In **Connect → Session pooler**, copy the PostgreSQL URI. Replace the password placeholder with your database password. Use port `5432`, not direct IPv6 or transaction-pooler port `6543`; Render's free service networking should use the IPv4-compatible session pooler.
4. In **Storage**, create a bucket named `vehicle-photos` and mark it **Public**. Listing images are intended to be visible through public asset URLs. Upload and delete calls are still made server-side with the service-role key.
5. Add the three required environment variables to Render. The bucket variable is optional unless you choose another bucket name.

The app creates its application tables on startup. It also adds the `vehicle_photos.slot` column idempotently for databases created by the earlier version.

## Render free deployment

1. Create a Web Service from this repository using Docker.
2. Select the Free instance.
3. Add `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in Render's Environment page.
4. Deploy. `render.yaml` describes the free service and prompts for secret values.

Do not attach a disk. Render Free filesystems are ephemeral; vehicle records are in Supabase Postgres and image files are in Supabase Storage. Free Render web services can spin down after 15 minutes without inbound traffic; the first request after spin-down may take about a minute.

## Template placeholders

Vehicle fields: `{{car.make}}`, `{{car.model}}`, `{{car.variant}}`, `{{car.year}}`, `{{car.registration}}`, `{{car.owner}}`, `{{car.transmission}}`, `{{car.fuel}}`, `{{car.odometer}}`, `{{car.insurance}}`, `{{car.insurance_expiry}}`, `{{car.tax_validity}}`, `{{car.fitness_validity}}`, `{{car.seller}}`, `{{car.condition}}`, `{{car.highlights}}`.

**Any image slot name is allowed.** Add tokens such as `{{slot.hero}}`, `{{slot.left_front_three_quarter}}`, `{{slot.dashboard_closeup}}`, or `{{slot.detail_01}}` to an image's `src`. The app scans the selected template and creates a drop target for each unique `slot.*` placeholder.

Add an optional matching caption token such as `{{label.left_front_three_quarter}}` wherever that slot's editable caption belongs.

## Security

This is currently an internal single-operator tool. The API does not yet implement login or authorization. Add authentication before sharing the deployed URL publicly. Keep the Supabase service-role key only in Render's private environment variables.
