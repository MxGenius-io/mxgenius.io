FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2; ONNXMiniLM_L6_V2()(['warmup'])"

COPY app.py .

RUN useradd --create-home --uid 10001 mxgenius \
    && chown -R mxgenius:mxgenius /app /home/mxgenius
USER mxgenius

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/readyz', timeout=5).read()"]

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
