FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

RUN groupadd --system --gid 10001 facultyconnect \
    && useradd --system --uid 10001 --gid 10001 --no-create-home facultyconnect \
    && chown -R facultyconnect:facultyconnect /app
USER facultyconnect

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --limit-concurrency 100 --limit-max-requests 1000 --timeout-keep-alive 5"]
