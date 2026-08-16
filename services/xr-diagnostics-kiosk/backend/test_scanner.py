import unittest

from scanner import normalize_scan_observation


class ScannerContractTests(unittest.TestCase):
    def test_prefixed_part_number_is_candidate_not_verification(self):
        event = normalize_scan_observation(
            {"value": "P/N: 123-ABC", "deviceId": "zebra-1", "transport": "usb-cdc"},
            node_id="pi-1",
            session_id="case-7",
            sequence=3,
        )
        self.assertEqual(event["type"], "scan.observed")
        self.assertEqual(event["normalized"]["partNumber"], "123-ABC")
        self.assertFalse(event["normalized"]["verified"])
        self.assertEqual(len(event["rawSha256"]), 64)

    def test_gs1_lot_and_serial_are_parsed_conservatively(self):
        event = normalize_scan_observation(
            {"rawValue": "(01)00812345678905(10)LOT77(21)SER9"},
            node_id="pi-1",
            session_id=None,
            sequence=1,
        )
        self.assertEqual(event["normalized"]["lotNumber"], "LOT77")
        self.assertEqual(event["normalized"]["serialNumber"], "SER9")

    def test_empty_scan_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_scan_observation({}, node_id="pi-1", session_id=None, sequence=1)


if __name__ == "__main__":
    unittest.main()
