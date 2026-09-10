import type { Muya } from '@muyajs/core';
import CodeMirror from '../../../desktop/src/renderer/src/codeMirror';
import { createCodeMirrorCoreAdapter } from '../../../desktop/src/renderer/src/documentAuthority/codeMirrorCoreAdapter';
import { createEditorCoreBinding } from '../../../desktop/src/renderer/src/documentAuthority/editorCoreBinding';
import { createLocalCoreOwner } from '../../../desktop/src/renderer/src/documentAuthority/localCoreOwner';
import { bootCoreBoundary } from './coreBoundaryControl';

/** Mount the incoming native view on the same owner after a real Source edit. */
export async function bootSourceImageHistory(muya: Muya, plain = false) {
    const source = plain ? 'x aaay\n' : '![aaa](url)\n';
    const binding = createEditorCoreBinding(createLocalCoreOwner());
    binding.open({ documentId: 'source-native-history.md', source });
    const host = document.body.appendChild(document.createElement('div'));
    const cm = CodeMirror(host, { value: source, mode: null });
    const adapter = createCodeMirrorCoreAdapter(cm.getDoc(), binding, { canonicalSource: source, insertedLineEnding: '\n' });
    try {
        cm.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 5 });
        cm.replaceSelection('bbb', 'end', '+input');
        await adapter.settled();
    }
    catch (error) {
        binding.dispose();
        throw error;
    }
    finally {
        adapter.dispose();
        host.remove();
    }
    return bootCoreBoundary(muya, source, false, binding);
}
