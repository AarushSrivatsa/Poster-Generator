# Poster Generator

A mobile-friendly car listing poster studio. Manage vehicle records, upload a photo library, drag photos into named poster slots, preview HTML/Tailwind templates, and print to PDF.

## Run locally

```bash
docker build -t poster-generator .
docker run --rm -p 8000:8000 -v poster-data:/var/data -e DATA_DIR=/var/data poster-generator
```

Open http://localhost:8000.

Without Docker:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Deploy to Render

1. Create a new **Web Service** from this GitHub repository.
2. Choose **Docker** as the runtime.
3. Set `DATA_DIR=/var/data`.
4. Attach a persistent disk mounted at `/var/data` (SQLite database and uploaded photos live there).
5. Deploy. Render supplies `PORT`; the Docker command listens on it.

The included `render.yaml` can be used as a Blueprint. Persistent disks require a Render plan that supports disks; without one, local SQLite/uploads are ephemeral across redeploys.

## Workflow

- **Vehicle:** save shared vehicle details once.
- **Photo placement:** upload multiple photos, then drag each thumbnail to any named slot. A photo can be replaced or reused; captions are editable.
- **Poster studio:** select a template, refresh preview, then Print / Save as PDF.
- **Templates:** paste HTML + Tailwind markup and save it for future vehicles.

## Template placeholder contract

Vehicle fields: `{{car.make}}`, `{{car.model}}`, `{{car.variant}}`, `{{car.year}}`, `{{car.registration}}`, `{{car.owner}}`, `{{car.transmission}}`, `{{car.fuel}}`, `{{car.odometer}}`, `{{car.insurance}}`, `{{car.insurance_expiry}}`, `{{car.tax_validity}}`, `{{car.fitness_validity}}`, `{{car.seller}}`, `{{car.condition}}`, `{{car.highlights}}`.

Image slots (use in `src`): `{{slot.hero}}`, `{{slot.front}}`, `{{slot.side}}`, `{{slot.rear}}`, `{{slot.interior}}`, `{{slot.extra1}}`, `{{slot.extra2}}`.

Editable image captions: `{{label.front}}`, `{{label.side}}`, `{{label.rear}}`, `{{label.interior}}`, `{{label.extra1}}`, `{{label.extra2}}`.

Example:

```html
<main class="bg-zinc-950 p-8 text-white">
  <h1 class="text-5xl font-black">{{car.make}} {{car.model}}</h1>
  <img class="w-full object-cover" src="{{slot.hero}}" alt="">
  <p>{{car.year}} · {{car.fuel}} · {{car.transmission}}</p>
  <img src="{{slot.front}}" alt="">
  <b>{{label.front}}</b>
</main>
```

Templates are stored as HTML text. The renderer only replaces documented placeholders; it does not execute Jinja or Python expressions. Preview runs in a sandboxed iframe. Tailwind CDN classes are supported in template markup.

## Storage notes

SQLite and uploaded images are stored under `DATA_DIR`. Back up that directory. For a multi-instance production deployment, switch to managed PostgreSQL and object storage rather than local disk.
