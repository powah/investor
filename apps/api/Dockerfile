FROM python:3.15.0rc1-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/api/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip==26.2
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY apps/api/app ./app
COPY apps/api/alembic.ini ./alembic.ini
COPY apps/api/alembic ./alembic
COPY data ./data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
