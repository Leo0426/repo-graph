import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse } from '../dist/source.js';

const source = [
    'package example.store;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    '@RestController',
    'public class Store {',
    '    private final String label = "图书", tag = "A";',
    '    @GetMapping(path = "/stock")',
    '    public java.util.List<String> stock(java.util.List<Integer> items, int counts[], String... notes) {',
    '        return summarize(items);',
    '    }',
    '    record Receipt(String label, int units) { Receipt {} }',
    '    interface Policy { int limit(); }',
    '    enum Status { OPEN, CLOSED }',
    '    @interface Marker { String value() default ""; }',
    '}'
].join('\r\n');

test('Java source parsing keeps legacy Java symbol IDs, nested names and annotation evidence', () => {
    const file = 'src/main/java/example/store/Store.java';
    const units = parse('example', file, 'java', source);
    const symbols = new Map(units.map(unit => [unit.qualifiedName, unit]));
    const name = 'example.store.Store#stock(java.util.List,int[],String...)';
    const method = symbols.get(name);
    assert.equal(method.id, createHash('sha256').update('example' + file + 'METHOD' + name).digest('hex'));
    assert.deepEqual([method.startLine, method.endLine], [6, 9]);
    assert.equal(method.parentQualifiedName, 'example.store.Store');
    assert.deepEqual(method.annotations, ['@GetMapping']);
    assert.equal(method.metadata.ann_GetMapping, '/stock');
    assert.equal(method.metadata.framework, 'spring');
    assert.equal(method.metadata.is_entry_point, 'true');
    assert.equal(method.metadata.return_type, 'java.util.List<String>');
    assert.equal(symbols.get('example.store.Store$Receipt').metadata.is_record, 'true');
    assert.equal(symbols.get('example.store.Store$Receipt#Receipt(String,int)').kind, 'CONSTRUCTOR');
    assert.equal(symbols.get('example.store.Store$Policy').kind, 'INTERFACE');
    assert.equal(symbols.get('example.store.Store$Status').kind, 'ENUM');
    assert.equal(symbols.get('example.store.Store$Marker').kind, 'ANNOTATION');
    assert.equal(symbols.get('example.store.Store.label').metadata.is_final, 'true');
    assert.equal(symbols.get('example.store.Store.tag').kind, 'FIELD');
    assert.match(symbols.get('example.store.Store.label').rawSource, /图书/);
    assert.deepEqual(parse('example', file, 'java', '// An intentionally empty compilation unit.\n'), []);
    assert.throws(() => parse('example', file, 'java', 'class Store { int missing( }'), /SYNTAX_ERROR/);
});

test('Java REST indexing binds project-scoped type and method relations across file changes', { timeout: 20_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-java-')));
    const root = join(tmp, 'store');
    const other = join(tmp, 'other');
    await Promise.all([mkdir(root), mkdir(other)]);
    const helper = 'package example.lib; public class Helper { public static int price(int count) { return count; } '
        + 'public int bill(int count) { return count; } public long bill(long count) { return count; } '
        + 'public Helper fluent() { return this; } '
        + 'public static class Rates { public static int rate(int count) { return count; } } }';
    const files = {
        'Base.java': 'package example.store; public class Base { public int stock() { return 1; } '
            + 'protected int parentOnly(int count) { return count; } }',
        'Policy.java': 'package example.store; public interface Policy { int stock(); default int feedback() { return 4; } }',
        'Helper.java': helper,
        'Store.java': [
            'package example.store;',
            'import example.lib.Helper;',
            'import static example.lib.Helper.price;',
            'import static example.lib.Helper.Rates.*;',
            'import static example.store.LocalOps.join;',
            '@RestController public class Store extends Base implements Policy {',
            '  @Override @GetMapping("/stock") public int stock() { return Helper.price(4) + this.total(1); }',
            '  public int total(int value) { return value; }',
            '  public int total(long value) { return (int) value; }',
            '  public int unclear(Object value) { return this.total(value.hashCode()); }',
            '  public int shadow() { Other Helper = new Other(); return Helper.price(4); }',
            '  private Helper helper;',
            '  public int fromParameter(Helper receiver, int count) { return receiver.bill(count); }',
            '  public int fromField() { return this.helper.bill(1); }',
            '  public long fromLocal() { var receiver = new Helper(); return receiver.bill(1L); }',
            '  public int fieldShadowed() { Other helper = new Other(); return helper.bill(1); }',
            '  public int afterBlock() { { Other helper = new Other(); helper.bill(0); } return helper.bill(1); }',
            '  public int localType() { class Helper { int bill(int n) { return n; } } Helper r = new Helper(); return r.bill(0); }',
            '  public int fromSuper() { return super.parentOnly(1); }',
            '  public int fromDefault() { return Policy.super.feedback(); }',
            '  public int fromLoop(Helper[] items) { for (Helper receiver : items) return receiver.bill(1); return 0; }',
            '  public int fromLambda() { java.util.function.ToIntFunction<Helper> f = (Helper receiver) -> receiver.bill(1); return 0; }',
            '  public int fromCast(Object value) { return ((Helper) value).bill(1); }',
            '  private Builder builder(int amount) { return null; }',
            '  private OtherBuilder builder(long amount) { return null; }',
            '  private Helper externalBuilder() { return helper; }',
            '  private <T> T unknownBuilder() { return null; }',
            '  public int fromChain() { return this.builder(1).named("sample").finish(2); }',
            '  public int fromExternalChain() { return externalBuilder().bill(3); }',
            '  public int fromUnknownChain() { return this.<Builder>unknownBuilder().finish(4); }',
            '  public int fromLongChain() { return externalBuilder().fluent().bill(5); }',
            '  public java.util.function.Supplier<Helper> boundReference() { return externalBuilder()::fluent; }',
            '  public java.util.function.IntUnaryOperator classReference() { return Helper::price; }',
            '  public java.util.function.IntUnaryOperator overloadedReference(Helper value) { return value::bill; }',
            '  static class Builder { Builder named(java.lang.String label) { return this; } int finish(int n) { return n; } }',
            '  static class OtherBuilder { OtherBuilder named(java.lang.String label) { return this; } int finish(int n) { return n; } }',
            '}',
            'class StaticConsumer {',
            '  int fromName() { return price(1); }',
            '  int fromWildcard() { return rate(2); }',
            '  int fromPackage() { return join(5); }',
            '}',
            'class LocalAncestor { protected int work(int value) { return value; } }',
            'class LocalDecoy { protected int work(int value) { return 0; } }',
            'class LocalMiddle extends LocalAncestor {}',
            'class LocalHeir extends LocalMiddle { int inherited() { return work(3); } }',
            'class LocalPrice { int price(int value) { return value; } int selected() { return price(4); } }',
            'class LocalOps { static int join(int value) { return value; } }',
            'class LocalReferences {',
            '  private int apply(int value) { return value; }',
            '  java.util.function.IntUnaryOperator ref() { return this::apply; }',
            '}'
        ].join('\n')
    };
    await Promise.all([...Object.entries(files).map(([file, body]) => writeFile(join(root, file), body)),
        writeFile(join(other, 'Helper.java'), helper)]);
    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_DB_PATH: join(tmp, 'index.db'),
            REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0'
        }, stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(tmp, { recursive: true, force: true });
    });
    const base = await new Promise((resolve, reject) => {
        let stderr = '';
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Server exited (${code}): ${stderr}`)));
        child.stderr.on('data', chunk => {
            stderr += chunk;
            const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
            if (address) resolve(address);
        });
    });
    async function api(path, parameters = {}, method = 'GET') {
        const response = await fetch(`${base}/api/v1${path}?${new URLSearchParams(parameters)}`, {
            method, headers: { Authorization: 'Bearer ' + token }
        });
        return { status: response.status, body: await response.json() };
    }
    const projectId = createHash('sha256').update(root).digest('hex').slice(0, 12);
    async function reindex(projectRoot, lang = 'java') {
        assert.equal((await api('/index/project', { projectRoot, lang }, 'POST')).status, 202);
        for (let attempt = 0; attempt < 100; attempt++) {
            const status = await api('/index/project/status', { projectRoot });
            assert.equal(status.status, 200);
            if (status.body.status !== 'running') return status.body;
            await delay(20);
        }
        assert.fail('Java indexing did not reach a terminal state');
    }
    const target = 'example.store.Store#stock()';
    const helperMethod = 'example.lib.Helper#price(int)';
    async function graph(kind, value, selected = projectId) {
        return (await api('/graph/' + kind, { projectId: selected, target: value })).body.map(unit => unit.qualifiedName);
    }

    assert.equal((await reindex(other)).status, 'done');
    assert.equal((await reindex(root)).parsedFiles, 4);
    const indexed = await api('/symbol/' + encodeURIComponent(target), { projectId });
    assert.equal(indexed.status, 200);
    assert.equal(indexed.body.language, 'java');
    const located = await api('/locate', { projectId, file: 'Store.java', line: 7 });
    assert.equal(located.body.id, indexed.body.id);
    const entrypoints = await api('/graph/entrypoints', { projectId, lang: 'java' });
    assert.equal(entrypoints.status, 200);
    assert.deepEqual(entrypoints.body.map(unit => unit.qualifiedName), ['example.store.Store', target]);
    assert.deepEqual((await api('/frameworks/' + projectId)).body, entrypoints.body);
    const client = new Client({ name: 'java-graph-test', version: '1.0.0' });
    try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
            env: { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }));
        const result = await client.callTool({ name: 'find_entrypoints', arguments: { projectId, lang: 'java' } });
        assert.equal(result.isError, false);
        assert.deepEqual(JSON.parse(result.content[0].text), entrypoints.body);
        const instance = await client.callTool({ name: 'find_callees', arguments: { projectId, target: 'example.store.Store#fromLocal()' } });
        assert.equal(instance.isError, false);
        assert.deepEqual(JSON.parse(instance.content[0].text).map(unit => unit.qualifiedName), ['example.lib.Helper#bill(long)']);
        const chain = await client.callTool({ name: 'find_callees', arguments: { projectId, target: 'example.store.Store#fromChain()' } });
        assert.equal(chain.isError, false);
        assert.deepEqual(JSON.parse(chain.content[0].text).map(unit => unit.qualifiedName), [
            'example.store.Store#builder(int)', 'example.store.Store$Builder#finish(int)', 'example.store.Store$Builder#named(java.lang.String)'
        ]);
    } finally {
        await client.close();
    }
    assert.deepEqual(await graph('callees', target), [helperMethod, 'example.store.Store#total(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#unclear(Object)'), []);
    assert.deepEqual(await graph('callees', 'example.store.Store#shadow()'), []);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromParameter(Helper,int)'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromField()'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromLocal()'), ['example.lib.Helper#bill(long)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fieldShadowed()'), []);
    assert.deepEqual(await graph('callees', 'example.store.Store#afterBlock()'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#localType()'), []);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromSuper()'), ['example.store.Base#parentOnly(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromDefault()'), ['example.store.Policy#feedback()']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromLoop(Helper[])'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromLambda()'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromCast(Object)'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.StaticConsumer#fromName()'), ['example.lib.Helper#price(int)']);
    assert.deepEqual(await graph('callees', 'example.store.StaticConsumer#fromWildcard()'), ['example.lib.Helper$Rates#rate(int)']);
    assert.deepEqual(await graph('callees', 'example.store.StaticConsumer#fromPackage()'), ['example.store.LocalOps#join(int)']);
    assert.deepEqual(await graph('callees', 'example.store.LocalPrice#selected()'), ['example.store.LocalPrice#price(int)']);
    assert.deepEqual(await graph('callees', 'example.store.LocalHeir#inherited()'), ['example.store.LocalAncestor#work(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromChain()'), [
        'example.store.Store#builder(int)', 'example.store.Store$Builder#finish(int)', 'example.store.Store$Builder#named(java.lang.String)'
    ]);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromExternalChain()'), [
        'example.lib.Helper#bill(int)', 'example.store.Store#externalBuilder()'
    ]);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromUnknownChain()'), ['example.store.Store#unknownBuilder()']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromLongChain()'), [
        'example.lib.Helper#fluent()', 'example.store.Store#externalBuilder()'
    ]);
    assert.deepEqual(await graph('callees', 'example.store.Store#boundReference()'), [
        'example.lib.Helper#fluent()', 'example.store.Store#externalBuilder()'
    ]);
    assert.deepEqual(await graph('callees', 'example.store.Store#classReference()'), [helperMethod]);
    assert.deepEqual(await graph('callees', 'example.store.Store#overloadedReference(Helper)'), []);
    assert.deepEqual(await graph('callees', 'example.store.LocalReferences#ref()'), ['example.store.LocalReferences#apply(int)']);
    assert.deepEqual(await graph('subtypes', 'example.store.Base'), ['example.store.Store']);
    assert.deepEqual(await graph('subtypes', 'example.store.Policy'), ['example.store.Store']);
    assert.deepEqual(await graph('impact', 'example.store.Policy#stock()'), [target]);
    assert.deepEqual(await graph('callers', helperMethod, createHash('sha256').update(other).digest('hex').slice(0, 12)), []);
    assert.equal((await reindex(root)).skippedFiles, 4);

    await writeFile(join(root, 'Duplicate.java'), helper);
    assert.equal((await reindex(root)).parsedFiles, 1);
    assert.deepEqual(await graph('callees', target), ['example.store.Store#total(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromParameter(Helper,int)'), []);
    assert.deepEqual(await graph('callees', 'example.store.StaticConsumer#fromWildcard()'), []);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromExternalChain()'), ['example.store.Store#externalBuilder()']);
    assert.deepEqual(await graph('callees', 'example.store.Store#classReference()'), []);
    await rm(join(root, 'Duplicate.java'));
    assert.equal((await reindex(root)).skippedFiles, 4);
    assert.deepEqual(await graph('callees', target), [helperMethod, 'example.store.Store#total(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromParameter(Helper,int)'), ['example.lib.Helper#bill(int)']);
    assert.deepEqual(await graph('callees', 'example.store.StaticConsumer#fromWildcard()'), ['example.lib.Helper$Rates#rate(int)']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromExternalChain()'), [
        'example.lib.Helper#bill(int)', 'example.store.Store#externalBuilder()'
    ]);

    const overloadedHelper = helper.replace('public Helper fluent() { return this; }',
        'public Helper fluent() { return this; } public Helper fluent(int n) { return this; }');
    await writeFile(join(root, 'Helper.java'), overloadedHelper);
    assert.equal((await reindex(root)).parsedFiles, 1);
    assert.deepEqual(await graph('callees', 'example.store.Store#boundReference()'), ['example.store.Store#externalBuilder()']);
    assert.deepEqual(await graph('callees', 'example.store.Store#fromLongChain()'), [
        'example.lib.Helper#fluent()', 'example.store.Store#externalBuilder()'
    ]);

    await writeFile(join(root, 'Store.java'), 'class Store { void broken( }');
    const partial = await reindex(root);
    assert.equal(partial.status, 'partial');
    assert.ok(partial.errors.includes('Store.java: SYNTAX_ERROR'));
    assert.equal((await api('/symbol/' + encodeURIComponent(target), { projectId })).body.id, indexed.body.id);

    await rm(join(root, 'Helper.java'));
    assert.equal((await reindex(root)).status, 'partial');
    assert.deepEqual(await graph('callees', target), ['example.store.Store#total(int)']);

    async function indexJava(relativePath, content) {
        const file = join(root, relativePath);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, content);
        const result = await api('/index/file', { projectRoot: root, file }, 'POST');
        assert.equal(result.status, 200);
        assert.equal(result.body.status, 'done');
    }
    const caller = 'example.consumer.Consumer#render(Tool)';
    const staticCaller = 'example.consumer.Consumer#count()';
    const stringCaller = 'example.consumer.Consumer#length(String)';
    await indexJava('WildcardUse.java', [
        'package example.consumer;',
        'import example.first.*;',
        'import example.second.*;',
        'class Consumer extends Parent implements Policy {',
        '  int render(Tool tool) { return tool.render(1); }',
        '  int count() { return Tool.count(1); }',
        '  int length(String text) { return text.length(); }',
        '  int adjust(int n) { return n; }',
        '  int fromDefault() { return Policy.super.feedback(); }',
        '}'
    ].join('\n'));
    assert.deepEqual(await graph('callees', caller), []);
    await indexJava('first/Parent.java', 'package example.first; public class Parent {}');
    await indexJava('first/Policy.java', 'package example.first; public interface Policy { default int feedback() { return 1; } }');
    await indexJava('first/Tool.java', 'package example.first; public class Tool { public int render(int n) { return n; } '
        + 'public static int count(int n) { return n; } }');
    await indexJava('first/String.java', 'package example.first; public class String { public int length() { return 1; } }');
    assert.deepEqual(await graph('subtypes', 'example.first.Parent'), ['example.consumer.Consumer']);
    assert.deepEqual(await graph('callees', 'example.consumer.Consumer#fromDefault()'), ['example.first.Policy#feedback()']);
    assert.deepEqual(await graph('callees', caller), ['example.first.Tool#render(int)']);
    assert.deepEqual(await graph('callees', staticCaller), ['example.first.Tool#count(int)']);
    assert.deepEqual(await graph('callees', stringCaller), []);
    await indexJava('consumer/String.java', 'package example.consumer; class String { int length() { return 1; } }');
    assert.deepEqual(await graph('callees', stringCaller), ['example.consumer.String#length()']);
    await indexJava('consumer/Parent.java', 'package example.consumer; class Parent { int adjust(int n) { return n; } }');
    assert.deepEqual(await graph('subtypes', 'example.first.Parent'), []);
    assert.ok((await graph('impact', 'example.consumer.Parent#adjust(int)')).includes('example.consumer.Consumer#adjust(int)'));
    await indexJava('second/Tool.java', 'package example.second; class Tool { public int render(int n) { return n; } }');
    assert.deepEqual(await graph('callees', caller), ['example.first.Tool#render(int)']);
    await indexJava('second/Tool.java', 'package example.second; public class Tool {}');
    assert.deepEqual(await graph('callees', caller), []);
    assert.deepEqual(await graph('callees', staticCaller), []);
    await indexJava('consumer/Tool.java', 'package example.consumer; class Tool { int render(int n) { return n; } }');
    assert.deepEqual(await graph('callees', caller), ['example.consumer.Tool#render(int)']);
    assert.deepEqual(await graph('callees', staticCaller), []);
    await rm(join(root, 'second', 'Tool.java'));
    await reindex(root);
    assert.deepEqual(await graph('callees', caller), ['example.consumer.Tool#render(int)']);
    assert.deepEqual(await graph('callees', staticCaller), []);
    await rm(join(root, 'consumer', 'Tool.java'));
    await reindex(root);
    assert.deepEqual(await graph('callees', caller), ['example.first.Tool#render(int)']);
    assert.deepEqual(await graph('callees', staticCaller), ['example.first.Tool#count(int)']);
});
