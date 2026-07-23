import hmac
import os
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


MODEL_NAME = "all-MiniLM-L6-v2"


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: str = MODEL_NAME


class EmbeddingDatum(BaseModel):
    object: str = "embedding"
    embedding: list[float]
    index: int


class EmbeddingUsage(BaseModel):
    prompt_tokens: int
    total_tokens: int


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: list[EmbeddingDatum]
    model: str
    usage: EmbeddingUsage


@lru_cache(maxsize=1)
def default_embedder() -> Any:
    from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

    embedder = ONNXMiniLM_L6_V2()
    embedder(["warmup"])
    return embedder


def _expected_key() -> str:
    return os.environ.get("EMBEDDINGS_API_KEY", "").strip()


def _authorized(authorization: str | None, api_key: str | None) -> bool:
    expected = _expected_key()
    if not expected:
        return False
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    candidate = bearer or (api_key or "").strip()
    return bool(candidate) and hmac.compare_digest(candidate, expected)


def create_app(embedder: Any | None = None) -> FastAPI:
    app = FastAPI(title="MXGenius MiniLM Embeddings", version="1.0.0")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "model": MODEL_NAME}

    @app.post("/v1/embeddings", response_model=EmbeddingResponse)
    def embeddings(
        request: EmbeddingRequest,
        authorization: str | None = Header(default=None),
        api_key: str | None = Header(default=None, alias="api-key"),
    ) -> EmbeddingResponse:
        if not _authorized(authorization, api_key):
            raise HTTPException(status_code=401, detail="authentication required")
        if request.model != MODEL_NAME:
            raise HTTPException(status_code=400, detail=f"unsupported model: {request.model}")

        texts = [request.input] if isinstance(request.input, str) else request.input
        if not texts or len(texts) > 64:
            raise HTTPException(status_code=400, detail="input must contain between 1 and 64 items")
        if any(not text.strip() or len(text.encode("utf-8")) > 32_000 for text in texts):
            raise HTTPException(status_code=400, detail="each input must contain 1 to 32000 UTF-8 bytes")

        vectors = (embedder or default_embedder())(texts)
        data = [
            EmbeddingDatum(embedding=[float(value) for value in vector], index=index)
            for index, vector in enumerate(vectors)
        ]
        approximate_tokens = sum(max(1, len(text.split())) for text in texts)
        return EmbeddingResponse(
            data=data,
            model=MODEL_NAME,
            usage=EmbeddingUsage(
                prompt_tokens=approximate_tokens,
                total_tokens=approximate_tokens,
            ),
        )

    return app


app = create_app()
