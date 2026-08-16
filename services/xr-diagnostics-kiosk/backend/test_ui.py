import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "assets" / "kiosk.js").read_text(encoding="utf-8")
BLUETOOTH_COMPAT = (ROOT / "systemd" / "mxg-bluetooth-compat.conf").read_text(encoding="utf-8")
INSTALL = (ROOT / "install.sh").read_text(encoding="utf-8")
UPDATE = (ROOT / "update.sh").read_text(encoding="utf-8")
BLUETOOTH_STREAM = (ROOT / "backend" / "bluetooth_stream.py").read_text(encoding="utf-8")
DESKTOP_ENTRY = (ROOT / "systemd" / "mxg-diagnostics-kiosk.desktop").read_text(encoding="utf-8")


class KioskUiContractTests(unittest.TestCase):
    def test_canonical_logo_is_packaged_and_used(self):
        logo = ROOT / "frontend" / "assets" / "mxgenius-logo.png"
        self.assertTrue(logo.is_file())
        self.assertGreater(logo.stat().st_size, 1000)
        self.assertIn("/assets/mxgenius-logo.png", HTML)

    def test_peripheral_readiness_profiles_are_visible(self):
        for profile in ("FLIR ONE Pro", "Honeywell Xenon XP 1950g", "Zebra DS3608", "Socket Mobile S740"):
            self.assertIn(profile, HTML)

    def test_commissioning_log_has_filters_export_and_privacy_copy(self):
        for marker in ("id=\"logView\"", "id=\"exportLogs\"", "data-level=\"warning\"", "Raw scanner values are never written"):
            self.assertIn(marker, HTML)
        self.assertIn("Unverified scanner observation received", JS)
        self.assertNotIn("rawValue: event.rawValue", JS)

    def test_normalized_fixture_registry_is_loaded_from_local_bridge(self):
        self.assertIn("/api/v1/integrations/simulated", JS)
        self.assertIn("Normalized API shape previewed", JS)

    def test_bluetooth_serial_profile_enables_the_bluez_compatibility_interface(self):
        self.assertIn("bluetoothd --compat", BLUETOOTH_COMPAT)
        for script in (INSTALL, UPDATE):
            self.assertIn("mxg-bluetooth-compat.conf", script)
            self.assertIn("systemctl restart bluetooth.service", script)
            self.assertIn("scripts", script)
        self.assertIn('getattr(socket, "BDADDR_ANY", "00:00:00:00:00:00")', BLUETOOTH_STREAM)

    def test_kiosk_autostart_uses_a_desktop_entry_safe_exec_line(self):
        exec_line = next(line for line in DESKTOP_ENTRY.splitlines() if line.startswith("Exec="))
        self.assertTrue(exec_line.startswith("Exec=chromium --kiosk "))
        self.assertNotIn("'", exec_line)


if __name__ == "__main__":
    unittest.main()
