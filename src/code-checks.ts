import type { CodeUnit } from './source.js';

type Source = Pick<CodeUnit, 'id' | 'qualifiedName' | 'filePath' | 'startLine' | 'endLine' | 'rawSource'>;
type Rule = {
    ruleId: string; cwe: string; severity: 'HIGH' | 'MEDIUM'; title: string; detail: string;
    matches: (source: string) => boolean;
};
export type CodeCheckMatch = Omit<Rule, 'matches'> & Omit<Source, 'rawSource'>;

const sqlExecution = /\.execute(?:query\(|update\(|\("|\(sql)/;
const sqlConcat = /" \+|\+ ["']|string\.format\(/;
const sqlPrepared = /preparedstatement|preparestatement\(/;
const sensitiveName = /password|secret|apikey|privatekey|accesstoken|credential/;
const fileOperation = /new file\(|paths\.get\(|path\.of\(|filechannel|fileinputstream\(|fileoutputstream\(/;
const pathInput = /getparameter\(|getpathinfo\(|getheader\(|requestparam|pathvariable|\.\.\/|\.\.\\/;
const xmlParser = /documentbuilderfactory|saxparserfactory|xmlinputfactory|transformer ?factory/;
const xmlGuard = /disallow-doctype-decl|external-general-entities|external-parameter-entities|setfeature\((?:javax\.xml|http:\/\/apache)/;
const nonSecureRandom = /new (?:java\.util\.)?random\(\)|math\.random\(\)/;
const securityContext = /token|password|secret|nonce|salt|session|key|auth|otp|captcha|uuid/;
const logCall = /(?:log|logger)\.(?:info|debug|warn|error)\(|system\.(?:out|err)\.print/;
const sensitiveLogField = /password|passwd|secret|token|apikey|credential|privatekey|accesskey/;

const rules: Rule[] = [
    {
        ruleId: 'SQL_INJECTION', cwe: 'CWE-89', severity: 'HIGH', title: 'SQL statement construction',
        detail: 'Review query construction and use parameterized statements for values.',
        matches: source => sqlExecution.test(source) && (sqlConcat.test(source) || !sqlPrepared.test(source))
    },
    {
        ruleId: 'COMMAND_INJECTION', cwe: 'CWE-78', severity: 'HIGH', title: 'Process execution',
        detail: 'Review how the command and its arguments are selected.',
        matches: source => /runtime\.getruntime\( ?\)\.exec\(|new processbuilder\(/.test(source)
    },
    {
        ruleId: 'INSECURE_DESERIALIZATION', cwe: 'CWE-502', severity: 'HIGH', title: 'Java object deserialization',
        detail: 'Review which inputs and types can reach object deserialization.',
        matches: source => /\.readobject\(\)|objectinputstream/.test(source)
    },
    {
        ruleId: 'WEAK_CRYPTO', cwe: 'CWE-327', severity: 'MEDIUM', title: 'Weak digest algorithm',
        detail: 'Check whether the digest serves a security purpose and requires a stronger algorithm.',
        matches: source => /"(?:md5|sha-?1)"/.test(source)
    },
    {
        ruleId: 'HARDCODED_SECRET', cwe: 'CWE-798', severity: 'HIGH', title: 'Possible hardcoded credential',
        detail: 'Review the assignment and move active credentials to a secret store.',
        matches: source => sensitiveName.test(source) && /= ["']/.test(source)
    },
    {
        ruleId: 'PATH_TRAVERSAL', cwe: 'CWE-22', severity: 'HIGH', title: 'File path handling',
        detail: 'Check that application paths remain within their intended base directory.',
        matches: source => fileOperation.test(source) && pathInput.test(source)
    },
    {
        ruleId: 'XXE_INJECTION', cwe: 'CWE-611', severity: 'HIGH', title: 'XML parser configuration',
        detail: 'Verify parser settings for DTDs and external entity resolution.',
        matches: source => xmlParser.test(source) && !xmlGuard.test(source)
    },
    {
        ruleId: 'INSECURE_RANDOM', cwe: 'CWE-330', severity: 'MEDIUM', title: 'Randomness in a security-sensitive context',
        detail: 'Use a cryptographically secure random generator for security-sensitive values.',
        matches: source => nonSecureRandom.test(source) && securityContext.test(source)
    },
    {
        ruleId: 'SENSITIVE_LOG', cwe: 'CWE-200', severity: 'MEDIUM', title: 'Possible sensitive value in logs',
        detail: 'Review the logged fields and remove sensitive values.',
        matches: source => logCall.test(source) && source.split(/\r\n|\r|\n/).some(line => logCall.test(line) && sensitiveLogField.test(line))
    }
];

export function checkCode({ rawSource, ...location }: Source): CodeCheckMatch[] {
    const source = rawSource.toLowerCase();
    const matches = [];
    for (const { matches: test, ...rule } of rules) if (test(source)) matches.push({ ...rule, ...location });
    return matches;
}
