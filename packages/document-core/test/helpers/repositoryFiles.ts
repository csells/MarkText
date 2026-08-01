import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pure-Node replacement for the `rg --files <roots> -g <glob>` enumeration
 * the repository sweeps used. Hosted CI runners ship no ripgrep, and an
 * ambient binary is exactly the dependency class the plan's supply-chain
 * hardening forbids; a walker in the test's own runtime needs neither.
 *
 * Matching mirrors the sweeps' actual usage: a glob without a slash matches
 * the basename anywhere below a root, a glob with a slash (or `**`) matches
 * the cwd-relative path, `{a,b}` alternates expand, and a leading `!`
 * excludes. Ignored directories mirror what ripgrep skipped via gitignore
 * in this repository.
 */
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    'dist',
    'out',
    'coverage',
])

function globToRegExp(glob: string): RegExp {
    let pattern = ''
    for (let index = 0; index < glob.length; index += 1) {
        const character = glob[index] as string
        if (character === '*') {
            if (glob[index + 1] === '*') {
                index += 1
                if (glob[index + 1] === '/') {
                    index += 1
                    pattern += '(?:[^/]+/)*'
                }
                else {
                    pattern += '.*'
                }
            }
            else {
                pattern += '[^/]*'
            }
        }
        else if (character === '{') {
            const end = glob.indexOf('}', index)
            if (end === -1)
                throw new Error(`Unclosed alternate in glob ${glob}`)
            const alternates = glob
                .slice(index + 1, end)
                .split(',')
                .map(alternate =>
                    alternate.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
            pattern += `(?:${alternates.join('|')})`
            index = end
        }
        else if ('.+?^$()|[]\\'.includes(character)) {
            pattern += `\\${character}`
        }
        else {
            pattern += character
        }
    }
    return new RegExp(`^${pattern}$`, 'u')
}

interface CompiledGlob {
    readonly expression: RegExp
    readonly pathwise: boolean
}

function compile(glob: string): CompiledGlob {
    const pathwise = glob.includes('/')
    return Object.freeze({ expression: globToRegExp(glob), pathwise })
}

function matches(compiled: CompiledGlob, relativePath: string): boolean {
    if (compiled.pathwise)
        return compiled.expression.test(relativePath)
    const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1)
    return compiled.expression.test(basename)
}

/**
 * Enumerate files under `roots` (cwd-relative), applying rg-style `-g`
 * globs: positives admit, `!`-prefixed negatives reject. Paths return
 * cwd-relative with forward slashes, sorted for determinism.
 */
export function listRepositoryFiles(
    cwd: string,
    roots: readonly string[],
    globs: readonly string[] = [],
): readonly string[] {
    const positives = globs
        .filter(glob => !glob.startsWith('!'))
        .map(compile)
    const negatives = globs
        .filter(glob => glob.startsWith('!'))
        .map(glob => compile(glob.slice(1)))
    const collected: string[] = []
    const walk = (relativeDirectory: string): void => {
        const absolute = join(cwd, relativeDirectory)
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
            const relativePath = relativeDirectory === ''
                ? entry.name
                : `${relativeDirectory}/${entry.name}`
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name))
                    walk(relativePath)
                continue
            }
            if (!entry.isFile())
                continue
            if (
                positives.length > 0
                && !positives.some(positive => matches(positive, relativePath))
            ) {
                continue
            }
            if (negatives.some(negative => matches(negative, relativePath)))
                continue
            collected.push(relativePath)
        }
    }
    for (const root of roots)
        walk(root)
    return Object.freeze([...collected].sort())
}
