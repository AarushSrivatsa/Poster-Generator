import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'posters.db'}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine_url = DATABASE_URL
engine_options = {"pool_pre_ping": True}

if not DATABASE_URL.startswith("sqlite"):
    # Convert Supabase's standard PostgreSQL URI to the psycopg 3 SQLAlchemy dialect.
    parsed = make_url(DATABASE_URL)
    if parsed.drivername in {"postgres", "postgresql"}:
        parsed = parsed.set(drivername="postgresql+psycopg")
    if "sslmode" not in parsed.query:
        parsed = parsed.update_query_dict({"sslmode": "require"})
    engine_url = parsed
    # Persistent Render web service: modest pool for Supabase's IPv4 Session pooler.
    engine_options.update({"pool_size": 3, "max_overflow": 2, "pool_recycle": 1800})

engine = create_engine(engine_url, connect_args=connect_args, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
