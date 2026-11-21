# Motor Poster Studio

A FastAPI + Supabase car inventory and poster builder. Store vehicle information once, create reusable HTML/Tailwind poster templates, then generate independent posters with their own image assignments and editable text.

## Data model

- \`CarMake\`: one shared manufacturer record, with its optional public Supabase logo URL.
- \`CarDetails\`: vehicle details, enums for fuel and transmission, integer year, nullable integer odometer/owner count, and nullable insurance/fitness expiry datetimes (\`NULL\` means Lapsed).
- \`CarImage\`: many images per car, each with a public Supabase Storage URL and free-text image type.
- \`PosterTemplate\`: reusable HTML/Tailwind source, automatically detected placeholder schema, optional thumbnail, sort order and built-in flag.
- \`CarPoster\`: a saved poster instance referencing one car and one template, with its own editable text values and image-placeholder assignments.

A make can be used by many cars. A car can own many images and many poster instances. A template can be reused by many poster instances. An uploaded car photo can be assigned to multiple image placeholders in one poster.

## Template placeholders

Use these tokens in template HTML:

| Token | Behaviour |
|---|---|
| \`{{car.model}}\` | Car model |
| \`{{car.variant}}\` | Car variant |
| \`{{car.registration_no}}\` | Registration number |
| \`{{car.fuel_type}}\` | Fuel type |
| \`{{car.year}}\` | Manufacturing year |
| \`{{car.transmission}}\` | Transmission |
| \`{{car.odometer_km}}\` | Odometer or “Unrecorded” |
| \`{{car.owner_count}}\` | Owner count or “Unrecorded” |
| \`{{car.insurance_validity}}\` | Expiry month/year or “Lapsed” |
| \`{{car.fitness_validity}}\` | Expiry year or “Lapsed” |
| \`{{make.name}}\` | Manufacturer name |
| \`{{make.icon}}\` | Public Supabase URL of the make logo |
| \`{{image.hero}}\` | User-assigned car image; any unique suffix is supported |
| \`{{text.headline}}\` | Editable text stored per poster; any unique suffix is supported |

Image and make tokens should be used inside image \`src\` attributes. Example: \`<img src="{{image.hero}}" alt="">\`.

Template HTML, including decorative inline SVGs and Tailwind classes, stays in \`html_content\`. Decorative icons can be directly authored as SVG and styled with Tailwind; there is no separate icon table. The API derives \`placeholder_schema\` from the tokens whenever a template is created or its HTML is updated.

## CRUD API

- Makes: \`GET/POST /api/makes\`, \`PUT/DELETE /api/makes/{id}\`, \`POST /api/makes/{id}/icon\`.
- Cars: \`GET/POST /api/cars\`, \`GET/PUT/DELETE /api/cars/{id}\`.
- Car images: \`POST /api/cars/{id}/images\`, \`PATCH/DELETE /api/images/{id}\`.
- Templates: \`GET/POST /api/templates\`, \`GET/PUT/DELETE /api/templates/{id}\`.
- Posters: \`GET/POST /api/posters\`, \`GET/PUT/DELETE /api/posters/{id}\`, \`GET /api/posters/{id}/render\`.

The interface supports auto-saving text, live preview refresh, file uploads, drag-and-drop image assignment, tap-to-assign on touch screens, editing image types, and reusing an uploaded image in multiple placeholders.

## Storage and deployment

- Supabase Postgres stores the application records.
- Supabase Storage bucket (default: \`vehicle-photos\`) stores car images and make logos.
- The database stores the public Supabase URL for each image/logo.
- Render runs the FastAPI app. No SQLite, local upload folder or Render disk is used.

Required Render environment variables:

| Variable | Required | Purpose |
|---|---|---|
| \`DATABASE_URL\` | Yes | Supabase PostgreSQL Session Pooler URI, port 5432 |
| \`SUPABASE_URL\` | Yes | Supabase project URL |
| \`SUPABASE_SECRET_KEY\` | Yes | Server-side Supabase secret key |
| \`SUPABASE_STORAGE_BUCKET\` | No | Defaults to \`vehicle-photos\` |

The Storage bucket must be public because the database stores public object URLs for use in posters. Upload and delete operations use the server-side secret key.

## Automatic schema reset

On the first deployment of this version, the app creates a persistent \`poster_generator_schema_meta\` marker in Supabase Postgres. When no schema marker exists, it drops the app's old/partial tables (\`vehicles\`, \`vehicle_photos\`, and the previous/partial poster tables), then creates the current tables from the SQLAlchemy models. It records schema version 1 so this reset does **not** repeat on later restarts.

**This one-time reset permanently deletes the old app records and old template records in those tables.** It does not drop unrelated tables or delete old orphaned Storage objects. Back up any old records you need before deploying.

## Important

The app currently has no authentication or per-user permissions. Treat it as a private internal tool until login and authorization are added. Never expose \`SUPABASE_SECRET_KEY\` in browser code or commit it to Git.
