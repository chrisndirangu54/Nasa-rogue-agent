FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamav clamav-freshclam ca-certificates && rm -rf /var/lib/apt/lists/*
RUN freshclam
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
ENV PORT=8080
CMD ["sh","-c","exec gunicorn --bind 0.0.0.0:${PORT} --timeout 250 --workers 1 --threads 2 main:app"]
