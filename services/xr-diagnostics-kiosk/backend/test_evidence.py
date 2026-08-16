import json
import unittest

from evidence import EvidenceChain, canonical_json_bytes, sha256_hex


SOURCE = {
    "kind": "thermal",
    "model": "FLIR ONE Pro for Android (USB-C)",
    "devicePseudonym": "quest-camera-a1",
    "softwareVersion": "0.1.0-poc",
    "calibrationState": "self-check-only",
    "calibrationValidThrough": None,
}


class EvidenceTests(unittest.TestCase):
    def test_canonical_bytes_do_not_depend_on_input_key_order(self):
        self.assertEqual(canonical_json_bytes({"b": 2, "a": 1}), canonical_json_bytes({"a": 1, "b": 2}))

    def test_observations_form_a_deterministic_hash_chain(self):
        chain = EvidenceChain("session-1")
        first, first_bytes = chain.observe(
            raw_payload=b"frame-one",
            source=SOURCE,
            condition_result="inconclusive",
            measurements={"maximum": {"value": "31115", "unit": "centikelvin"}},
            limitations=["Camera path has not completed reference calibration."],
            observed_at_ms=1000,
            observation_id="obs-1",
        )
        second, _ = chain.observe(
            raw_payload=b"frame-two",
            source=SOURCE,
            condition_result="does-not-reproduce",
            measurements={"maximum": {"value": "30115", "unit": "centikelvin"}},
            limitations=["The reported condition may be intermittent."],
            observed_at_ms=2000,
            observation_id="obs-2",
        )
        self.assertEqual(first["sequence"], 1)
        self.assertEqual(second["sequence"], 2)
        self.assertEqual(second["integrity"]["previousEventSha256"], first["integrity"]["eventSha256"])
        self.assertEqual(json.loads(first_bytes)["observationId"], "obs-1")

    def test_mutating_payload_changes_payload_hash(self):
        self.assertNotEqual(sha256_hex(b"frame-one"), sha256_hex(b"frame-One"))

    def test_non_neutral_result_is_rejected(self):
        with self.assertRaises(ValueError):
            EvidenceChain("session-1").observe(
                raw_payload=b"frame",
                source=SOURCE,
                condition_result="reporter-deceptive",
                measurements={},
                limitations=["No motive can be inferred from sensor data."],
            )


if __name__ == "__main__":
    unittest.main()
