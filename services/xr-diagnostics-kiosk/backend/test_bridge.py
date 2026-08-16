import struct
import unittest

from fastapi.testclient import TestClient

from app import app


class BridgeIntegrationTests(unittest.TestCase):
    def test_health_and_binary_sensor_relay(self):
        frame = struct.pack("<4sBBBBHHQI", b"MXGS", 1, 1, 1, 0, 2, 2, 123, 2) + b"{}" + b"jpeg"
        with TestClient(app) as client:
            response = client.get("/api/v1/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["service"], "mxg-xr-diagnostics")

            with client.websocket_connect("/ws/xr") as consumer:
                self.assertEqual(consumer.receive_json()["role"], "consumer")
                with client.websocket_connect("/ws/ingest") as producer:
                    self.assertEqual(producer.receive_json()["role"], "producer")
                    status = consumer.receive_json()
                    while status.get("type") != "source.status":
                        status = consumer.receive_json()
                    producer.send_bytes(frame)
                    message = consumer.receive()
                    while message.get("bytes") is None:
                        message = consumer.receive()
                    self.assertEqual(message["bytes"], frame)

    def test_raw_scan_is_normalized_and_relayed(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/v1/schemas/scan-observation").status_code, 200)
            with client.websocket_connect("/ws/xr") as consumer:
                consumer.receive_json()
                with client.websocket_connect("/ws/ingest") as producer:
                    producer.receive_json()
                    while consumer.receive_json().get("type") != "source.status":
                        pass
                    producer.send_json({
                        "type": "scan.raw",
                        "value": "P/N: TEST-42",
                        "deviceId": "scanner-test",
                        "transport": "usb-cdc",
                    })
                    event = consumer.receive_json()
                    while event.get("type") != "scan.observed":
                        event = consumer.receive_json()
                    self.assertEqual(event["normalized"]["partNumber"], "TEST-42")
                    self.assertFalse(event["normalized"]["verified"])

    def test_session_identifier_uses_the_gateway_contract(self):
        with TestClient(app) as client:
            with client.websocket_connect("/ws/xr") as consumer:
                consumer.receive_json()
                consumer.send_json({"type": "bridge.session", "sessionId": "invalid session/id"})
                error = consumer.receive_json()
                while error.get("type") != "bridge.error":
                    error = consumer.receive_json()
                self.assertEqual(error["code"], "INVALID_SESSION_ID")


if __name__ == "__main__":
    unittest.main()
