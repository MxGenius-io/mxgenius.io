import asyncio
import os
import unittest
from unittest.mock import patch

from diagnostics import DiagnosticsCollector, _configured_probes
from app import Bridge


class DiagnosticsTests(unittest.TestCase):
    def test_snapshot_has_stable_contract(self):
        snapshot = asyncio.run(DiagnosticsCollector().collect())
        self.assertEqual(snapshot["type"], "diagnostics.snapshot")
        self.assertEqual(snapshot["version"], 1)
        self.assertIn("cpu", snapshot)
        self.assertIn("memory", snapshot)
        self.assertIn("storage", snapshot)
        self.assertIn("usb", snapshot)
        self.assertIn("portProbes", snapshot)

    def test_invalid_port_configuration_fails_closed(self):
        with patch.dict(os.environ, {"MXG_DIAGNOSTIC_PORTS": "not-json"}):
            self.assertEqual(_configured_probes(), [])

    def test_remote_summary_reduces_raw_diagnostics(self):
        bridge = Bridge()
        bridge.latest = {
            "timestampMs": 123,
            "status": "nominal",
            "host": {"name": "pi-edge"},
            "cpu": {"usedPercent": 12.5, "temperatureC": 51.0},
            "memory": {"usedPercent": 22.0},
            "storage": {"usedPercent": 33.0},
            "usb": [{"serial": "raw-device-detail"}],
            "serialPorts": ["/dev/ttyUSB0"],
            "portProbes": [{"label": "CAN gateway", "status": "closed", "host": "10.0.0.4"}],
        }
        summary = bridge.compact_summary()
        self.assertEqual(summary["type"], "diagnostics.summary")
        self.assertEqual(summary["findings"][0]["code"], "PORT_UNREACHABLE")
        self.assertEqual(summary["hardware"], {"usbDevices": 1, "serialPorts": 1})
        self.assertNotIn("usb", summary)
        self.assertNotIn("portProbes", summary)


if __name__ == "__main__":
    unittest.main()
