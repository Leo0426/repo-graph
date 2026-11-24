import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import type { GraphFacts, RelationKind } from './graph-source.js';
import { descriptorNotations, readClassFile } from './java-class-file.js';
import type { ClassFile, ClassFileBudget } from './java-class-file.js';
import type { CodeUnit, IndexedSource, UnitFactory } from './source.js';

interface Input {
    classFile: ClassFile;
    archiveEntry?: string;
}

export const MAX_CLASS_BYTES = 1024 * 1024;
export const MAX_JAR_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_CLASSES = 64 * 1024 * 1024;
const MAX_JAR_ENTRIES = 10_000;

function visibility(flags: number) {
    if (flags & 0x0001) return 'public';
    if (flags & 0x0002) return 'private';
    if (flags & 0x0004) return 'protected';
    return 'package';
}

function metadata(flags: number, input: Input): Record<string, string> {
    return {
        bytecode: 'true', visibility: visibility(flags),
        ...(flags & 0x0008 ? { is_static: 'true' } : {}),
        ...(flags & 0x0010 ? { is_final: 'true' } : {}),
        ...(flags & 0x0400 ? { is_abstract: 'true' } : {}),
        ...(flags & 0x1000 ? { is_synthetic: 'true' } : {}),
        ...(input.classFile.sourceFile ? { source_file: input.classFile.sourceFile } : {}),
        ...(input.archiveEntry ? { archive_entry: input.archiveEntry } : {})
    };
}

function modifiers(meta: Record<string, string>) {
    return [meta.visibility === 'package' ? '' : meta.visibility,
        meta.is_static && 'static', meta.is_final && 'final', meta.is_abstract && 'abstract'].filter(Boolean).join(' ');
}

function simple(name: string) { return name.slice(Math.max(name.lastIndexOf('.'), name.lastIndexOf('$')) + 1); }
function moduleName(owner: string) { return '/java/bytecode/' + owner; }
function methodKey(name: string, descriptor: string) { return name + descriptor; }

export async function indexBytecode(bytes: Buffer, unit: UnitFactory, jar: boolean, signal?: AbortSignal): Promise<IndexedSource> {
    const budget = { symbols: 50_000, calls: 100_000 };
    return indexClasses(jar ? await jarClasses(bytes, budget, signal) : [{ classFile: readClassFile(bytes, budget) }], unit);
}

async function jarClasses(bytes: Buffer, budget: ClassFileBudget, signal?: AbortSignal) {
    const inputs: Input[] = [];
    try {
        const file = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true });
        try {
            if (file.entryCount > MAX_JAR_ENTRIES) throw new Error('JAVA_ARCHIVE_LIMIT');
            let expanded = 0;
            for await (const entry of file.eachEntry()) {
                signal?.throwIfAborted();
                const path = entry.fileName;
                if (!path.endsWith('.class') || path.startsWith('META-INF/')) continue;
                const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
                if ((entry.generalPurposeBitFlag & 1) || (mode !== 0 && mode !== 0x8000)
                    || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\0'))) {
                    throw new Error('INVALID_JAVA_ARCHIVE');
                }
                expanded += entry.uncompressedSize;
                if (entry.uncompressedSize > MAX_CLASS_BYTES || expanded > MAX_EXTRACTED_CLASSES) throw new Error('JAVA_ARCHIVE_LIMIT');
                const chunks: Buffer[] = [];
                const stream = await file.openReadStreamPromise(entry);
                let length = 0;
                let crc = 0;
                try {
                    for await (const chunk of stream as AsyncIterable<Buffer>) {
                        signal?.throwIfAborted();
                        length += chunk.length;
                        if (length > entry.uncompressedSize) throw new Error('INVALID_JAVA_ARCHIVE');
                        crc = crc32(chunk, crc);
                        chunks.push(chunk);
                    }
                } finally { stream.destroy(); }
                if (length !== entry.uncompressedSize || crc !== entry.crc32) throw new Error('INVALID_JAVA_ARCHIVE');
                const classFile = readClassFile(Buffer.concat(chunks, length), budget);
                const classPath = path.replace(/^(?:BOOT-INF|WEB-INF)\/classes\//, '');
                if (classPath !== classFile.name.replaceAll('.', '/') + '.class') throw new Error('INVALID_JAVA_ARCHIVE');
                inputs.push({ classFile, archiveEntry: path });
            }
        } finally { file.close(); }
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && ['INVALID_CLASS_FILE', 'JAVA_ARCHIVE_LIMIT', 'BYTECODE_SYMBOL_LIMIT'].includes(error.message)) throw error;
        throw new Error('INVALID_JAVA_ARCHIVE');
    }
    return inputs;
}

function indexClasses(inputs: Input[], unit: UnitFactory): IndexedSource {
    const units: CodeUnit[] = [];
    const graph: GraphFacts = { edges: [], imports: [], exports: [], moduleKeys: [] };
    const locals = new Map<string, Map<string, CodeUnit>>();
    const deferred: {
        source: CodeUnit; owner: string; key: string; kind: RelationKind; line: number;
    }[] = [];
    function edge(source: CodeUnit, target: CodeUnit, kind: RelationKind, line: number) {
        graph.edges.push({ sourceId: source.id, targetId: target.id, kind, resolved: true, filePath: source.filePath, sourceLine: line });
    }
    for (const input of inputs) {
        const { classFile: cls } = input;
        if (cls.flags & 0x8000 || /\$\d[^$]*$/.test(cls.name)) continue; // module descriptors and anonymous/local classes
        if (locals.has(cls.name)) throw new Error('DUPLICATE_JAVA_CLASS');
        const local = new Map<string, CodeUnit>();
        locals.set(cls.name, local);
        graph.moduleKeys.push({ name: moduleName(cls.name), priority: 0 });
        function record(key: string, symbol: CodeUnit) {
            if (local.has(key)) throw new Error('INVALID_CLASS_FILE');
            local.set(key, symbol);
            units.push(symbol);
            graph.exports.push({ name: cls.name + '#' + key, unit: symbol });
        }
        const interfaceFlag = Boolean(cls.flags & 0x0200);
        const kind = cls.flags & 0x2000 ? 'ANNOTATION' : interfaceFlag ? 'INTERFACE' : cls.flags & 0x4000 ? 'ENUM' : 'CLASS';
        const meta = metadata(cls.flags, input);
        if (cls.record) meta.is_record = 'true';
        if (interfaceFlag) delete meta.is_abstract;
        const name = simple(cls.name);
        const parent = cls.superName === 'java.lang.Object' ? null : cls.superName;
        const keyword = kind === 'ANNOTATION' ? '@interface' : cls.record ? 'record' : kind.toLowerCase();
        const signature = [modifiers(meta), keyword, name,
            parent && 'extends ' + parent, cls.interfaces.length > 0 &&
            (interfaceFlag ? 'extends ' : 'implements ') + cls.interfaces.join(', ')].filter(Boolean).join(' ');
        const type = unit(kind, name, cls.name, 0, 0, signature, signature, cls.outerName, meta);
        record('', type);
        if (parent) deferred.push({ source: type, owner: parent, key: '', kind: 'EXTENDS', line: 0 });
        for (const name of cls.interfaces) {
            deferred.push({ source: type, owner: name, key: '', kind: interfaceFlag ? 'EXTENDS' : 'IMPLEMENTS', line: 0 });
        }
        if (cls.outerName) deferred.push({ source: type, owner: cls.outerName, key: '', kind: 'CONTAINS', line: 0 });

        const fields = new Set<string>();
        for (const field of cls.fields) {
            const typeName = descriptorNotations(field.descriptor, false).result;
            const meta = metadata(field.flags, input);
            const signature = [modifiers(meta), typeName, field.name].filter(Boolean).join(' ');
            const base = cls.name + '.' + field.name;
            const qualified = fields.has(base) ? base + ':' + typeName : base;
            fields.add(base);
            const symbol = unit('FIELD', field.name, qualified, 0, 0, signature, signature, cls.name, meta);
            record('field:' + field.name + ':' + field.descriptor, symbol);
            edge(type, symbol, 'CONTAINS', 0);
        }
        const names = new Set<string>();
        // Prefer the user-declared method for the legacy Java name when a bridge differs only by return type.
        const methods = [...cls.methods].sort((a, b) => (a.flags & 0x0040) - (b.flags & 0x0040));
        for (const method of methods) {
            if (method.name === '<clinit>') continue;
            const constructor = method.name === '<init>';
            const kind = constructor ? 'CONSTRUCTOR' : 'METHOD';
            const name = constructor ? type.simpleName : method.name;
            const { parameters, result } = descriptorNotations(method.descriptor, true);
            const meta = metadata(method.flags, input);
            meta.return_type = result;
            if (parameters.length) meta.param_types = parameters.join(',');
            if (method.flags & 0x0040) meta.is_bridge = 'true';
            const base = cls.name + '#' + name + '(' + parameters.join(',') + ')';
            const qualified = names.has(base) ? base + ':' + result : base;
            names.add(base);
            const signature = [modifiers(meta), constructor ? '' : result,
                name + '(' + parameters.join(', ') + ')'].filter(Boolean).join(' ');
            const symbol = unit(kind, name, qualified, method.startLine, method.endLine, signature, signature, cls.name, meta);
            record(methodKey(method.name, method.descriptor), symbol);
            edge(type, symbol, 'CONTAINS', method.startLine);
            for (const call of method.calls) {
                deferred.push({ source: symbol, owner: call.owner, key: methodKey(call.name, call.descriptor), kind: 'CALLS', line: call.line });
            }
        }
    }
    for (const { source, owner, key, kind, line } of deferred) {
        const target = locals.get(owner)?.get(key);
        if (target) {
            if (kind === 'CONTAINS') edge(target, source, kind, line);
            else edge(source, target, kind, line);
        } else if (!locals.has(owner)) {
            graph.imports.push({ sourceId: source.id, module: moduleName(owner), name: owner + '#' + key, kind, line });
        }
    }
    return { units, ...graph };
}
