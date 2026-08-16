import os
import unittest

from fastapi.testclient import TestClient

from app import MODEL_NAME, create_app


class FakeEmbedder:
    def __call__(self, texts):
        return [[0.25] * 384 for _ in texts]


class EmbeddingServiceTests(unittest.TestCase):
    def setUp(self):
        os.environ["EMBEDDINGS_API_KEY"] = "test-key"
        self.client = TestClient(create_app(FakeEmbedder()))

    def test_requires_authentication(self):
        response = self.client.post(
            "/v1/embeddings",
            json={"model": MODEL_NAME, "input": "bleed loop fault"},
        )
        self.assertEqual(response.status_code, 401)

    def test_returns_openai_compatible_embedding_shape(self):
        response = self.client.post(
            "/v1/embeddings",
            headers={"Authorization": "Bearer test-key"},
            json={"model": MODEL_NAME, "input": "bleed loop fault"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["object"], "list")
        self.assertEqual(payload["model"], MODEL_NAME)
        self.assertEqual(len(payload["data"]), 1)
        self.assertEqual(len(payload["data"][0]["embedding"]), 384)

    def test_readiness_verifies_model_and_vector_dimensions(self):
        response = self.client.get("/readyz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"status": "ready", "model": MODEL_NAME, "dimensions": 384},
        )

    def test_rejects_invalid_embedding_dimensions(self):
        class InvalidEmbedder:
            def __call__(self, texts):
                return [[0.25] * 10 for _ in texts]

        client = TestClient(create_app(InvalidEmbedder()))
        response = client.post(
            "/v1/embeddings",
            headers={"Authorization": "Bearer test-key"},
            json={"model": MODEL_NAME, "input": "bleed loop fault"},
        )
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
