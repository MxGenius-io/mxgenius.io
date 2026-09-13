import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

from app import app
from control import ControlUnavailable, request_control
from control_agent import (
    _bind_usb_image,
    _split_escaped,
    bluetooth_action,
    handle_action,
    usb_gadget_activate,
    usb_gadget_status,
    wifi_connect,
    wifi_scan,
)


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

    def test_wifi_scan_uses_a_named_adapter_and_separates_rescan_from_results(self):
        responses = [
            Mock(returncode=0, stdout="enabled\n", stderr=""),
            Mock(returncode=0, stdout="wlan0:wifi:disconnected\n", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout=r"*:Hangar\: West:88:WPA2" + "\n:Guest:40:\n", stderr=""),
        ]
        with patch("control_agent._run", side_effect=responses) as run:
            result = wifi_scan()

        self.assertTrue(result["ok"])
        self.assertEqual(result["device"], "wlan0")
        self.assertEqual([network["ssid"] for network in result["networks"]], ["Hangar: West", "Guest"])
        self.assertEqual(run.call_args_list[2].args[0], ["nmcli", "--wait", "12", "device", "wifi", "rescan", "ifname", "wlan0"])
        self.assertIn("--rescan", run.call_args_list[3].args[0])
        self.assertIn("no", run.call_args_list[3].args[0])

    def test_wifi_scan_recovers_a_disabled_unmanaged_adapter(self):
        responses = [
            Mock(returncode=0, stdout="disabled\n", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout="wlan0:wifi:unmanaged\n", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout="wlan0:wifi:disconnected\n", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout=":Shop:67:WPA2\n", stderr=""),
        ]
        with patch("control_agent._run", side_effect=responses) as run, patch("control_agent.time.sleep"):
            result = wifi_scan()

        self.assertTrue(result["ok"])
        self.assertEqual(result["networks"][0]["ssid"], "Shop")
        self.assertEqual(run.call_args_list[1].args[0], ["nmcli", "radio", "wifi", "on"])
        self.assertEqual(run.call_args_list[3].args[0], ["nmcli", "device", "set", "wlan0", "managed", "yes"])

    def test_wifi_scan_does_not_report_zero_when_the_rescan_failed(self):
        responses = [
            Mock(returncode=0, stdout="enabled\n", stderr=""),
            Mock(returncode=0, stdout="wlan0:wifi:disconnected\n", stderr=""),
            Mock(returncode=10, stdout="", stderr="Scanning not allowed"),
            Mock(returncode=0, stdout="", stderr=""),
        ]
        with patch("control_agent._run", side_effect=responses):
            result = wifi_scan()

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "Scanning not allowed")

    def test_wifi_scan_reports_missing_adapter_instead_of_an_empty_success(self):
        responses = [
            Mock(returncode=0, stdout="enabled\n", stderr=""),
            Mock(returncode=0, stdout="eth0:ethernet:connected\n", stderr=""),
        ]
        with patch("control_agent._run", side_effect=responses):
            result = wifi_scan()

        self.assertFalse(result["ok"])
        self.assertIn("No Wi-Fi adapter", result["error"])

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

    def test_usb_gadget_binding_uses_only_the_prepared_image_and_observed_controller(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gadget = root / "configfs" / "mxgenius"
            udc = root / "udc"
            controller = udc / "pisp_udc"
            image = root / "slot-A.img"
            (gadget / "functions" / "mass_storage.0" / "lun.0").mkdir(parents=True)
            controller.mkdir(parents=True)
            image.write_bytes(b"image")

            with patch("control_agent.Path.symlink_to") as symlink:
                observed = _bind_usb_image(image, gadget_root=gadget, udc_root=udc)

            self.assertEqual(observed, "pisp_udc")
            self.assertEqual((gadget / "UDC").read_text(encoding="utf-8"), "pisp_udc")
            symlink.assert_called_once()
            self.assertEqual(
                (gadget / "functions" / "mass_storage.0" / "lun.0" / "file").read_text(encoding="utf-8"),
                str(image.resolve()),
            )
            self.assertEqual((gadget / "functions" / "mass_storage.0" / "lun.0" / "ro").read_text(), "1")

    def test_usb_gadget_activation_persists_only_after_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "slot-A.img"
            image.write_bytes(b"image")
            state_path = root / "usb-gadget.json"
            with (
                patch("control_agent.USB_GADGET_STATE", state_path),
                patch("control_agent._build_usb_image", return_value=image),
                patch("control_agent._bind_usb_image", return_value="pisp_udc"),
            ):
                result = usb_gadget_activate({
                    "slot": "A",
                    "generation": 3,
                    "versionId": "87913743-0554-4de1-8a38-83f81c84d79e",
                })

            self.assertTrue(result["ok"])
            saved = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["activeSlot"], "A")
            self.assertEqual(saved["generation"], 3)
            self.assertEqual(saved["controller"], "pisp_udc")

    def test_usb_gadget_activation_restores_previous_image_on_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous = root / "slot-A.img"
            candidate = root / "slot-B.img"
            previous.write_bytes(b"previous")
            candidate.write_bytes(b"candidate")
            state_path = root / "usb-gadget.json"
            state_path.write_text(json.dumps({
                "schemaVersion": 1,
                "activeSlot": "A",
                "activeImage": str(previous),
            }), encoding="utf-8")
            binder = Mock(side_effect=[RuntimeError("bind failed"), "pisp_udc"])
            with (
                patch("control_agent.USB_GADGET_STATE", state_path),
                patch("control_agent._build_usb_image", return_value=candidate),
                patch("control_agent._bind_usb_image", new=binder),
                patch("control_agent._unbind_usb_gadget"),
            ):
                with self.assertRaises(RuntimeError):
                    usb_gadget_activate({
                        "slot": "B",
                        "generation": 4,
                        "versionId": "87913743-0554-4de1-8a38-83f81c84d79e",
                    })

            self.assertEqual(binder.call_count, 2)
            self.assertEqual(binder.call_args_list[1].args[0], previous)


if __name__ == "__main__":
    unittest.main()
