import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import app
from control_agent import _split_escaped, bluetooth_action, handle_action, wifi_connect


class ControlApiTests(unittest.TestCase):
    def test_local_control_session_and_wifi_scan(self):
        with TestClient(app) as client:
            control = AsyncMock(side_effect=[
                {"ok": True, "capabilities": ["wifi", "bluetooth", "poweroff"]},
                {"ok": True, "networks": []},
            ])
            with patch("app.request_control", new=control):
                session = client.get("/api/v1/control/session")
                self.assertEqual(session.status_code, 200)
                token = session.json()["token"]
                response = client.post("/api/v1/control/wifi/scan", headers={"X-MXG-Control-Token": token})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["networks"], [])

    def test_control_mutations_require_local_nonce(self):
        with TestClient(app) as client:
            response = client.post("/api/v1/control/poweroff")
            self.assertEqual(response.status_code, 403)


class ControlAgentValidationTests(unittest.TestCase):
    def test_nmcli_escaped_fields_are_split_without_losing_colons(self):
        self.assertEqual(_split_escaped(r"*:Hangar\: West:88:WPA2"), ["*", "Hangar: West", "88", "WPA2"])

    def test_wifi_and_bluetooth_reject_unbounded_input_before_execution(self):
        self.assertFalse(wifi_connect({"ssid": "x" * 33})["ok"])
        self.assertFalse(bluetooth_action({"address": "not-a-mac", "operation": "connect"})["ok"])
        self.assertFalse(handle_action({"action": "shell", "command": "anything"})["ok"])


if __name__ == "__main__":
    unittest.main()
