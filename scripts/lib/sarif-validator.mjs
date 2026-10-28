// Development-only validation. Runtime exports do not depend on Ajv or this module.
import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const SARIF_SCHEMA_URL = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json';
const schema = JSON.parse(fs.readFileSync(new URL('../../test/fixtures/sarif/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
// The verbatim OASIS schema uses legacy ECMA-262 patterns invalid with a Unicode flag.
const ajv = new Ajv({ allErrors: true, unicodeRegExp: false });
addFormats(ajv);
export const validateSarif = ajv.compile(schema);
export const sarifValidationErrors = () => ajv.errorsText(validateSarif.errors, { separator: '\n' });
