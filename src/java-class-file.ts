export interface ClassFile {
    name: string;
    superName: string | null;
    interfaces: string[];
    outerName: string | null;
    flags: number;
    sourceFile?: string;
    record: boolean;
    fields: Member[];
    methods: Method[];
}

interface Member {
    flags: number;
    name: string;
    descriptor: string;
}

interface Method extends Member {
    startLine: number;
    endLine: number;
    calls: (MethodReference & { line: number })[];
}

interface MethodReference {
    owner: string;
    name: string;
    descriptor: string;
}

export interface ClassFileBudget { symbols: number; calls: number }

function invalid(): never { throw new Error('INVALID_CLASS_FILE'); }

function consume(budget: ClassFileBudget, kind: keyof ClassFileBudget, count: number) {
    budget[kind] -= count;
    if (budget[kind] < 0) throw new Error('BYTECODE_SYMBOL_LIMIT');
    return count;
}

class Reader {
    offset = 0;
    constructor(readonly bytes: Buffer) {}
    take(size: number) {
        if (size < 0 || size > this.bytes.length - this.offset) invalid();
        this.offset += size;
        return this.bytes.subarray(this.offset - size, this.offset);
    }
    u1() { return this.take(1)[0]; }
    u2() { return this.take(2).readUInt16BE(0); }
    u4() { return this.take(4).readUInt32BE(0); }
    done() { if (this.offset !== this.bytes.length) invalid(); }
}

// JVM modified UTF-8 encodes UTF-16 code units, including NUL and surrogate pairs.
function modifiedUtf8(bytes: Buffer) {
    let value = '';
    for (let offset = 0; offset < bytes.length;) {
        const start = bytes[offset++];
        if (start > 0 && start <= 0x7f) {
            value += String.fromCharCode(start);
        } else {
            const length = (start & 0xe0) === 0xc0 ? 2 : (start & 0xf0) === 0xe0 ? 3 : invalid();
            let char = start & (length === 2 ? 31 : 15);
            for (let part = 1; part < length; part++) {
                const next = bytes[offset++];
                if (next === undefined || (next & 0xc0) !== 0x80) invalid();
                char = (char << 6) | (next & 0x3f);
            }
            if (length === 2 ? char > 0 && char < 0x80 : char < 0x800) invalid();
            value += String.fromCharCode(char);
        }
    }
    return value;
}

interface Constant { tag: number; first?: number; second?: number; text?: string }

function constants(reader: Reader) {
    const count = reader.u2();
    const entries: (Constant | undefined)[] = [];
    for (let index = 1; index < count; index++) {
        const tag = reader.u1();
        switch (tag) {
            case 1: entries[index] = { tag, text: modifiedUtf8(reader.take(reader.u2())) }; break;
            case 7: case 8: case 16: case 19: case 20:
                entries[index] = { tag, first: reader.u2() }; break;
            case 9: case 10: case 11: case 12: case 17: case 18:
                entries[index] = { tag, first: reader.u2(), second: reader.u2() }; break;
            case 15: entries[index] = { tag, first: reader.u1(), second: reader.u2() }; break;
            case 3: case 4: reader.take(4); break;
            case 5: case 6:
                reader.take(8);
                if (++index === count) invalid();
                break;
            default: invalid();
        }
    }
    return entries;
}

const operandBytes = new Uint8Array(0xca);
for (const op of [0x10, 0x12, 0xa9, 0xbc]) operandBytes[op] = 1;
operandBytes.fill(1, 0x15, 0x1a);
operandBytes.fill(1, 0x36, 0x3b);
for (const op of [0x11, 0x13, 0x14, 0x84, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7]) operandBytes[op] = 2;
operandBytes.fill(2, 0x99, 0xa9);
operandBytes.fill(2, 0xb2, 0xb9);
for (const op of [0xb9, 0xba, 0xc8, 0xc9]) operandBytes[op] = 4;
operandBytes[0xc5] = 3;

function invokes(code: Buffer, lines: { offset: number; line: number }[], budget: ClassFileBudget) {
    const reader = new Reader(code);
    const calls: { index: number; dynamic: boolean; line: number }[] = [];
    let line = 0;
    let cursor = 0;
    while (reader.offset < code.length) {
        const offset = reader.offset;
        const op = reader.u1();
        if (op >= operandBytes.length) invalid();
        if (op === 0xaa || op === 0xab) {
            reader.take((4 - reader.offset % 4) % 4);
            reader.take(4); // default branch
            const first = reader.take(4).readInt32BE(0);
            const count = op === 0xaa ? reader.take(4).readInt32BE(0) - first + 1 : first;
            if (op === 0xaa && count < 1) invalid();
            reader.take(count * (op === 0xaa ? 4 : 8));
        } else if (op === 0xc4) {
            const widened = reader.u1();
            if (widened === 0x84) reader.take(4);
            else if ((widened >= 0x15 && widened <= 0x19) || (widened >= 0x36 && widened <= 0x3a) || widened === 0xa9) reader.take(2);
            else invalid();
        } else {
            const args = reader.take(operandBytes[op]);
            if (op < 0xb6 || op > 0xba) continue;
            consume(budget, 'calls', 1);
            while (cursor < lines.length && lines[cursor].offset <= offset) line = lines[cursor++].line;
            calls.push({ index: args.readUInt16BE(0), dynamic: op === 0xba, line });
        }
    }
    return calls;
}

export function readClassFile(bytes: Buffer, budget: ClassFileBudget): ClassFile {
    const reader = new Reader(bytes);
    if (reader.u4() !== 0xcafebabe) invalid();
    reader.u2(); // minor version
    if (reader.u2() < 45) invalid();
    const pool = constants(reader);
    function constant(index: number, ...tags: number[]) {
        const value = pool[index];
        if (!value || !tags.includes(value.tag)) invalid();
        return value;
    }
    function utf(index: number) { return constant(index, 1).text!; }
    function className(index: number) { return utf(constant(index, 7).first!).replaceAll('/', '.'); }
    function memberReference(index: number): MethodReference {
        const target = constant(index, 10, 11);
        const entry = constant(target.second!, 12);
        return { owner: className(target.first!), name: utf(entry.first!), descriptor: utf(entry.second!) };
    }
    function attributes(input: Reader, visit: (name: string, body: Reader) => void) {
        const count = input.u2();
        for (let index = 0; index < count; index++) {
            const name = utf(input.u2());
            visit(name, new Reader(input.take(input.u4())));
        }
    }
    function member(): Member {
        return { flags: reader.u2(), name: utf(reader.u2()), descriptor: utf(reader.u2()) };
    }
    function code(body: Reader) {
        body.take(4); // max_stack and max_locals
        const size = body.u4();
        if (!size || size > 65_535) invalid();
        const instructions = body.take(size);
        body.take(body.u2() * 8); // exception table
        const lines: { offset: number; line: number }[] = [];
        let startLine = 0;
        let endLine = 0;
        attributes(body, (name, table) => {
            if (name !== 'LineNumberTable') return;
            const count = table.u2();
            for (let index = 0; index < count; index++) {
                const offset = table.u2();
                const line = table.u2();
                if (offset >= size) invalid();
                if (!line) continue;
                lines.push({ offset, line });
                startLine = startLine ? Math.min(startLine, line) : line;
                endLine = Math.max(endLine, line);
            }
            table.done();
        });
        body.done();
        lines.sort((a, b) => a.offset - b.offset);
        return { startLine, endLine, pending: invokes(instructions, lines, budget) };
    }

    let flags = reader.u2();
    const ownIndex = reader.u2();
    const name = className(ownIndex);
    const superIndex = reader.u2();
    const interfaces = Array.from({ length: reader.u2() }, () => className(reader.u2()));
    consume(budget, 'symbols', 1 + interfaces.length);
    const fields = Array.from({ length: consume(budget, 'symbols', reader.u2()) }, () => {
        const field = member();
        attributes(reader, () => {});
        return field;
    });
    const bodies = Array.from({ length: consume(budget, 'symbols', reader.u2()) }, () => {
        const declaration = member();
        let methodCode: ReturnType<typeof code> | undefined;
        attributes(reader, (attribute, body) => {
            if (attribute !== 'Code') return;
            if (methodCode) invalid();
            methodCode = code(body);
        });
        return { ...declaration, ...(methodCode ?? { startLine: 0, endLine: 0, pending: [] }) };
    });

    let outerName: string | null = null;
    let sourceFile: string | undefined;
    let record = false;
    const bootstraps: { handle: number; implementation?: number }[] = [];
    attributes(reader, (attribute, body) => {
        if (attribute === 'SourceFile') {
            sourceFile = utf(body.u2());
        } else if (attribute === 'InnerClasses') {
            const count = body.u2();
            for (let index = 0; index < count; index++) {
                const inner = body.u2();
                const outer = body.u2();
                body.u2(); // inner_name_index
                const access = body.u2();
                if (inner !== ownIndex) continue;
                outerName = outer ? className(outer) : null;
                flags = access;
            }
        } else if (attribute === 'BootstrapMethods') {
            const count = body.u2();
            for (let index = 0; index < count; index++) {
                const handle = body.u2();
                const args = body.u2();
                const argumentsBytes = body.take(args * 2);
                const implementation = args > 1 ? argumentsBytes.readUInt16BE(2) : undefined;
                bootstraps.push({ handle, implementation });
            }
        } else {
            if (attribute === 'Record') record = true;
            return;
        }
        body.done();
    });
    reader.done();

    function lambda(index: number) {
        const dynamic = constant(index, 18);
        const bootstrap = bootstraps[dynamic.first!];
        if (!bootstrap) invalid();
        const handle = constant(bootstrap.handle, 15);
        if (handle.first !== 6) return undefined; // REF_invokeStatic
        const factory = memberReference(handle.second!);
        if (factory.owner !== 'java.lang.invoke.LambdaMetafactory' || !['metafactory', 'altMetafactory'].includes(factory.name)) return undefined;
        if (!bootstrap.implementation) invalid();
        return memberReference(constant(bootstrap.implementation, 15).second!);
    }
    const methods = bodies.map(({ pending, ...method }) => ({
        ...method,
        calls: pending.flatMap(({ index, dynamic, line }) => {
            const target = dynamic ? lambda(index) : memberReference(index);
            return target ? [{ ...target, line }] : [];
        })
    }));
    return { name, flags, superName: superIndex ? className(superIndex) : null, interfaces, outerName, sourceFile, record, fields, methods };
}

const primitives: Record<string, string> = { B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int',
    J: 'long', S: 'short', Z: 'boolean' };

export function descriptorNotations(descriptor: string, method: boolean) {
    let offset = method ? 1 : 0;
    function type(allowVoid: boolean) {
        let dimensions = 0;
        while (descriptor[offset] === '[') { offset++; dimensions++; }
        if (dimensions > 255) invalid();
        const kind = descriptor[offset++];
        let value = primitives[kind];
        if (kind === 'L') {
            const end = descriptor.indexOf(';', offset);
            if (end <= offset) invalid();
            value = descriptor.slice(offset, end).replaceAll('/', '.');
            offset = end + 1;
        }
        if (kind === 'V' && allowVoid && !dimensions) value = 'void';
        if (!value) invalid();
        return value + '[]'.repeat(dimensions);
    }
    const parameters: string[] = [];
    if (method) {
        if (!descriptor.startsWith('(')) invalid();
        while (descriptor[offset] !== ')') parameters.push(type(false));
        offset++;
    }
    const result = type(method);
    if (offset !== descriptor.length) invalid();
    return { parameters, result };
}
