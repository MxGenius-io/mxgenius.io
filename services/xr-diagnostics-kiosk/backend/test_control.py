import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

from app import app
from control import ControlUnavailable, request_control
from control_agent import _split_escaped, bluetooth_action, handle_action, usb_gadget_status, wifi_connect


class ControlApiTests(unittest.TestCase):
    def test_windows_without_unix_sockets_reports_control_unavailable(self):
        with patch(
            "control.asyncio.open_unix_connection",
            new=AsyncMock(side_effect=NotImplementedError),
            create=True,
        ):
            with self.assertRaises(ControlUnavailable):
                asyncio.run(request_control("status"))

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

    def test_equipment_pack_status_is_local_and_never_exposes_a_credential(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/equipment-pack/status")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("credential", response.json())


class ControlAgentValidationTests(unittest.TestCase):
    def test_nmcli_escaped_fields_are_split_without_losing_colons(self):
        self.assertEqual(_split_escaped(r"*:Hangar\: West:88:WPA2"), ["*", "Hangar: West", "88", "WPA2"])

    def test_wifi_and_bluetooth_reject_unbounded_input_before_execution(self):
        self.assertFalse(wifi_connect({"ssid": "x" * 33})["ok"])
        self.assertFalse(bluetooth_action({"address": "not-a-mac", "operation": "connect"})["ok"])
        self.assertFalse(handle_action({"action": "shell", "command": "anything"})["ok"])

    def test_wifi_connect_repairs_a_matching_profile_with_missing_key_management(self):
        responses = [
            Mock(returncode=10, stdout="", stderr="802-11-wireless-security.key-mgmt: property is missing"),
            Mock(returncode=0, stdout=r"netplan-wlan0\:Basement:wifi" + "\n", stderr=""),
            Mock(returncode=0, stdout="Basement\n", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
        ]
        with patch("control_agent._run", side_effect=responses) as run:
            result = wifi_connect({"ssid": "Basement", "password": "secret-passphrase"})

        self.assertTrue(result["ok"])
        self.assertIn("repaired", result["message"].lower())
        modification = run.call_args_list[3].args[0]
        self.assertIn("netplan-wlan0:Basement", modification)
        self.assertIn("802-11-wireless-security.key-mgmt", modification)
        self.assertIn("wpa-psk", modification)

    def test_wifi_connect_does_not_repair_unrelated_failures(self):
        with patch("control_agent._run", return_value=Mock(returncode=10, stdout="", stderr="No network found")) as run:
            result = wifi_connect({"ssid": "Hangar", "password": "secret-passphrase"})

        self.assertFalse(result["ok"])
        self.assertEqual(run.call_count, 1)

    def test_usb_gadget_probe_is_read_only_and_reports_kernel_surfaces(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gadget_root = root / "configfs"
            udc_root = root / "udc"
            (gadget_root / "mxgenius").mkdir(parents=True)
            (udc_root / "fe980000.usb").mkdir(parents=True)
            status = usb_gadget_status(gadget_root, udc_root)
        self.assertTrue(status["ok"])
        self.assertTrue(status["supported"])
        self.assertEqual(status["udcs"], ["fe980000.usb"])
        self.assertEqual(status["gadgets"], ["mxgenius"])


if __name__ == "__main__":
    unittest.main()
