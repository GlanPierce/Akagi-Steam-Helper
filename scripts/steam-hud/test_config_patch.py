import unittest
from config_patch import enable, restore
import tomllib

class ConfigPatchTests(unittest.TestCase):
    def test_enable_preserves_models_secrets_and_other_sections(self):
        text = '# keep\n[bot]\ndefault = "local"\n[overlay]\nenabled = false # old\nopacity = 0.9\n[overlay.calibration]\nx = 0.12\n[api]\ntoken = "test-only-secret"\n'
        result = enable(text)
        before, after = tomllib.loads(text), tomllib.loads(result)
        self.assertEqual(before['api'], after['api'])
        self.assertEqual(before['bot'], after['bot'])
        self.assertEqual(after['overlay']['calibration'], {'x': .12})
        self.assertTrue(after['overlay']['enabled'])
        self.assertTrue(after['overlay']['immersive'])
        self.assertIn('# keep', result)

    def test_rollback_preserves_subsequent_model_changes(self):
        old = '[bot]\ndefault = "old"\n[overlay]\nenabled = false\n[api]\ntoken = "old-token"\n'
        current = enable(old).replace('"old"', '"new"').replace('"old-token"', '"new-token"')
        value = tomllib.loads(restore(current, old))
        self.assertEqual(value['bot']['default'], 'new')
        self.assertEqual(value['api']['token'], 'new-token')
        self.assertEqual(value['overlay'], {'enabled': False})

    def test_first_overlay_and_bad_config(self):
        self.assertTrue(tomllib.loads(enable('[bot]\nenabled = true\n'))['overlay']['immersive'])
        with self.assertRaises(ValueError):
            enable('[broken')

if __name__ == '__main__':
    unittest.main()
