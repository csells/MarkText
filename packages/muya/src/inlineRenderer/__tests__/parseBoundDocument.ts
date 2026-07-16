import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { ILexOption } from '../../utils/marked/types';
import { emptyCriticMarkupBindingGraph } from '../../criticMarkup/bindingGraph';
import { createCriticMarkupDocument } from '../../criticMarkup/document';
import { grammarCriticMarkupBindingGraph } from '../../criticMarkup/grammarBindings';
import { parseCriticMarkupDocument } from '../../utils/marked/criticMarkupDocument';

/**
 * Test-support composition of a fragment-bearing document for one standalone
 * mapped revision: the public semantic parse supplies the analysis and the
 * sanctioned grammar materializer supplies the topology. Production consumers
 * always receive their graph from a parser artifact instead.
 */
export function parseBoundCriticMarkupDocument(
    sourceMap: TTrackedMarkdown,
    options: ILexOption = {},
) {
    const { analysis } = parseCriticMarkupDocument(sourceMap, options);
    return createCriticMarkupDocument(
        analysis,
        sourceMap,
        analysis.parserProfile,
        analysis.contextCoverage,
        analysis.roots.length
            ? grammarCriticMarkupBindingGraph(analysis, sourceMap)
            : emptyCriticMarkupBindingGraph(),
    );
}
