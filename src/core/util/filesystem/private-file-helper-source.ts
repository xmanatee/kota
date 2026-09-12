/** Linux-only credential publication. Never write bytes through a named inode. */
export const PRIVATE_FILE_HELPER_SOURCE = String.raw`
import ctypes, json, os, secrets, stat, sys

def refuse(reason):
    raise ValueError(reason)

def fingerprint(info):
    return ':'.join(str(value) for value in (info.st_dev, info.st_ino,
        info.st_size, info.st_mtime_ns, info.st_ctime_ns))

def target_snapshot(parent, name):
    try:
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        refuse('target must be a regular single-link file')
    return fingerprint(info)

def execute(request):
    if sys.platform != 'linux' or os.geteuid() == 0 or os.getuid() != os.geteuid():
        refuse('requires an unprivileged Linux runtime')
    with open('/proc/self/status', encoding='ascii') as status:
        capabilities = dict(line.split(':', 1) for line in status if ':' in line)
    if any(int(capabilities[key].strip(), 16) != 0 for key in ('CapEff', 'CapPrm', 'CapAmb')):
        refuse('requires a runtime without Linux capabilities')
    # Privileged host administrators are the trust anchor, never a competing
    # agent writer. Linux POSIX ACL write grants are included in the group mask.
    if not hasattr(os, 'O_TMPFILE'):
        refuse('requires Linux anonymous temporary files')
    path = request['path']
    if not isinstance(path, str) or not path.startswith('/') or '\x00' in path:
        refuse('invalid absolute target')
    parts = path.split('/')[1:]
    if not parts or any(part in ('', '.', '..') for part in parts):
        refuse('target must have canonical path components')
    roots = request['roots']
    if not isinstance(roots, list) or not all(isinstance(root, str) for root in roots):
        refuse('invalid write roots')
    if not any(path.startswith(root.rstrip('/') + '/') for root in roots):
        refuse('target is outside the declared write roots')
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = None
    staged = None
    try:
        # Every directory controlling the next component must be immutable to
        # unprivileged writers. In particular, the destination directory cannot
        # be renamed, even by its owner. No realpath/check/write race is relied on.
        for part in parts[:-1]:
            info = os.fstat(parent)
            if info.st_uid != 0 or info.st_mode & 0o022:
                refuse('an ancestor permits root or staging-directory relocation')
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        name = parts[-1]
        before = target_snapshot(parent, name)
        if request['operation'] == 'prepare':
            # Probe support before the caller collects credentials. An anonymous
            # empty inode disappears at close and creates no pathname to race.
            temporary = os.open('.', os.O_RDWR | os.O_TMPFILE, 0o600, dir_fd=parent)
            return {'ok': True, 'snapshot': before}
        if request['operation'] != 'publish' or before != request['snapshot']:
            refuse('target changed before publication')
        content = request['content'].encode('utf-8')
        temporary = os.open('.', os.O_RDWR | os.O_TMPFILE, 0o600, dir_fd=parent)
        os.fchmod(temporary, 0o600)
        remaining = memoryview(content)
        while remaining:
            written = os.write(temporary, remaining)
            if written <= 0:
                refuse('anonymous write failed')
            remaining = remaining[written:]
        os.fsync(temporary)
        if os.fstat(temporary).st_nlink != 0:
            refuse('staging inode is no longer anonymous')
        if target_snapshot(parent, name) != before:
            refuse('target changed during anonymous staging')
        # linkat follows only our own proc descriptor. Both destination operations
        # use the same non-relocatable directory; neither follows a target link.
        libc = ctypes.CDLL(None, use_errno=True)
        linkat = libc.linkat
        linkat.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        linkat.restype = ctypes.c_int
        staged = '.kota-private-' + secrets.token_hex(24)
        source = ('/proc/self/fd/' + str(temporary)).encode()
        if linkat(-100, source, parent, staged.encode(), 0x400) != 0:
            staged = None
            refuse('anonymous publication is unavailable')
        installed = os.stat(staged, dir_fd=parent, follow_symlinks=False)
        original = os.fstat(temporary)
        if (installed.st_dev, installed.st_ino) != (original.st_dev, original.st_ino):
            refuse('staged entry changed')
        os.replace(staged, name, src_dir_fd=parent, dst_dir_fd=parent)
        staged = None
        # There are deliberately no data writes or chmods after the inode gains
        # a name. Moving a published file cannot redirect a later privileged write.
        os.fsync(parent)
        return {'ok': True, 'snapshot': None}
    finally:
        if staged is not None:
            try:
                os.unlink(staged, dir_fd=parent)
            except FileNotFoundError:
                pass
        if temporary is not None:
            os.close(temporary)
        os.close(parent)

try:
    result = execute(json.load(sys.stdin))
except ValueError as error:
    result = {'ok': False, 'reason': str(error)}
except Exception:
    # Never put credential bytes, source snippets or raw OS diagnostics in output.
    result = {'ok': False, 'reason': 'private filesystem operation failed'}
sys.stdout.write(json.dumps(result))
`;
