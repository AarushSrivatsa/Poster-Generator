import calendar
import html
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db, SessionLocal
from .models import (
    CarDetails,
    CarImage,
    CarMake,
    CarPoster,
    FuelType,
    PosterTemplate,
    TransmissionType,
)

ROOT = Path(__file__).resolve().parent
ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/avif": ".avif",
}
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]{0,79})\s*\}\}")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "vehicle-photos")

if not SUPABASE_URL.startswith("https://") or not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SECRET_KEY are required. "
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


def public_storage_url(key: str) -> str:
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    object_key = quote(key, safe="/")
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_key}"


async def upload_storage_object(key: str, content: bytes, content_type: str) -> str:
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
    return public_storage_url(key)


def storage_key_from_public_url(image_url: str) -> str | None:
    parsed = urlparse(image_url)
    prefix = f"/storage/v1/object/public/{SUPABASE_STORAGE_BUCKET}/"
    if parsed.netloc != urlparse(SUPABASE_URL).netloc or not parsed.path.startswith(prefix):
        return None
    return unquote(parsed.path[len(prefix):])


def delete_storage_object(image_url: str | None) -> None:
    if not image_url:
        return
    key = storage_key_from_public_url(image_url)
    if not key:
        return
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}"
    response = httpx.delete(
        url,
        headers=storage_headers(),
        json={"prefixes": [key]},
        timeout=30,
    )
    if response.is_error and response.status_code != 404:
        raise RuntimeError(f"Supabase Storage delete failed: {response.text[:300]}")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_int(value, field_name: str, nullable: bool = False):
    if value is None or value == "":
        if nullable:
            return None
        raise HTTPException(400, f"{field_name} is required.")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{field_name} must be a whole number.")


def parse_validity(value, field_name: str, kind: str) -> datetime | None:
    if value is None or str(value).strip().lower() in {"", "lapsed", "null"}:
        return None
    raw = str(value).strip()
    try:
        if kind == "month" and re.fullmatch(r"\d{4}-\d{2}", raw):
            year, month = map(int, raw.split("-"))
            day = calendar.monthrange(year, month)[1]
            return datetime(year, month, day, 23, 59, 59, tzinfo=timezone.utc)
        if kind == "year" and re.fullmatch(r"\d{4}", raw):
            return datetime(int(raw), 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (ValueError, OverflowError):
        pass
    expected = "YYYY-MM for insurance" if kind == "month" else "YYYY for fitness"
    raise HTTPException(400, f"{field_name} must be Lapsed or {expected}.")


def datetime_value(value: datetime | None):
    return value.isoformat() if value else None


def enum_value(value):
    return value.value if hasattr(value, "value") else value


def make_to_dict(make: CarMake) -> dict:
    return {"id": make.id, "name": make.name, "icon_url": make.icon_url}


def image_to_dict(image: CarImage) -> dict:
    return {
        "id": image.id,
        "car_id": image.car_id,
        "image_url": image.image_url,
        "image_type": image.image_type,
        "sort_order": image.sort_order,
        "created_at": datetime_value(image.created_at),
    }


def car_to_dict(car: CarDetails, include_images: bool = True) -> dict:
    result = {
        "id": car.id,
        "make_id": car.make_id,
        "make": make_to_dict(car.make) if car.make else None,
        "model": car.model,
        "variant": car.variant,
        "registration_no": car.registration_no,
        "fuel_type": enum_value(car.fuel_type),
        "year": car.year,
        "transmission": enum_value(car.transmission),
        "odometer_km": car.odometer_km,
        "owner_count": car.owner_count,
        "insurance_validity": datetime_value(car.insurance_validity),
        "fitness_validity": datetime_value(car.fitness_validity),
        "created_at": datetime_value(car.created_at),
        "updated_at": datetime_value(car.updated_at),
    }
    if include_images:
        result["images"] = [
            image_to_dict(image)
            for image in sorted(car.images, key=lambda item: (item.sort_order, item.id))
        ]
    return result


def humanize_key(key: str) -> str:
    return re.sub(r"[_-]+", " ", key).strip().title()


def extract_placeholder_schema(markup: str) -> dict:
    car_fields, make_fields, image_keys, text_keys = [], [], [], []
    for match in TOKEN_RE.finditer(markup):
        token = match.group(1)
        if token.startswith("car."):
            key = token[4:]
            if key not in car_fields:
                car_fields.append(key)
        elif token.startswith("make."):
            key = token[5:]
            if key not in make_fields:
                make_fields.append(key)
        elif token.startswith("image."):
            key = token[6:]
            if key not in image_keys:
                image_keys.append(key)
        elif token.startswith("text."):
            key = token[5:]
            if key not in text_keys:
                text_keys.append(key)

    return {
        "car": car_fields,
        "make": make_fields,
        "images": [
            {"key": key, "label": humanize_key(key), "required": False}
            for key in image_keys
        ],
        "text": [
            {
                "key": key,
                "label": humanize_key(key),
                "default": "",
                "required": False,
                "multiline": any(
                    part in key.lower()
                    for part in ("description", "subtitle", "note", "tagline", "offer")
                ),
            }
            for key in text_keys
        ],
    }


def validate_template_html(markup: str) -> dict:
    if not markup.strip():
        raise HTTPException(400, "Template HTML is required.")
    if len(markup) > 200_000:
        raise HTTPException(413, "Template HTML is limited to 200 KB.")
    schema = extract_placeholder_schema(markup)
    if not any(schema.values()):
        raise HTTPException(
            400,
            "Use at least one placeholder: {{car.model}}, {{make.icon}}, {{image.hero}} or {{text.headline}}.",
        )
    return schema


def template_to_dict(template: PosterTemplate) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "html_content": template.html_content,
        "placeholder_schema": template.placeholder_schema or {},
        "thumbnail_url": template.thumbnail_url,
        "sort_order": template.sort_order,
        "is_builtin": template.is_builtin,
        "created_at": datetime_value(template.created_at),
        "updated_at": datetime_value(template.updated_at),
    }


def poster_to_dict(poster: CarPoster) -> dict:
    return {
        "id": poster.id,
        "car_id": poster.car_id,
        "template_id": poster.template_id,
        "name": poster.name,
        "text_values": poster.text_values or {},
        "image_assignments": poster.image_assignments or {},
        "created_at": datetime_value(poster.created_at),
        "updated_at": datetime_value(poster.updated_at),
    }


def render_poster_html(template: PosterTemplate, poster: CarPoster, car: CarDetails, db: Session) -> str:
    schema = template.placeholder_schema or extract_placeholder_schema(template.html_content)
    image_keys = {entry["key"] for entry in schema.get("images", [])}
    text_keys = {entry["key"] for entry in schema.get("text", [])}
    assignments = poster.image_assignments or {}

    valid_ids = {}
    for key, value in assignments.items():
        if key not in image_keys:
            continue
        try:
            valid_ids[key] = int(value)
        except (TypeError, ValueError):
            continue

    image_map = {}
    if valid_ids:
        image_map = {
            row.id: row
            for row in db.query(CarImage).filter(
                CarImage.id.in_(list(valid_ids.values())),
                CarImage.car_id == car.id,
            ).all()
        }

    car_values = {
        "model": car.model,
        "variant": car.variant or "",
        "registration_no": car.registration_no,
        "fuel_type": enum_value(car.fuel_type),
        "year": str(car.year),
        "transmission": enum_value(car.transmission),
        "odometer_km": str(car.odometer_km) if car.odometer_km is not None else "Unrecorded",
        "owner_count": str(car.owner_count) if car.owner_count is not None else "Unrecorded",
        "insurance_validity": car.insurance_validity.strftime("%m/%Y") if car.insurance_validity else "Lapsed",
        "fitness_validity": car.fitness_validity.strftime("%Y") if car.fitness_validity else "Lapsed",
        "make": car.make.name if car.make else "",
    }
    transparent_pixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
    make_values = {
        "name": car.make.name if car.make else "",
        "icon": (car.make.icon_url if car.make and car.make.icon_url else transparent_pixel),
    }

    replacements = {}
    for key, value in car_values.items():
        replacements["car." + key] = value
    replacements["car.make.name"] = make_values["name"]
    replacements["make.name"] = make_values["name"]
    replacements["make.icon"] = make_values["icon"]

    for key in image_keys:
        image = image_map.get(valid_ids.get(key))
        replacements["image." + key] = image.image_url if image else transparent_pixel

    text_values = poster.text_values or {}
    for key in text_keys:
        replacements["text." + key] = text_values.get(key, "")

    def substitute(match):
        token = match.group(1)
        value = replacements.get(token, "")
        if token == "make.icon" or token.startswith("image."):
            return html.escape(str(value or ""), quote=True)
        return html.escape(str(value if value is not None else ""))

    markup = TOKEN_RE.sub(substitute, template.html_content)
    print_bridge = (
        "<script>window.addEventListener('message',function(event){"
        "if(event.source===window.parent&&event.data&&event.data.type==='POSTER_STUDIO_PRINT'){"
        "window.focus();window.print();}});</script>"
    )
    if re.search(r"</body\s*>", markup, flags=re.IGNORECASE):
        markup = re.sub(r"</body\s*>", print_bridge + "</body>", markup, count=1, flags=re.IGNORECASE)
    else:
        markup += print_bridge
    return markup


# =====================================================
# ONE-TIME SCHEMA RESET + CREATE
# =====================================================

app = FastAPI(title="Vehicle Poster Studio", version="2.0.0")

with engine.begin() as connection:
    connection.execute(text(
        """
        CREATE TABLE IF NOT EXISTS poster_generator_schema_meta (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    ))
    installed_version = connection.execute(text(
        "SELECT MAX(version) FROM poster_generator_schema_meta"
    )).scalar()

    if installed_version is None or installed_version < 1:
        # Explicit one-time reset of the legacy app tables and any partially
        # created new tables. The migration marker is kept outside this list.
        connection.execute(text(
            """
            DROP TABLE IF EXISTS
                car_posters,
                car_images,
                car_details,
                car_makes,
                poster_templates,
                vehicle_photos,
                vehicles
            CASCADE
            """
        ))
        Base.metadata.create_all(bind=connection)
        connection.execute(text(
            "INSERT INTO poster_generator_schema_meta (version) VALUES (1) ON CONFLICT DO NOTHING"
        ))
    else:
        Base.metadata.create_all(bind=connection)

app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
views = Jinja2Templates(directory=ROOT / "templates")

BUILT_IN_TEMPLATES = [
    ("Midnight Gold", "Warm black-and-gold automotive poster", "default_poster.html", 10),
    ("Studio Minimal", "Clean editorial layout with generous space", "poster_studio_minimal.html", 20),
    ("Electric Motion", "High-energy dark design with neon accents", "poster_electric_motion.html", 30),
    ("Executive Black", "Luxury editorial layout with warm metallic details", "poster_executive_black.html", 40),
]

with SessionLocal() as seed_db:
    for name, description, filename, order in BUILT_IN_TEMPLATES:
        source = ROOT / "templates" / filename
        if not source.exists():
            continue
        markup = source.read_text(encoding="utf-8")
        schema = extract_placeholder_schema(markup)
        existing = seed_db.query(PosterTemplate).filter_by(name=name).first()
        if existing is None:
            seed_db.add(PosterTemplate(
                name=name,
                description=description,
                html_content=markup,
                placeholder_schema=schema,
                sort_order=order,
                is_builtin=True,
            ))
        # Existing built-ins are left untouched so user edits survive restarts.
    seed_db.commit()


@app.get("/healthz")
def health():
    return {"ok": True}


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def home(request):
    return views.TemplateResponse("index.html", {"request": request})


# =====================================================
# MAKE CRUD
# =====================================================

@app.get("/api/makes")
def list_makes(db: Session = Depends(get_db)):
    return [make_to_dict(make) for make in db.query(CarMake).order_by(CarMake.name).all()]


@app.post("/api/makes")
def create_make(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Make name is required.")
    make = CarMake(name=name[:100], icon_url=None)
    db.add(make)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That make already exists.")
    db.refresh(make)
    return make_to_dict(make)


@app.put("/api/makes/{make_id}")
def update_make(make_id: int, payload: dict, db: Session = Depends(get_db)):
    make = db.get(CarMake, make_id)
    if not make:
        raise HTTPException(404, "Make not found.")
    if "name" in payload:
        name = str(payload["name"]).strip()
        if not name:
            raise HTTPException(400, "Make name cannot be empty.")
        make.name = name[:100]
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A make with that name already exists.")
    db.refresh(make)
    return make_to_dict(make)


@app.post("/api/makes/{make_id}/icon")
async def upload_make_icon(make_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    make = db.get(CarMake, make_id)
    if not make:
        raise HTTPException(404, "Make not found.")
    extension = ALLOWED_TYPES.get(file.content_type or "")
    if not extension:
        raise HTTPException(415, "Use a JPG, PNG, WEBP or AVIF image.")
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Make icons must be 12 MB or smaller.")
    key = f"make-icons/{make_id}/{uuid.uuid4().hex}{extension}"
    new_url = await upload_storage_object(key, content, file.content_type)
    old_url = make.icon_url
    make.icon_url = new_url
    db.commit()
    if old_url:
        delete_storage_object(old_url)
    return make_to_dict(make)


@app.delete("/api/makes/{make_id}")
def delete_make(make_id: int, db: Session = Depends(get_db)):
    make = db.get(CarMake, make_id)
    if not make:
        raise HTTPException(404, "Make not found.")
    if db.query(CarDetails.id).filter(CarDetails.make_id == make_id).first():
        raise HTTPException(409, "This make is used by cars. Reassign or delete those cars first.")
    icon_url = make.icon_url
    db.delete(make)
    db.commit()
    delete_storage_object(icon_url)
    return {"ok": True}


# =====================================================
# CAR CRUD
# =====================================================

@app.get("/api/cars")
def list_cars(db: Session = Depends(get_db)):
    cars = (
        db.query(CarDetails)
        .options(selectinload(CarDetails.make), selectinload(CarDetails.images))
        .order_by(CarDetails.id.desc())
        .all()
    )
    return [car_to_dict(car) for car in cars]


@app.get("/api/cars/{car_id}")
def get_car(car_id: int, db: Session = Depends(get_db)):
    car = (
        db.query(CarDetails)
        .options(selectinload(CarDetails.make), selectinload(CarDetails.images))
        .filter_by(id=car_id)
        .first()
    )
    if not car:
        raise HTTPException(404, "Car not found.")
    return car_to_dict(car)


def car_payload(payload: dict, creating: bool = False) -> dict:
    data = {}
    if creating or "make_id" in payload:
        data["make_id"] = parse_int(payload.get("make_id"), "Make")
    if creating or "model" in payload:
        model = str(payload.get("model", "")).strip()
        if not model:
            raise HTTPException(400, "Model is required.")
        data["model"] = model[:150]
    for key, limit in (("variant", 150), ("registration_no", 25)):
        if creating or key in payload:
            value = str(payload.get(key) or "").strip()
            if key == "registration_no" and not value:
                raise HTTPException(400, "Registration number is required.")
            data[key] = value[:limit] or None
    if "registration_no" in data:
        data["registration_no"] = data["registration_no"].upper()
    if creating or "fuel_type" in payload:
        try:
            data["fuel_type"] = FuelType(str(payload.get("fuel_type")))
        except ValueError:
            raise HTTPException(400, "Choose a valid fuel type.")
    if creating or "year" in payload:
        data["year"] = parse_int(payload.get("year"), "Year")
    if creating or "transmission" in payload:
        try:
            data["transmission"] = TransmissionType(str(payload.get("transmission")))
        except ValueError:
            raise HTTPException(400, "Choose a valid transmission type.")
    if creating or "odometer_km" in payload:
        data["odometer_km"] = parse_int(payload.get("odometer_km"), "Odometer", nullable=True)
    if creating or "owner_count" in payload:
        data["owner_count"] = parse_int(payload.get("owner_count"), "Owner count", nullable=True)
    if creating or "insurance_validity" in payload:
        data["insurance_validity"] = parse_validity(payload.get("insurance_validity"), "Insurance validity", "month")
    if creating or "fitness_validity" in payload:
        data["fitness_validity"] = parse_validity(payload.get("fitness_validity"), "Fitness validity", "year")
    return data


@app.post("/api/cars")
def create_car(payload: dict, db: Session = Depends(get_db)):
    data = car_payload(payload, creating=True)
    if not db.get(CarMake, data["make_id"]):
        raise HTTPException(404, "Selected make does not exist.")
    car = CarDetails(**data)
    db.add(car)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A car with this registration number already exists.")
    db.refresh(car)
    return {"id": car.id}


@app.put("/api/cars/{car_id}")
def update_car(car_id: int, payload: dict, db: Session = Depends(get_db)):
    car = db.get(CarDetails, car_id)
    if not car:
        raise HTTPException(404, "Car not found.")
    data = car_payload(payload)
    if "make_id" in data and not db.get(CarMake, data["make_id"]):
        raise HTTPException(404, "Selected make does not exist.")
    for key, value in data.items():
        setattr(car, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A car with this registration number already exists.")
    db.refresh(car)
    return {"id": car.id}


@app.delete("/api/cars/{car_id}")
def delete_car(car_id: int, db: Session = Depends(get_db)):
    car = (
        db.query(CarDetails)
        .options(selectinload(CarDetails.images))
        .filter_by(id=car_id)
        .first()
    )
    if not car:
        raise HTTPException(404, "Car not found.")
    for image in car.images:
        delete_storage_object(image.image_url)
    db.delete(car)
    db.commit()
    return {"ok": True}


# =====================================================
# CAR IMAGE CRUD + SUPABASE STORAGE
# =====================================================

@app.post("/api/cars/{car_id}/images")
async def upload_car_images(
    car_id: int,
    files: list[UploadFile] = File(...),
    image_type: str = Form(""),
    db: Session = Depends(get_db),
):
    car = db.get(CarDetails, car_id)
    if not car:
        raise HTTPException(404, "Car not found.")
    added = []
    for file in files:
        extension = ALLOWED_TYPES.get(file.content_type or "")
        if not extension:
            raise HTTPException(415, "Use JPG, PNG, WEBP or AVIF images.")
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Each image must be 12 MB or smaller.")
        key = f"cars/{car_id}/{uuid.uuid4().hex}{extension}"
        image_url = await upload_storage_object(key, content, file.content_type)
        image = CarImage(
            car_id=car_id,
            image_url=image_url,
            image_type=(image_type.strip() or Path(file.filename or "Vehicle photo").stem)[:100],
            sort_order=db.query(CarImage).filter_by(car_id=car_id).count(),
        )
        db.add(image)
        db.flush()
        added.append(image_to_dict(image))
    db.commit()
    return added


@app.patch("/api/images/{image_id}")
def update_car_image(image_id: int, payload: dict, db: Session = Depends(get_db)):
    image = db.get(CarImage, image_id)
    if not image:
        raise HTTPException(404, "Image not found.")
    if "image_type" in payload:
        image.image_type = str(payload["image_type"]).strip()[:100]
    if "sort_order" in payload:
        image.sort_order = parse_int(payload["sort_order"], "Sort order")
    db.commit()
    return image_to_dict(image)


@app.delete("/api/images/{image_id}")
def delete_car_image(image_id: int, db: Session = Depends(get_db)):
    image = db.get(CarImage, image_id)
    if not image:
        raise HTTPException(404, "Image not found.")
    delete_storage_object(image.image_url)
    db.delete(image)
    db.commit()
    return {"ok": True}


# =====================================================
# TEMPLATE CRUD
# =====================================================

@app.get("/api/templates")
def list_templates(db: Session = Depends(get_db)):
    templates = db.query(PosterTemplate).order_by(
        PosterTemplate.sort_order, PosterTemplate.name
    ).all()
    return [template_to_dict(template) for template in templates]


@app.get("/api/templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)):
    template = db.get(PosterTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found.")
    return template_to_dict(template)


def template_payload(payload: dict, creating: bool = False) -> dict:
    data = {}
    if creating or "name" in payload:
        name = str(payload.get("name", "")).strip()
        if not name:
            raise HTTPException(400, "Template name is required.")
        data["name"] = name[:150]
    if creating or "html_content" in payload:
        markup = str(payload.get("html_content", ""))
        data["html_content"] = markup
        data["placeholder_schema"] = validate_template_html(markup)
    if "description" in payload:
        data["description"] = str(payload.get("description") or "").strip() or None
    if "thumbnail_url" in payload:
        data["thumbnail_url"] = str(payload.get("thumbnail_url") or "").strip() or None
    if "sort_order" in payload:
        data["sort_order"] = parse_int(payload["sort_order"], "Sort order")
    return data


@app.post("/api/templates")
def create_template(payload: dict, db: Session = Depends(get_db)):
    template = PosterTemplate(**template_payload(payload, creating=True))
    db.add(template)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A template with that name already exists.")
    db.refresh(template)
    return template_to_dict(template)


@app.put("/api/templates/{template_id}")
def update_template(template_id: int, payload: dict, db: Session = Depends(get_db)):
    template = db.get(PosterTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found.")
    data = template_payload(payload)
    for key, value in data.items():
        setattr(template, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A template with that name already exists.")
    db.refresh(template)
    return template_to_dict(template)


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    template = db.get(PosterTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found.")
    if template.is_builtin:
        raise HTTPException(409, "Built-in templates cannot be deleted. Duplicate one to customise it.")
    if db.query(CarPoster.id).filter(CarPoster.template_id == template_id).first():
        raise HTTPException(409, "This template is used by saved posters. Delete those posters first.")
    db.delete(template)
    db.commit()
    return {"ok": True}


# =====================================================
# POSTER CRUD + RENDER
# =====================================================

@app.get("/api/posters")
def list_posters(car_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(CarPoster)
    if car_id is not None:
        query = query.filter(CarPoster.car_id == car_id)
    return [poster_to_dict(poster) for poster in query.order_by(CarPoster.updated_at.desc()).all()]


@app.get("/api/posters/{poster_id}")
def get_poster(poster_id: int, db: Session = Depends(get_db)):
    poster = db.get(CarPoster, poster_id)
    if not poster:
        raise HTTPException(404, "Poster not found.")
    return poster_to_dict(poster)


@app.post("/api/posters")
def create_poster(payload: dict, db: Session = Depends(get_db)):
    car_id = parse_int(payload.get("car_id"), "Car")
    template_id = parse_int(payload.get("template_id"), "Template")
    if not db.get(CarDetails, car_id):
        raise HTTPException(404, "Car not found.")
    template = db.get(PosterTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found.")
    defaults = {
        field["key"]: field.get("default", "")
        for field in (template.placeholder_schema or {}).get("text", [])
    }
    poster = CarPoster(
        car_id=car_id,
        template_id=template_id,
        name=str(payload.get("name") or template.name)[:150],
        text_values=defaults,
        image_assignments={},
    )
    db.add(poster)
    db.commit()
    db.refresh(poster)
    return poster_to_dict(poster)


@app.put("/api/posters/{poster_id}")
def update_poster(poster_id: int, payload: dict, db: Session = Depends(get_db)):
    poster = db.get(CarPoster, poster_id)
    if not poster:
        raise HTTPException(404, "Poster not found.")
    template = db.get(PosterTemplate, poster.template_id)
    schema = template.placeholder_schema or {}
    text_keys = {field["key"] for field in schema.get("text", [])}
    image_keys = {field["key"] for field in schema.get("images", [])}

    if "name" in payload:
        poster.name = str(payload["name"] or "").strip()[:150] or None
    if "text_values" in payload:
        incoming = payload["text_values"]
        if not isinstance(incoming, dict):
            raise HTTPException(400, "text_values must be an object.")
        poster.text_values = {
            key: str(value)[:4000]
            for key, value in incoming.items()
            if key in text_keys
        }
    if "image_assignments" in payload:
        incoming = payload["image_assignments"]
        if not isinstance(incoming, dict):
            raise HTTPException(400, "image_assignments must be an object.")
        clean = {}
        for key, value in incoming.items():
            if key not in image_keys or value in (None, ""):
                continue
            image_id = parse_int(value, f"Image assignment for {key}")
            image = db.get(CarImage, image_id)
            if not image or image.car_id != poster.car_id:
                raise HTTPException(400, f"Image {image_id} does not belong to this car.")
            clean[key] = image_id
        poster.image_assignments = clean
    db.commit()
    db.refresh(poster)
    return poster_to_dict(poster)


@app.delete("/api/posters/{poster_id}")
def delete_poster(poster_id: int, db: Session = Depends(get_db)):
    poster = db.get(CarPoster, poster_id)
    if not poster:
        raise HTTPException(404, "Poster not found.")
    db.delete(poster)
    db.commit()
    return {"ok": True}


@app.get("/api/posters/{poster_id}/render", response_class=HTMLResponse)
def render_poster(poster_id: int, db: Session = Depends(get_db)):
    poster = (
        db.query(CarPoster)
        .options(
            selectinload(CarPoster.car).selectinload(CarDetails.make),
            selectinload(CarPoster.template),
        )
        .filter_by(id=poster_id)
        .first()
    )
    if not poster:
        raise HTTPException(404, "Poster not found.")
    return HTMLResponse(
        render_poster_html(poster.template, poster, poster.car, db),
        headers={"Cache-Control": "no-store"},
    )
