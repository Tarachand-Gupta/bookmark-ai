#!/usr/bin/env python3
"""Copy, sign inside out, export and audit a tested macOS archive. Never uploads.

The selected manual ExportOptions profile supplies the certificate allowlist.
Resource bundles outside Contents/Frameworks are explicitly signed: Xcode's
export can otherwise leave their original development signature in place.
"""
import argparse
import base64
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

BUNDLE_SUFFIXES = {'.app', '.bundle', '.framework', '.xpc', '.appex'}
MACHO = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf',
         b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca',
         b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def run(*args):
    result = subprocess.run([str(a) for a in args], capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): '
                           f'{result.stderr.decode(errors="replace")}')
    return result.stdout


def load(path):
    return plistlib.loads(Path(path).read_bytes())


def save(path, value):
    Path(path).write_bytes(plistlib.dumps(value))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def macho(path):
    if not path.is_file():
        return False
    with path.open('rb') as stream:
        return stream.read(4) in MACHO


def targets(app):
    bundles = [p for p in app.rglob('*') if p.is_dir() and p.suffix in BUNDLE_SUFFIXES]
    # Signing executable files separately is harmless; sign containers last.
    binaries = [p for p in app.rglob('*') if not p.is_symlink() and macho(p)]
    return sorted(set(bundles + binaries), key=lambda p: len(p.parts), reverse=True) + [app]


def decode_profile(path):
    return plistlib.loads(run('security', 'cms', '-D', '-i', path))


def profile_for(options, bundle_id):
    selection = options.get('provisioningProfiles', {}).get(bundle_id)
    if not selection:
        raise RuntimeError('Explicit provisioningProfiles entry required')
    roots = [Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles',
             Path.home() / 'Library/MobileDevice/Provisioning Profiles']
    for root in roots:
        for path in sorted(root.glob('*')):
            if path.suffix not in {'.provisionprofile', '.mobileprovision'}:
                continue
            profile = decode_profile(path)
            if selection in {profile.get('UUID'), profile.get('Name')}:
                if profile.get('ProvisionsAllDevices') or profile.get('ProvisionedDevices'):
                    raise RuntimeError('An App Store distribution profile is required')
                if profile.get('TeamIdentifier', [None])[0] != options.get('teamID'):
                    raise RuntimeError('Export team differs from selected profile')
                if profile['Entitlements'].get('com.apple.application-identifier') != f'{options["teamID"]}.{bundle_id}':
                    raise RuntimeError('Selected profile has a different application identifier')
                return path, profile
    raise RuntimeError(f'Installed provisioning profile not found: {selection}')


def identity_for(profile):
    available = run('security', 'find-identity', '-v', '-p', 'codesigning').decode()
    candidates = [hashlib.sha1(c).hexdigest().upper() for c in profile['DeveloperCertificates']]
    matches = [fingerprint for fingerprint in candidates if fingerprint in available]
    if len(matches) != 1:
        raise RuntimeError('Profile must match exactly one usable distribution signing identity')
    return matches[0]


def audit_installer(package_signature, options):
    selected = options.get('installerSigningCertificate', '')
    if not re.fullmatch(r'[0-9A-Fa-f]{40}', selected):
        raise RuntimeError('Select installerSigningCertificate by explicit SHA1 fingerprint')
    certificates = run('security', 'find-certificate', '-a', '-p').decode()
    matching = []
    for encoded in re.findall(r'-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----', certificates):
        certificate = base64.b64decode(encoded)
        if hashlib.sha1(certificate).hexdigest().upper() == selected.upper():
            matching.append(certificate)
    if not matching:
        raise RuntimeError('Selected installer certificate not found')
    fingerprint = re.search(r'SHA256 Fingerprint:\s*([\s\S]*?)\s*-{5}', package_signature)
    if not fingerprint:
        raise RuntimeError('Installer has no certificate fingerprint')
    observed = ''.join(re.findall(r'\b[0-9A-Fa-f]{2}\b', fingerprint.group(1))).upper()
    if observed != hashlib.sha256(matching[0]).hexdigest().upper():
        raise RuntimeError('Installer signer differs from explicit export certificate')
    return {'pass': True, 'selectedInstallerSHA1': selected.upper(), 'observedInstallerSHA256': observed}


def entitlements(path):
    raw = run('codesign', '-d', '--entitlements', ':-', path)
    return plistlib.loads(raw) if raw else {}


def audit(app, profile, report):
    allowed = [hashlib.sha1(c).hexdigest().upper() for c in profile['DeveloperCertificates']]
    entries = []
    with tempfile.TemporaryDirectory() as temporary:
        for index, target in enumerate(targets(app)):
            prefix = Path(temporary) / f'cert-{index}-'
            run('codesign', '-d', f'--extract-certificates={prefix}', target)
            leaf = Path(str(prefix) + '0')
            if not leaf.exists():
                raise RuntimeError(f'Missing certificate (unsigned/ad-hoc): {target}')
            signer = hashlib.sha1(leaf.read_bytes()).hexdigest().upper()
            entry = {'path': str(target.relative_to(app)), 'signerSHA1': signer,
                     'matchesProfile': signer in allowed}
            entries.append(entry)
            if signer not in allowed:
                report.write_text(json.dumps({'pass': False, 'targets': entries}, indent=2) + '\n')
                raise RuntimeError(f'Signer outside provisioning profile: {target} ({signer})')
            run('codesign', '--verify', '--strict', '--verbose=2', target)
            entry['strictSignatureValid'] = True
    run('codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
    actual = decode_profile(app / 'Contents/embedded.provisionprofile')
    if actual['UUID'] != profile['UUID']:
        raise RuntimeError('Embedded profile differs from selected profile')
    signed = entitlements(app)
    for key in ['com.apple.application-identifier', 'com.apple.developer.team-identifier']:
        if signed.get(key) != profile['Entitlements'].get(key):
            raise RuntimeError(f'Host profile entitlement mismatch: {key}')
    if signed.get('com.apple.security.get-task-allow'):
        raise RuntimeError('Debug entitlement present in release')
    result = {'pass': True, 'profileUUID': profile['UUID'], 'allowedCertificateSHA1': allowed,
              'allSignersMatchProfile': True, 'deepStrictSignatureValid': True, 'targets': entries}
    report.write_text(json.dumps(result, indent=2) + '\n')
    return result


def normalized_payload(app):
    result = {}
    with tempfile.TemporaryDirectory() as temporary:
        for path in sorted(app.rglob('*')):
            relative = path.relative_to(app)
            if '_CodeSignature' in relative.parts or relative == Path('Contents/embedded.provisionprofile'):
                continue
            if path.is_symlink():
                result[str(relative)] = {'symlink': str(path.readlink())}
            elif path.is_file():
                data = path.read_bytes()
                if relative == Path('Contents/Info.plist'):
                    value = plistlib.loads(data)
                    value.pop('CFBundleVersion', None)
                    data = plistlib.dumps(value, sort_keys=True)
                elif macho(path):
                    unsigned = Path(temporary) / 'executable'
                    shutil.copy2(path, unsigned)
                    run('codesign', '--remove-signature', unsigned)
                    data = unsigned.read_bytes()
                result[str(relative)] = sha(data)
    return result


def compare_payload(original, repaired, report):
    before, after = normalized_payload(original), normalized_payload(repaired)
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    result = {'pass': not changed, 'changedOutsideAllowedMetadataAndSignatures': changed,
              'allowedChanges': ['Code signature records', 'embedded.provisionprofile', 'host CFBundleVersion'],
              'original': before, 'repaired': after}
    report.write_text(json.dumps(result, indent=2) + '\n')
    if changed:
        raise RuntimeError(f'Unexpected payload change: {changed}')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--export-options', type=Path, required=True)
    parser.add_argument('--build', help='Optional numeric build bump; compiled code is preserved')
    parser.add_argument('--audit-app', type=Path, help='Audit only; does not sign/export')
    args = parser.parse_args()
    options = load(args.export_options)
    if options.get('destination') != 'export' or options.get('method') != 'app-store-connect' or options.get('signingStyle') != 'manual':
        raise RuntimeError('Manual app-store-connect export options with destination=export required')
    if options.get('manageAppVersionAndBuildNumber') is not False:
        raise RuntimeError('Disable automatic export version management')
    args.output_dir = args.output_dir.resolve()
    if not args.audit_app:
        if not args.archive or not args.archive.is_dir():
            raise RuntimeError('--archive must be an existing tested .xcarchive')
        original = args.archive.resolve()
        if args.output_dir.is_relative_to(original):
            raise RuntimeError('Output must be outside the original archive')
    if args.audit_app:
        info = load(args.audit_app / 'Contents/Info.plist')
        _, profile = profile_for(options, info['CFBundleIdentifier'])
        args.output_dir.mkdir(parents=True, exist_ok=False)
        audit(args.audit_app, profile, args.output_dir / 'audit.json')
        print(f'Audit passed: {args.output_dir}')
        return
    archive = args.output_dir / original.name
    source_info = load(original / 'Info.plist')
    original_app = original / 'Products' / source_info['ApplicationProperties']['ApplicationPath']
    app_info = load(original_app / 'Contents/Info.plist')
    profile_path, profile = profile_for(options, app_info['CFBundleIdentifier'])
    identity = identity_for(profile)
    if args.build:
        if not args.build.isdigit() or int(args.build) <= int(app_info['CFBundleVersion']):
            raise RuntimeError('Build must be numeric and higher than original archive')
        archive = args.output_dir / f'{original.stem.rsplit("-", 1)[0]}-{args.build}.xcarchive'
    args.output_dir.mkdir(parents=True, exist_ok=False)
    run('ditto', original, archive)
    app = archive / 'Products' / source_info['ApplicationProperties']['ApplicationPath']
    if args.build:
        app_info['CFBundleVersion'] = args.build
        source_info['ApplicationProperties']['CFBundleVersion'] = args.build
        save(app / 'Contents/Info.plist', app_info)
    source_info['ApplicationProperties']['SigningIdentity'] = 'Apple Distribution'
    source_info['ApplicationProperties']['Team'] = options['teamID']
    save(archive / 'Info.plist', source_info)
    shutil.copy2(profile_path, app / 'Contents/embedded.provisionprofile')
    scratch = args.output_dir / 'signing'
    scratch.mkdir()
    for index, target in enumerate(targets(app)):
        if target.suffix in {'.appex', '.xpc'} or (target != app and target.suffix == '.app'):
            raise RuntimeError('Nested processes require explicit separate provisioning profiles; unsupported')
        signed = entitlements(target)
        signed.pop('com.apple.security.get-task-allow', None)
        if target == app:
            for key in ['com.apple.application-identifier', 'com.apple.developer.team-identifier']:
                signed[key] = profile['Entitlements'][key]
        elif any(k in signed for k in ['com.apple.application-identifier', 'keychain-access-groups']):
            raise RuntimeError(f'Nested entitlements require separate profile validation: {target}')
        command = ['codesign', '--force', '--sign', identity, '--timestamp=none']
        # Preserve main app sandbox and hardened runtime; no entitlements on codeless resources.
        if signed:
            path = scratch / f'entitlements-{index}.plist'
            save(path, signed)
            command += ['--entitlements', path]
        if target == app or macho(target):
            command += ['--options', 'runtime']
        run(*command, target)
    audit(app, profile, args.output_dir / 'archive-signing-audit.json')
    compare_payload(original_app, app, args.output_dir / 'archive-payload-audit.json')
    for path in sorted((original / 'dSYMs').rglob('*')):
        if path.is_file() and sha(path.read_bytes()) != sha((archive / path.relative_to(original)).read_bytes()):
            raise RuntimeError(f'dSYM changed: {path}')
    copied_options = dict(options, signingCertificate=identity)
    save(args.output_dir / 'ExportOptions.plist', copied_options)
    export = args.output_dir / 'export'
    raw = run('xcodebuild', '-exportArchive', '-archivePath', archive, '-exportPath', export,
              '-exportOptionsPlist', args.output_dir / 'ExportOptions.plist')
    (args.output_dir / 'export.log').write_bytes(raw)
    packages = list(export.glob('*.pkg'))
    if len(packages) != 1:
        raise RuntimeError('Export must produce exactly one package')
    package = packages[0]
    package_signature = run('pkgutil', '--check-signature', package).decode()
    (args.output_dir / 'package-signature.txt').write_text(package_signature)
    installer_audit = audit_installer(package_signature, options)
    (args.output_dir / 'installer-signing-audit.json').write_text(json.dumps(installer_audit, indent=2) + '\n')
    expanded = args.output_dir / 'expanded'
    run('pkgutil', '--expand-full', package, expanded)
    apps = [p for p in expanded.rglob(app.name) if p.is_dir() and 'Payload' in p.parts]
    if len(apps) != 1:
        raise RuntimeError('Package must contain exactly one expected app')
    audit(apps[0], profile, args.output_dir / 'package-signing-audit.json')
    compare_payload(original_app, apps[0], args.output_dir / 'package-payload-audit.json')
    summary = {'pass': True, 'archive': str(archive), 'package': str(package),
               'packageSHA256': sha(package.read_bytes()), 'version': app_info['CFBundleShortVersionString'],
               'build': app_info['CFBundleVersion'], 'compiledPayloadPreserved': True,
               'dSYMsPreserved': True, 'allSignersMatchSelectedProfile': True, 'uploaded': False}
    (args.output_dir / 'RESULT.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError) as error:
        raise SystemExit(str(error))
