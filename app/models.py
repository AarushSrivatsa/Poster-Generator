from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    make: Mapped[str] = mapped_column(String(80), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    variant: Mapped[str] = mapped_column(String(120), default="")
    year: Mapped[str] = mapped_column(String(12), default="")
    registration: Mapped[str] = mapped_column(String(40), default="")
    owner: Mapped[str] = mapped_column(String(40), default="")
    transmission: Mapped[str] = mapped_column(String(40), default="Manual")
    fuel: Mapped[str] = mapped_column(String(40), default="Diesel")
    odometer: Mapped[str] = mapped_column(String(60), default="Unrecorded")
    insurance: Mapped[str] = mapped_column(String(80), default="")
    insurance_expiry: Mapped[str] = mapped_column(String(60), default="")
    tax_validity: Mapped[str] = mapped_column(String(60), default="")
    fitness_validity: Mapped[str] = mapped_column(String(60), default="")
    seller: Mapped[str] = mapped_column(String(120), default="")
    condition: Mapped[str] = mapped_column(String(120), default="Well cared-for vehicle")
    highlights: Mapped[str] = mapped_column(String(300), default="Robust | Reliable | Value for money")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    photos: Mapped[list["VehiclePhoto"]] = relationship(back_populates="vehicle", cascade="all, delete-orphan")

class VehiclePhoto(Base):
    __tablename__ = "vehicle_photos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(255))
    label: Mapped[str] = mapped_column(String(80), default="Vehicle view")
    slot: Mapped[str] = mapped_column(String(40), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    vehicle: Mapped[Vehicle] = relationship(back_populates="photos")

class PosterTemplate(Base):
    __tablename__ = "poster_templates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(String(300), default="")
    html: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
