import struct
import unittest

from fastapi.testclient import TestClient

from app import app, equipment_pack_agent
from equipment_pack_agent import EdgeIdentity


class BridgeIntegrationTests(unittest.TestCase):
    def test_local_realtime_proxy_uses_enrolled_device_without_exposing_credential(self):
        class RealtimeCore:
            def realtime_call(self, identity, sdp):
                self.identity = identity
                self.sdp = sdp
                return "v=0\r\no=edge-answer\r\n", {
                    "x-mxg-realtime-call-id": "rtc_test",
                    "x-correlation-id": "correlation-test",
                }

        core = RealtimeCore()
        original_identity = equipment_pack_agent.identity
        original_client = equipment_pack_agent.client
        equipment_pack_agent.identity = EdgeIdentity(
            device_id="a1379f31-f033-4dc5-9b60-b5aecb5fc456",
            display_name="Test edge",
            credential="mxgd.a1379f31-f033-4dc5-9b60-b5aecb5fc456." + "a" * 64,
        )
        equipment_pack_agent.client = core
        try:
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/realtime/calls",
                    content="v=0\r\no=edge-offer\r\n",
                    headers={"Content-Type": "application/sdp"},
                )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "application/sdp")
            self.assertEqual(response.headers["x-mxg-realtime-call-id"], "rtc_test")
            self.assertTrue(core.sdp.startswith("v=0"))
            self.assertNotIn("mxgd.", response.text)
        finally:
            equipment_pack_agent.identity = original_identity
            equipment_pack_agent.client = original_client

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

    def test_local_hardware_button_is_relayed_without_a_secret(self):
        with TestClient(app) as client:
            with client.websocket_connect("/ws/xr") as consumer:
                consumer.receive_json()
                response = client.post(
                    "/api/v1/hardware/button",
                    json={"button": "talk", "pressed": True},
                )
                self.assertEqual(response.status_code, 200)
                event = consumer.receive_json()
                while event.get("type") != "hardware.button":
                    event = consumer.receive_json()
                self.assertEqual(event["button"], "talk")
                self.assertTrue(event["pressed"])

    def test_local_hardware_led_state_is_validated_and_reported(self):
        payload = {"local": False, "cloud": True, "listening": True, "thinking": False}
        with TestClient(app) as client:
            response = client.post("/api/v1/hardware/leds", json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual({name: response.json()[name] for name in payload}, payload)
            self.assertGreater(response.json()["updatedAtMs"], 0)
            self.assertEqual(client.get("/api/v1/hardware/leds").json()["cloud"], True)
            invalid = client.post("/api/v1/hardware/leds", json={"cloud": True})
            self.assertEqual(invalid.status_code, 400)


if __name__ == "__main__":
    unittest.main()
