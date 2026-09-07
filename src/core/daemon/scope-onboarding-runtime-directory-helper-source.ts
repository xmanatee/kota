/**
 * Darwin's renameatx_np(2) can resolve a complete relative path beneath an
 * open directory and reject every symbolic link in the same syscall that
 * performs the rename. Staging leaves are direct children of the accepted
 * root, so mkdirat(2), inspection, and unlinkat(2) never resolve an
 * attacker-movable intermediate descriptor.
 *
 * Ruby is the smallest system-provided bridge to that syscall on macOS. The
 * TypeScript wrapper fails closed on platforms without this primitive.
 */
export const SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE = `
require "json"
require "fiddle"
require "securerandom"

RUNTIME_DIRECTORIES = [
  ".kota",
  ".kota/runs",
  ".kota/approvals",
  ".kota/dead-letter-queue",
  ".kota/idempotency",
  ".kota/owner-decisions",
  ".kota/owner-questions",
].freeze

O_RDONLY = 0x0000
O_RESOLVE_BENEATH = 0x00001000
O_DIRECTORY = 0x00100000
O_NOFOLLOW_ANY = 0x20000000
AT_FDCWD = -2
AT_REMOVEDIR = 0x80
AT_SYMLINK_NOFOLLOW_ANY = 0x0800
AT_RESOLVE_BENEATH = 0x2000
UNLINK_FLAGS = AT_REMOVEDIR | AT_SYMLINK_NOFOLLOW_ANY | AT_RESOLVE_BENEATH
RENAME_EXCL = 0x00000004
RENAME_NOFOLLOW_ANY = 0x00000010
RENAME_RESOLVE_BENEATH = 0x00000020
RENAME_FLAGS = RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH

LIBC = Fiddle::Handle::DEFAULT
OPENAT = Fiddle::Function.new(
  LIBC["openat"],
  [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT],
  Fiddle::TYPE_INT,
)
MKDIRAT = Fiddle::Function.new(
  LIBC["mkdirat"],
  [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT],
  Fiddle::TYPE_INT,
)
UNLINKAT = Fiddle::Function.new(
  LIBC["unlinkat"],
  [Fiddle::TYPE_INT, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT],
  Fiddle::TYPE_INT,
)
RENAMEATX = Fiddle::Function.new(
  LIBC["renameatx_np"],
  [
    Fiddle::TYPE_INT,
    Fiddle::TYPE_VOIDP,
    Fiddle::TYPE_INT,
    Fiddle::TYPE_VOIDP,
    Fiddle::TYPE_INT,
  ],
  Fiddle::TYPE_INT,
)

class SafeRefusal < StandardError; end

CONFLICT_ERRNOS = [Errno::ELOOP::Errno, Errno::ENOTDIR::Errno]
if Errno.const_defined?(:ENOTCAPABLE)
  CONFLICT_ERRNOS << Errno.const_get(:ENOTCAPABLE)::Errno
end
CONFLICT_ERRNOS.freeze

def refuse(reason)
  raise SafeRefusal, reason
end

def identity(stats)
  { dev: stats.dev, ino: stats.ino }
end

def same_file?(left, right)
  left[:dev] == right[:dev] && left[:ino] == right[:ino]
end

def symbolize_identity(value, field)
  unless value.is_a?(Hash) && value["dev"].is_a?(Integer) &&
      value["ino"].is_a?(Integer) && value["dev"] >= 0 && value["ino"] >= 0
    refuse(field + " is invalid")
  end
  { dev: value["dev"], ino: value["ino"] }
end

def open_directory_at(parent_fd, path)
  flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW_ANY | O_RESOLVE_BENEATH
  fd = OPENAT.call(parent_fd, path, flags)
  return [fd, nil] if fd >= 0
  [nil, Fiddle.last_error]
end

def open_absolute_directory(path)
  flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW_ANY
  fd = OPENAT.call(AT_FDCWD, path, flags)
  return [fd, nil] if fd >= 0
  [nil, Fiddle.last_error]
end

def inspect_directory(root_fd, relative_path)
  fd, error = open_directory_at(root_fd, relative_path)
  if fd.nil?
    return { state: "missing" } if error == Errno::ENOENT::Errno
    return { state: "conflict" } if CONFLICT_ERRNOS.include?(error)
    refuse("runtime directory inspection failed (errno " + error.to_s + ")")
  end
  io = IO.for_fd(fd)
  begin
    stats = io.stat
    return { state: "conflict" } unless stats.directory?
    { state: "directory", identity: identity(stats) }
  ensure
    io.close
  end
end

def atomic_rename(from_fd, from_path, to_fd, to_path)
  result = RENAMEATX.call(from_fd, from_path, to_fd, to_path, RENAME_FLAGS)
  result == 0 ? nil : Fiddle.last_error
end

def remove_empty_directory_at(parent_fd, name)
  result = UNLINKAT.call(parent_fd, name, UNLINK_FLAGS)
  result == 0 ? nil : Fiddle.last_error
end

def fsync_parent(root_fd, relative_path)
  parent_path = File.dirname(relative_path)
  fd, error = open_directory_at(root_fd, parent_path)
  refuse("runtime directory parent changed after mutation") if fd.nil?
  io = IO.for_fd(fd)
  begin
    io.fsync
  ensure
    io.close
  end
end

def ensure_directory(root_fd, mutation)
  relative_path = mutation.fetch("relativePath")
  leaf = inspect_directory(root_fd, relative_path)
  return { outcome: "conflict" } if leaf[:state] == "conflict"
  if leaf[:state] == "directory"
    return {
      outcome: mutation.fetch("expectMissing") ? "unexpected-existing" : "existing",
    }
  end

  outcome = nil
  staging_name = ".kota-runtime-directory-stage-" + SecureRandom.uuid
  result = MKDIRAT.call(root_fd, staging_name, 0o700)
  refuse("staged runtime directory could not be created (errno " + Fiddle.last_error.to_s + ")") unless result == 0
  begin
    staged = inspect_directory(root_fd, staging_name)
    refuse("staged runtime directory could not be verified") unless staged[:state] == "directory"
    staged_identity = staged.fetch(:identity)
    error = atomic_rename(root_fd, staging_name, root_fd, relative_path)
    unless error.nil?
      if error == Errno::EEXIST::Errno
        raced_leaf = inspect_directory(root_fd, relative_path)
        if raced_leaf[:state] == "directory"
          outcome = {
            outcome: mutation.fetch("expectMissing") ? "unexpected-existing" : "existing",
          }
        else
          outcome = { outcome: "conflict" }
        end
      else
        refuse("atomic runtime directory creation was rejected (errno " + error.to_s + ")")
      end
    else
      installed = inspect_directory(root_fd, relative_path)
      unless installed[:state] == "directory" &&
          same_file?(installed.fetch(:identity), staged_identity)
        refuse("created runtime directory identity changed during installation")
      end
      fsync_parent(root_fd, relative_path)
      outcome = { outcome: "created" }
    end
  ensure
    cleanup_error = remove_empty_directory_at(root_fd, staging_name)
    unless cleanup_error.nil? || cleanup_error == Errno::ENOENT::Errno
      refuse("staged runtime directory could not be removed (errno " + cleanup_error.to_s + ")")
    end
  end
  outcome
end

def validate_request(request)
  unless request.is_a?(Hash) && request["operation"] == "ensure" &&
      request["scopeRootPath"].is_a?(String) && request["mutations"].is_a?(Array) &&
      !request["mutations"].empty?
    refuse("runtime-directory filesystem request is invalid")
  end
  symbolize_identity(request["scopeRootIdentity"], "accepted scope root identity")
  request["mutations"].each do |mutation|
    unless mutation.is_a?(Hash) &&
        RUNTIME_DIRECTORIES.include?(mutation["relativePath"]) &&
        mutation["operation"] == request["operation"]
      refuse("runtime-directory filesystem request is invalid")
    end
    refuse("runtime-directory ensure request is invalid") unless [true, false].include?(mutation["expectMissing"])
  end
end

def open_scope_root(request)
  logical_stats = File.lstat(request.fetch("scopeRootPath"))
  expected = symbolize_identity(request.fetch("scopeRootIdentity"), "accepted scope root identity")
  unless logical_stats.directory? && !logical_stats.symlink? &&
      same_file?(identity(logical_stats), expected) &&
      File.realpath(request.fetch("scopeRootPath")) == request.fetch("scopeRootPath")
    refuse("accepted scope root changed during runtime-directory mutation")
  end
  fd, error = open_absolute_directory(request.fetch("scopeRootPath"))
  refuse("accepted scope root could not be anchored (errno " + error.to_s + ")") if fd.nil?
  directory = IO.for_fd(fd)
  unless same_file?(identity(directory.stat), expected)
    directory.close
    refuse("accepted scope root changed while it was opened")
  end
  directory
end

begin
  request = JSON.parse(STDIN.read)
  validate_request(request)
  root = open_scope_root(request)
  begin
    results = request.fetch("mutations").map do |mutation|
      ensure_directory(root.fileno, mutation)
    end
    STDOUT.write(JSON.generate({ ok: true, results: results }))
  ensure
    root.close
  end
rescue SafeRefusal => error
  STDOUT.write(JSON.generate({ ok: false, reason: error.message }))
rescue StandardError => error
  code = error.respond_to?(:errno) ? error.errno.to_s : "unknown"
  STDOUT.write(JSON.generate({
    ok: false,
    reason: "runtime-directory filesystem operation failed (" + code + ")",
  }))
end
`;
