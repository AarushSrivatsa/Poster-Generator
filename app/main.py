import html
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db, DATA_DIR
from .models import Vehicle, VehiclePhoto, PosterTemplate

ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED = {"image/jpeg", "image/png", "image/webp"}
MAX_UPLOAD = 12 * 1024 * 1024

app = FastAPI(title="Poster Studio", version="1.0.0")
Base.metadata.create_all(bind=engine)
# Lightweight SQLite schema upgrade for an existing persistent disk.
if engine.dialect.name == "sqlite":
    columns = {c["name"] for c in inspect(engine).get_columns("vehicle_photos")}
    if "slot" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE vehicle_photos ADD COLUMN slot VARCHAR(40) DEFAULT ''"))
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
views = Jinja2Templates(directory=ROOT / "templates")

# Seed a starter template on first boot.
from .database import SessionLocal
with SessionLocal() as seed_db:
    if seed_db.query(PosterTemplate).count() == 0:
        starter = (ROOT / "templates" / "default_poster.html").read_text(encoding="utf-8")
        seed_db.add(PosterTemplate(name="Midnight Gold", description="Bold black and gold dealership layout", html=starter))
        seed_db.commit()

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return views.TemplateResponse("index.html", {"request": request})

def vehicle_dict(v: Vehicle):
    return {k: getattr(v, k) for k in (
        "id","make","model","variant","year","registration","owner","transmission",
        "fuel","odometer","insurance","insurance_expiry","tax_validity",
        "fitness_validity","seller","condition","highlights"
    )}

def photo_dict(p: VehiclePhoto):
    return {"id":p.id,"url":f"/uploads/{p.filename}","label":p.label,"slot":p.slot,"sort_order":p.sort_order}

@app.get("/api/vehicles")
def list_vehicles(db: Session = Depends(get_db)):
    vehicles = db.query(Vehicle).options(selectinload(Vehicle.photos)).order_by(Vehicle.id.desc()).all()
    return [{"vehicle":vehicle_dict(v),"photos":[photo_dict(p) for p in sorted(v.photos,key=lambda x:x.sort_order)]} for v in vehicles]

@app.post("/api/vehicles")
def create_vehicle(payload: dict, db: Session = Depends(get_db)):
    allowed = set(Vehicle.__table__.columns.keys()) - {"id","created_at"}
    data = {k:str(v)[:300] for k,v in payload.items() if k in allowed and v is not None}
    if not data.get("make") or not data.get("model"):
        raise HTTPException(400, "Make and model are required")
    v = Vehicle(**data)
    db.add(v); db.commit(); db.refresh(v)
    return vehicle_dict(v)

@app.put("/api/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: int, payload: dict, db: Session = Depends(get_db)):
    v = db.get(Vehicle, vehicle_id)
    if not v: raise HTTPException(404, "Vehicle not found")
    allowed = set(Vehicle.__table__.columns.keys()) - {"id","created_at"}
    for k,val in payload.items():
        if k in allowed and val is not None: setattr(v,k,str(val)[:300])
    db.commit(); db.refresh(v)
    return vehicle_dict(v)

@app.delete("/api/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    v = db.query(Vehicle).options(selectinload(Vehicle.photos)).filter_by(id=vehicle_id).first()
    if not v: raise HTTPException(404, "Vehicle not found")
    for p in v.photos:
        try: (UPLOAD_DIR/p.filename).unlink(missing_ok=True)
        except OSError: pass
    db.delete(v); db.commit()
    return {"ok":True}

@app.post("/api/vehicles/{vehicle_id}/photos")
async def upload_photos(vehicle_id: int, files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    v = db.get(Vehicle, vehicle_id)
    if not v: raise HTTPException(404, "Vehicle not found")
    added = []
    for file in files:
        if file.content_type not in ALLOWED: raise HTTPException(415, "Only JPG, PNG and WEBP images are supported")
        content = await file.read()
        if len(content) > MAX_UPLOAD: raise HTTPException(413, "Each image must be 12 MB or smaller")
        ext = {"image/jpeg":".jpg","image/png":".png","image/webp":".webp"}[file.content_type]
        name = f"{uuid.uuid4().hex}{ext}"
        (UPLOAD_DIR/name).write_bytes(content)
        photo = VehiclePhoto(vehicle_id=vehicle_id,filename=name,label=Path(file.filename or "Vehicle view").stem[:80])
        db.add(photo); db.flush()
        added.append(photo_dict(photo))
    db.commit()
    return added

@app.patch("/api/photos/{photo_id}")
def update_photo(photo_id: int, payload: dict, db: Session = Depends(get_db)):
    p = db.get(VehiclePhoto, photo_id)
    if not p: raise HTTPException(404, "Photo not found")
    if "label" in payload: p.label = str(payload["label"])[:80]
    if "slot" in payload: p.slot = str(payload["slot"])[:40]
    if "sort_order" in payload: p.sort_order = int(payload["sort_order"])
    db.commit()
    return photo_dict(p)

@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(get_db)):
    p = db.get(VehiclePhoto, photo_id)
    if not p: raise HTTPException(404, "Photo not found")
    (UPLOAD_DIR/p.filename).unlink(missing_ok=True)
    db.delete(p); db.commit()
    return {"ok":True}

@app.get("/api/templates")
def list_templates(db: Session = Depends(get_db)):
    return [{"id":t.id,"name":t.name,"description":t.description,"html":t.html} for t in db.query(PosterTemplate).order_by(PosterTemplate.id).all()]

@app.post("/api/templates")
def save_template(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name","")).strip()[:120]
    markup = str(payload.get("html",""))
    if not name or not markup: raise HTTPException(400,"Template name and HTML are required")
    if len(markup) > 100_000: raise HTTPException(413,"Template HTML is limited to 100 KB")
    t = PosterTemplate(name=name,description=str(payload.get("description",""))[:300],html=markup)
    db.add(t)
    try: db.commit()
    except Exception:
        db.rollback(); raise HTTPException(409,"A template with that name already exists")
    db.refresh(t)
    return {"id":t.id,"name":t.name}

@app.delete("/api/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    t = db.get(PosterTemplate,template_id)
    if not t: raise HTTPException(404,"Template not found")
    db.delete(t); db.commit()
    return {"ok":True}

@app.get("/api/vehicles/{vehicle_id}/poster/{template_id}", response_class=HTMLResponse)
def render_poster(vehicle_id: int, template_id: int, db: Session = Depends(get_db)):
    v = db.query(Vehicle).options(selectinload(Vehicle.photos)).filter_by(id=vehicle_id).first()
    t = db.get(PosterTemplate,template_id)
    if not v or not t: raise HTTPException(404,"Vehicle or template not found")
    # Custom templates use escaped scalar placeholders and named image slots.
    # Never evaluate user-supplied Jinja/Python expressions.
    data = vehicle_dict(v)
    markup = t.html
    for key,value in data.items():
        markup = markup.replace("{{car."+key+"}}", html.escape(str(value or "")))
    for p in v.photos:
        if p.slot:
            markup = markup.replace("{{slot."+p.slot+"}}", html.escape(f"/uploads/{p.filename}"))
            markup = markup.replace("{{label."+p.slot+"}}", html.escape(p.label))
    markup = re.sub(r"\{\{(?:car\.[a-zA-Z_]+|slot\.[a-zA-Z0-9_-]+|label\.[a-zA-Z0-9_-]+)\}\}", "", markup)
    return HTMLResponse(markup)
