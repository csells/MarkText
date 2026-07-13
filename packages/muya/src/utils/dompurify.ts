import type { Config } from 'dompurify';
import DOMPurify from 'dompurify';

const purifier = DOMPurify();
const { isValidAttribute } = purifier;
function sanitize(dirty: string, config?: Config): string {
    return purifier.sanitize(dirty, config) as string;
}

export { Config, isValidAttribute };

export default sanitize;
