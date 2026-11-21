FROM node:22-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm

# Keep the existing Python runtime and add Node only for the Tailwind CLI compiler.
COPY --from=node-runtime /usr/local/ /usr/local/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

RUN npm install --global @tailwindcss/cli@4.3.5 --no-audit --no-fund \
    && npm cache clean --force

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
