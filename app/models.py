from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class FuelType(str, PyEnum):
    PETROL = "Petrol"
    DIESEL = "Diesel"
    CNG = "CNG"
    PETROL_CNG = "Petrol + CNG"
    LPG = "LPG"
    PETROL_LPG = "Petrol + LPG"
    ELECTRIC = "Electric"
    HYBRID = "Hybrid"
    PLUG_IN_HYBRID = "Plug-in Hybrid"
    HYDROGEN = "Hydrogen"


class TransmissionType(str, PyEnum):
    MANUAL = "Manual"
    AMT = "AMT"
    TORQUE_CONVERTER = "Torque Converter Automatic"
    CVT = "CVT"
    DCT = "DCT / DSG"
    IMT = "iMT"
    ECVT = "e-CVT"
    SINGLE_SPEED_EV = "Single-speed EV"


def enum_column(enum_class: type[PyEnum], name: str):
    return SAEnum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CarMake(Base):
    __tablename__ = "car_makes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    # Public URL of the logo stored in Supabase Storage.
    icon_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    cars: Mapped[list["CarDetails"]] = relationship(back_populates="make")


class CarDetails(Base):
    __tablename__ = "car_details"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    make_id: Mapped[int] = mapped_column(
        ForeignKey("car_makes.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    model: Mapped[str] = mapped_column(String(150), nullable=False)
    variant: Mapped[str | None] = mapped_column(String(150), nullable=True)
    registration_no: Mapped[str] = mapped_column(
        String(25), unique=True, nullable=False, index=True
    )

    fuel_type: Mapped[FuelType] = mapped_column(
        enum_column(FuelType, "fuel_type"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    transmission: Mapped[TransmissionType] = mapped_column(
        enum_column(TransmissionType, "transmission_type"), nullable=False
    )

    # NULL means Unrecorded.
    odometer_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # NULL means Lapsed; otherwise the selected expiry date is stored.
    insurance_validity: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fitness_validity: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    make: Mapped["CarMake"] = relationship(back_populates="cars")
    images: Mapped[list["CarImage"]] = relationship(
        back_populates="car",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    posters: Mapped[list["CarPoster"]] = relationship(
        back_populates="car",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class CarImage(Base):
    __tablename__ = "car_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    car_id: Mapped[int] = mapped_column(
        ForeignKey("car_details.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Full public Supabase Storage URL, as requested.
    image_url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Free text; e.g. Front left, Interior, Dashboard, Scratches.
    image_type: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    car: Mapped["CarDetails"] = relationship(back_populates="images")


class PosterTemplate(Base):
    __tablename__ = "poster_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    html_content: Mapped[str] = mapped_column(Text, nullable=False)
    # Extracted from the template tokens; unique to each template.
    placeholder_schema: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    posters: Mapped[list["CarPoster"]] = relationship(back_populates="template")


class CarPoster(Base):
    __tablename__ = "car_posters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    car_id: Mapped[int] = mapped_column(
        ForeignKey("car_details.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    template_id: Mapped[int] = mapped_column(
        ForeignKey("poster_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Maps text placeholder keys to values, e.g. {"headline": "JUST ARRIVED"}.
    text_values: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Maps image placeholder keys to CarImage IDs, e.g. {"hero": 18}.
    image_assignments: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    car: Mapped["CarDetails"] = relationship(back_populates="posters")
    template: Mapped["PosterTemplate"] = relationship(back_populates="posters")
