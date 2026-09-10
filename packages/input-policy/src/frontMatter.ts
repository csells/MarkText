export interface FrontMatterPolicy {
  readonly lang: 'yaml' | 'toml' | 'json'
  readonly style: '-' | '+' | ';' | '{'
  readonly open: string
  readonly close: string
}

/** Existing MarkText preference spelling, without document parsing or EOL policy. */
export function frontMatterPolicy(type: string): FrontMatterPolicy {
  switch (type) {
    case '+': return { lang: 'toml', style: '+', open: '+++', close: '+++' }
    case ';': return { lang: 'json', style: ';', open: ';;;', close: ';;;' }
    case '{': return { lang: 'json', style: '{', open: '{', close: '}' }
    default: return { lang: 'yaml', style: '-', open: '---', close: '---' }
  }
}
