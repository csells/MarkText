# The engine authors no bytes the user did not type

When the user edits canonical source, MarkText never inserts a character on
their behalf — not to protect a parse, not to keep pasted prose literal, not to
preserve a structure the edit reinterprets. In Source mode the user types
*bytes*, and those exact bytes are what the document holds. Marker-looking text
therefore becomes CriticMarkup wherever it lands, and a user who wants a literal
`{++` escapes it themselves using the language authority's own mechanisms.

This governs canonical-source editing. A projection edit is different in kind:
in Markup mode the user types *text*, not bytes, and the engine must choose
source that means that text. Escaping a delimiter the typed text would otherwise
assemble is encoding, the way `&lt;` encodes a typed `<`, and it is not
authorship — without it two typed characters would silently close an annotation
and restructure a document the user was writing prose into. The test is whose
alphabet the input was in: source bytes are transcribed exactly, projected text
is encoded faithfully.

The tempting alternative is for the engine to insert a backslash when an edit
assembles a delimiter it thinks the user did not intend. Profile 1 §8 E1 does
define backslash escaping, so the mechanism exists and the parse would be
protected. It is rejected because E1 is a MarkText extension: §12 D3 records
that **no reference tool has any escape**, and §8 E2 names the code span as the
only escape that survives the reference tools. A backslash MarkText writes to
defend its own parse is a byte every other CriticMarkup-aware tool reads
differently — which contradicts the product's central promise that a document
"stays portable forever: every CriticMarkup-aware tool reads the same bytes."
The portable alternative, wrapping the text in a code span, would change the
user's meaning outright.

The cost is accepted deliberately: prose containing `{++…++}` sometimes becomes
an annotation the user did not plan, and MarkText will not rescue them from it.
That is the same property that lets a colleague, an external tool, or an AI
propose a change simply by writing CriticMarkup into the text — the interop this
product exists to provide. Protecting users from surprising annotations and
accepting bytes from arbitrary tools are the same mechanism seen from two sides,
and only one of them can win.

Two consequences worth stating. An escape appearing in committed source from a
Source-mode edit is a defect, never a feature. And candidate protection runs
when a projection edit is first admitted — never when history replays an edit
that was already admitted and proved, whose bytes were settled then.
