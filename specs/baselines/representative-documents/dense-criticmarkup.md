# Dense CriticMarkup review

The opening was {~~tentative~>decisive~~}, the evidence is {++now explicit++}, and the obsolete
claim is {--retained only for review--}. This {==high-risk sentence==}{>>Check the citation and the
Unicode boundary 😀 before accepting.<<} keeps all five surface forms in one paragraph.

> A quoted {++addition++} sits beside a {--deletion--} and an isolated comment:
> {>>## Local heading
>
> A local [reference][note] with a nested {==highlight==}.
>
> [note]: https://example.com/review
> <<}

| Item | Proposed change | Reviewer note |
| --- | --- | --- |
| Alpha | {~~old~>new~~} | {>>Verify the substitution.<<} |
| Beta | {++inserted++} | {==Needs review==} |

```markdown
Literal markers stay literal here: {++not an annotation++}
```

Closing text contains adjacent annotations: {++one++}{--two--}{==three==}{>>four<<}.
