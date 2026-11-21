import html
import json
import os
import re
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db, SessionLocal
from .models import Vehicle, VehiclePhoto, PosterTemplate

ROOT = Path(__file__).resolve().parent
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_UPLOAD_BYTES = 12 * 1024 * 1024

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "vehicle-photos")

if not SUPABASE_URL.startswith("https://") or not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SECRET_KEY are required (legacy SUPABASE_SERVICE_ROLE_KEY is also accepted). "
        "Configure Supabase Postgres and Storage before starting the app."
    )

def storage_headers(content_type: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers

def storage_object_url(key: str) -> str:
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    object_key = quote(key, safe="/")
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_key}"

async def store_photo(key: str, content: bytes, content_type: str) -> None:
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    object_key = quote(key, safe="/")
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{object_key}"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            url,
            headers={**storage_headers(content_type), "x-upsert": "false"},
            content=content,
        )
    if response.is_error:
        raise HTTPException(502, f"Supabase Storage upload failed: {response.text[:300]}")

def remove_photo(key: str) -> None:
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}"
    response = httpx.delete(
        url,
        headers=storage_headers(),
        json={"prefixes": [key]},
        timeout=30,
    )
    if response.is_error:
        raise RuntimeError(f"Supabase Storage delete failed: {response.text[:300]}")

app = FastAPI(title="Poster Studio", version="1.0.0")
Base.metadata.create_all(bind=engine)

# Safe idempotent migration for deployments that created the table before slot support.
with engine.begin() as connection:
    connection.execute(text(
        "ALTER TABLE vehicle_photos ADD COLUMN IF NOT EXISTS slot VARCHAR(40) NOT NULL DEFAULT ''"
    ))
    connection.execute(text(
        "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS poster_fields TEXT NOT NULL DEFAULT '{}'"
    ))

app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
views = Jinja2Templates(directory=ROOT / "templates")

# Seed the built-in template once. Future templates are saved in Supabase Postgres.
with SessionLocal() as seed_db:
    if seed_db.query(PosterTemplate).count() == 0:
        starter = (ROOT / "templates" / "default_poster.html").read_text(encoding="utf-8")
        seed_db.add(PosterTemplate(
            name="Midnight Gold",
            description="Bold black and gold dealership layout",
            html=starter,
        ))
        seed_db.commit()

@app.get("/healthz")
def health():
    return {"ok": True}

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def home(request: Request):
    return views.TemplateResponse("index.html", {"request": request})

def vehicle_dict(vehicle: Vehicle) -> dict:
    fields = (
        "id", "make", "model", "variant", "year", "registration", "owner",
        "transmission", "fuel", "odometer", "insurance", "insurance_expiry",
        "tax_validity", "fitness_validity", "seller", "condition", "highlights",
    )
    data = {field: getattr(vehicle, field) for field in fields}
    try:
        data["poster_fields"] = json.loads(vehicle.poster_fields or "{}")
    except (TypeError, ValueError):
        data["poster_fields"] = {}
    return data

def photo_dict(photo: VehiclePhoto) -> dict:
    return {
        "id": photo.id,
        "url": storage_object_url(photo.filename),
        "label": photo.label,
        "slot": photo.slot,
        "sort_order": photo.sort_order,
    }

@app.get("/api/vehicles")
def list_vehicles(db: Session = Depends(get_db)):
    records = (
        db.query(Vehicle)
        .options(selectinload(Vehicle.photos))
        .order_by(Vehicle.id.desc())
        .all()
    )
    return [
        {
            "vehicle": vehicle_dict(vehicle),
            "photos": [photo_dict(photo) for photo in sorted(vehicle.photos, key=lambda p: p.sort_order)],
        }
        for vehicle in records
    ]

@app.post("/api/vehicles")
def create_vehicle(payload: dict, db: Session = Depends(get_db)):
    allowed = set(Vehicle.__table__.columns.keys()) - {"id", "created_at"}
    data = {key: str(value)[:300] for key, value in payload.items() if key in allowed and key != "poster_fields" and value is not None}
    if isinstance(payload.get("poster_fields"), dict):
        data["poster_fields"] = json.dumps({str(k)[:60]: str(v)[:1000] for k, v in payload["poster_fields"].items()})
    if not data.get("make") or not data.get("model"):
        raise HTTPException(400, "Make and model are required")
    vehicle = Vehicle(**data)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle_dict(vehicle)

@app.put("/api/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: int, payload: dict, db: Session = Depends(get_db)):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")
    allowed = set(Vehicle.__table__.columns.keys()) - {"id", "created_at", "poster_fields"}
    for key, value in payload.items():
        if key in allowed and value is not None:
            setattr(vehicle, key, str(value)[:300])
    if isinstance(payload.get("poster_fields"), dict):
        vehicle.poster_fields = json.dumps({str(k)[:60]: str(v)[:1000] for k, v in payload["poster_fields"].items()})
    db.commit()
    db.refresh(vehicle)
    return vehicle_dict(vehicle)

@app.delete("/api/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    vehicle = (
        db.query(Vehicle)
        .options(selectinload(Vehicle.photos))
        .filter_by(id=vehicle_id)
        .first()
    )
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")
    for photo in vehicle.photos:
        remove_photo(photo.filename)
    db.delete(vehicle)
    db.commit()
    return {"ok": True}

@app.post("/api/vehicles/{vehicle_id}/photos")
async def upload_photos(
    vehicle_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")

    added = []
    for file in files:
        extension = ALLOWED_TYPES.get(file.content_type or "")
        if not extension:
            raise HTTPException(415, "Only JPG, PNG and WEBP images are supported")
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Each image must be 12 MB or smaller")

        object_key = f"{vehicle_id}/{uuid.uuid4().hex}{extension}"
        await store_photo(object_key, content, file.content_type)
        photo = VehiclePhoto(
            vehicle_id=vehicle_id,
            filename=object_key,
            label=Path(file.filename or "Vehicle view").stem[:80],
        )
        db.add(photo)
        db.flush()
        added.append(photo_dict(photo))

    db.commit()
    return added

@app.patch("/api/photos/{photo_id}")
def update_photo(photo_id: int, payload: dict, db: Session = Depends(get_db)):
    photo = db.get(VehiclePhoto, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    if "label" in payload:
        photo.label = str(payload["label"])[:80]
    if "slot" in payload:
        slot = str(payload["slot"])
        if len(slot) > 40 or (slot and not re.fullmatch(r"[A-Za-z0-9_-]+", slot)):
            raise HTTPException(400, "Slot names may contain only letters, numbers, _ and - (max 40 chars)")
        photo.slot = slot
    if "sort_order" in payload:
        photo.sort_order = int(payload["sort_order"])
    db.commit()
    return photo_dict(photo)

@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(VehiclePhoto, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    remove_photo(photo.filename)
    db.delete(photo)
    db.commit()
    return {"ok": True}

@app.get("/api/templates")
def list_templates(db: Session = Depends(get_db)):
    return [
        {"id": template.id, "name": template.name, "description": template.description, "html": template.html}
        for template in db.query(PosterTemplate).order_by(PosterTemplate.id).all()
    ]

@app.post("/api/templates")
def save_template(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name", "")).strip()[:120]
    markup = str(payload.get("html", ""))
    if not name or not markup:
        raise HTTPException(400, "Template name and HTML are required")
    if len(markup) > 100_000:
        raise HTTPException(413, "Template HTML is limited to 100 KB")
    template = PosterTemplate(
        name=name,
        description=str(payload.get("description", ""))[:300],
        html=markup,
    )
    db.add(template)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(409, "A template with that name already exists")
    db.refresh(template)
    return {"id": template.id, "name": template.name}

@app.delete("/api/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    template = db.get(PosterTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    db.delete(template)
    db.commit()
    return {"ok": True}

@app.get("/api/vehicles/{vehicle_id}/poster/{template_id}", response_class=HTMLResponse)
def render_poster(vehicle_id: int, template_id: int, db: Session = Depends(get_db)):
    vehicle = (
        db.query(Vehicle)
        .options(selectinload(Vehicle.photos))
        .filter_by(id=vehicle_id)
        .first()
    )
    template = db.get(PosterTemplate, template_id)
    if not vehicle or not template:
        raise HTTPException(404, "Vehicle or template not found")

    markup = template.html
    data = vehicle_dict(vehicle)
    for key, value in data.items():
        if key != "poster_fields" and not isinstance(value, dict) and "car." + key not in data.get("poster_fields", {}):
            markup = re.sub(r"\{\{\s*" + re.escape(key) + r"\s*\}\}", html.escape(str(value or "")), markup)
            markup = markup.replace("{{car." + key + "}}", html.escape(str(value or "")))
    for key, value in data.get("poster_fields", {}).items():
        markup = re.sub(r"\{\{\s*" + re.escape(key) + r"\s*\}\}", html.escape(str(value or "")), markup)
    for photo in vehicle.photos:
        if photo.slot:
            url = html.escape(storage_object_url(photo.filename), quote=True)
            markup = re.sub(r"\{\{\s*" + re.escape(photo.slot) + r"\s*\}\}", url, markup)
            markup = markup.replace("{{slot." + photo.slot + "}}", url)
            markup = markup.replace("{{label." + photo.slot + "}}", html.escape(photo.label))
    markup = re.sub(r"\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}", "", markup)
    return HTMLResponse(markup)
