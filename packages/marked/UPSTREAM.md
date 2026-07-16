# Upstream provenance

This private workspace fork is based on
[Marked](https://github.com/markedjs/marked) tag `v18.0.5`, commit
`4063c638cb621c09091d41b26f323ff074416bb9`.

`FORK_MANIFEST.json` pins the reviewed upstream Git objects, complete local file
inventory, fork version, consumer versions, and exact source classifications.
The canonical patch under `patches/` is the complete reviewable delta for the
vendored surface: upstream `src/`, `LICENSE`, and `package.json`, plus this local
provenance document.

Run the offline verifier from the repository root after changing the fork:

```sh
node packages/marked/scripts/verify-fork.mjs --self-test
```

The verifier reverses the patch, authenticates the reconstructed upstream source
tree and blobs, reapplies the patch, and requires a byte-exact round trip. Its
self-test runs one negative control per recorded drift class in temporary
copies: an unrecorded source edit, fork-version drift, a decoy consumer
importer masking broken Muya lock wiring, a manifest that reclassifies a
modified file as unchanged, and a corrupted canonical patch. It does not fetch
from the network.

## Updating the fork

1. Check out the manifest's exact upstream commit in a separate clean directory.
2. Rebuild the canonical patch from the upstream vendored surface to the complete
   local vendored surface; never handwave or omit a changed parser file.
3. Recompute every manifest classification and object identifier.
4. Increment the `marktext.N` suffix after a previously reviewed fork version has
   shipped. Work on one unreleased fork version may update its patch in place.
5. Run the verifier self-test, Muya typecheck/unit suites, and CommonMark/GFM
   conformance suites before review.

Keep Marked changes bounded to `packages/marked` and limited to MarkText parser
needs or provenance maintenance. Preserve upstream attribution and fail loudly
when the recorded delta or consumer contract differs.
