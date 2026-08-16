import json
import unittest
from pathlib import Path

from edge_schema import StateDeltaEncoder, normalize_snapshot


def sample(cpu=10.0, port_status="open"):
    return {
        "timestampMs": 1000,
        "status": "nominal",
        "host": {"name": "pi-edge", "platform": "linux", "machine": "aarch64", "uptimeSeconds": 50},
        "cpu": {"usedPercent": cpu, "temperatureC": 48.5, "loadAverage": [0.1, 0.2, 0.3]},
        "memory": {"usedPercent": 20.0},
        "storage": {"usedPercent": 30.0},
        "network": [{"name": "eth0", "state": "up", "rxBytes": 10, "txBytes": 20}],
        "usb": [],
        "serialPorts": ["/dev/ttyUSB0"],
        "portProbes": [{"label": "CAN gateway", "host": "127.0.0.1", "port": 9000, "status": port_status, "latencyMs": 2.5}],
    }


class EdgeSchemaTests(unittest.TestCase):
    def test_normalized_state_is_keyed_for_vr_rendering(self):
        state = normalize_snapshot(sample(), node_id="pi-edge", session_id="session-1", sequence=1)
        self.assertEqual(state["type"], "diagnostics.state")
        self.assertEqual(state["metrics"]["cpu.temperature"]["unit"], "celsius")
        self.assertEqual(state["transports"]["probe:CAN gateway"]["status"], "online")
        self.assertEqual(state["findings"], {})

    def test_delta_contains_only_changed_fields(self):
        encoder = StateDeltaEncoder("pi-edge")
        first = encoder.update(sample(), "session-1")
        delta = encoder.update(sample(cpu=35.0, port_status="closed"), "session-1")
        self.assertEqual(first["type"], "diagnostics.state")
        self.assertEqual(delta["type"], "diagnostics.delta")
        paths = {operation["path"] for operation in delta["operations"]}
        self.assertIn("/metrics/cpu.utilization/value", paths)
        self.assertIn("/transports/probe:CAN gateway/status", paths)
        self.assertTrue(any(path.startswith("/findings/") for path in paths))
        self.assertNotIn("/metrics/memory.utilization/value", paths)

    def test_contract_file_is_valid_json(self):
        contract = Path(__file__).resolve().parent.parent / "contracts" / "diagnostics-state.schema.json"
        schema = json.loads(contract.read_text())
        self.assertEqual(schema["$defs"]["state"]["properties"]["type"]["const"], "diagnostics.state")
        layout = schema["x-mxg-xr-layout"]
        self.assertEqual(layout["surface"], "sensor-diagnostics")
        self.assertEqual(
            [row["id"] for row in layout["panel"]["rows"]],
            ["node", "posture", "cpu", "memory", "storage", "load", "transports", "findings"],
        )

    def test_remote_witness_contract_requires_wearer_consent(self):
        contract = Path(__file__).resolve().parent.parent / "contracts" / "remote-witness-session.schema.json"
        schema = json.loads(contract.read_text())
        request = schema["$defs"]["request"]["allOf"][1]
        self.assertEqual(request["properties"]["wearerInitiated"]["const"], True)
        self.assertIn("recordingRequested", request["required"])

    def test_evidence_contract_uses_neutral_condition_results(self):
        contract = Path(__file__).resolve().parent.parent / "contracts" / "diagnostic-evidence.schema.json"
        schema = json.loads(contract.read_text())
        results = schema["properties"]["conditionResult"]["enum"]
        self.assertEqual(
            results,
            ["supports-reported-condition", "does-not-reproduce", "inconclusive", "not-evaluated"],
        )
        self.assertNotIn("fraud", json.dumps(schema).lower())

    def test_xr_gateway_contract_requires_wss_and_evidence_ack(self):
        contract = Path(__file__).resolve().parent.parent / "contracts" / "xr-session-gateway.schema.json"
        schema = json.loads(contract.read_text())
        self.assertEqual(schema["$defs"]["negotiateResponse"]["properties"]["bridgeUrl"]["pattern"], "^wss://")
        self.assertEqual(schema["$defs"]["negotiateResponse"]["properties"]["companionBridgeUrl"]["pattern"], "^wss://")
        self.assertEqual(schema["$defs"]["evidenceAck"]["properties"]["type"]["const"], "evidence.ack")

    def test_sensor_companion_contract_separates_activation_presence_and_camera_status(self):
        contract = Path(__file__).resolve().parent.parent / "contracts" / "sensor-companion.schema.json"
        schema = json.loads(contract.read_text())
        self.assertEqual(schema["$defs"]["announce"]["properties"]["nodeType"]["const"], "quest-companion")
        self.assertEqual(schema["$defs"]["announce"]["properties"]["capabilities"]["contains"]["const"], "flir-one-pro-usb-c")
        self.assertIn("permission-denied", schema["$defs"]["sourceStatus"]["properties"]["status"]["enum"])


if __name__ == "__main__":
    unittest.main()
