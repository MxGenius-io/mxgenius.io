import unittest

from integration_fixtures import simulated_integrations


class IntegrationFixtureTests(unittest.TestCase):
    def test_low_hanging_provider_shapes_are_explicitly_synthetic(self):
        payload = simulated_integrations()
        rows = payload["integrations"]
        self.assertEqual({row["provider"] for row in rows}, {"aviationweather", "partsbase", "honeywell-forge"})
        for row in rows:
            self.assertNotEqual(row["mode"], "live")
            self.assertEqual(row["sample"]["status"], "fixture")
            self.assertTrue(row["sample"]["source"]["reference"].startswith("fixture://"))
            self.assertIsNone(row["sample"]["operationalConclusion"])

    def test_credentials_are_not_modeled_as_fixture_fields(self):
        serialized = str(simulated_integrations()).lower()
        self.assertNotIn("password", serialized)
        self.assertNotIn("api_key", serialized)
        self.assertNotIn("access_token", serialized)


if __name__ == "__main__":
    unittest.main()
