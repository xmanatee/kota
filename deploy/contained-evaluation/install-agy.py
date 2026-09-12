"""Image-build acquisition from an operator-pinned official Linux manifest entry.
No host binary, login or home is an input. SHA-512 covers the downloaded artifact.
"""
import hashlib
import io
import os
import platform
import re
import subprocess
import sys
import tarfile
import urllib.parse

def verified_linux_binary(payload, digest, architecture):
    if hashlib.sha512(payload).hexdigest() != digest.lower():
        raise ValueError('AGY distribution SHA-512 mismatch')
    if not payload.startswith(b'\x7fELF'):
        with tarfile.open(fileobj=io.BytesIO(payload), mode='r:*') as archive:
            matches = [entry for entry in archive.getmembers() if entry.isfile() and
                       entry.name.rsplit('/', 1)[-1] == 'agy']
            if len(matches) != 1:
                raise ValueError('Official archive must contain one regular agy executable')
            payload = archive.extractfile(matches[0]).read()
    expected_machine = {'x86_64': 62, 'aarch64': 183}.get(architecture)
    if (len(payload) < 20 or payload[:6] != b'\x7fELF\x02\x01' or
            expected_machine is None or int.from_bytes(payload[18:20], 'little') != expected_machine):
        raise ValueError('AGY distribution does not match this Linux image architecture')
    return payload


def main():
    url, digest = sys.argv[1:]
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or
            parsed.password or parsed.query or parsed.fragment or
            not re.fullmatch(r'[a-fA-F0-9]{128}', digest)):
        sys.exit('Provide AGY_LINUX_URL and AGY_LINUX_SHA512 from the official Linux platform manifest; credentials and unpinned downloads are rejected.')
    subprocess.run(['curl', '--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
                    '--max-time', '300', '--output', '/tmp/agy-download', url], check=True)
    with open('/tmp/agy-download', 'rb') as stream:
        payload = verified_linux_binary(stream.read(), digest, platform.machine())
    with open('/usr/local/bin/agy', 'xb') as stream:
        stream.write(payload)
    os.chmod('/usr/local/bin/agy', 0o755)
    os.remove('/tmp/agy-download')
    print('Verified AGY Linux distribution:', url, 'sha512=' + digest.lower())


if __name__ == '__main__':
    main()
