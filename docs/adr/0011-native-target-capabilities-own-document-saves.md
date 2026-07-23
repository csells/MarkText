# Native target capabilities own document saves

Document save durability is implemented behind a small platform-native target
capability, not inferred from portable path strings or a successful JavaScript
`rename` callback. The desktop persistence boundary resolves a requested path
once into an opaque capability anchored to the final destination entry: its
verified parent-directory identity, the filesystem's actual name-equivalence
rules, and an observed target generation. The host-wide `FileTargetRegistry`
uses the resulting stable `FileTargetId`; parser, renderer, and document-core
code never receive a native handle.

The capability is the only authority allowed to create the target-local
temporary entry exclusively, stream and sync encoded bytes, revalidate the
destination while its target lock is held, atomically replace the entry, sync
the containing directory, and inspect the installed entry during ambiguous
rename recovery. Symlink traversal and final-target semantics, case and Unicode
name equivalence, target generations, and stale-directory detection therefore
come from the filesystem backend that performs the operation. A raw path or
current inode is not a substitute: replacement addresses a directory entry,
and two hard-link names intentionally remain distinct targets.

Each supported desktop platform supplies a narrow native backend with explicit
capability and error results. If a platform/filesystem combination cannot prove
the identity, replacement, or durability primitive required by the protocol,
save fails visibly before replacement with a typed unsupported-capability or
stale-target result; it does not claim an atomic or durable save after a weaker
fallback. The versioned persistence ledger records the stable target identity,
generation, hashes, temporary identity, and protocol state, never a process
handle. Recovery reacquires a fresh native capability from that record and
must revalidate the same target before reconciling `rename-unknown`.

This boundary remains deliberately small. Encoding and exact-source leasing
stay in their existing owners; save ordering and crash state stay in the
registry ledger. The native helper supplies only target identity and filesystem
operations whose guarantees cannot be expressed or verified portably. Contract
tests run against the helper on every supported packaged platform, including
aliasing, stale-target, short-write, sync, replacement, and crash-recovery
boundaries.
