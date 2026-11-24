import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { indexLanguages } from '../dist/assets.js';
import { RepositoryIndex } from '../dist/index.js';
import { languageOf, parse } from '../dist/source.js';

const cSource = `#define LIMIT 12
typedef struct Item {
    int age, count;
    union Data { long number; char letter; } data;
} Item;
int adjust(int units);
static int cap(int units) { return units < LIMIT ? units : LIMIT; }
int adjust(int units) { return cap(units); }
const char *format(const Item *item) { return "图书"; }
int (*callback)(int);
`;

const pySource = `from .models import Board as Parent, format_slot as render
from . import helpers
class Warehouse(Parent):
    class Receipt:
        pass

    @staticmethod
    async def send(count: int) -> str:
        return render(count)

    def open(self):
        return self.store(helpers.label())

    def store(self, value: str):
        return value

def launch():
    return Warehouse()

def shadow(render):
    return render(1)

if __name__ == "__main__":
    launch()
`;

test('C, C++ and Python keep source ranges and expose their language-specific declarations', () => {
    assert.deepEqual(['x.c', 'x.h', 'x.cpp', 'x.HPP', 'x.py', 'x.pyi'].map(languageOf), ['c','c','cpp','cpp','python','python']);
    const c = parse('project', 'inventory.c', 'c', cSource);
    const proto = c.find(unit => unit.qualifiedName === 'adjust' && unit.metadata.is_declaration === 'true');
    assert.equal(proto.id, createHash('sha256').update('projectinventory.cFUNCTIONadjust#decl').digest('hex'));
    assert.equal(c.find(unit => unit.qualifiedName === 'cap').metadata.visibility, 'file-local');
    assert.equal(c.find(unit => unit.qualifiedName === 'Item.age').kind, 'FIELD');
    assert.equal(c.find(unit => unit.simpleName === 'Data').kind, 'UNION');
    assert.ok(c.some(unit => unit.kind === 'TYPEDEF' && unit.simpleName === 'Item'));
    assert.ok(c.some(unit => unit.kind === 'MACRO' && unit.simpleName === 'LIMIT'));
    assert.match(c.find(unit => unit.qualifiedName === 'format').rawSource, /图书/);
    assert.equal(c.find(unit => unit.qualifiedName === 'format').metadata.return_type, 'const char *');
    assert.ok(!c.some(unit => unit.simpleName === 'callback'));
    const cpp = parse('project', 'report.cpp', 'cpp', `namespace report {
class Frame { public: int size() const { return 4; } };
int count(int value) { return value; }
int count(long value) { return (int) value; }
}`);
    assert.equal(cpp.find(unit => unit.qualifiedName === 'report::Frame').kind, 'CLASS');
    assert.equal(cpp.find(unit => unit.qualifiedName === 'report::Frame::size() const').kind, 'METHOD');
    assert.ok(cpp.some(unit => unit.qualifiedName === 'report::count(int)'));
    assert.ok(cpp.some(unit => unit.qualifiedName === 'report::count(long)'));
    const py = parse('project', 'sample/warehouse.py', 'python', pySource);
    const send = py.find(unit => unit.qualifiedName === 'Warehouse#send');
    assert.equal(send.kind, 'METHOD');
    assert.equal(send.startLine, 7);
    assert.deepEqual(send.annotations, ['@staticmethod']);
    assert.equal(send.metadata.is_async, 'true');
    assert.equal(send.metadata.param_types, 'int');
    assert.equal(send.metadata.return_type, 'str');
    assert.ok(py.some(unit => unit.qualifiedName === 'Warehouse.Receipt' && unit.kind === 'CLASS'));
    assert.equal(py.find(unit => unit.qualifiedName === 'launch').metadata.is_entry_point, 'true');
    assert.throws(() => parse('project', 'broken.py', 'python', 'def broken( :'), /SYNTAX_ERROR/);
});

test('polyglot indexing keeps scoped Python imports and C linkage through incremental updates', { timeout: 15_000 }, async t => {
    const work = await realpath(await mkdtemp(join(tmpdir(), 'repograph-polyglot-')));
    const root = join(work, 'project');
    await mkdir(join(root, 'sample'), { recursive: true });
    const files = {
        'sample/warehouse.py': pySource,
        'sample/models.py': 'class Board: pass\n\ndef format_slot(count):\n    return str(count)\n',
        'sample/helpers.py': 'def label():\n    return "new"\n',
        'inventory.c': cSource,
        'shipping.h': '#ifndef SHIPPING_H\n#define SHIPPING_H\nint ship(int units);\n#endif\n',
        'shipping.c': 'int ship(int units) { return units; }\n',
        'main.c': '#include "shipping.h"\nint main(void) { return ship(3); }\n',
        'report.cpp': 'namespace report { int size(int value) { return value; } int run() { return size(3); } }'
    };
    await Promise.all(Object.entries(files).map(([file, body]) => writeFile(join(root, file), body)));
    const repository = await RepositoryIndex.open(join(work, 'index.db'), work);
    t.after(async () => {
        await repository.close();
        await rm(work, { recursive: true, force: true });
    });
    const projectId = createHash('sha256').update(root).digest('hex').slice(0, 12);
    const names = (name, query, depth = 1) => repository.traverse(name, projectId, query, depth).map(unit => unit.qualifiedName);
    async function index(languages = indexLanguages()) {
        await repository.start(root, languages, true);
        for (let attempt = 0; attempt < 150; attempt++) {
            const result = await repository.status(root);
            if (result.status !== 'running') return result;
            await delay(15);
        }
        assert.fail('Indexing did not finish');
    }
    assert.equal((await index()).parsedFiles, Object.keys(files).length);
    assert.deepEqual(names('Board', 'subtypes'), ['Warehouse']);
    assert.deepEqual(names('Warehouse#send', 'callees'), ['format_slot']);
    assert.deepEqual(names('Warehouse#open', 'callees'), ['Warehouse#store', 'label']);
    assert.deepEqual(names('shadow', 'callees'), []);
    assert.deepEqual(names('main', 'callees'), ['ship']);
    assert.deepEqual(names('adjust', 'callees'), ['cap']);
    assert.deepEqual(names('report::run()', 'callees'), ['report::size(int)']);
    assert.deepEqual(repository.entryPoints(projectId, 'python', 500, 0).map(unit => unit.qualifiedName), ['launch']);
    assert.equal((await index()).skippedFiles, Object.keys(files).length);

    await writeFile(join(root, 'shipping.h'), 'int ship(long units);\n');
    assert.equal((await index(indexLanguages('c'))).parsedFiles, 1);
    assert.deepEqual(names('main', 'callees'), []);
    await writeFile(join(root, 'shipping.h'), 'int reserve(int units);\n');
    assert.equal((await index(indexLanguages('c'))).parsedFiles, 1);
    assert.deepEqual(names('main', 'callees'), []);
    assert.deepEqual(names('Warehouse#send', 'callees'), ['format_slot']);
    await writeFile(join(root, 'sample/models.py'), 'def invalid( :');
    const result = await index();
    assert.equal(result.status, 'partial');
    assert.deepEqual(names('Warehouse#send', 'callees'), ['format_slot']);
    await rm(join(root, 'sample/models.py'));
    assert.equal((await index()).status, 'done');
    assert.deepEqual(names('Warehouse#send', 'callees'), []);
});
