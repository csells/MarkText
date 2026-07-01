import type { Config } from 'dompurify';
import DOMPurify from 'dompurify';

type Sanitize = (dirty: string | Node, cfg?: Config) => string;

const purify = DOMPurify();
const sanitize: Sanitize = (dirty, cfg) => purify.sanitize(dirty, cfg) as string;
const { isValidAttribute } = purify;

export { Config, isValidAttribute };

export default sanitize;
