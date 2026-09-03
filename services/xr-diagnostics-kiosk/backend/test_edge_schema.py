import json
import unittest
from copy import deepcopy
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

from edge_schema import StateDeltaEncoder, normalize_snapshot


ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
FIXTURES = ROOT / "fixtures"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


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

    def test_remote_witness_contract_matches_live_bounded_protocol(self):
        schema = load_json(CONTRACTS / "remote-witness-session.schema.json")
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
        fixture_names = [
            "witness-bootstrap.json",
            "witness-bootstrap-ack.json",
            "witness-control-pause.json",
            "witness-signal-offer.json",
            "witness-signal-answer.json",
            "witness-signal-ice.json",
            "witness-android-offer.json",
            "witness-android-ice.json",
            "witness-room-state.json",
            "witness-presence-reconnect.json",
            "witness-error.json",
        ]
        for name in fixture_names:
            validator.validate(load_json(FIXTURES / name))

        self.assertNotIn("remote-witness.", json.dumps(schema))
        self.assertEqual(schema["$defs"]["bootstrap"]["properties"]["type"]["const"], "witness.bootstrap")
        self.assertEqual(schema["$defs"]["bootstrap"]["properties"]["producerCredential"]["$ref"], "#/$defs/credential")
        self.assertEqual(schema["$defs"]["signalMessage"]["properties"]["type"]["const"], "witness.signal")
        self.assertEqual(schema["$defs"]["candidate"]["properties"]["candidate"]["maxLength"], 4096)

        invalid = deepcopy(load_json(FIXTURES / "witness-bootstrap.json"))
        invalid["producerCredential"] = "not-a-credential"
        with self.assertRaises(ValidationError):
            validator.validate(invalid)

        unknown = deepcopy(load_json(FIXTURES / "witness-control-pause.json"))
        unknown["caseId"] = "case-escape"
        with self.assertRaises(ValidationError):
            validator.validate(unknown)

        confused_control = deepcopy(load_json(FIXTURES / "witness-control-pause.json"))
        confused_control["layers"] = {"pov": True}
        with self.assertRaises(ValidationError):
            validator.validate(confused_control)

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
        schema = load_json(CONTRACTS / "sensor-companion.schema.json")
        self.assertEqual(schema["$defs"]["announce"]["properties"]["nodeType"]["const"], "quest-companion")
        self.assertEqual(schema["$defs"]["capabilities"]["contains"]["const"], "flir-one-pro-usb-c")
        self.assertIn("permission-denied", schema["$defs"]["sourceStatus"]["properties"]["status"]["enum"])

    def test_spatial_contract_schemas_and_fixtures(self):
        target_schema = load_json(CONTRACTS / "spatial-target-registry.schema.json")
        command_schema = load_json(CONTRACTS / "spatial-scene-command.schema.json")
        Draft202012Validator.check_schema(target_schema)
        Draft202012Validator.check_schema(command_schema)
        target_validator = Draft202012Validator(target_schema)
        command_validator = Draft202012Validator(command_schema)

        target_fixtures = [
            "spatial-targets-empty.json",
            "spatial-targets-candidates.json",
            "spatial-targets-locked.json",
            "spatial-targets-expired.json",
            "spatial-targets-reconnect.json",
            "spatial-targets-delta.json",
        ]
        command_fixtures = [
            "spatial-command-scan.json",
            "spatial-command-stale-result.json",
        ]
        for name in target_fixtures:
            target_validator.validate(load_json(FIXTURES / name))
        for name in command_fixtures:
            command_validator.validate(load_json(FIXTURES / name))

        locked = load_json(FIXTURES / "spatial-targets-locked.json")
        active = [target for target in locked["targets"] if target["targetId"] == locked["activeTargetId"]]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["state"], "locked")

        expired = load_json(FIXTURES / "spatial-targets-expired.json")
        self.assertLess(expired["targets"][0]["expiresAtMs"], 1780000020000)

        reconnect = load_json(FIXTURES / "spatial-targets-reconnect.json")
        stale_result = load_json(FIXTURES / "spatial-command-stale-result.json")
        self.assertEqual(stale_result["status"], "stale")
        self.assertEqual(stale_result["registryRevision"], reconnect["registryRevision"])

    def test_spatial_contract_rejects_unsafe_shapes(self):
        target_schema = load_json(CONTRACTS / "spatial-target-registry.schema.json")
        command_schema = load_json(CONTRACTS / "spatial-scene-command.schema.json")
        target_validator = Draft202012Validator(target_schema)
        command_validator = Draft202012Validator(command_schema)

        candidates = load_json(FIXTURES / "spatial-targets-candidates.json")
        invalid_id = deepcopy(candidates)
        invalid_id["targets"][0]["targetId"] = "not-namespaced"
        with self.assertRaises(ValidationError):
            target_validator.validate(invalid_id)

        oversized = deepcopy(candidates)
        oversized["targets"] = [deepcopy(candidates["targets"][0]) for _ in range(9)]
        for index, target in enumerate(oversized["targets"]):
            target["targetId"] = f"observation:oversized:candidate-{index}"
        with self.assertRaises(ValidationError):
            target_validator.validate(oversized)

        missing_frame = deepcopy(candidates)
        del missing_frame["targets"][0]["anchor"]["coordinateFrame"]
        with self.assertRaises(ValidationError):
            target_validator.validate(missing_frame)

        command = load_json(FIXTURES / "spatial-command-scan.json")
        unsupported = deepcopy(command)
        unsupported["action"] = "run-arbitrary-code"
        with self.assertRaises(ValidationError):
            command_validator.validate(unsupported)

        lock_without_target = deepcopy(command)
        lock_without_target["action"] = "lock"
        with self.assertRaises(ValidationError):
            command_validator.validate(lock_without_target)

    def test_sensor_companion_schema_matches_snapshot_and_commissioning_protocol(self):
        schema = load_json(CONTRACTS / "sensor-companion.schema.json")
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)

        validator.validate({
            "type": "headset.snapshot.request",
            "requestId": "snapshot_0001",
        })
        validator.validate({
            "type": "headset.snapshot.result",
            "requestId": "snapshot_0001",
            "status": "ok",
            "mimeType": "image/jpeg",
            "width": 1024,
            "height": 1024,
            "eye": "left",
            "capturedAtMs": 1780000000000,
            "dataUrl": "data:image/jpeg;base64,/9j/2Q==",
        })
        validator.validate({
            "type": "headset.snapshot.request",
            "requestId": "snapshot_scan_0001",
            "purpose": "scan",
            "scanId": "scan_contract_0001",
        })
        validator.validate({
            "type": "headset.snapshot.result",
            "requestId": "snapshot_scan_0001",
            "purpose": "scan",
            "scanId": "scan_contract_0001",
            "status": "ok",
            "mimeType": "image/jpeg",
            "width": 1024,
            "height": 1024,
            "eye": "left",
            "capturedAtMs": 1780000000000,
            "camera": {
                "source": "quest-passthrough",
                "eye": "left",
                "poseAvailable": False,
                "intrinsicsAvailable": False,
            },
            "dataUrl": "data:image/jpeg;base64,/9j/2Q==",
        })
        with self.assertRaises(ValidationError):
            validator.validate({
                "type": "headset.snapshot.request",
                "requestId": "snapshot_scan_0002",
                "purpose": "scan",
            })
        validator.validate({
            "type": "commissioning.browser_ack",
            "runId": "run-contract-0001",
            "renderedFrames": 10,
        })
        validator.validate({
            "type": "commissioning.status",
            "schema": "mxg.thermal.commissioning.v1",
            "runId": "run-contract-0001",
            "sessionId": "session-contract-1",
            "phase": "awaiting-browser",
            "result": "running",
            "versionName": "0.1.0-alpha.19",
            "versionCode": 18,
            "startedAtMs": 1780000000000,
            "updatedAtMs": 1780000015000,
            "firstFrameAtMs": 1780000001000,
            "completedAtMs": 0,
            "nativeFrames": 60,
            "transientSkips": 0,
            "maxFrameGapMs": 200,
            "requiredNativeFrames": 60,
            "browserFrames": 0,
            "requiredBrowserFrames": 10,
        })
        capabilities = schema["$defs"]["capabilities"]["items"]["enum"]
        self.assertIn("headset-snapshot", capabilities)
        self.assertIn("thermal-commissioning-v1", capabilities)
        self.assertIn("remote-witness-bootstrap-v1", capabilities)


if __name__ == "__main__":
    unittest.main()
