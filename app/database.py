import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required. Configure the Supabase Session pooler URI in Render.")

parsed = make_url(DATABASE_URL)
if parsed.drivername in {"postgres", "postgresql"}:
    parsed = parsed.set(drivername="postgresql+psycopg")
if parsed.drivername != "postgresql+psycopg":
    raise RuntimeError("Only Supabase PostgreSQL is supported; local SQLite storage is intentionally disabled.")
if "sslmode" not in parsed.query:
    parsed = parsed.update_query_dict({"sslmode": "require"})

engine = create_engine(
    parsed,
    pool_pre_ping=True,
    pool_size=2,
    max_overflow=1,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
