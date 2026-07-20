# Canonical source is lossless

The parser core preserves the exact decoded canonical source, including a
leading U+FEFF retained from a file BOM, line-ending style, blank lines,
terminal-EOL absence, CriticMarkup spelling, escapes, and untouched trivia. The
desktop snapshot records whether that leading unit came from an encoding
signature. Edited saves disable automatic BOM emission and encode the canonical
units exactly, so the retained U+FEFF is neither duplicated nor dropped. Opening
and saving without an edit is exact. Grammar treats exactly the first source
U+FEFF as virtual BOF trivia by value and position; file-signature provenance
never changes parsing because that distinction cannot survive an independent
plain-file reopen. Later U+FEFF units are ordinary text.

`SourceHashV1` hashes framed exact UTF-16 code units, `FileHashV1` hashes framed
raw bytes, and `RevisionSemanticHashV1` combines the source digest with the full
versioned interpretation/build identity. No hash normalizes Unicode or line
endings. Normalization is permitted only as an explicit document
transformation. This keeps persistence independent of syntax-tree reconstruction
and derived views.
