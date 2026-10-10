"""Regression tests for the signing gate. No keys, network, signing or app launch."""
import hashlib
import base64
import importlib.util
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('distribution', Path(__file__).with_name('export-app-store.py'))
distribution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(distribution)


class SigningGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = self.root / 'App.app'
        self.bundle = self.app / 'Contents/Resources/Crypto.bundle'
        self.bundle.mkdir(parents=True)
        (self.app / 'Contents/embedded.provisionprofile').write_bytes(b'fixture profile')
        self.leaf = b'fixture distribution certificate'
        self.profile = {'UUID': 'fixture', 'DeveloperCertificates': [self.leaf], 'Entitlements': {
            'com.apple.application-identifier': 'TEAM.app', 'com.apple.developer.team-identifier': 'TEAM'}}
        self.signed = dict(self.profile['Entitlements'], **{'com.apple.security.app-sandbox': True})
        self.report = self.root / 'audit.json'

    def fake_run(self, *args):
        if args[0] == 'codesign' and '--entitlements' in args:
            return plistlib.dumps(self.signed)
        for arg in args:
            if str(arg).startswith('--extract-certificates='):
                prefix = str(arg).split('=', 1)[1]
                Path(prefix + '0').write_bytes(self.leaf)
        return b''

    def audit(self, fake=None):
        with patch.object(distribution, 'run', side_effect=fake or self.fake_run), \
             patch.object(distribution, 'decode_profile', return_value=self.profile):
            return distribution.audit(self.app, self.profile, self.report)

    def test_every_resource_bundle_must_match_profile(self):
        def mismatch(*args):
            result = self.fake_run(*args)
            if args[-1] == self.bundle:
                prefix = next(str(a).split('=', 1)[1] for a in args if str(a).startswith('--extract-certificates='))
                Path(prefix + '0').write_bytes(b'fixture development certificate')
            return result
        with self.assertRaisesRegex(RuntimeError, 'Signer outside provisioning profile'):
            self.audit(mismatch)

    def test_unsigned_resource_bundle_is_rejected(self):
        def unsigned(*args):
            if args[-1] == self.bundle:
                return b''
            return self.fake_run(*args)
        with self.assertRaisesRegex(RuntimeError, 'Missing certificate'):
            self.audit(unsigned)

    def test_strict_validation_failure_is_rejected(self):
        def invalid(*args):
            if '--verify' in args and args[-1] == self.bundle:
                raise RuntimeError('strict signature invalid')
            return self.fake_run(*args)
        with self.assertRaisesRegex(RuntimeError, 'strict signature invalid'):
            self.audit(invalid)

    def test_debug_entitlement_is_rejected(self):
        self.signed['com.apple.security.get-task-allow'] = True
        with self.assertRaisesRegex(RuntimeError, 'Debug entitlement'):
            self.audit()

    def test_profile_application_identity_must_match_host(self):
        self.signed['com.apple.application-identifier'] = 'OTHER.app'
        with self.assertRaisesRegex(RuntimeError, 'Host profile entitlement mismatch'):
            self.audit()

    def test_valid_host_and_resource_are_all_audited(self):
        result = self.audit()
        self.assertTrue(result['pass'])
        self.assertEqual(len(result['targets']), 2)
        self.assertTrue(all(t['strictSignatureValid'] for t in result['targets']))

    def test_identity_is_derived_from_profile_and_usable_key(self):
        allowed = hashlib.sha1(self.leaf).hexdigest().upper()
        with patch.object(distribution, 'run', return_value=f'1) {allowed} "Apple Distribution"'.encode()):
            self.assertEqual(distribution.identity_for(self.profile), allowed)

    def test_identity_requires_usable_matching_key(self):
        with patch.object(distribution, 'run', return_value=b'0 valid identities found'):
            with self.assertRaisesRegex(RuntimeError, 'exactly one usable'):
                distribution.identity_for(self.profile)


class PayloadGateTests(unittest.TestCase):
    def test_only_build_and_signature_metadata_are_ignored(self):
        with tempfile.TemporaryDirectory() as temporary:
            a, b = [Path(temporary) / name for name in ['before.app', 'after.app']]
            for app, build in [(a, '8'), (b, '9')]:
                (app / 'Contents/Resources').mkdir(parents=True)
                distribution.save(app / 'Contents/Info.plist', {'CFBundleVersion': build, 'CFBundleIdentifier': 'app'})
                (app / 'Contents/Resources/resource.txt').write_text('unchanged tested resource')
                (app / 'Contents/_CodeSignature').mkdir()
                (app / 'Contents/_CodeSignature/CodeResources').write_text(build)
            self.assertEqual(distribution.normalized_payload(a), distribution.normalized_payload(b))
            (b / 'Contents/Resources/resource.txt').write_text('regression')
            with self.assertRaisesRegex(RuntimeError, 'Unexpected payload change'):
                distribution.compare_payload(a, b, Path(temporary) / 'payload.json')


class InstallerGateTests(unittest.TestCase):
    def setUp(self):
        self.leaf = b'fixture installer certificate'
        self.options = {'installerSigningCertificate': hashlib.sha1(self.leaf).hexdigest().upper()}
        self.pem = b'-----BEGIN CERTIFICATE-----\n' + base64.b64encode(self.leaf) + b'\n-----END CERTIFICATE-----'

    def signature(self, leaf):
        return 'SHA256 Fingerprint:\n' + ' '.join(f'{byte:02X}' for byte in hashlib.sha256(leaf).digest()) + '\n----------'

    def test_selected_installer_matches(self):
        with patch.object(distribution, 'run', return_value=self.pem):
            self.assertTrue(distribution.audit_installer(self.signature(self.leaf), self.options)['pass'])

    def test_other_installer_is_rejected(self):
        with patch.object(distribution, 'run', return_value=self.pem):
            with self.assertRaisesRegex(RuntimeError, 'Installer signer differs'):
                distribution.audit_installer(self.signature(b'other certificate'), self.options)

    def test_unsigned_installer_is_rejected(self):
        with patch.object(distribution, 'run', return_value=self.pem):
            with self.assertRaisesRegex(RuntimeError, 'no certificate fingerprint'):
                distribution.audit_installer('Status: unsigned', self.options)


class OutputGuardTests(unittest.TestCase):
    def test_output_inside_source_archive_is_rejected_without_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'tested.xcarchive'
            archive.mkdir()
            options = Path(temporary) / 'options.plist'
            distribution.save(options, {'destination': 'export', 'method': 'app-store-connect',
                                        'signingStyle': 'manual', 'manageAppVersionAndBuildNumber': False})
            output = archive / 'unexpected'
            result = subprocess.run([sys.executable, str(Path(distribution.__file__)),
                                     '--archive', str(archive), '--output-dir', str(output),
                                     '--export-options', str(options)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('outside the original archive', result.stderr)
            self.assertFalse(output.exists())
            self.assertEqual(list(archive.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
